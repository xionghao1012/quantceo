import { Router } from 'express'
import { db } from '../db/db.js'
import { moneyFlowDaily, moneyFlowAlerts, moneyFlowRealtime } from '../db/schema.js'
import { eq, desc, sql, and, gte, count, sum, avg } from 'drizzle-orm'
import { getMoneyFlow5d, getRealtimeMoneyFlow, getConnectionStatus } from '../services/moneyFlowService.js'
import { createAlertConfig, listAlertConfigs, deleteAlertConfig, toggleAlertConfig } from '../services/moneyFlowAlertEngine.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.get('/daily', async (req, res) => {
  const code = req.query.code as string
  if (!code) return res.status(400).json({ error: 'code required' })
  const rows = await db.select().from(moneyFlowDaily)
    .where(eq(moneyFlowDaily.code, code))
    .orderBy(desc(moneyFlowDaily.tradeDate))
    .limit(10)
  res.json({ code, data: rows })
})

router.get('/5d/:code', async (req, res) => {
  const result = await getMoneyFlow5d(req.params.code)
  res.json(result || { netInflowMain: 0, count: 0 })
})

router.get('/stock/:code/history', async (req, res) => {
  const code = req.params.code
  const days = Math.min(parseInt(req.query.days as string) || 20, 60)
  const rows = await db.select().from(moneyFlowDaily)
    .where(eq(moneyFlowDaily.code, code))
    .orderBy(desc(moneyFlowDaily.tradeDate))
    .limit(days)
  const data = rows.reverse().map(r => ({
    date: r.tradeDate,
    close: Number(r.closePrice || 0),
    changePct: Number(r.changePct || 0),
    netInflowSuperLarge: Number(r.netInflowSuperLarge || 0),
    netInflowLarge: Number(r.netInflowLarge || 0),
    netInflowMedium: Number(r.netInflowMedium || 0),
    netInflowSmall: Number(r.netInflowSmall || 0),
    netInflowMain: Number(r.netInflowMain || 0),
    netInflowMainPct: Number(r.netInflowMainPct || 0),
  }))
  res.json({ code, days, data })
})

router.get('/stock/:code/timeseries', async (req, res) => {
  const code = req.params.code
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const rows = await db.select().from(moneyFlowRealtime)
    .where(and(
      eq(moneyFlowRealtime.code, code),
      gte(moneyFlowRealtime.updateTime, today),
    ))
    .orderBy(moneyFlowRealtime.updateTime)
  const data = rows.map(r => ({
    time: r.updateTime,
    close: Number(r.closePrice || 0),
    netInflowSuperLarge: Number(r.netInflowSuperLarge || 0),
    netInflowLarge: Number(r.netInflowLarge || 0),
    netInflowMedium: Number(r.netInflowMedium || 0),
    netInflowSmall: Number(r.netInflowSmall || 0),
    netInflowMain: Number(r.netInflowMain || 0),
    netInflowMainPct: Number(r.netInflowMainPct || 0),
  }))
  res.json({ code, data })
})

router.get('/realtime/:code', async (req, res) => {
  const data = await getRealtimeMoneyFlow(req.params.code)
  if (!data) return res.status(404).json({ error: 'No data' })
  res.json(data)
})

router.get('/status', async (_req, res) => {
  res.json(getConnectionStatus())
})

router.post('/alerts/configs', requireAuth, async (req, res) => {
  const userId = req.user!.userId
  if (!userId) return res.status(401).json({ error: 'Unauthorized' })
  const { code, name, thresholdType, thresholdValue, direction, techResonanceEnabled, techResonanceMacd, techResonanceMa, basicFilterEnabled, smartFilterEnabled } = req.body
  if (!thresholdType || thresholdValue == null) {
    return res.status(400).json({ error: 'thresholdType and thresholdValue required' })
  }
  const id = await createAlertConfig(userId, { code, name, thresholdType, thresholdValue, direction, techResonanceEnabled, techResonanceMacd, techResonanceMa, basicFilterEnabled, smartFilterEnabled })
  res.json({ id })
})

router.get('/alerts/configs', requireAuth, async (req, res) => {
  const userId = req.user!.userId
  if (!userId) return res.status(401).json({ error: 'Unauthorized' })
  const code = req.query.code as string | undefined
  const configs = await listAlertConfigs(userId)
  if (code) return res.json(configs.filter(c => c.code === code))
  res.json(configs)
})

