import { db } from '../src/server/db/db.js'
import { klines, stocks } from '../src/server/db/schema.js'
import { eq, sql } from 'drizzle-orm'

const LIMIT_RATIOS: Record<string, number> = { '68': 0.20, '30': 0.20, '4': 0.05, 'default': 0.10 }

function getLimitRatio(code: string, name: string): number {
  if (name.includes('ST')) return 0.05
  if (code.startsWith('8')) return 0.30
  return LIMIT_RATIOS[code.slice(0, 2)] ?? LIMIT_RATIOS['default']
}

function getPrevTradingDay(date: string): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() - 1)
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1)
  }
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function computeLimitUpRecords(date: string): Promise<number> {
  const todayKlines = await db.select().from(klines).where(eq(klines.date, date))
  const allStocks = await db.select().from(stocks)
  const stockMap = new Map(allStocks.map(s => [s.code, s.name]))

  const prevDate = await getPrevTradingDay(date)
  const prevKlines = await db.select().from(klines).where(eq(klines.date, prevDate))
  const prevMap = new Map(prevKlines.map(k => [k.code, k]))

  const prevLimitUp = await db.execute(sql`
    SELECT code, date, close_price, prev_close FROM limit_up_records
    WHERE date <= ${date}
    ORDER BY date DESC
  `)
  const prevLimitUpMap = new Map<string, any>()
  for (const row of prevLimitUp.rows as any[]) {
    const key = row.code + '_' + row.date
    if (!prevLimitUpMap.has(key)) prevLimitUpMap.set(key, row)
  }

  let written = 0

  for (const k of todayKlines) {
    const prev = prevMap.get(k.code)
    if (!prev) continue

    const name = stockMap.get(k.code) ?? k.code
    const limitRatio = getLimitRatio(k.code, name)
    const close = Number(k.close)
    const prevClose = Number(prev.close)
    const gain = (close / prevClose - 1) * 100
    const limitUpPrice = Math.round((prevClose * (1 + limitRatio)) * 100) / 100

    if (Math.abs(gain - limitRatio * 100) >= 0.01) continue

    let consecutiveDays = 1
    let checkDate = date
    while (true) {
      const prevTDate = getPrevTradingDay(checkDate)
      const key = k.code + '_' + prevTDate
      const rec = prevLimitUpMap.get(key)
      if (!rec) break
      const recGain = Number(rec.close_price) / Number(rec.prev_close) - 1
      if (recGain >= limitRatio - 0.001) {
        consecutiveDays++
        checkDate = prevTDate
      } else {
        break
      }
    }

    const isFirstBoard = consecutiveDays === 1

    await db.execute(sql`
      INSERT INTO limit_up_records (
        code, name, date, prev_close, close_price, limit_up_price,
        change_pct, limit_ratio, consecutive_days, volume, amount,
        is_first_board, board_tag
      ) VALUES (
        ${k.code}, ${name}, ${date}, ${prevClose},
        ${close}, ${limitUpPrice}, ${gain},
        ${limitRatio}, ${consecutiveDays}, ${Number(k.volume)},
        ${Number(k.amount)}, ${isFirstBoard}, NULL
      )
      ON CONFLICT (code, date) DO UPDATE SET
        consecutive_days = EXCLUDED.consecutive_days,
        is_first_board = EXCLUDED.is_first_board
    `)
    written++
  }

  return written
}

async function main() {
  const dates = await db.execute(sql`
    SELECT DISTINCT date FROM klines WHERE date >= '2026-01-01' ORDER BY date ASC
  `)

  let total = 0
  for (const row of dates.rows) {
    const d = row.date as string
    try {
      const written = await computeLimitUpRecords(d)
      if (written > 0) {
        console.log(`${d}: ${written}`)
        total += written
      }
    } catch (e: any) {
      console.error(`${d}: ERROR ${e.message}`)
    }
  }

  console.log(`\nTotal records written: ${total}`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
