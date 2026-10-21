import type { Rule } from '../../shared/types.js'
import {DrizzleScanRepository} from './DrizzleScanRepository.js';

export interface Stock {
  code: string
  name: string
}

export interface KLine {
  code: string
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number
}

export interface UserStrategy {
  id: number
  userId: number
  name: string
  config: {
    rules?: Rule[]
  }
}

export interface IScanRepository {
  // Stocks
  findStocks(codes?: string[], limit?: number, offset?: number): Promise<Stock[]>

  // KLines
  saveKLines(klines: KLine[]): Promise<number>

  // User strategies
  findUserStrategyById(id: number): Promise<UserStrategy | null>
}

// Module-level repository instance
let _repo: IScanRepository | null = null

export function setScanRepository(repo: IScanRepository): void {
  _repo = repo
}

export function getScanRepository(): IScanRepository {
  if (!_repo) {
    
    _repo = new DrizzleScanRepository()
  }
  return _repo!
}
