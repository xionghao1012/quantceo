import type { KLine, MinuteKLine, MinutePeriod } from '../../shared/types.js'
import { db } from '../db/db.js'
import { klines as klinesTable, minuteKlines as minuteKlinesTable } from '../db/schema.js'
import { eq, inArray, and } from 'drizzle-orm'
import { fetchKlines } from './eastmoney.js'
import { fetchMinuteKlines } from './tencentMinute.js'
import { fetchBaostockMinuteKlines } from './baostockMinute.js'
import { fetchAkshareMinuteKlines } from './akshareMinute.js'
import { cacheGetKlines, cacheGetKlinesBulk, cacheSetKlinesBulk, cacheGetMinuteKlines, cacheSetMinuteKlines, cacheSetMinuteKlinesBulk } from './redis.js'

function decodeRow(row: any): KLine {
  return {
    code: row.code,
    date: row.date,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: row.volume,
    amount: Number(row.amount),
  }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

const MIN_FULL_HISTORY = 1000

async function refreshLatestKlines(code: string, existing: KLine[]): Promise<KLine[]> {
  try {
    const apiData = await fetchKlines(code)
    if (apiData.length === 0) return existing

    const dateSet = new Set(existing.map(k => k.date))
    const newKlines = apiData.filter(k => !dateSet.has(k.date))

    if (newKlines.length === 0) return existing

    const BATCH_SIZE = 500
    for (let i = 0; i < newKlines.length; i += BATCH_SIZE) {
      const batch = newKlines.slice(i, i + BATCH_SIZE)
      const values = batch.map(k => ({
        code: k.code,
        date: k.date,
        open: String(k.open),
        high: String(k.high),
        low: String(k.low),
        close: String(k.close),
        volume: k.volume,
        amount: String(k.amount),
      }))
      await db.insert(klinesTable).values(values).onConflictDoNothing()
    }

    const merged = [...existing, ...newKlines].sort(
      (a, b) => a.date.localeCompare(b.date)
    )
    cacheSetKlinesBulk({ [code]: JSON.stringify(merged) })
    return merged
  } catch {
    return existing
  }
}

export async function batchGetKlines(codes: string[]): Promise<Record<string, KLine[]>> {
  if (!codes.length) return {}

  const cached = await cacheGetKlinesBulk(codes)
  const fromRedis: Record<string, KLine[]> = {}
  const fromDbCodes: string[] = []

  for (const code of codes) {
    const raw = cached[code]
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as KLine[]
        if (parsed.length > MIN_FULL_HISTORY) {
          fromRedis[code] = parsed
          continue
        }
      } catch {}
    }
    fromDbCodes.push(code)
  }

  if (fromDbCodes.length === 0) return fromRedis

  const rows = await db.select().from(klinesTable)
    .where(inArray(klinesTable.code, fromDbCodes))
    .orderBy(klinesTable.date)

  const toCache: Record<string, string> = {}
  const map: Record<string, KLine[]> = { ...fromRedis }
  for (const row of rows) {
    if (!map[row.code]) map[row.code] = []
    map[row.code].push(decodeRow(row))
  }
  for (const code of fromDbCodes) {
    if (map[code]) toCache[code] = JSON.stringify(map[code])
  }
  if (Object.keys(toCache).length) cacheSetKlinesBulk(toCache)

  return map
}

export async function getOrFetchKlines(code: string): Promise<{ klines: KLine[]; source: 'cache' | 'api' }> {
  const redisData = await cacheGetKlines(code)
  if (redisData) {
    try {
      const klines = JSON.parse(redisData) as KLine[]
      if (klines.length > MIN_FULL_HISTORY) {
        const lastDate = klines[klines.length - 1]?.date
        if (lastDate && lastDate < todayStr()) {
          refreshLatestKlines(code, klines).catch(() => {})
        }
        return { klines, source: 'cache' }
      }
    } catch {}
  }

  const cached = await db.select().from(klinesTable)
    .where(eq(klinesTable.code, code))
    .orderBy(klinesTable.date)

  if (cached.length > MIN_FULL_HISTORY) {
    const klines = cached.map(decodeRow)
    cacheSetKlinesBulk({ [code]: JSON.stringify(klines) })
    const lastDate = klines[klines.length - 1]?.date
    if (lastDate && lastDate < todayStr()) {
      refreshLatestKlines(code, klines).catch(() => {})
    }
    return { klines, source: 'cache' }
  }

  let data: KLine[] = []
  try {
    data = await fetchKlines(code)
  } catch {}
  if (data.length === 0) {
    if (cached.length > 0) {
      return { klines: cached.map(decodeRow), source: 'cache' }
    }
    return { klines: [], source: 'api' }
  }

  if (cached.length > 0) {
    await db.delete(klinesTable).where(eq(klinesTable.code, code))
  }

  const BATCH_SIZE = 500
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE)
    const values = batch.map(k => ({
      code: k.code,
      date: k.date,
      open: String(k.open),
      high: String(k.high),
      low: String(k.low),
      close: String(k.close),
      volume: k.volume,
      amount: String(k.amount),
    }))
    await db.insert(klinesTable).values(values).onConflictDoNothing()
  }

  cacheSetKlinesBulk({ [code]: JSON.stringify(data) })
  return { klines: data, source: 'api' }
}

