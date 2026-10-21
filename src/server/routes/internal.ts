import { Router } from 'express'
import { computeDailyMetrics } from '../services/scheduler.js'
import { computeLimitUpRecords } from '../services/limitUp.js'
import { db } from '../db/db.js'
import { eq, sql } from 'drizzle-orm'
import { requireInternal } from '../middleware/requireInternal.js'
import { runStrategyBacktestAllPeriods } from '../services/backtestStrategyService.js'
import { users } from '../db/schema.js'
import { analyzeAllPositions } from '../ai/positionAlert.js'
import { dispatchPush } from '../services/push/dispatcher.js'

const router = Router()
router.use(requireInternal)

router.post('/compute-metrics', async (_req, res) => {
  try {
    await computeDailyMetrics()
    res.json({ success: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/strategy-backtest', async (req, res) => {
  try {
    const { rows } = await db.execute(sql`
      SELECT config FROM strategies WHERE config->>'type' = 'scoring_strategy'
    `)

    const today = new Date().toISOString().split('T')[0]

    const { rows: earliest } = await db.execute(sql`
      SELECT MIN(metric_date) AS d FROM daily_metrics
    `)
    const startDate = (earliest[0] as any)?.d || '2025-01-01'

    const results: any[] = []
    for (const row of rows) {
      const config = row.config as any
      const allPeriods = await runStrategyBacktestAllPeriods({
        strategyKey: config.key,
        strategyLabel: config.label,
        scoreSQL: config.scoreSQL || '',
        conditionsSQL: (config.conditions || []).map((c: any) => c.sql),
        startDate,
        endDate: today,
        initialCapital: 1000000,
        topN: 5,
        commissionRate: 0.00025,
        stampTaxRate: 0.001,
        slippage: 0.001,
      })

      for (const [holdingDays, output] of Object.entries(allPeriods) as any) {
        const period = Number(holdingDays)
        await db.execute(sql`
          INSERT INTO strategy_backtest_runs (
            strategy_key, strategy_label, start_date, end_date,
            trade_direction, holding_periods, initial_capital, top_n, allocation,
            commission_rate, stamp_tax_rate, slippage,
            total_return, annual_return, sharpe, max_drawdown,
            win_rate, trade_count, avg_hold_days,
            return_1d, return_3d, return_5d, return_10d,
            trades, equity_curve, triggered_by, computation_ms
          ) VALUES (
            ${config.key}, ${config.label}, ${startDate}, ${today},
            'long', ${sql.raw(`ARRAY[${period}]::integer[]`)}, 1000000, 5, 'score_weighted',
            0.00025, 0.001, 0.001,
            ${output.stats.totalReturn}, ${output.stats.annualReturn}, ${output.stats.sharpe}, ${output.stats.maxDrawdown},
            ${output.stats.winRate}, ${output.stats.tradeCount}, ${output.stats.avgHoldDays},
            ${output.stats.return1d}, ${output.stats.return3d}, ${output.stats.return5d}, ${output.stats.return10d},
            ${JSON.stringify(output.trades)}::jsonb, ${JSON.stringify(output.equityCurve)}::jsonb, 'scheduler', 0
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
            triggered_by = 'scheduler',
            created_at = NOW()
        `)
        results.push({ strategyKey: config.key, holdingDays: period, totalReturn: output.stats.totalReturn })
      }
    }

    res.json({ success: true, results })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/compute-limit-up', async (req, res) => {
  const date = (req.body.date as string) || new Date().toISOString().split('T')[0]
  try {
    const written = await computeLimitUpRecords(date)
    res.json({ success: true, date, written })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/position-alerts', async (_req, res) => {
  try {
    const proUsers = await db.select().from(users).where(eq(users.role, 'premium'))
    const alerts: any[] = []
    for (const user of proUsers) {
      try {
        const userAlerts = await analyzeAllPositions(user.id)
        const sellAlerts = userAlerts.filter((a: any) => a.recommendation === 'sell' && a.confidence >= 60)
        if (sellAlerts.length === 0) continue

        const signals = sellAlerts.map((a: any) => ({
          code: a.code, name: a.name, direction: 'SELL',
          strength: Math.round(a.confidence / 20),
          strategyName: `AI预警卖出 置信${a.confidence}%`,
          price: String(a.currentPrice),
        }))
        let text = `AI持仓预警 ${new Date().toISOString().slice(0, 10)}\n`
        for (const a of sellAlerts) {
          text += `\n${a.code} ${a.name}: 建议卖出 置信${a.confidence}%`
          text += `\n  现价${a.currentPrice.toFixed(2)} 盈亏${a.pnlPercent.toFixed(1)}% 理由: ${a.reasoning}`
        }
        text += '\n\n⚠️ 不构成投资建议'

        await dispatchPush({ type: 'alert', signals, alertText: text })
        alerts.push({ userId: user.id, alerts: sellAlerts.length })
      } catch {}
    }
    res.json({ success: true, alerts })
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Pro module not available' })
  }
})

export default router
