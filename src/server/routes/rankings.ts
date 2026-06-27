import { Router } from 'express'
import { eq, desc, asc, and, sql } from 'drizzle-orm'
import { db } from '../db/db.js'
import { dailyMetrics, strategies as strategiesTable } from '../db/schema.js'

const router = Router()

const BOARD_LABELS: Record<string, string> = {
  hsb: '沪深主板',
  kcb: '科创板',
  cyb: '创业板',
  all: '全部',
}

const METRIC_LABELS: Record<string, string> = {
  rsi: 'RSI',
  change_pct: '涨跌幅',
  vol_ratio: '成交量比',
  macd_signal: 'MACD信号',
  bb_position: '布林位置',
  ma_alignment: '均线多头',
  volatility: '波动率',
  momentum: '动量',
}

const METRIC_COLS: Record<string, string> = {
  rsi: 'rsi',
  change_pct: 'change_pct',
  vol_ratio: 'vol_ratio',
  macd_signal: 'macd_signal',
  bb_position: 'bb_position',
  ma_alignment: 'ma_alignment',
  volatility: 'volatility',
  momentum: 'momentum',
}

const METRIC_SORT: Record<string, 'asc' | 'desc'> = {
  rsi: 'asc',
  change_pct: 'desc',
  vol_ratio: 'desc',
  macd_signal: 'desc',
  bb_position: 'desc',
  ma_alignment: 'desc',
  volatility: 'desc',
  momentum: 'desc',
}

interface StrategyDef {
  key: string
  label: string
  desc: string
  scoreLabel: string
  scoreUnit: string
  conditions: (sql: any) => any[]
  scoreSQL: string
  sort: 'asc' | 'desc'
}

let strategiesCache: StrategyDef[] | null = null

async function loadStrategies(): Promise<StrategyDef[]> {
  if (strategiesCache) return strategiesCache
  const rows = await db.select({ name: strategiesTable.name, config: strategiesTable.config })
    .from(strategiesTable)
    .where(sql`config->>'type' = 'scoring_strategy'`)
  strategiesCache = rows.map(r => {
    const c = r.config as any
    return {
      key: c.key,
      label: c.label,
      desc: c.desc,
      scoreLabel: c.label + '评分',
      scoreUnit: '分',
      conditions: () => (c.conditions || []).map((cond: any) => sql.raw(cond.sql)),
      scoreSQL: c.scoreSQL || '',
      sort: c.sort || 'desc',
    }
  })
  return strategiesCache
}

function invalidateStrategiesCache() {
  strategiesCache = null
}

