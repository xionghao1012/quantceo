import { Router } from 'express'
import { db } from '../db/db.js'
import { stocks, klines } from '../db/schema.js'
import { eq, desc, sql } from 'drizzle-orm'
import { calcMA, calcMACD, calcRSI } from '../indicators/index.js'

const router = Router()

const SCREENER_FIELDS = [
  { field: 'price', label: '最新价', type: 'number', operators: ['>', '<', '==', 'between'] },
  { field: 'change', label: '涨跌幅%', type: 'number', operators: ['>', '<', '==', 'between'] },
  { field: 'volume', label: '成交量', type: 'number', operators: ['>', '<', '==', 'between'] },
  { field: 'amount', label: '成交额', type: 'number', operators: ['>', '<', '==', 'between'] },
  { field: 'amplitude', label: '振幅%', type: 'number', operators: ['>', '<', '==', 'between'] },
  { field: 'ma5', label: 'MA5', type: 'number', operators: ['>', '<', '=='] },
  { field: 'ma10', label: 'MA10', type: 'number', operators: ['>', '<', '=='] },
  { field: 'ma20', label: 'MA20', type: 'number', operators: ['>', '<', '=='] },
  { field: 'ma60', label: 'MA60', type: 'number', operators: ['>', '<', '=='] },
  { field: 'macd', label: 'MACD', type: 'number', operators: ['>', '<', '=='] },
  { field: 'macdSignal', label: 'MACD信号', type: 'number', operators: ['>', '<', '=='] },
  { field: 'macdHistogram', label: 'MACD柱', type: 'number', operators: ['>', '<', '=='] },
  { field: 'rsi', label: 'RSI', type: 'number', operators: ['>', '<', '=='] },
]

const ALLOWED_FIELDS = new Set(SCREENER_FIELDS.map(f => f.field))

router.get('/fields', (_req, res) => {
  res.json({ fields: SCREENER_FIELDS })
})

interface Condition {
  field: string
  operator: string
  value: number | string | [number, number]
}

