import {DrizzleSubscriptionRepository} from './DrizzleSubscriptionRepository.js';
export type OrderRow = {
  id: number
  plan: string
  status: string
  externalPlatform: string | null
  externalOrderId: string | null
  externalNote: string | null
  externalSubmittedAt: Date | null
  externalVerifiedAt: Date | null
  currentPeriodEnd: Date | null
  createdAt: Date
}

export type SubscriptionRow = {
  id: number
  userId: number
  plan: string
  status: string
  provider: string | null
  providerSubId: string | null
  providerData: Record<string, unknown> | null
  trialEndsAt: Date | null
  currentPeriodEnd: Date | null
  startDate: Date | null
  endDate: Date | null
  createdAt: Date
  cancelledAt: Date | null
  updatedAt: Date
}

export type UsageRow = {
  scans: number
  backtests: number
}

export interface ISubscriptionRepository {
  // Orders
  getUserOrders(userId: number): Promise<OrderRow[]>

  // Subscription CRUD
  getSubscription(userId: number): Promise<SubscriptionRow | null>
  createSubscription(data: any): Promise<SubscriptionRow>
  updateSubscription(id: number, data: any): Promise<void>
  cancelSubscription(id: number): Promise<void>

  // User role management
  updateUserRole(userId: number, role: string): Promise<void>
  getUserRole(userId: number): Promise<string | null>

  // Usage tracking
  getUsageToday(userId: number): Promise<UsageRow>
  recordScan(userId: number): Promise<void>
  recordBacktest(userId: number): Promise<void>

  // Watchlist
  getWatchlistCount(userId: number): Promise<number>

  // Payment logs
  logPayment(opts: {
    subscriptionId?: number
    userId?: number
    provider: string
    eventType: string
    amount?: number
    currency?: string
    status: string
    rawData?: Record<string, unknown>
  }): Promise<void>
}

// Module-level repository instance
let _repo: ISubscriptionRepository | null = null

export function setSubscriptionRepository(repo: ISubscriptionRepository): void {
  _repo = repo
}

export function getSubscriptionRepository(): ISubscriptionRepository {
  if (!_repo) {
    
    _repo = new DrizzleSubscriptionRepository()
  }
  return _repo!
}
