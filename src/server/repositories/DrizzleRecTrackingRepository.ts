import { db } from '../db/db.js'
import { recTracking } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import type { IRecTrackingRepository, RecTrackingRow } from './IRecTrackingRepository.js'

export class DrizzleRecTrackingRepository implements IRecTrackingRepository {
  async findByCodeAndDate(code: string, pickDate: string): Promise<RecTrackingRow | null> {
    const rows = await db.select({ id: recTracking.id, code: recTracking.code, name: recTracking.name, pickDate: recTracking.pickDate, status: recTracking.status })
      .from(recTracking)
      .where(and(eq(recTracking.code, code), eq(recTracking.pickDate, pickDate)))
      .limit(1)
    return rows[0] ?? null
  }

  async create(input: { code: string; name: string; pickDate: string; status: string }): Promise<void> {
    await db.insert(recTracking).values({
      code: input.code,
      name: input.name,
      pickDate: input.pickDate,
      status: input.status,
    })
  }
}
