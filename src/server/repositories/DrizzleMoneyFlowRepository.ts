import { db } from '../db/db.js'
import { moneyFlowDaily, moneyFlowRealtime, moneyFlowAlerts, moneyFlowSources, stocks, limitUpRecords } from '../db/schema.js'
import { eq, desc, and, sql } from 'drizzle-orm'
import type { IMoneyFlowRepository } from './IMoneyFlowRepository.js'
import type { MoneyFlowRealtime, MoneyFlowData } from '../data/eastmoneyMoneyFlow.js'

const currentSource = 'eastmoney'

export class DrizzleMoneyFlowRepository implements IMoneyFlowRepository {
  async getLimitUpCodes(date: string) {
    return db.select({ code: limitUpRecords.code })
      .from(limitUpRecords)
      .where(eq(limitUpRecords.date, date))
  }

  async getDailyMoneyFlow(code: string) {
    return db.select().from(moneyFlowDaily).where(eq(moneyFlowDaily.code, code))
  }

  async saveDailyMoneyFlow(data: MoneyFlowData) {
    const vals: typeof moneyFlowDaily.$inferInsert = {
      code: data.code,
      name: data.name,
      tradeDate: data.date,
      closePrice: String(data.close),
      changePct: String(data.changePct),
      netInflowSuperLarge: String(data.netInflowSuperLarge),
      netInflowLarge: String(data.netInflowLarge),
      netInflowMedium: String(data.netInflowMedium),
      netInflowSmall: String(data.netInflowSmall),
      netInflowMain: String(data.netInflowMain),
      netInflowMainPct: String(data.netInflowMainPct),
      turnoverRate: data.turnoverRate !== undefined ? String(data.turnoverRate) : null,
      source: currentSource,
    }
    await db.insert(moneyFlowDaily).values(vals).onConflictDoUpdate({
      target: [moneyFlowDaily.code, moneyFlowDaily.tradeDate],
      set: {
        closePrice: String(data.close),
        changePct: String(data.changePct),
        netInflowSuperLarge: String(data.netInflowSuperLarge),
        netInflowLarge: String(data.netInflowLarge),
        netInflowMedium: String(data.netInflowMedium),
        netInflowSmall: String(data.netInflowSmall),
        netInflowMain: String(data.netInflowMain),
        netInflowMainPct: String(data.netInflowMainPct),
        turnoverRate: data.turnoverRate !== undefined ? String(data.turnoverRate) : null,
      },
    })
  }

  async saveRealtimeMoneyFlow(data: MoneyFlowRealtime, flags: { isLimitUp: boolean; isAuctionAnomaly: boolean; anomalyReason?: string }) {
    const vals: typeof moneyFlowRealtime.$inferInsert = {
      code: data.code,
      name: data.name,
      updateTime: data.updateTime,
      closePrice: String(data.close),
      netInflowSuperLarge: String(data.netInflowSuperLarge),
      netInflowLarge: String(data.netInflowLarge),
      netInflowMedium: String(data.netInflowMedium),
      netInflowSmall: String(data.netInflowSmall),
      netInflowMain: String(data.netInflowMain),
      netInflowMainPct: String(data.netInflowMainPct),
      source: currentSource,
      isLimitUp: flags.isLimitUp,
      isAuctionAnomaly: flags.isAuctionAnomaly,
      anomalyReason: flags.anomalyReason || null,
    }
    await db.insert(moneyFlowRealtime).values(vals)
  }

  async getLatestDailyNetInflow(code: string): Promise<number | null> {
    const rows = await db.select({ netInflowMain: moneyFlowDaily.netInflowMain })
      .from(moneyFlowDaily)
      .where(eq(moneyFlowDaily.code, code))
      .orderBy(desc(moneyFlowDaily.tradeDate))
      .limit(1)
    return rows.length > 0 ? Number(rows[0].netInflowMain || 0) : null
  }

  async getAlert(code: string, alertType: string) {
    const [row] = await db.select({ id: moneyFlowAlerts.id })
      .from(moneyFlowAlerts)
      .where(and(
        eq(moneyFlowAlerts.code, code),
        eq(moneyFlowAlerts.alertType, alertType),
        eq(moneyFlowAlerts.notified, false),
      ))
      .limit(1)
    return row ?? null
  }

  async saveAlert(code: string, name: string, alertType: string, detail: object) {
    const vals: typeof moneyFlowAlerts.$inferInsert = { code, name, alertType, detail }
    await db.insert(moneyFlowAlerts).values(vals)
  }

  async getActiveStocks() {
    return db.select({ code: stocks.code, name: stocks.name })
      .from(stocks)
      .where(eq(stocks.status, 'active'))
  }

  async updateSourceStatus(success: boolean, _failMsg?: string) {
    const now = new Date()
    if (success) {
      const vals: typeof moneyFlowSources.$inferInsert = {
        sourceName: currentSource,
        sourceType: 'primary',
        isActive: true,
        lastSuccessAt: now,
        failCount: 0,
      }
      await db.insert(moneyFlowSources).values(vals).onConflictDoUpdate({
        target: [moneyFlowSources.sourceName],
        set: { lastSuccessAt: now, failCount: 0, isActive: true },
      })
    } else {
      await db.execute(sql`
        INSERT INTO money_flow_sources (source_name, source_type, is_active, last_fail_at, fail_count, created_at)
        VALUES (${currentSource}, 'primary', false, ${now}, 1, ${now})
        ON CONFLICT (source_name) DO UPDATE SET
          last_fail_at = ${now},
          fail_count = money_flow_sources.fail_count + 1,
          is_active = false
      `)
    }
  }
}