router.post('/', async (req, res) => {
  const { conditions = [], sort = { field: 'change', order: 'desc' }, page = 1, limit = 50 } = req.body as {
    conditions?: Condition[]
    sort?: { field: string; order: 'asc' | 'desc' }
    page?: number
    limit?: number
  }

  if (!conditions.length) {
    return res.status(400).json({ error: 'At least one condition is required' })
  }

  for (const c of conditions) {
    if (!ALLOWED_FIELDS.has(c.field)) {
      return res.status(400).json({ error: `Invalid field: ${c.field}` })
    }
    if (!['>', '<', '==', 'between', 'cross_above', 'cross_below'].includes(c.operator)) {
      return res.status(400).json({ error: `Invalid operator: ${c.operator}` })
    }
  }

  const effectiveLimit = Math.min(Number(limit) || 50, 100)
  const effectivePage = Math.max(Number(page) || 1, 1)

  const stockRows = await db.select().from(stocks)
  const stockMap: Record<string, string> = {}
  for (const s of stockRows) {
    stockMap[s.code] = s.name
  }
  const allCodes = stockRows.map((s: any) => s.code)

  const MAX_STOCKS = 500
  const limitedCodes = allCodes.slice(0, MAX_STOCKS)

  const results: any[] = []
  const BATCH = 100

  const batchChunks = []
  for (let i = 0; i < limitedCodes.length; i += BATCH) {
    batchChunks.push(limitedCodes.slice(i, i + BATCH))
  }

  const allBatchResults = await Promise.allSettled(
    batchChunks.map(async (batch) => {
      const klineRows = await db
        .select()
        .from(klines)
        .where(sql`${klines.code} IN (${sql.raw(batch.map(c => `'${c}'`).join(','))})`)
        .orderBy(klines.code, klines.date)

      const byCode: Record<string, any[]> = {}
      for (const row of klineRows) {
        if (!byCode[row.code]) byCode[row.code] = []
        byCode[row.code].push({
          open: Number(row.open), high: Number(row.high),
          low: Number(row.low), close: Number(row.close),
          volume: row.volume, amount: Number(row.amount),
        })
      }

      const computed = await Promise.allSettled(
        batch.map(async (code: string) => {
          const klines_data = byCode[code] || []
          if (klines_data.length < 2) return null

          const last = klines_data[klines_data.length - 1]
          const prev = klines_data[klines_data.length - 2]

          const maMap = calcMA(klines_data, [5, 10, 20, 60])
          const macd = calcMACD(klines_data)
          const rsi = calcRSI(klines_data, 14)

          const latest = {
            price: last.close,
            change: prev.close > 0 ? ((last.close - prev.close) / prev.close * 100) : 0,
            volume: last.volume,
            amount: last.amount,
            amplitude: prev.close > 0 ? ((last.high - last.low) / prev.close * 100) : 0,
            ma5: maMap.MA5[maMap.MA5.length - 1],
            ma10: maMap.MA10[maMap.MA10.length - 1],
            ma20: maMap.MA20[maMap.MA20.length - 1],
            ma60: maMap.MA60[maMap.MA60.length - 1],
            macd: macd.macd[macd.macd.length - 1],
            macdSignal: macd.signal[macd.signal.length - 1],
            macdHistogram: macd.histogram[macd.histogram.length - 1],
            rsi: rsi[rsi.length - 1],
          }

          const prevIndicators = {
            price: prev.close,
            change: prev.close > 0 ? ((last.close - prev.close) / prev.close * 100) : 0,
            volume: prev.volume,
            amount: prev.amount,
            amplitude: prev.close > 0 ? ((last.high - last.low) / prev.close * 100) : 0,
            ma5: maMap.MA5[maMap.MA5.length - 2],
            ma10: maMap.MA10[maMap.MA10.length - 2],
            ma20: maMap.MA20[maMap.MA20.length - 2],
            ma60: maMap.MA60[maMap.MA60.length - 2],
            macd: macd.macd[macd.macd.length - 2],
            macdSignal: macd.signal[macd.signal.length - 2],
            macdHistogram: macd.histogram[macd.histogram.length - 2],
            rsi: rsi[rsi.length - 2],
          }

          for (const cond of conditions) {
            if (cond.operator === 'cross_above' || cond.operator === 'cross_below') {
              const curVal = latest[cond.field as keyof typeof latest]
              const curOther = latest[cond.value as string as keyof typeof latest]
              const prevVal = prevIndicators[cond.field as keyof typeof prevIndicators]
              const prevOther = prevIndicators[cond.value as string as keyof typeof prevIndicators]
              if (curVal == null || isNaN(curVal) || curOther == null || isNaN(curOther)
                || prevVal == null || isNaN(prevVal) || prevOther == null || isNaN(prevOther)) return null
              if (cond.operator === 'cross_above') {
                if (!((curVal > curOther) && (prevVal <= prevOther))) return null
              } else {
                if (!((curVal < curOther) && (prevVal >= prevOther))) return null
              }
              continue
            }

            const val = latest[cond.field as keyof typeof latest]
            if (val == null || isNaN(val as number)) return null

            if (cond.operator === '>') {
              if ((val as number) <= (cond.value as number)) return null
            } else if (cond.operator === '<') {
              if ((val as number) >= (cond.value as number)) return null
            } else if (cond.operator === '==') {
              if (Math.abs((val as number) - (cond.value as number)) > 0.001) return null
            } else if (cond.operator === 'between') {
              const [min, max] = cond.value as [number, number]
              if ((val as number) < min || (val as number) > max) return null
            }
          }

          return {
            code,
            name: stockMap[code] || code,
            price: latest.price,
            change: latest.change,
            volume: latest.volume,
            amount: latest.amount,
            amplitude: latest.amplitude,
            indicators: {
              ma5: latest.ma5,
              ma10: latest.ma10,
              ma20: latest.ma20,
              ma60: latest.ma60,
              macd: latest.macd,
              macdSignal: latest.macdSignal,
              macdHistogram: latest.macdHistogram,
              rsi: latest.rsi,
            },
          }
        })
      )

      return computed
    })
  )

  for (const batchResult of allBatchResults) {
    if (batchResult.status === 'fulfilled') {
      for (const r of batchResult.value) {
        if (r.status === 'fulfilled' && r.value) {
          results.push(r.value)
        }
      }
    }
  }

  const sortField = sort?.field || 'change'
  const sortOrder = sort?.order === 'asc' ? 1 : -1
  results.sort((a, b) => {
    const aVal = sortField === 'name' || sortField === 'code' ? a[sortField] : (a[sortField] ?? 0)
    const bVal = sortField === 'name' || sortField === 'code' ? b[sortField] : (b[sortField] ?? 0)
    if (typeof aVal === 'string') return aVal.localeCompare(bVal as string) * sortOrder
    return ((aVal as number) - (bVal as number)) * sortOrder
  })

  const total = results.length
  const start = (effectivePage - 1) * effectiveLimit
  const paginated = results.slice(start, start + effectiveLimit)

  res.json({
    total,
    page: effectivePage,
    limit: effectiveLimit,
    stocks: paginated,
  })
})

export default router
