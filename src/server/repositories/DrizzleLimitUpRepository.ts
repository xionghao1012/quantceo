import { db } from '../db/db.js'
import { klines, limitUpRecords, stocks } from '../db/schema.js'
import { eq, sql } from 'drizzle-orm'
import type { ILimitUpRepository, LimitUpRecordInput } from './ILimitUpRepository.js'

export class DrizzleLimitUpRepository implements ILimitUpRepository {
  async getLimitUpRecord(code: string, date: string): Promise<{ code: string; date: string; close_price: number; prev_close: number } | null> {
    const { rows } = await db.execute(sql`
      SELECT close_price, prev_close FROM limit_up_records
      WHERE code = ${code} AND date = ${date}
      LIMIT 1
    `)
    if (!rows.length) return null
    const r = rows[0] as any
    return { code, date, close_price: Number(r.close_price), prev_close: Number(r.prev_close) }
  }

  async getLimitUpRecordsInRange(startDate: string, endDate: string): Promise<{ code: string; date: string; close_price: number; prev_close: number }[]> {
    const { rows } = await db.execute(sql`
      SELECT code, date, close_price, prev_close FROM limit_up_records
      WHERE date <= ${endDate} AND date >= ${startDate}
      ORDER BY date DESC
    `)
    return (rows as any[]).map(r => ({
      code: r.code,
      date: r.date,
      close_price: Number(r.close_price),
      prev_close: Number(r.prev_close),
    }))
  }

  async upsertLimitUpRecord(input: LimitUpRecordInput): Promise<void> {
    await db.execute(sql`
      INSERT INTO limit_up_records (
        code, name, date, prev_close, close_price, limit_up_price,
        change_pct, limit_ratio, consecutive_days, volume, amount,
        is_first_board, board_tag
      ) VALUES (
        ${input.code}, ${input.name}, ${input.date}, ${input.prevClose},
        ${input.closePrice}, ${input.limitUpPrice}, ${input.changePct},
        ${input.limitRatio}, ${input.consecutiveDays}, ${input.volume},
        ${input.amount}, ${input.isFirstBoard}, NULL
      )
      ON CONFLICT (code, date) DO UPDATE SET
        consecutive_days = EXCLUDED.consecutive_days,
        is_first_board = EXCLUDED.is_first_board
    `)
  }

  async getKlinesByDate(date: string): Promise<{ code: string; close: number; volume: number; amount: number }[]> {
    const rows = await db.select({
      code: klines.code,
      close: klines.close,
      volume: klines.volume,
      amount: klines.amount,
    })
      .from(klines)
      .where(eq(klines.date, date))
    return rows.map(r => ({
      code: r.code,
      close: Number(r.close),
      volume: Number(r.volume),
      amount: Number(r.amount),
    }))
  }

  async getKlinesByCodeAndDate(code: string, date: string): Promise<{ code: string; close: number } | null> {
    const [row] = await db.select({
      code: klines.code,
      close: klines.close,
    })
      .from(klines)
      .where(eq(klines.date, date))
      .limit(1)
    if (!row) return null
    return { code: row.code, close: Number(row.close) }
  }

  async getAllStocks(): Promise<{ code: string; name: string }[]> {
    const rows = await db.select({ code: stocks.code, name: stocks.name }).from(stocks)
    return rows.map(r => ({ code: r.code, name: r.name }))
  }
}