router.get('/', async (req, res) => {
  try {
    const date = req.query.date as string || new Date().toISOString().split('T')[0]
    const board = (req.query.board as string) || 'all'
    const metric = (req.query.metric as string) || 'rsi'
    const limit = Math.min(Number(req.query.limit) || 100, 200)

    const validMetric = METRIC_LABELS[metric] ? metric : 'rsi'
    const validBoard = BOARD_LABELS[board] ? board : 'all'
    const sortDir = METRIC_SORT[validMetric] || 'asc'
    const col = METRIC_COLS[validMetric]

    const conditions = [eq(dailyMetrics.metricDate, date)]
    if (validBoard !== 'all') {
      conditions.push(eq(dailyMetrics.board, validBoard))
    }

    const orderFn = sortDir === 'asc' ? asc : desc

    const rows = await db.select({
      code: dailyMetrics.code,
      name: dailyMetrics.name,
      exchange: dailyMetrics.exchange,
      board: dailyMetrics.board,
      rsi: dailyMetrics.rsi,
      changePct: dailyMetrics.changePct,
      volRatio: dailyMetrics.volRatio,
      macdSignal: dailyMetrics.macdSignal,
      bbPosition: dailyMetrics.bbPosition,
      maAlignment: dailyMetrics.maAlignment,
      volatility: dailyMetrics.volatility,
      momentum: dailyMetrics.momentum,
    })
      .from(dailyMetrics)
      .where(and(...conditions))
      .orderBy(orderFn(sql`${sql.raw(col)}`))
      .limit(limit)

    const rankings = rows.map((row, idx) => ({
      rank: idx + 1,
      code: row.code,
      name: row.name,
      exchange: row.exchange,
      board: row.board,
      value: (() => {
        const keyMap: Record<string, string> = {
          rsi: 'rsi', change_pct: 'changePct', vol_ratio: 'volRatio',
          macd_signal: 'macdSignal', bb_position: 'bbPosition',
          ma_alignment: 'maAlignment', volatility: 'volatility', momentum: 'momentum',
        }
        const k = keyMap[validMetric]
        const v = k ? (row as any)[k] : null
        return v !== null && v !== undefined ? Number(v) : null
      })(),
      changePct: row.changePct !== null ? Number(row.changePct) : null,
      rsi: row.rsi !== null ? Number(row.rsi) : null,
      volRatio: row.volRatio !== null ? Number(row.volRatio) : null,
      macdSignal: row.macdSignal !== null ? Number(row.macdSignal) : null,
      bbPosition: row.bbPosition !== null ? Number(row.bbPosition) : null,
      maAlignment: row.maAlignment !== null ? Number(row.maAlignment) : null,
      volatility: row.volatility !== null ? Number(row.volatility) : null,
      momentum: row.momentum !== null ? Number(row.momentum) : null,
    }))

    const total = rows.length
    const hasData = total > 0

    res.json({
      date,
      board: validBoard,
      boardLabel: BOARD_LABELS[validBoard],
      metric: validMetric,
      metricLabel: METRIC_LABELS[validMetric],
      sort: sortDir,
      total,
      hasData,
      rankings,
    })
  } catch (e: any) {
    console.error('Rankings error:', e)
    res.status(500).json({ error: e.message })
  }
})

router.get('/strategies', async (req, res) => {
  try {
    const date = req.query.date as string || new Date().toISOString().split('T')[0]
    const board = (req.query.board as string) || 'all'
    const strategyKey = (req.query.strategy as string) || 'oversold_reversal'
    const limit = Math.min(Number(req.query.limit) || 100, 200)

    const allStrategies = await loadStrategies()
    const strategy = allStrategies.find(s => s.key === strategyKey)
    if (!strategy) return res.status(400).json({ error: '未知策略' })

    const conditions: any[] = [eq(dailyMetrics.metricDate, date)]
    if (board !== 'all') conditions.push(eq(dailyMetrics.board, board))
    conditions.push(...strategy.conditions(sql))

    const orderDir = strategy.sort === 'asc' ? asc : desc

    const rows = await db.select({
      code: dailyMetrics.code,
      name: dailyMetrics.name,
      exchange: dailyMetrics.exchange,
      board: dailyMetrics.board,
      rsi: dailyMetrics.rsi,
      changePct: dailyMetrics.changePct,
      volRatio: dailyMetrics.volRatio,
      macdSignal: dailyMetrics.macdSignal,
      bbPosition: dailyMetrics.bbPosition,
      maAlignment: dailyMetrics.maAlignment,
      volatility: dailyMetrics.volatility,
      momentum: dailyMetrics.momentum,
    })
      .from(dailyMetrics)
      .where(and(...conditions))
      .orderBy(orderDir(sql`${sql.raw(strategy.scoreSQL)}`))
      .limit(limit)

    const rankings = rows.map((row, idx) => {
      const rsi = row.rsi !== null ? Number(row.rsi) : null
      const changePct = row.changePct !== null ? Number(row.changePct) : null
      const volRatio = row.volRatio !== null ? Number(row.volRatio) : null
      const macdSignal = row.macdSignal !== null ? Number(row.macdSignal) : null
      const bbPosition = row.bbPosition !== null ? Number(row.bbPosition) : null
      const maAlignment = row.maAlignment !== null ? Number(row.maAlignment) : null
      const momentum = row.momentum !== null ? Number(row.momentum) : null

      const score = computeScore(strategy, rsi, changePct, volRatio, macdSignal, bbPosition, maAlignment, momentum)

      return {
        rank: idx + 1,
        code: row.code,
        name: row.name,
        exchange: row.exchange,
        board: row.board,
        score,
        rsi,
        changePct,
        volRatio,
        macdSignal,
        bbPosition,
        maAlignment,
        momentum,
      }
    })

    res.json({
      date,
      board,
      strategy: strategy.key,
      strategyLabel: strategy.label,
      strategyDesc: strategy.desc,
      scoreLabel: strategy.scoreLabel,
      scoreUnit: strategy.scoreUnit,
      total: rankings.length,
      hasData: rankings.length > 0,
      rankings,
    })
  } catch (e: any) {
    console.error('Strategy rankings error:', e)
    res.status(500).json({ error: e.message })
  }
})

