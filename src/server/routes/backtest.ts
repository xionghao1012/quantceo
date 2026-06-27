import { Router } from 'express'
import { eq, sql, desc } from 'drizzle-orm'
import crypto from 'crypto'
import { db } from '../db/db.js'
import { strategies, backtests, stocks, userStrategies, strategyBacktestRuns } from '../db/schema.js'
import { getOrFetchKlines } from '../data/cache.js'
import { runBacktest } from '../backtest/index.js'
import { runStrategyBacktestAllPeriods, selectBestStrategy } from '../services/backtestStrategyService.js'
import type { BacktestResult } from '../../shared/types.js'

const router = Router()

function withCache(res: import('express').Response, data: unknown, maxAge = 60): boolean {
  const body = JSON.stringify(data)
  const etag = crypto.createHash('md5').update(body).digest('hex')
  if (res.req.headers['if-none-match'] === etag) {
    res.status(304).end()
    return true
  }
  res.setHeader('ETag', etag)
  res.setHeader('Cache-Control', `public, max-age=${maxAge}`)
  return false
}

router.post('/', async (req, res) => {
  const { code, strategyId, userStrategyId, startDate, endDate, initialCapital, custom, rules: directRules, strategyName: directName } = req.body as {
    code?: string
    strategyId?: number
    userStrategyId?: number
    startDate?: string
    endDate?: string
    initialCapital?: number
    custom?: boolean
    rules?: any[]
    strategyName?: string
  }
  const resultCache = await getOrFetchKlines(code!)
  if (resultCache.klines.length === 0) return res.status(404).json({ error: 'No data' })
  const klineData = resultCache.klines

  let rules: any[]
  let strategyName = ''

  if (directRules) {
    rules = directRules
    strategyName = directName || '自定义参数'
  } else if (custom && userStrategyId) {
    const rows = await db.select().from(userStrategies).where(eq(userStrategies.id, userStrategyId)).limit(1)
    if (!rows[0]) return res.status(404).json({ error: '自定义策略不存在' })
    const config = typeof rows[0].config === 'string' ? JSON.parse(rows[0].config) : rows[0].config
    rules = config.rules || []
    strategyName = rows[0].name
  } else {
    const rows = await db.select().from(strategies).where(eq(strategies.id, strategyId!)).limit(1)
    if (!rows[0]) return res.status(404).json({ error: 'Strategy not found' })
    rules = (rows[0].config as any).rules as any[]
    strategyName = rows[0].name
  }

  const result = runBacktest(klineData, { code: code!, strategyId: String(strategyId || userStrategyId), startDate: startDate!, endDate: endDate!, initialCapital: initialCapital! }, rules)

  if (!directRules) {
    await db.insert(backtests).values({
      code: code!, strategyId: strategyId || userStrategyId!, startDate: startDate!, endDate: endDate!,
      initialCapital: String(initialCapital),
      result: JSON.parse(JSON.stringify(result)),
    })
  }

  res.json(result)
})

router.get('/', async (_req, res) => {
  const rows = await db.select().from(backtests).orderBy(desc(backtests.createdAt)).limit(100)
  res.json(rows)
})

router.get('/history', async (req, res) => {
  const { limit = '100' } = req.query as Record<string, string>
  const rows = await db.select().from(backtests).orderBy(desc(backtests.createdAt)).limit(Number(limit))
  if (withCache(res, rows, 30)) return
  res.json(rows)
})

router.get('/compare', async (req, res) => {
  const { ids } = req.query as { ids?: string }
  if (!ids) return res.status(400).json({ error: 'Missing ids' })
  const idList = ids.split(',').map(Number).filter(Boolean)
  if (idList.length < 2) return res.status(400).json({ error: 'Need at least 2 IDs' })
  const rows = await db.select().from(backtests).where(sql`${backtests.id} = ANY(${idList})`)
  const parsed = rows.map((r: any) => ({ ...r, result: typeof r.result === 'string' ? JSON.parse(r.result) : r.result }))
  if (withCache(res, parsed, 60)) return
  res.json(parsed)
})

router.get('/leaderboard', async (req, res) => {
  const { limit = '50' } = req.query as Record<string, string>
  const rows = await db.select().from(backtests).orderBy(desc(backtests.createdAt)).limit(Number(limit))
  const parsed = rows.map((r: any) => {
    const result = typeof r.result === 'string' ? JSON.parse(r.result) : (r.result || {})
    return {
      id: r.id,
      code: r.code,
      strategyId: r.strategyId,
      startDate: r.startDate,
      endDate: r.endDate,
      initialCapital: r.initialCapital,
      createdAt: r.createdAt,
      totalReturn: result.totalReturn || 0,
      annualReturn: result.annualReturn || 0,
      sharpe: result.sharpe || 0,
      maxDrawdown: result.maxDrawdown || 0,
      winRate: result.winRate || 0,
      tradeCount: result.tradeCount || 0,
    }
  })
  parsed.sort((a, b) => b.totalReturn - a.totalReturn)
  const result = parsed.slice(0, Number(limit))
  if (withCache(res, result, 60)) return
  res.json(result)
})

