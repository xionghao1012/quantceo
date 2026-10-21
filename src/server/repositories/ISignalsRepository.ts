import { createRequire } from 'node:module'
import { eq, desc, and, gte, lte, sql } from 'drizzle-orm'
import type { signals } from '../db/schema.js'


// ESM 里没有 require（package.json 是 type: module），用 createRequire 兜住
const require = createRequire(import.meta.url)
export interface SignalRow {
  id: number
  code: string
  name: string
  scanDate: Date
  strategyId: number
  strategyName: string
  direction: string
  strength: number
  price: string | null
  indicators: Record<string, unknown>
  reason: string
}

export interface CreateSignalInput {
  code: string
  name: string
  scanDate: string
  strategyId: number
  strategyName: string
  direction: string
  strength: number
  price: string
  reason: string
}

export interface ISignalsRepository {
  create(input: CreateSignalInput): Promise<void>
  findByDate(scanDate: string, limit?: number): Promise<SignalRow[]>
  findByDateRange(startDate: string, endDate: string, limit?: number): Promise<SignalRow[]>
}

// Module-level singleton
let _repo: ISignalsRepository | null = null

export function setSignalsRepository(repo: ISignalsRepository): void {
  _repo = repo
}

export function getSignalsRepository(): ISignalsRepository {
  if (!_repo) {
     
    const { DrizzleSignalsRepository } = require('./DrizzleSignalsRepository.js')
    _repo = new DrizzleSignalsRepository()
  }
  return _repo!
}
