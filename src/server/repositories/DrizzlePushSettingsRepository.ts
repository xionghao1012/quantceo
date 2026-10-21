import { db } from '../db/db.js'
import { pushSettings, notificationLogs, users, subscriptions } from '../db/schema.js'
import { inArray, desc } from 'drizzle-orm'
import type { IPushSettingsRepository, PushSetting, UserRow, SubscriptionRow, NotificationLogInput } from './IPushSettingsRepository.js'

export class DrizzlePushSettingsRepository implements IPushSettingsRepository {
  async findAll(): Promise<PushSetting[]> {
    const rows = await db.select().from(pushSettings)
    // Drizzle 把 json 列推断成 unknown，运行时就是结构化 JSON
    return rows as unknown as PushSetting[]
  }

  async findUsersByIds(userIds: number[]): Promise<UserRow[]> {
    if (userIds.length === 0) return []
    return db.select({ id: users.id, role: users.role, email: users.email })
      .from(users)
      .where(inArray(users.id, userIds))
  }

  async findSubscriptionsByUserIds(userIds: number[]): Promise<SubscriptionRow[]> {
    if (userIds.length === 0) return []
    return db.select({ userId: subscriptions.userId, plan: subscriptions.plan, status: subscriptions.status, createdAt: subscriptions.createdAt })
      .from(subscriptions)
      .where(inArray(subscriptions.userId, userIds))
      .orderBy(desc(subscriptions.createdAt))
  }

  async createNotificationLog(input: NotificationLogInput): Promise<void> {
    await db.insert(notificationLogs).values({
      userId: input.userId,
      channel: input.channel,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data,
      status: input.status,
    })
  }
}
