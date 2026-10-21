import { db } from '../db/db.js'
import { moneyFlowAlertConfigs, moneyFlowRealtime, moneyFlowDaily, limitUpRecords, stocks, moneyFlowAlerts } from '../db/schema.js'
import { eq, and, gte, sql, desc } from 'drizzle-orm'
import type { IMoneyFlowAlertRepository, MoneyFlowAlertConfig } from './IMoneyFlowAlertRepository.js'
import type { KLine } from '../../shared/types.js'

export class DrizzleMoneyFlowAlertRepository implements IMoneyFlowAlertRepository {
  async getEnabledConfigs(): Promise<MoneyFlowAlertConfig[]> {
    return db.select().from(moneyFlowAlertConfigs)
      .where(eq(moneyFlowAlertConfigs.enabled, true)) as any
  }

  async createAlertConfig(userId: number, params: {
    code?: string; name?: string; thresholdType: string; thresholdValue: number;
    direction?: string; techResonanceEnabled?: boolean; techResonanceMacd?: boolean;
    techResonanceMa?: boolean; basicFilterEnabled?: boolean; smartFilterEnabled?: boolean;
  }): Promise<number> {
    const [row] = await db.insert(moneyFlowAlertConfigs).values({
      userId,
      code: params.code || null,
      name: params.name || null,
      enabled: true,
      thresholdType: params.thresholdType,
      thresholdValue: String(params.thresholdValue),
      direction: params.direction || 'inflow',
      techResonanceEnabled: params.techResonanceEnabled ?? false,
      techResonanceMacd: params.techResonanceMacd ?? false,
      techResonanceMa: params.techResonanceMa ?? false,
      basicFilterEnabled: params.basicFilterEnabled ?? true,
      smartFilterEnabled: params.smartFilterEnabled ?? false,
    }).returning()
    return row.id
  }

  async listAlertConfigs(userId: number): Promise<MoneyFlowAlertConfig[]> {
    return db.select().from(moneyFlowAlertConfigs)
      .where(eq(moneyFlowAlertConfigs.userId, userId))
      .orderBy(sql`${moneyFlowAlertConfigs.createdAt} DESC`) as any
  }

  async deleteAlertConfig(userId: number, configId: number): Promise<boolean> {
    const result = await db.delete(moneyFlowAlertConfigs)
      .where(and(
        eq(moneyFlowAlertConfigs.id, configId),
        eq(moneyFlowAlertConfigs.userId, userId),
      ))
    return (result.rowCount ?? 0) > 0
  }

  async toggleAlertConfig(userId: number, configId: number, enabled: boolean): Promise<boolean> {
    const result = await db.update(moneyFlowAlertConfigs)
      .set({ enabled })
      .where(and(
        eq(moneyFlowAlertConfigs.id, configId),
        eq(moneyFlowAlertConfigs.userId, userId),
      ))
    return (result.rowCount ?? 0) > 0
  }

  async getRecentRealtimeData(since: Date, limit = 500) {
    return db.select().from(moneyFlowRealtime)
      .where(gte(moneyFlowRealtime.updateTime, since))
      .limit(limit)
  }

  async isST(code: string): Promise<boolean> {
    const rows = await db.select({ name: stocks.name }).from(stocks).where(eq(stocks.code, code)).limit(1)
    if (!rows.length) return false
    return rows[0].name?.includes('ST') || rows[0].name?.includes('*ST') || false
  }

  async isLimitUp(code: string): Promise<boolean> {
    const today = new Date().toISOString().split('T')[0]
    const rows = await db.select({ code: limitUpRecords.code }).from(limitUpRecords)
      .where(and(eq(limitUpRecords.code, code), eq(limitUpRecords.date, today)))
      .limit(1)
    return rows.length > 0
  }

  async getKlinesForTech(code: string, limit = 90): Promise<KLine[]> {
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
      code,
      name,
      alertType,
      detail,
      notified: true,
    })
  }
}