function decodeMinuteRow(row: any): MinuteKLine {
  return {
    code: row.code,
    datetime: row.datetime instanceof Date ? row.datetime.toISOString().replace('T', ' ').slice(0, 19) : String(row.datetime),
    period: row.period as MinutePeriod,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
    amount: Number(row.amount),
  }
}

async function refreshLatestMinuteKlines(code: string, period: MinutePeriod, existing: MinuteKLine[]): Promise<MinuteKLine[]> {
  try {
    const apiData = await fetchMinuteKlines(code, period, 640)
    if (apiData.length === 0) return existing

    const dtSet = new Set(existing.map(k => k.datetime))
    const newBars = apiData.filter(k => !dtSet.has(k.datetime))

    if (newBars.length === 0) return existing

    const BATCH_SIZE = 500
    for (let i = 0; i < newBars.length; i += BATCH_SIZE) {
      const batch = newBars.slice(i, i + BATCH_SIZE)
      const values = batch.map(k => ({
        code: k.code,
        datetime: new Date(k.datetime),
        period: k.period,
        open: String(k.open),
        high: String(k.high),
        low: String(k.low),
        close: String(k.close),
        volume: k.volume,
        amount: String(k.amount),
      }))
      await db.insert(minuteKlinesTable).values(values).onConflictDoNothing()
    }

    const merged = [...existing, ...newBars].sort((a, b) => a.datetime.localeCompare(b.datetime))
    cacheSetMinuteKlinesBulk({ [`${period}:${code}`]: JSON.stringify(merged) })
    return merged
  } catch {
    return existing
  }
}

export async function getOrFetchMinuteKlines(code: string, period: MinutePeriod): Promise<{ klines: MinuteKLine[]; source: 'cache' | 'api' }> {
  const redisData = await cacheGetMinuteKlines(code, period)
  if (redisData) {
    try {
      const klines = JSON.parse(redisData) as MinuteKLine[]
      if (klines.length > 0) {
        const lastDt = klines[klines.length - 1]?.datetime
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ')
        if (lastDt && lastDt < fiveMinAgo) {
          refreshLatestMinuteKlines(code, period, klines).catch(() => {})
        }
        return { klines, source: 'cache' }
      }
    } catch {}
  }

  const cached = await db.select().from(minuteKlinesTable)
    .where(and(
      eq(minuteKlinesTable.code, code),
      eq(minuteKlinesTable.period, period),
    ))
    .orderBy(minuteKlinesTable.datetime)

  if (cached.length > 0) {
    const klines = cached.map(decodeMinuteRow)
    cacheSetMinuteKlinesBulk({ [`${period}:${code}`]: JSON.stringify(klines) })
    const lastDt = klines[klines.length - 1]?.datetime
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ')
    if (lastDt && lastDt < fiveMinAgo) {
      refreshLatestMinuteKlines(code, period, klines).catch(() => {})
    }
    return { klines, source: 'cache' }
  }

  let data: MinuteKLine[] = []
  try {
    if (period === 'm1') {
      data = await fetchAkshareMinuteKlines(code, period)
      if (data.length === 0) {
        data = await fetchMinuteKlines(code, period, 640)
      }
    } else {
      const today = new Date()
      const endDate = today.toISOString().slice(0, 10)
      const startDate = new Date(today.getTime() - 365 * 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      data = await fetchBaostockMinuteKlines(code, period, startDate, endDate)
      if (data.length === 0) {
        data = await fetchAkshareMinuteKlines(code, period)
      }
      if (data.length === 0) {
        data = await fetchMinuteKlines(code, period, 640)
      }
    }
  } catch {}
  if (data.length === 0) return { klines: [], source: 'api' }

  const BATCH_SIZE = 500
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE)
    const values = batch.map(k => ({
      code: k.code,
      datetime: new Date(k.datetime),
      period: k.period,
      open: String(k.open),
      high: String(k.high),
      low: String(k.low),
      close: String(k.close),
      volume: k.volume,
      amount: String(k.amount),
    }))
    await db.insert(minuteKlinesTable).values(values).onConflictDoNothing()
  }

  cacheSetMinuteKlinesBulk({ [`${period}:${code}`]: JSON.stringify(data) })
  return { klines: data, source: 'api' }
}
