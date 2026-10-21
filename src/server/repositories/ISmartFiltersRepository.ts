import type { minuteKlines, moneyFlowDaily } from '../db/schema.js'
import {DrizzleSmartFiltersRepository} from './DrizzleSmartFiltersRepository.js';

export type MinuteKlineRow = typeof minuteKlines.$inferSelect
export type MoneyFlowRow = typeof moneyFlowDaily.$inferSelect

export interface MinuteKlineInput {
  code: string
  datetime: Date
  close: number
  volume: number
}

export interface MoneyFlowInput {
  code: string
  tradeDate: string
  closePrice: number
  changePct: number
  turnoverRate: number
}

export interface ISmartFiltersRepository {
  // minuteKlines
  getMinuteKlinesByCode(code: string, since: Date): Promise<MinuteKlineRow[]>
  getMinuteKlinesByCodeAndLimit(code: string, limit: number): Promise<MinuteKlineRow[]>

  // moneyFlowDaily
  getMoneyFlowByCode(code: string, limit?: number): Promise<MoneyFlowRow[]>
}

let _repo: ISmartFiltersRepository | null = null

export function setSmartFiltersRepository(repo: ISmartFiltersRepository): void {
  _repo = repo
}

export function getSmartFiltersRepository(): ISmartFiltersRepository {
  if (!_repo) {
    
    _repo = new DrizzleSmartFiltersRepository()
  }
  return _repo!
}
