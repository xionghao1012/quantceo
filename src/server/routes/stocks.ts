import { Router } from 'express'
import { eq, and, between, inArray, sql } from 'drizzle-orm'
import { db } from '../db/db.js'
import { stocks, klines, strategies } from '../db/schema.js'
import { getOrFetchKlines, getOrFetchMinuteKlines } from '../data/cache.js'
import { calcMA, calcMACD, calcRSI } from '../indicators/index.js'
import type { KLine } from '../../shared/types.js'
import { fetchFundamental } from '../data/fundamental.js'
import { fetchUSKlines, fetchHKKlines } from '../data/intl.js'
import { cacheGetQuotes, cacheSetQuotes } from '../data/redis.js'

const router = Router()

router.get('/', async (req, res) => {
  const q = req.query.q as string || ''
  const limit = Math.min(Number(req.query.limit) || 100, 500)
  const offset = Number(req.query.offset) || 0
  const result = await db.select().from(stocks)
    .where(q ? eq(stocks.code, q) : undefined)
    .limit(limit).offset(offset)
  res.json(result)
})

router.get('/quotes', async (_req, res) => {
  const cached = await cacheGetQuotes()
  if (cached) {
    try {
      return res.json(JSON.parse(cached))
    } catch {}
  }
  const { rows } = await db.execute(sql`
    SELECT
      s.code,
      CAST(l0.close AS numeric(12,2)) AS price,
      l0.volume,
      CASE WHEN l1.close > 0 THEN (l0.close - l1.close) / l1.close * 100 ELSE 0 END AS change
    FROM stocks s
    LEFT JOIN LATERAL (
      SELECT code, close, volume
      FROM klines
      WHERE code = s.code
      ORDER BY date DESC
      LIMIT 1
    ) l0 ON true
    LEFT JOIN LATERAL (
      SELECT close
      FROM klines
      WHERE code = s.code
      ORDER BY date DESC
      LIMIT 1 OFFSET 1
    ) l1 ON true
    WHERE s.status = 'active'
  `)
  const quotes: Record<string, { price: number; change: number; volume: number }> = {}
  for (const row of rows as any[]) {
    quotes[row.code] = {
      price: Number(row.price),
      change: Number(row.change),
      volume: Number(row.volume),
    }
  }
  await cacheSetQuotes(JSON.stringify(quotes))
  res.json(quotes)
})

router.post('/quotes/batch', async (req, res) => {
  const { codes } = req.body as { codes?: string[] }
  if (!codes || !codes.length) return res.json({})
  const codeList = codes.map((c: string) => `'${c.replace(/'/g, "''")}'`).join(',')
  const { rows } = await db.execute(sql`
    WITH latest AS (
      SELECT code, close AS price, volume,
        ROW_NUMBER() OVER (PARTITION BY code ORDER BY date DESC) AS rn
      FROM klines
    ),
    prev AS (
      SELECT code, close AS prev_close,
        ROW_NUMBER() OVER (PARTITION BY code ORDER BY date DESC) AS rn
      FROM klines
    )
    SELECT
      l.code,
      CAST(l.price AS numeric(12,2)) AS price,
      l.volume,
      CASE WHEN p.prev_close > 0 THEN (l.price - p.prev_close) / p.prev_close * 100 ELSE 0 END AS change
    FROM latest l
    LEFT JOIN prev p ON l.code = p.code AND p.rn = 2
    WHERE l.rn = 1 AND l.code IN (${sql.raw(codeList)})
  `)
  const quotes: Record<string, { price: number; change: number; volume: number }> = {}
  for (const row of rows as any[]) {
    quotes[row.code] = {
      price: Number(row.price),
      change: Number(row.change),
      volume: Number(row.volume),
    }
  }
  res.json(quotes)
})

router.get('/strategies', async (_req, res) => {
  const result = await db.select().from(strategies)
  res.json(result)
})

