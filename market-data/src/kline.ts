import { db } from './db.js'
import { stocks, klines, minuteKlines } from './db.js'
import { eq, desc, asc, and, lte } from 'drizzle-orm'
import {
  cacheGetKlines, cacheSetKlines, cacheGetKlinesBulk, cacheSetKlinesBulk,
  cacheGetQuotes, cacheSetQuotes, cacheGetMinuteKlines, cacheSetMinuteKlines,
} from './cache.js'
import type { KLine, StockQuote } from './types.js'

// ---- K-Line Data ----

export async function getKlines(code: string, days = 90): Promise<KLine[]> {
  const cached = await cacheGetKlines(code)
  if (cached) {
    const all = JSON.parse(cached) as KLine[]
    return all.slice(-days)
  }

  const rows = await db
    .select()
    .from(klines)
    .where(eq(klines.code, code))
    .orderBy(desc(klines.date))
    .limit(365)

  const result = rows.reverse().map(r => ({
    code: r.code,
    date: typeof r.date === 'string' ? r.date : new Date(r.date).toISOString().slice(0, 10),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
    amount: Number(r.amount),
  }))

  await cacheSetKlines(code, JSON.stringify(result))
  return result.slice(-days)
}

export async function getKlinesBulk(codes: string[], days = 90): Promise<Record<string, KLine[]>> {
  const fromCache = await cacheGetKlinesBulk(codes)
  const result: Record<string, KLine[]> = {}
  const missing: string[] = []

  for (const code of codes) {
    if (fromCache[code]) {
      result[code] = (JSON.parse(fromCache[code]!) as KLine[]).slice(-days)
    } else {
      missing.push(code)
    }
  }

  if (missing.length) {
    // Fetch from DB for missing codes
    const toCache: Record<string, string> = {}
    for (const code of missing) {
      const rows = await db
        .select()
        .from(klines)
        .where(eq(klines.code, code))
        .orderBy(desc(klines.date))
        .limit(365)

      const kls = rows.reverse().map(r => ({
        code: r.code,
        date: typeof r.date === 'string' ? r.date : new Date(r.date).toISOString().slice(0, 10),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
        amount: Number(r.amount),
      }))

      result[code] = kls.slice(-days)
      toCache[code] = JSON.stringify(kls)
    }
    await cacheSetKlinesBulk(toCache)
  }

  return result
}

export async function refreshKline(code: string): Promise<{ source: string; count: number }> {
  // Fetch from external API (sohu/eastmoney), store in DB, update cache
  const result = await fetchKlineFromAPI(code)
  if (!result.length) return { source: 'none', count: 0 }

  for (const k of result) {
    await db.insert(klines).values({
      code, date: k.date,
      open: String(k.open), high: String(k.high),
      low: String(k.low), close: String(k.close),
      volume: String(k.volume), amount: String(k.amount),
    }).onConflictDoNothing()
  }

  const all = await getKlines(code, 365)
  return { source: 'api', count: result.length }
}

async function fetchKlineFromAPI(code: string): Promise<KLine[]> {
  const market = code.startsWith('6') ? 'sh' : 'sz'
  const url = `https://q.stock.sohu.com/hisHq?code=cn_${code}&start=20200101&end=20500101&stat=1&order=D&period=d`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    const text = await res.text()
    const match = text.match(/\[(\[.*\])\]/)
    if (!match) return []

    const raw: any[] = JSON.parse(match[1])
    return raw.map((r: any) => ({
      code,
      date: r[0],
      open: parseFloat(r[1]),
      close: parseFloat(r[2]),
      high: parseFloat(r[6]),
      low: parseFloat(r[5]),
      volume: parseInt(r[7], 10) || 0,
      amount: parseFloat(r[8]) || 0,
    }))
  } catch {
    return []
  }
}

// ---- Stock Quotes ----

export async function getQuotes(codes?: string[]): Promise<StockQuote[]> {
  const cached = await cacheGetQuotes()
  if (cached) {
    const all = JSON.parse(cached) as StockQuote[]
    if (codes) return all.filter(q => codes.includes(q.code))
    return all
  }

  const stockRows = await db
    .select({ code: stocks.code, name: stocks.name })
    .from(stocks)

  const targetCodes = codes || stockRows.map(s => s.code).slice(0, 50)
  const quotes = await fetchQuotesFromAPI(targetCodes)

  await cacheSetQuotes(JSON.stringify(quotes))
  return quotes
}

async function fetchQuotesFromAPI(codes: string[]): Promise<StockQuote[]> {
  if (!codes.length) return []
  const symbols = codes.map(c => (c.startsWith('6') ? `sh${c}` : `sz${c}`)).join(',')
  const url = `https://hq.sinajs.cn/list=${symbols}`

  try {
    const res = await fetch(url, {
      headers: { 'Referer': 'https://finance.sina.com.cn' },
      signal: AbortSignal.timeout(8000),
    })
    const text = await res.text()
    const quotes: StockQuote[] = []
    const lines = text.split('\n')
    for (const line of lines) {
      const m = line.match(/hq_str_(sh|sz)(\d+)="([^"]+)"/)
      if (!m) continue
      const code = m[2]
      const fields = m[3].split(',')
      if (fields.length < 32) continue
      quotes.push({
        code,
        name: fields[0],
        open: parseFloat(fields[1]) || 0,
        prevClose: parseFloat(fields[2]) || 0,
        price: parseFloat(fields[3]) || 0,
        high: parseFloat(fields[4]) || 0,
        low: parseFloat(fields[5]) || 0,
        volume: parseInt(fields[8], 10) || 0,
        amount: parseFloat(fields[9]) || 0,
        change: parseFloat(fields[3]) - parseFloat(fields[2]),
        changePct: parseFloat(fields[2]) > 0
          ? ((parseFloat(fields[3]) - parseFloat(fields[2])) / parseFloat(fields[2])) * 100
          : 0,
      })
    }
    return quotes
  } catch {
    return []
  }
}

// ---- Stock List ----

export async function getStockList(): Promise<{ code: string; name: string; exchange: string }[]> {
  const rows = await db.select({ code: stocks.code, name: stocks.name, exchange: stocks.exchange })
    .from(stocks)
    .where(eq(stocks.status, 'active'))
  return rows
}

// ---- Minute K-Lines ----

export async function getMinuteKlines(code: string, period: string): Promise<any[]> {
  const cached = await cacheGetMinuteKlines(code, period)
  if (cached) return JSON.parse(cached)

  const rows = await db
    .select()
    .from(minuteKlines)
    .where(and(eq(minuteKlines.code, code), eq(minuteKlines.period, period)))
    .orderBy(desc(minuteKlines.time))
    .limit(480)

  const result = rows.reverse().map(r => ({
    code: r.code,
    period: r.period,
    time: r.time instanceof Date ? r.time.toISOString() : String(r.time),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
    amount: Number(r.amount),
  }))

  await cacheSetMinuteKlines(code, period, JSON.stringify(result))
  return result
}