router.delete('/alerts/configs/:id', requireAuth, async (req, res) => {
  const userId = req.user!.userId
  if (!userId) return res.status(401).json({ error: 'Unauthorized' })
  const ok = await deleteAlertConfig(userId, parseInt(String(req.params.id)))
  res.json({ success: ok })
})

router.patch('/alerts/configs/:id', requireAuth, async (req, res) => {
  const userId = req.user!.userId
  if (!userId) return res.status(401).json({ error: 'Unauthorized' })
  const { enabled } = req.body
  const ok = await toggleAlertConfig(userId, parseInt(String(req.params.id)), !!enabled)
  res.json({ success: ok })
})

router.get('/alerts', async (_req, res) => {
  const rows = await db.select().from(moneyFlowAlerts)
    .where(eq(moneyFlowAlerts.notified, false))
    .orderBy(desc(moneyFlowAlerts.createdAt))
    .limit(50)
  res.json(rows)
})

router.get('/top20', async (req, res) => {
  const window = (req.query.window as string) || '1d'
  const order = (req.query.order as string) === 'outflow' ? 'asc' : 'desc'
  const sortBy = (req.query.sortBy as string) || 'inflow'
  const limit = Math.min(Number(req.query.limit) || 50, 100)

  let data: any[]

  if (window === '1d') {
    // 实时数据：取最近30分钟内的记录
    const recent = new Date()
    recent.setMinutes(recent.getMinutes() - 30)

    const rows = await db
      .select({
        code: moneyFlowRealtime.code,
        name: moneyFlowRealtime.name,
        netInflowMain: moneyFlowRealtime.netInflowMain,
        netInflowMainPct: moneyFlowRealtime.netInflowMainPct,
        closePrice: moneyFlowRealtime.closePrice,
        updateTime: moneyFlowRealtime.updateTime,
      })
      .from(moneyFlowRealtime)
      .where(gte(moneyFlowRealtime.updateTime, recent))
      .orderBy(order === 'desc' ? desc(moneyFlowRealtime.netInflowMain) : sql`${moneyFlowRealtime.netInflowMain} ASC`)
      .limit(limit)

    data = rows.map((r, i) => ({
      rank: i + 1,
      code: r.code,
      name: r.name,
      netInflowMain: Number(r.netInflowMain || 0),
      netInflowMainPct: Number(r.netInflowMainPct || 0),
      closePrice: Number(r.closePrice || 0),
      updateTime: r.updateTime,
      trend: '—',
    }))
  } else {
    // 历史聚合：moneyFlowDaily 多日窗口
    const days = window === '5d' ? 5 : window === '10d' ? 10 : 20
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)

    const rows = await db
      .select({
        code: moneyFlowDaily.code,
        name: moneyFlowDaily.name,
        netInflowMain: sum(sql`${moneyFlowDaily.netInflowMain}::numeric`),
        netInflowMainPct: avg(sql`${moneyFlowDaily.netInflowMainPct}::numeric`),
        count: count(),
      })
      .from(moneyFlowDaily)
      .where(gte(moneyFlowDaily.tradeDate, cutoff.toISOString().split('T')[0]))
      .groupBy(moneyFlowDaily.code, moneyFlowDaily.name)
      .orderBy(
        sortBy === 'inflowRate'
          ? (order === 'desc' ? desc(avg(sql`${moneyFlowDaily.netInflowMainPct}::numeric`)) : avg(sql`${moneyFlowDaily.netInflowMainPct}::numeric`))
          : (order === 'desc' ? desc(sum(sql`${moneyFlowDaily.netInflowMain}::numeric`)) : sum(sql`${moneyFlowDaily.netInflowMain}::numeric`))
      )
      .limit(limit)

    data = rows.map((r, i) => {
      const netInflowMain = Number(r.netInflowMain || 0)
      const netInflowMainPct = Number(r.netInflowMainPct || 0)
      return {
        rank: i + 1,
        code: r.code,
        name: r.name,
        netInflowMain,
        netInflowMainPct: Number(netInflowMainPct.toFixed(2)),
        closePrice: 0,
        updateTime: null,
        trend: '—',
      }
    })
  }

  res.json({ window, order, sortBy, data })
})

export default router