const SCORING_STRATEGY_KEYS = [
  'oversold_reversal', 'volume_breakout', 'bottom_start',
  'strong_pullback', 'bullish_composite', 'extreme_oversold',
]

router.get('/strategies/results', async (req, res) => {
  try {
    const rows = await db.select()
      .from(strategyBacktestRuns)
      .orderBy(sql`created_at DESC`)
      .limit(60)

    const grouped = new Map<string, any[]>()
    for (const r of rows) {
      const key = r.strategyKey
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push({
        id: r.id,
        holdingDays: r.holdingPeriods?.[0] || 5,
        totalReturn: Number(r.totalReturn),
        annualReturn: Number(r.annualReturn),
        sharpe: Number(r.sharpe),
        maxDrawdown: Number(r.maxDrawdown),
        winRate: Number(r.winRate),
        tradeCount: r.tradeCount,
        avgHoldDays: Number(r.avgHoldDays),
        return1d: Number(r.return1d),
        return3d: Number(r.return3d),
        return5d: Number(r.return5d),
        return10d: Number(r.return10d),
        endDate: r.endDate,
        startDate: r.startDate,
        createdAt: r.createdAt,
      })
    }

    const recommendation = selectBestStrategy(
      Array.from(grouped.entries()).flatMap(([k, results]) =>
        results.map((r: any) => ({
          strategyKey: k,
          strategyLabel: r.strategyKey,
          stats: r,
          holdingDays: r.holdingDays,
        }))
      )
    )

    res.json({
      strategies: Array.from(grouped.entries()).map(([key, results]) => ({
        key,
        results: results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      })),
      recommendation,
      updatedAt: rows.length > 0 ? rows[0].createdAt : null,
    })
  } catch (e: any) {
    console.error('Strategy results error:', e)
    res.status(500).json({ error: e.message })
  }
})

router.get('/strategies/results/:key', async (req, res) => {
  try {
    const { key } = req.params
    const rows = await db.select()
      .from(strategyBacktestRuns)
      .where(eq(strategyBacktestRuns.strategyKey, key))
      .orderBy(sql`created_at DESC`)
      .limit(10)

    if (rows.length === 0) return res.status(404).json({ error: 'No results for this strategy' })

    const latest = rows[0]
    res.json({
      key: latest.strategyKey,
      label: latest.strategyLabel,
      stats: {
        totalReturn: Number(latest.totalReturn),
        annualReturn: Number(latest.annualReturn),
        sharpe: Number(latest.sharpe),
        maxDrawdown: Number(latest.maxDrawdown),
        winRate: Number(latest.winRate),
        tradeCount: latest.tradeCount,
        avgHoldDays: Number(latest.avgHoldDays),
        return1d: Number(latest.return1d),
        return3d: Number(latest.return3d),
        return5d: Number(latest.return5d),
        return10d: Number(latest.return10d),
      },
      trades: latest.trades,
      equityCurve: latest.equityCurve,
      startDate: latest.startDate,
      endDate: latest.endDate,
      topN: latest.topN,
      updatedAt: latest.createdAt,
    })
  } catch (e: any) {
    console.error('Strategy detail error:', e)
    res.status(500).json({ error: e.message })
  }
})

