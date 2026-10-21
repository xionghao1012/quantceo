import { db } from '../db/db.js'
import { signals } from '../db/schema.js'
import { eq, desc, and, gte, lte, sql } from 'drizzle-orm'
import type { ISignalsRepository, SignalRow, CreateSignalInput } from './ISignalsRepository.js'

export class DrizzleSignalsRepository implements ISignalsRepository {
  async create(input: CreateSignalInput): Promise<void> {
    await db.insert(signals).values({
      code: input.code,
      name: input.name,
      scanDate: input.scanDate,
      strategyId: input.strategyId,
      strategyName: input.strategyName,
      direction: input.direction,
      strength: input.strength,
      price: input.price,
      indicators: {},
      reason: input.reason,
    }).onConflictDoNothing()
  }

  async findByDate(scanDate: string, limit = 100): Promise<SignalRow[]> {
    const rows = await db.select().from(signals)
      .where(eq(signals.scanDate, scanDate))
      .limit(limit)
    // Drizzle 把 json 列推断成 unknown，运行时就是结构化 JSON
    return rows as unknown as SignalRow[]
  }

  async findByDateRange(startDate: string, endDate: string, limit = 50): Promise<SignalRow[]> {
    const rows = await db.select().from(signals)
      .where(sql`${signals.scanDate} >= ${startDate} AND ${signals.scanDate} <= ${endDate}`)
      .limit(limit)
    return rows as unknown as SignalRow[]
  }
}
