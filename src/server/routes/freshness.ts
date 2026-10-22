import { Router } from 'express'
import { sql } from 'drizzle-orm'
import { db } from '../db/db.js'
import { getSchedulerLogRepository } from '../repositories/ISchedulerLogRepository.js'

const router = Router()

/**
 * 数据可信度：每个数据页都露一句「数据截至哪天、覆盖多少只」，
 * 用户才知道这些数字不是编的（这是与免费行情站的第一差异点）。
 */
router.get('/freshness', async (_req, res) => {
  try {
    // 行情日期取几只主力票的 max(date)：klines 上没有单独的 date 索引，
    // 全表 max(date) 要扫 1600 万行、7 秒，走 code 索引只要毫秒级
    const counts = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM stocks) AS stocks,
        (SELECT count(*)::int FROM daily_metrics) AS indicators,
        (SELECT max(metric_date)::text FROM daily_metrics) AS metrics_date,
        (SELECT max(date)::text FROM klines
          WHERE code IN ('600519', '000001', '600036', '601318', '000858')) AS kline_date
    `)
    const row = (counts as any).rows?.[0] || {}
    let lastUpdate = ''
    try {
      const last = await getSchedulerLogRepository().findLastSuccess('daily_data')
      lastUpdate = last || ''
    } catch {}

    res.json({
      // 行情与指标是两条链路，各自报日期，别用一个新的盖住旧的
      date: row.kline_date || row.metrics_date || '',
      metricsDate: row.metrics_date || '',
      stocks: row.stocks || 0,
      indicators: row.indicators || 0,
      lastUpdate,
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default router
