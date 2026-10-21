import { db } from '../db/db.js'
import { stocks, klines, userStrategies } from '../db/schema.js'
import { eq, inArray, asc, sql } from 'drizzle-orm'
import type { IScanRepository, Stock, KLine, UserStrategy } from './IScanRepository.js'

export class DrizzleScanRepository implements IScanRepository {
  async findStocks(codes?: string[], limit = 100, offset = 0): Promise<Stock[]> {
    return db.select({ code: stocks.code, name: stocks.name })
      .from(stocks)
      .where(codes?.length ? inArray(stocks.code, codes) : undefined)
      .orderBy(stocks.code)
      .limit(limit)
      .offset(offset)
  }

  async saveKLines(klinesData: KLine[]): Promise<number> {
    if (klinesData.length === 0) return 0

    for (const k of klinesData) {
      await db.insert(klines).values({
        code: k.code,
        date: k.date,
        open: String(k.open),
        high: String(k.high),
        low: String(k.low),
        close: String(k.close),
        volume: k.volume,
        amount: String(k.amount),
      }).onConflictDoNothing()
    }
    return klinesData.length
  }

  async findUserStrategyById(id: number): Promise<UserStrategy | null> {
    const rows = await db.select().from(userStrategies)
      .where(eq(userStrategies.id, id))
      .limit(1)
    if (!rows[0]) return null
    return {
      id: rows[0].id,
      userId: rows[0].userId,
      name: rows[0].name,
      config: rows[0].config as { rules?: any[] },
    }
  }
}