router.post('/strategies/run', async (req, res) => {
  try {
    const {
      strategyKey = 'all',
      startDate = '',
      endDate = '',
      topN = 5,
      initialCapital = 1000000,
    } = req.body

    const keys = strategyKey === 'all' ? SCORING_STRATEGY_KEYS : [strategyKey]

    const { rows: strategiesRows } = await db.execute(sql`
      SELECT config FROM strategies WHERE config->>'type' = 'scoring_strategy'
    `)

    const results: any[] = []

    for (const row of strategiesRows) {
      const config = row.config as any
      if (!keys.includes(config.key)) continue

      const sd = startDate || (await getEarliestDate())
      const ed = endDate || new Date().toISOString().split('T')[0]

      const allPeriods = await runStrategyBacktestAllPeriods({
        strategyKey: config.key,
        strategyLabel: config.label,
        scoreSQL: config.scoreSQL || '',
        conditionsSQL: (config.conditions || []).map((c: any) => c.sql),
        startDate: sd,
        endDate: ed,
        initialCapital,
        topN,
        commissionRate: 0.00025,
        stampTaxRate: 0.001,
        slippage: 0.001,
      })

      for (const [holdingDays, output] of Object.entries(allPeriods) as any as any) {
        const period = Number(holdingDays)
        const upsertSQL = sql`
          INSERT INTO strategy_backtest_runs (
            strategy_key, strategy_label, start_date, end_date,
            trade_direction, holding_periods, initial_capital, top_n, allocation,
            commission_rate, stamp_tax_rate, slippage,
            total_return, annual_return, sharpe, max_drawdown,
            win_rate, trade_count, avg_hold_days,
            return_1d, return_3d, return_5d, return_10d,
            trades, equity_curve, triggered_by, computation_ms
          ) VALUES (
            ${config.key}, ${config.label}, ${sd}, ${ed},
            'long', ${sql.raw(`ARRAY[${period}]::integer[]`)}, ${initialCapital}, ${topN}, 'score_weighted',
            0.00025, 0.001, 0.001,
            ${output.stats.totalReturn}, ${output.stats.annualReturn}, ${output.stats.sharpe}, ${output.stats.maxDrawdown},
            ${output.stats.winRate}, ${output.stats.tradeCount}, ${output.stats.avgHoldDays},
            ${output.stats.return1d}, ${output.stats.return3d}, ${output.stats.return5d}, ${output.stats.return10d},
            ${JSON.stringify(output.trades)}::jsonb, ${JSON.stringify(output.equityCurve)}::jsonb, 'manual', 0
          )
          ON CONFLICT (strategy_key, start_date, end_date, top_n)
          DO UPDATE SET
            total_return = EXCLUDED.total_return,
            annual_return = EXCLUDED.annual_return,
            sharpe = EXCLUDED.sharpe,
            max_drawdown = EXCLUDED.max_drawdown,
            win_rate = EXCLUDED.win_rate,
            trade_count = EXCLUDED.trade_count,
            avg_hold_days = EXCLUDED.avg_hold_days,
            return_1d = EXCLUDED.return_1d,
            return_3d = EXCLUDED.return_3d,
            return_5d = EXCLUDED.return_5d,
            return_10d = EXCLUDED.return_10d,
            trades = EXCLUDED.trades,
            equity_curve = EXCLUDED.equity_curve,
            triggered_by = 'manual',
            created_at = NOW()
        `
        await db.execute(upsertSQL)

        results.push({
          strategyKey: config.key,
          strategyLabel: config.label,
          holdingDays: period,
          stats: output.stats,
          tradeCount: output.trades.length,
        })
      }
    }

    res.json({ done: true, count: results.length, results })
  } catch (e: any) {
    console.error('Strategy backtest run error:', e)
    res.status(500).json({ error: e.message })
  }
})

async function getEarliestDate(): Promise<string> {
  const { rows } = await db.execute(sql`
    SELECT MIN(metric_date) AS d FROM daily_metrics
  `)
  return (rows[0] as any)?.d || '2025-01-01'
}

router.post('/pdf', async (_req, res) => {
  res.status(501).json({ error: 'PDF导出功能尚未实现' })
})

router.post('/optimize', async (_req, res) => {
  res.status(501).json({ error: '参数优化功能已迁移至 /api/strategy/optimize' })
})

router.post('/walkforward', async (_req, res) => {
  res.status(501).json({ error: '滚动优化功能尚未实现' })
})

router.post('/portfolio', async (req, res) => {
  const { code, startDate, endDate } = req.body as any
  if (!code || !startDate || !endDate) {
    return res.status(400).json({ error: '缺少必要参数' })
  }
  const resultCache = await getOrFetchKlines(code)
  if (resultCache.klines.length === 0) return res.status(404).json({ error: 'No data' })
  const result = runBacktest(JSON.parse(JSON.stringify(resultCache.klines)), {
    code, strategyId: 'buy_hold', startDate, endDate, initialCapital: 100000,
  }, [])
  res.json(result)
})

router.post('/portfolio-enhanced', async (req, res) => {
  const { code, startDate, endDate } = req.body as any
  if (!code || !startDate || !endDate) {
    return res.status(400).json({ error: '缺少必要参数' })
  }
  const resultCache = await getOrFetchKlines(code)
  if (resultCache.klines.length === 0) return res.status(404).json({ error: 'No data' })
  const result = runBacktest(JSON.parse(JSON.stringify(resultCache.klines)), {
    code, strategyId: 'rsi', startDate, endDate, initialCapital: 100000,
  }, [])
  res.json(result)
})

export default router
