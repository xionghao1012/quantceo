import { Router } from 'express'
import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/db.js'
import { stocks, klines, userStrategies } from '../db/schema.js'
import { getOrFetchKlines, batchGetKlines } from '../data/cache.js'
import { scanStock } from '../scan/index.js'
import { LazyIndicators } from '../indicators/index.js'
import { extractNeededIndicators } from '../engine/ruleEngine.js'
import type { Rule } from '../../shared/types.js'

const router = Router()

async function loadCustomStrategy(userStrategyId: number): Promise<{ rules: Rule[]; name: string } | null> {
  const rows = await db.select().from(userStrategies).where(eq(userStrategies.id, userStrategyId)).limit(1)
  if (!rows[0]) return null
  const config = rows[0].config as { rules?: Rule[] }
  return { rules: config.rules || [], name: rows[0].name }
}

router.post('/', async (req, res) => {
  const { codes: bodyCodes, custom, userStrategyId, page, limit } = req.body as {
    codes?: string[]
    custom?: boolean
    userStrategyId?: number
    page?: number
    limit?: number
  }

  const customStrategy = custom && userStrategyId ? await loadCustomStrategy(userStrategyId) : null
  const customRules = customStrategy?.rules
  const customRuleName = customStrategy?.name
  const neededIndicators = customRules?.length ? extractNeededIndicators(customRules) : null

  const effectiveLimit = Math.min(Number(limit) || 100, 100)
  const effectivePage = Math.max(Number(page) || 1, 1)

  const totalStocks = 5307
  const totalPages = Math.ceil(totalStocks / effectiveLimit)
  const offset = (effectivePage - 1) * effectiveLimit

  const pageStocks = await db.select({ code: stocks.code, name: stocks.name })
    .from(stocks)
    .where(bodyCodes?.length ? inArray(stocks.code, bodyCodes) : undefined)
    .orderBy(stocks.code)
    .limit(effectiveLimit)
    .offset(offset)

  const codes = pageStocks.map(s => s.code)
  const klinesMap = codes.length ? await batchGetKlines(codes) : {}

  const results: any[] = []
  for (const s of pageStocks) {
    let klineData = klinesMap[s.code]
    if (!klineData || klineData.length < 100) {
      const cache = await getOrFetchKlines(s.code)
      klineData = cache.klines
    }
    if (!klineData || klineData.length < 100) continue
    try {
      const lazy = neededIndicators ? new LazyIndicators(klineData, neededIndicators) : undefined
      const scanned = scanStock(s.code, s.name, klineData, customRules, customRuleName, lazy)
      if (scanned) results.push(scanned)
    } catch {}
  }
  results.sort((a, b) => Math.abs(b.totalStrength) - Math.abs(a.totalStrength))
  res.json({ count: results.length, total: totalStocks, page: effectivePage, totalPages, limit: effectiveLimit, results })
})

router.post('/save-klines', async (req, res) => {
  const { code, klineData } = req.body
  for (const k of klineData) {
    await db.insert(klines).values({
      code: k.code, date: k.date, open: String(k.open), high: String(k.high),
      low: String(k.low), close: String(k.close), volume: k.volume, amount: String(k.amount),
    }).onConflictDoNothing()
  }
  res.json({ saved: klineData.length })
})

router.post('/stream', async (req, res) => {
  const { page = 1, limit = 50, codes, customRules } = req.body as any
  const effectivePage = Math.max(1, Number(page))
  const effectiveLimit = Math.min(200, Math.max(1, Number(limit)))
  const totalStocks = 5307
  const totalPages = Math.ceil(totalStocks / effectiveLimit)
  const offset = (effectivePage - 1) * effectiveLimit

  const pageStocks = await db.select({ code: stocks.code, name: stocks.name })
    .from(stocks)
    .where(codes?.length ? inArray(stocks.code, codes) : undefined)
    .orderBy(stocks.code)
    .limit(effectiveLimit).offset(offset)

  const results = []
  for (const s of pageStocks) {
    try {
      const { klines: klineData } = await getOrFetchKlines(s.code)
      if (!klineData.length) continue
      const scanned = scanStock(s.code, s.name, klineData, customRules)
      if (scanned) results.push(scanned)
    } catch {}
  }
  results.sort((a, b) => Math.abs(b.totalStrength) - Math.abs(a.totalStrength))
  res.json({ count: results.length, total: totalStocks, page: effectivePage, totalPages, limit: effectiveLimit, results })
})

export default router