router.get('/strategies/list', async (_req, res) => {
  const allStrategies = await loadStrategies()
  res.json({ strategies: allStrategies.map(s => ({
    key: s.key,
    label: s.label,
    desc: s.desc,
    scoreLabel: s.scoreLabel,
    scoreUnit: s.scoreUnit,
  }))})
})

function computeScore(
  strategy: StrategyDef,
  rsi: number | null,
  changePct: number | null,
  volRatio: number | null,
  macdSignal: number | null,
  bbPosition: number | null,
  maAlignment: number | null,
  momentum: number | null,
): number {
  const R = (v: number | null, fallback: number) => v !== null && v !== undefined ? v : fallback
  switch (strategy.key) {
    case 'oversold_reversal':
      return Math.round(
        Math.max(0, (30 - R(rsi, 30)) / 30 * 40) +
        Math.max(0, Math.min(R(macdSignal, 0) / 2, 1) * 30) +
        Math.max(0, Math.min(-R(momentum, 0) / 10, 1) * 30)
      )
    case 'volume_breakout':
      return Math.round(
        Math.max(0, Math.min((R(volRatio, 1) - 1) / 3, 1) * 35) +
        Math.max(0, Math.min((R(changePct, 0) - 3) / 7, 1) * 35) +
        Math.max(0, R(bbPosition, 0) / 100 * 30)
      )
    case 'bottom_start':
      return Math.round(
        Math.max(0, (35 - R(rsi, 35)) / 35 * 40) +
        Math.max(0, Math.min((R(volRatio, 1) - 1) / 4, 1) * 30) +
        Math.max(0, Math.min(R(changePct, 0) / 5, 1) * 30)
      )
    case 'strong_pullback':
      return Math.round(
        Math.max(0, (R(rsi, 50) - 50) / 50 * 30) +
        Math.max(0, Math.min(-R(changePct, 0) / 10, 1) * 40) +
        Math.max(0, Math.min((R(volRatio, 1) - 1) / 3, 1) * 30)
      )
    case 'bullish_composite':
      return Math.round(
        Math.max(0, (R(rsi, 50) - 50) / 50 * 25) +
        Math.max(0, Math.min(R(macdSignal, 0) / 3, 1) * 25) +
        (R(maAlignment, 0) > 0 ? 25 : 0) +
        Math.max(0, Math.min(R(momentum, 0) / 10, 1) * 25)
      )
    case 'extreme_oversold':
      return Math.round(
        Math.max(0, (20 - R(rsi, 20)) / 20 * 60) +
        Math.max(0, Math.min((0.6 - R(volRatio, 0)) / 0.5, 1) * 40)
      )
    default:
      return 0
  }
}

router.get('/available-dates', async (_req, res) => {
  try {
    const { rows } = await db.execute(sql`
      SELECT DISTINCT metric_date
      FROM daily_metrics
      ORDER BY metric_date DESC
      LIMIT 30
    `)
    const dates = rows.map((r: any) => r.metric_date)
    res.json({ dates })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default router
