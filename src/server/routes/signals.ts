import { Router } from 'express'
import { eq, and, desc, gte, count } from 'drizzle-orm'
import { db } from '../db/db.js'
import { signals } from '../db/schema.js'

const router = Router()

router.get('/', async (req, res) => {
  const { code, strategyId, direction, date, limit = '100' } = req.query as Record<string, string>
  const conditions = []

  if (code) conditions.push(eq(signals.code, code))
  if (strategyId) conditions.push(eq(signals.strategyId, Number(strategyId)))
  if (direction) conditions.push(eq(signals.direction, direction))
  if (date) conditions.push(eq(signals.scanDate, date))

  const rows = await db.select()
    .from(signals)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(signals.scanDate), desc(signals.strength))
    .limit(Number(limit))

  res.json(rows)
})

router.get('/stats', async (req, res) => {
  const { strategyId, days = '30' } = req.query as Record<string, string>
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - Number(days))
  const cutoffStr = cutoff.toISOString().split('T')[0]

  const conds = [gte(signals.scanDate, cutoffStr)]
  if (strategyId) conds.push(eq(signals.strategyId, Number(strategyId)))

  const rows = await db.select({
    scanDate: signals.scanDate,
    direction: signals.direction,
    count: count(signals.id),
  })
    .from(signals)
    .where(and(...conds))
    .groupBy(signals.scanDate, signals.direction)
    .orderBy(signals.scanDate)

  res.json(rows)
})

router.get('/today', async (_req, res) => {
  const today = new Date().toISOString().split('T')[0]
  const rows = await db.select()
    .from(signals)
    .where(eq(signals.scanDate, today))
    .orderBy(desc(signals.strength))

  const grouped: Record<string, any[]> = {}
  for (const s of rows) {
    if (!grouped[s.code]) grouped[s.code] = []
    grouped[s.code].push(s)
  }

  const result = Object.entries(grouped).map(([code, sigs]) => ({
    code,
    name: sigs[0]?.name || code,
    price: sigs[0]?.price || '0',
    signals: sigs.map(({ name: _n, indicators: _i, reason: _r, price: _p, ...rest }) => rest),
    totalStrength: sigs.reduce((sum, sig) =>
      sum + (sig.direction === 'BUY' ? sig.strength : -sig.strength), 0
    ),
  }))

  result.sort((a, b) => Math.abs(b.totalStrength) - Math.abs(a.totalStrength))
  res.json(result)
})

export default router
