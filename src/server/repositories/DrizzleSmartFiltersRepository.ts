import { db } from '../db/db.js'
import { minuteKlines, moneyFlowDaily } from '../db/schema.js'
import { eq, and, gte, desc } from 'drizzle-orm'
import type { ISmartFiltersRepository } from './ISmartFiltersRepository.js'

export class DrizzleSmartFiltersRepository implements ISmartFiltersRepository {
  async getMinuteKlinesByCode(code: string, since: Date): Promise<typeof minuteKlines.$inferSelect[]> {
    return db.select()
      .from(minuteKlines)
      .where(and(
        eq(minuteKlines.code, code),
        gte(minuteKlines.datetime, since)
      ))
      .orderBy(desc(minuteKlines.datetime))
      .limit(100)
  }

  async getMinuteKlinesByCodeAndLimit(code: string, limit: number): Promise<typeof minuteKlines.$inferSelect[]> {
    return db.select()
      .from(minuteKlines)
      .where(eq(minuteKlines.code, code))
      .orderBy(desc(minuteKlines.datetime))
      .limit(limit)
  }

  async getMoneyFlowByCode(code: string, limit = 5): Promise<typeof moneyFlowDaily.$inferSelect[]> {
    return db.select()
      .from(moneyFlowDaily)
      .where(eq(moneyFlowDaily.code, code))
      .orderBy(desc(moneyFlowDaily.tradeDate))
      .limit(limit)
  }
}
