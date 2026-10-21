import { db } from '../db/db.js'
import { moneyFlowRealtime, moneyFlowDaily, limitUpRecords, stocks, moneyFlowAlerts } from '../db/schema.js'
import { eq, and, gte, sql } from 'drizzle-orm'
import type { ICompositeAlertRepository } from './ICompositeAlertRepository.js'
import type { KLine } from '../../shared/types.js'

export class DrizzleCompositeAlertRepository implements ICompositeAlertRepository {
  async getRecentRealtimeData(since: Date, limit = 500) {
    return db.select().from(moneyFlowRealtime)
      .where(gte(moneyFlowRealtime.updateTime, since))
      .limit(limit)
  }

  async isSTOrLimitUp(code: string): Promise<boolean> {
    const today = new Date().toISOString().split('T')[0]
    const [stRows, luRows] = await Promise.all([
      db.select({ name: stocks.name }).from(stocks).where(eq(stocks.code, code)).limit(1),
      db.select({ code: limitUpRecords.code }).from(limitUpRecords)
        .where(and(eq(limitUpRecords.code, code), eq(limitUpRecords.date, today))).limit(1),
    ])
    if (stRows.length && (stRows[0].name?.includes('ST'))) return true
    return luRows.length > 0
  }

  async getKlinesForMacd(code: string, limit = 60): Promise<KLine[]> {
    const { rows } = await db.execute(sql`
      SELECT date::text, open::numeric, high::numeric, low::numeric,
             close::numeric, volume, amount::numeric
      FROM klines
      WHERE code = ${code}
      ORDER BY date DESC
      LIMIT ${limit}
    `) as { rows: any[] }
    return rows.reverse() as KLine[]
  }

  async getKlinesForVolume(code: string, limit = 30): Promise<KLine[]> {
    const { rows } = await db.execute(sql`
      SELECT date::text, open::numeric, high::numeric, low::numeric,
             close::numeric, volume, amount::numeric
      FROM klines
      WHERE code = ${code}
      ORDER BY date DESC
      LIMIT ${limit}
    `) as { rows: any[] }
    return rows.reverse() as KLine[]
  }

  async saveAlert(code: string, name: string, alertType: string, detail: object): Promise<void> {
    await db.insert(moneyFlowAlerts).values({
      code, name, alertType, detail, notified: true,
    })
  }
}
