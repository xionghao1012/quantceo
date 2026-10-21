import type { SourceAdapter, MoneyFlowData, MoneyFlowMinute, SourceManagerConfig } from '@shared/sources.js'

type HealthStatus = 'healthy' | 'degraded' | 'unavailable'

interface SourceHealth {
  status: HealthStatus
  lastCheck: Date
  consecutiveFailures: number
}

export class SourceManager {
  private sources: SourceAdapter[] = []
  private healthMap = new Map<string, SourceHealth>()
  private config: Required<SourceManagerConfig>
  private healthCheckTimer?: NodeJS.Timeout

  constructor(config: SourceManagerConfig = {}) {
    this.config = {
      enableFallback: config.enableFallback ?? true,
      healthCheckInterval: config.healthCheckInterval ?? 60000,
      fallbackDelay: config.fallbackDelay ?? 1000,
    }
  }

  register(adapter: SourceAdapter): void {
    this.sources.push(adapter)
    this.sources.sort((a, b) => a.priority - b.priority)
    this.healthMap.set(adapter.name, {
      status: 'healthy',
      lastCheck: new Date(),
      consecutiveFailures: 0,
    })
  }

  unregister(name: string): void {
    this.sources = this.sources.filter((s) => s.name !== name)
    this.healthMap.delete(name)
  }

  async fetchMoneyFlow(code: string, days = 5): Promise<{ data: MoneyFlowData[]; source: string }> {
    const availableSources = this.getAvailableSources()

    for (const source of availableSources) {
      try {
        const data = await source.fetchDailyMoneyFlow(code, days)
        if (data.length > 0) {
          this.recordSuccess(source.name)
          return { data, source: source.name }
        }
      } catch (e) {
        this.recordFailure(source.name)
        console.warn(`[SourceManager] ${source.name} failed for ${code}:`, e)
      }
    }

    return { data: [], source: 'none' }
  }

  async fetchMinuteMoneyFlow(code: string, date?: string): Promise<{ data: MoneyFlowMinute[]; source: string }> {
    const availableSources = this.getAvailableSources()

    for (const source of availableSources) {
      if (!source.fetchMinuteMoneyFlow) continue
      try {
        const data = await source.fetchMinuteMoneyFlow(code, date)
        if (data.length > 0) {
          this.recordSuccess(source.name)
          return { data, source: source.name }
        }
      } catch (e) {
        this.recordFailure(source.name)
        console.warn(`[SourceManager] ${source.name} minute failed for ${code}:`, e)
      }
    }

    return { data: [], source: 'none' }
  }

  async fetchWithFallback<T>(
    code: string,
    fetcher: (source: SourceAdapter) => Promise<T>,
    predicate?: (data: T) => boolean,
  ): Promise<{ data: T; source: string }> {
    const availableSources = this.getAvailableSources()

    for (const source of availableSources) {
      try {
        const data = await fetcher(source)
        if (!predicate || predicate(data)) {
          this.recordSuccess(source.name)
          return { data, source: source.name }
        }
      } catch (e) {
        this.recordFailure(source.name)
        if (!this.config.enableFallback) throw e
      }

      if (this.config.enableFallback) {
        await this.delay(this.config.fallbackDelay)
      }
    }

    throw new Error(`All sources failed for ${code}`)
  }

  getAvailableSources(): SourceAdapter[] {
    return this.sources.filter((s) => {
      const health = this.healthMap.get(s.name)
      return !health || health.status !== 'unavailable'
    })
  }

  getHealth(name: string): SourceHealth | undefined {
    return this.healthMap.get(name)
  }

  getAllHealth(): Map<string, SourceHealth> {
    return new Map(this.healthMap)
  }

  private recordSuccess(name: string): void {
    const health = this.healthMap.get(name)
    if (health) {
      health.consecutiveFailures = 0
      health.status = 'healthy'
      health.lastCheck = new Date()
    }
  }

  private recordFailure(name: string): void {
    const health = this.healthMap.get(name)
    if (health) {
      health.consecutiveFailures++
      health.lastCheck = new Date()
      if (health.consecutiveFailures >= 3) {
        health.status = 'degraded'
      }
      if (health.consecutiveFailures >= 5) {
        health.status = 'unavailable'
        console.warn(`[SourceManager] ${name} marked as unavailable after ${health.consecutiveFailures} failures`)
      }
    }
  }

  async checkHealth(): Promise<void> {
    await Promise.all(
      this.sources.map(async (source) => {
        try {
          const available = await source.isAvailable()
          const health = this.healthMap.get(source.name)
          if (health) {
            if (available) {
              health.consecutiveFailures = 0
              health.status = health.consecutiveFailures >= 3 ? 'degraded' : 'healthy'
            } else {
              this.recordFailure(source.name)
            }
          }
        } catch {
          this.recordFailure(source.name)
        }
      }),
    )
  }

  startHealthCheck(): void {
    this.healthCheckTimer = setInterval(() => this.checkHealth(), this.config.healthCheckInterval)
  }

  stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = undefined
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export const globalSourceManager = new SourceManager()
