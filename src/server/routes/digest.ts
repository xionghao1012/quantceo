import { Router } from 'express'
import { sql } from 'drizzle-orm'
import { db } from '../db/db.js'
import { optionalAuth } from '../middleware/auth.js'

const router = Router()

/**
 * 今日速览：首屏要回答的三个问题里，数据层能直接答的两个。
 *   1. 今天该看哪 3 只 —— 今天扫描出的最强买入信号（同一只票多个策略合并）
 *   2. 我的持仓有没有事 —— 持仓的最新价 / 盈亏 / 今日触发的资金流告警
 * （第三个问题「今天大盘怎么样」行情看板已有指数卡片和涨跌家数，不重复造。）
 */

/** 今天该看哪 3 只：同一天的最强买入信号，按票聚合策略 */
async function topPicks(limit = 3) {
  const res = await db.execute(sql`
    SELECT s.code,
           max(s.name) AS name,
           max(s.strength) AS strength,
           max(s.price)::text AS price,
           string_agg(DISTINCT s.strategy_name, ' · ') AS strategies,
           count(*)::int AS hits,
           m.change_pct::text AS change_pct
    FROM signals s
    -- 涨跌直接从 K 线算：daily_metrics 比 klines 晚一天，
    -- 同屏混用两个源会出现「价格是今天的、涨跌是昨天的」
    LEFT JOIN LATERAL (
      SELECT round((k.close - k.prev) / k.prev * 100, 2) AS change_pct
      FROM (
        SELECT close, lag(close) OVER (ORDER BY date) AS prev
        FROM klines kk
        WHERE kk.code = s.code
        ORDER BY date DESC
        LIMIT 2
      ) k
      WHERE k.prev IS NOT NULL
      LIMIT 1
    ) m ON TRUE
    WHERE s.scan_date = (SELECT max(scan_date) FROM signals)
      AND s.direction = 'BUY'
    GROUP BY s.code, m.change_pct
    -- 同强度先看多策略共振（共振比单策略可信），再看当日相对强度，
    -- 避免 3 只票全是跌停/大跌的同一副面孔
    ORDER BY max(s.strength) DESC, count(*) DESC, m.change_pct DESC NULLS LAST
    LIMIT ${limit}
  `)
  return (res as any).rows || []
}

/** 我的持仓：最新价 + 盈亏 + 今日触发的资金流告警 */
async function myPositions(userId: number) {
  const res = await db.execute(sql`
    SELECT p.code,
           max(p.name) AS name,
           max(p.quantity)::int AS quantity,
           max(p.entry_price)::text AS entry_price,
           (SELECT k.close::text FROM klines k
             WHERE k.code = p.code
             ORDER BY k.date DESC LIMIT 1) AS price,
           (SELECT round((a.close - a.prev) / a.prev * 100, 2)::text FROM (
              SELECT close, lag(close) OVER (ORDER BY date) AS prev
              FROM klines kk WHERE kk.code = p.code ORDER BY date DESC LIMIT 2
            ) a WHERE a.prev IS NOT NULL LIMIT 1) AS change_pct,
           (SELECT count(*)::int FROM money_flow_alerts a
             WHERE a.code = p.code
               AND a.created_at >= date_trunc('day', now())) AS alerts_today
    FROM positions p
    WHERE p.user_id = ${userId} AND p.status = 'open'
    GROUP BY p.code
    ORDER BY max(p.id)
  `)
  return (res as any).rows || []
}

// optionalAuth：有 token 就带上用户（持仓要用户身份），没登录也能看推荐
router.get('/today', optionalAuth, async (req, res) => {
  try {
    const [picks, scanDate] = await Promise.all([
      topPicks(3),
      db.execute(sql`SELECT max(scan_date)::text AS d FROM signals`).then((r: any) => r.rows?.[0]?.d || ''),
    ])

    let positions: any[] = []
    if (req.user?.userId) {
      try {
        positions = await myPositions(req.user.userId)
      } catch (e: any) {
        console.error('[digest] 持仓查询失败:', e.message)
      }
    }

    res.json({ date: scanDate, picks, positions })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default router
