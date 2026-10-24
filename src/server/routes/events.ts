import { Router } from 'express'
import { sql } from 'drizzle-orm'
import { db } from '../db/db.js'
import { appEvents } from '../db/schema.js'
import { optionalAuth } from '../middleware/auth.js'

const router = Router()

/** 只接受小写字母/数字/下划线，长度 1-50：防止把任意字符串写进索引列 */
const EVENT_RE = /^[a-z0-9_]{1,50}$/
const MAX_PROPS_BYTES = 2048

/**
 * 埋点上报。要求：
 * - 匿名也能上报（userId 为 null），但登录时带上 userId；
 * - props 只存结构化小数据（≤2KB），不存页面内容；
 * - 失败不影响用户操作（前端 fire-and-forget）。
 */
router.post('/', optionalAuth, async (req: any, res) => {
  const { event, props, path } = req.body || {}
  if (typeof event !== 'string' || !EVENT_RE.test(event)) {
    return res.status(400).json({ error: '无效的事件名' })
  }
  const safeProps = props && typeof props === 'object' ? props : {}
  let serialized = '{}'
  try {
    serialized = JSON.stringify(safeProps)
  } catch {
    return res.status(400).json({ error: 'props 无法序列化' })
  }
  if (serialized.length > MAX_PROPS_BYTES) {
    return res.status(413).json({ error: 'props 过大' })
  }

  try {
    await db.insert(appEvents).values({
      userId: req.user?.userId ?? null,
      event,
      props: safeProps,
      path: typeof path === 'string' ? path.slice(0, 200) : null,
    })
    res.json({ ok: true })
  } catch (e: any) {
    // 埋点失败不能影响用户：返回 200 但记录日志
    console.error('[events] 写入失败:', e.message)
    res.json({ ok: false })
  }
})

/** 汇总：按事件名计数（管理端看漏斗用） */
router.get('/summary', async (req, res) => {
  const days = Math.min(Number(req.query.days) || 7, 90)
  try {
    const r = await db.execute(sql`
      SELECT event, count(*)::int AS n,
             count(DISTINCT user_id)::int AS users
      FROM app_events
      WHERE created_at >= now() - (${days} || ' days')::interval
      GROUP BY event
      ORDER BY n DESC
    `) as any
    res.json({ days, events: r?.rows || [] })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default router
