import { createRequire } from 'node:module'
import type { positions, priceAlerts } from '../db/schema.js'
import {DrizzlePositionsRepository} from './DrizzlePositionsRepository.js';


// ESM 里没有 require（package.json 是 type: module），用 createRequire 兜住
const require = createRequire(import.meta.url)
export interface Position {
  id: number
  userId: number
  code: string
  name: string
  quantity: number
  entryPrice: string
  stopLoss: string | null
  takeProfit: string | null
  status: string
  notes: string
  createdAt: Date
  updatedAt: Date
}

export interface PriceAlert {
  id: number
  userId: number
  code: string
  name: string
  targetPrice: string | null
  targetValue: string | null
  direction: string
  condition: string
  status: string
  enabled: boolean
  triggeredAt: Date | null
  createdAt: Date
}

export interface CreatePositionInput {
  userId: number
  code: string
  name: string
  quantity: number
  entryPrice: string
  stopLoss?: string | null
  takeProfit?: string | null
  status?: string
  notes?: string
}

export interface UpdatePositionInput {
  quantity?: number
  entryPrice?: string
  stopLoss?: string | null
  takeProfit?: string | null
  status?: string
  notes?: string
}

export interface IPositionsRepository {
  findById(id: number, userId: number): Promise<Position | null>
  findByUserId(userId: number): Promise<Position[]>
  findOpenByUserId(userId: number): Promise<Position[]>
  create(input: CreatePositionInput): Promise<{ position: Position; alertIds: number[] }>
  update(id: number, userId: number, input: UpdatePositionInput): Promise<{ position: Position; alertIds: number[] }>
  delete(id: number, userId: number): Promise<void>
}

export interface CreateAlertInput {
  userId: number
  code: string
  name: string
  condition: string
  targetValue: string
}

export interface IPriceAlertsRepository {
  createAlert(input: CreateAlertInput): Promise<PriceAlert>
  deleteByCodeAndUserId(userId: number, code: string): Promise<void>
}

// Module-level repository instance
let _positionsRepo: IPositionsRepository | null = null
let _priceAlertsRepo: IPriceAlertsRepository | null = null

export function setPositionsRepository(repo: IPositionsRepository): void {
  _positionsRepo = repo
}

export function getPositionsRepository(): IPositionsRepository {
  if (!_positionsRepo) {
    _positionsRepo = new DrizzlePositionsRepository()
  }
  return _positionsRepo!
}

export function setPriceAlertsRepository(repo: IPriceAlertsRepository): void {
  _priceAlertsRepo = repo
}

export function getPriceAlertsRepository(): IPriceAlertsRepository {
  if (!_priceAlertsRepo) {
    // 延迟 require，避免与 DrizzlePositionsRepository 形成循环导入
    const { DrizzlePriceAlertsRepository } = require('./DrizzlePositionsRepository.js')
    _priceAlertsRepo = new DrizzlePriceAlertsRepository()
  }
  return _priceAlertsRepo!
}
