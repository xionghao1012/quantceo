import { eq, desc } from 'drizzle-orm'
import { db } from '../db/db.js'
import { subscriptions, paymentLogs, users, watchlist } from '../db/schema.js'
import type { ISubscriptionRepository, SubscriptionRow, UsageRow } from './ISubscriptionRepository.js'

export class DrizzleSubscriptionRepository implements ISubscriptionRepository {
  async getUserOrders(userId: number) {
    const rows = await db.select({
      id: subscriptions.id,
      plan: subscriptions.plan,
      status: subscriptions.status,
      externalPlatform: subscriptions.externalPlatform,
      externalOrderId: subscriptions.externalOrderId,
      externalNote: subscriptions.externalNote,
      externalSubmittedAt: subscriptions.externalSubmittedAt,
      externalVerifiedAt: subscriptions.externalVerifiedAt,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      createdAt: subscriptions.createdAt,
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(10)
    return rows
  }

  async getSubscription(userId: number): Promise<SubscriptionRow | null> {
    const rows = await db.select().from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1)
    return (rows[0] as unknown as SubscriptionRow) || null
  }

  async createSubscription(data: any): Promise<SubscriptionRow> {
    const result = await db.insert(subscriptions).values(data).returning()
    return result[0] as unknown as SubscriptionRow
  }

  async updateSubscription(id: number, data: any): Promise<void> {
    await db.update(subscriptions).set(data).where(eq(subscriptions.id, id))
  }

  async cancelSubscription(id: number): Promise<void> {
    await db.update(subscriptions)
      .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(subscriptions.id, id))
  }

  async updateUserRole(userId: number, role: string): Promise<void> {
    await db.update(users).set({ role: role as any, updatedAt: new Date() }).where(eq(users.id, userId))
  }

  async getUserRole(userId: number): Promise<string | null> {
    const rows = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1)
    return rows[0]?.role || null
  }

  async getUsageToday(userId: number): Promise<UsageRow> {
    const userRows = await db.select({ usage: users.usage }).from(users).where(eq(users.id, userId)).limit(1)
    const usage = (userRows[0]?.usage as Record<string, unknown>) || {}
    const today = new Date().toISOString().slice(0, 10)
    const todayScans = String(usage.scansToday || '') === today ? (Number(usage.scanCount) || 0) : 0
    const todayBacktests = String(usage.backtestsToday || '') === today ? (Number(usage.backtestCount) || 0) : 0
    return { scans: todayScans, backtests: todayBacktests }
  }

  async recordScan(userId: number): Promise<void> {
    const userRows = await db.select({ usage: users.usage }).from(users).where(eq(users.id, userId)).limit(1)
    const usage = (userRows[0]?.usage as Record<string, unknown>) || {}
    const today = new Date().toISOString().slice(0, 10)
    const newUsage = {
      ...usage,
      scansToday: today,
      scanCount: (String(usage.scansToday || '') === today ? (Number(usage.scanCount) || 0) : 0) + 1,
    }
    await db.update(users).set({ usage: newUsage as any, updatedAt: new Date() }).where(eq(users.id, userId))
  }

  async recordBacktest(userId: number): Promise<void> {
    const userRows = await db.select({ usage: users.usage }).from(users).where(eq(users.id, userId)).limit(1)
    const usage = (userRows[0]?.usage as Record<string, unknown>) || {}
    const today = new Date().toISOString().slice(0, 10)
    const newUsage = {
      ...usage,
      backtestsToday: today,
      backtestCount: (String(usage.backtestsToday || '') === today ? (Number(usage.backtestCount) || 0) : 0) + 1,
    }
    await db.update(users).set({ usage: newUsage as any, updatedAt: new Date() }).where(eq(users.id, userId))
  }

  async getWatchlistCount(userId: number): Promise<number> {
    const rows = await db.select().from(watchlist).where(eq(watchlist.userId, userId))
    return rows.length
  }

  async logPayment(opts: {
    subscriptionId?: number
    userId?: number
    provider: string
    eventType: string
    amount?: number
    currency?: string
    status: string
    rawData?: Record<string, unknown>
  }): Promise<void> {
    await db.insert(paymentLogs).values({
      subscriptionId: opts.subscriptionId,
      userId: opts.userId,
      provider: opts.provider,
      eventType: opts.eventType,
      amount: opts.amount,
      currency: opts.currency || 'CNY',
      status: opts.status,
      rawData: opts.rawData || {},
    })
  }
}
