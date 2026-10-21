import { createRequire } from 'node:module'
import type { dailyMetrics } from '../db/schema.js'


// ESM 里没有 require（package.json 是 type: module），用 createRequire 兜住
const require = createRequire(import.meta.url)
export interface DailyMetricInput {
  metricDate: string
  code: string
  name: string
  exchange: string
  board: string
  rsi: string
  changePct: string
  volRatio: string
  macdSignal: string
  bbPosition: string
  maAlignment: number
  volatility: string
  momentum: string
}

export interface IDailyMetricsRepository {
  upsert(input: DailyMetricInput): Promise<void>
}

// Module-level singleton
let _repo: IDailyMetricsRepository | null = null

export function setDailyMetricsRepository(repo: IDailyMetricsRepository): void {
  _repo = repo
}

export function getDailyMetricsRepository(): IDailyMetricsRepository {
  if (!_repo) {
     
    const { DrizzleDailyMetricsRepository } = require('./DrizzleDailyMetricsRepository.js')
    _repo = new DrizzleDailyMetricsRepository()
  }
  return _repo!
}