router.get('/:code/klines', async (req, res) => {
  const code = req.params.code as string
  const period = req.query.period as string | undefined
  const start = req.query.start as string | undefined
  const end = req.query.end as string | undefined

  if (period && /^m(1|5|15|30|60)$/.test(period)) {
    const result = await getOrFetchMinuteKlines(code, period as any)
    if (result.klines.length === 0) return res.status(404).json({ error: 'No data' })
    let klines = result.klines
    if (start || end) {
      klines = klines.filter(k =>
        (!start || k.datetime >= start) && (!end || k.datetime <= end)
      )
    }
    return res.json({ klines, source: result.source, period })
  }

  let rows = await db.select().from(klines)
    .where(and(
      eq(klines.code, code),
      start ? between(klines.date, start, end || '20500101') : undefined
    ))
    .orderBy(klines.date)

  if (rows.length === 0) {
    const result = await getOrFetchKlines(code)
    if (result.klines.length === 0) return res.status(404).json({ error: 'No data' })
    if (start || end) {
      const filtered = result.klines.filter(k =>
        (!start || k.date >= start) && (!end || k.date <= end)
      )
      return res.json({ klines: filtered, source: result.source })
    }
    return res.json(result)
  }

  res.json({
    klines: rows.map(r => ({
      ...r, open: Number(r.open), high: Number(r.high),
      low: Number(r.low), close: Number(r.close), amount: Number(r.amount),
    })),
    source: 'cache',
  })
})

router.get('/:code/indicators', async (req, res) => {
  const code = req.params.code as string
  const period = req.query.period as string | undefined

  if (period && /^m(1|5|15|30|60)$/.test(period)) {
    const result = await getOrFetchMinuteKlines(code, period as any)
    if (result.klines.length === 0) return res.status(404).json({ error: 'No data' })
    const asKlines = result.klines as unknown as KLine[]
    return res.json({
      ma: calcMA(asKlines),
      macd: calcMACD(asKlines),
      rsi: calcRSI(asKlines),
      source: result.source,
      period,
    })
  }

  const result = await getOrFetchKlines(code)
  if (result.klines.length === 0) return res.status(404).json({ error: 'No data' })

  res.json({
    ma: calcMA(result.klines),
    macd: calcMACD(result.klines),
    rsi: calcRSI(result.klines),
    source: result.source,
  })
})

router.get('/:code/fundamental', async (req, res) => {
  const code = req.params.code as string
  const data = await fetchFundamental(code)
  if (!data) return res.status(404).json({ error: 'Fundamental data not available' })
  res.json(data)
})

router.get('/intl/:market/:code/klines', async (req, res) => {
  const { market, code } = req.params as { market: string; code: string }
  try {
    if (market === 'US') {
      const data = await fetchUSKlines(code.toUpperCase())
      return res.json({ klines: data, source: 'api' })
    }
    if (market === 'HK') {
      const data = await fetchHKKlines(code)
      return res.json({ klines: data, source: 'api' })
    }
    res.status(400).json({ error: 'Invalid market. Use US or HK.' })
  } catch (e: any) {
    res.status(404).json({ error: e.message || 'Failed to fetch data' })
  }
})

router.get('/intl/:market/:code/indicators', async (req, res) => {
  const { market, code } = req.params as { market: string; code: string }
  try {
    let klines
    if (market === 'US') {
      klines = await fetchUSKlines(code.toUpperCase())
    } else if (market === 'HK') {
      klines = await fetchHKKlines(code)
    } else {
      return res.status(400).json({ error: 'Invalid market' })
    }
    if (!klines?.length) return res.status(404).json({ error: 'No data' })
    res.json({
      ma: calcMA(klines),
      macd: calcMACD(klines),
      rsi: calcRSI(klines),
      source: 'api',
    })
  } catch (e: any) {
    res.status(404).json({ error: e.message || 'Failed to fetch data' })
  }
})

export default router
