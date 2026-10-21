import { createRequire } from 'node:module'
import type { pushSettings, notificationLogs, users, subscriptions } from '../db/schema.js'
import { inArray, desc } from 'drizzle-orm'


// ESM 里没有 require（package.json 是 type: module），用 createRequire 兜住
const require = createRequire(import.meta.url)
export interface PushSetting {
  id: number
  userId: number
  channels: { inApp?: boolean; wechat?: boolean; email?: boolean }
  triggers: { onSignal?: boolean; dailyDigest?: boolean; weeklyReport?: boolean }
  filter: { minStrength?: number; onlyBuy?: boolean; codes?: string[] }
  serverChanKey: string
}

export interface UserRow {
  id: number
  role: string
  email: string
}

export interface SubscriptionRow {
  userId: number
  plan: string
  status: string
  createdAt: Date
}

export interface NotificationLogInput {
  userId: number
  channel: string
  type: string
  title: string
  body: string
  data: Record<string, unknown>
  status: string
}

export interface IPushSettingsRepository {
  findAll(): Promise<PushSetting[]>
  findUsersByIds(userIds: number[]): Promise<UserRow[]>
  findSubscriptionsByUserIds(userIds: number[]): Promise<SubscriptionRow[]>
  createNotificationLog(input: NotificationLogInput): Promise<void>
}

// Module-level singleton
let _repo: IPushSettingsRepository | null = null

export function setPushSettingsRepository(repo: IPushSettingsRepository): void {
  _repo = repo
}

export function getPushSettingsRepository(): IPushSettingsRepository {
  if (!_repo) {
     
    const { DrizzlePushSettingsRepository } = require('./DrizzlePushSettingsRepository.js')
    _repo = new DrizzlePushSettingsRepository()
  }
  return _repo!
}
