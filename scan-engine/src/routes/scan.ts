import { Router } from 'express'
import { db } from '../db.js'
import { stocks, klines } from '../db.js'
import { eq, desc } from 'drizzle-orm'
import { scanStock, scanStocks } from '../scan.js'

const router = Router()

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'scan-engine' })
})

router.post('/stock', async (req, res) => {
  try {
    const { code, name, klines: klineData } = req.body
    const stockCode = code || req.body.stockCode
    if (!stockCode) return res.status(400).json({ error: 'code required' })

    let kls = klineData
    if (!kls?.length) {
      const rows = await db.select().from(klines)
        .where(eq(klines.code, stockCode))
        .orderBy(desc(klines.date)).limit(90)
      kls = rows.reverse().map(r => ({
        code: r.code, date: String(r.date),
        open: Number(r.open), high: Number(r.high), low: Number(r.low),
        close: Number(r.close), volume: Number(r.volume), amount: Number(r.amount),
      }))
    }

    const stockName = name || stockCode
    const result = scanStock(stockCode, stockName, kls)
    if (!result) return res.json({ code: stockCode, name: stockName, signals: [] })

    res.json(result)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/bulk', async (req, res) => {
  try {
    const { stocks: stockList } = req.body
    if (!Array.isArray(stockList) || !stockList.length) {
      return res.status(400).json({ error: 'stocks array required' })
    }

    const results: any[] = []
    for (const s of stockList) {
      try {
        const code = s.code || s.stockCode
        const rows = await db.select().from(klines)
          .where(eq(klines.code, code))
          .orderBy(desc(klines.date)).limit(90)
        const kls = rows.reverse().map(r => ({
          code: r.code, date: String(r.date),
          open: Number(r.open), high: Number(r.high), low: Number(r.low),
          close: Number(r.close), volume: Number(r.volume), amount: Number(r.amount),
        }))
        const r = scanStock(code, s.name || code, kls)
        if (r) results.push(r)
      } catch {}
    }
    res.json({ count: results.length, results })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/market', async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, req.body.limit || 50))
    const allStocks = await db.select({ code: stocks.code, name: stocks.name })
      .from(stocks).where(eq(stocks.status, 'active')).limit(limit)

    const results: any[] = []
    for (const s of allStocks) {
      try {
        const rows = await db.select().from(klines)
          .where(eq(klines.code, s.code))
          .orderBy(desc(klines.date)).limit(90)
        const kls = rows.reverse().map(r => ({
          code: r.code, date: String(r.date),
          open: Number(r.open), high: Number(r.high), low: Number(r.low),
          close: Number(r.close), volume: Number(r.volume), amount: Number(r.amount),
        }))
        if (kls.length < 30) continue
        const r = scanStock(s.code, s.name, kls)
        if (r) results.push(r)
      } catch {}
    }

    res.json({ scanned: allStocks.length, signals: results.length, results })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default router
