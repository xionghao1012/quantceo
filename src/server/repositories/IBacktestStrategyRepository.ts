import {DrizzleBacktestStrategyRepository} from './DrizzleBacktestStrategyRepository.js';
export type KlinePrice = { date: string; close: number }

export interface IBacktestStrategyRepository {
  // Get distinct metric dates in range
  getDailyMetricsDates(startDate: string, endDate: string): Promise<string[]>

  // Get top N stocks by score for a given date
  getTopNByScore(date: string, scoreSQL: string, topN: number): Promise<{ code: string; name: string; score: number }[]>

  // Check if stock satisfies conditions
  checkConditions(date: string, code: string, conditionsSQL: string[]): Promise<boolean>

  // Get klines for codes in date range
  getKlinesForCodes(codes: string[], startDate: string, endDate: string): Promise<Map<string, KlinePrice[]>>
}

let _repo: IBacktestStrategyRepository | null = null

export function setBacktestStrategyRepository(repo: IBacktestStrategyRepository): void {
  _repo = repo
}

export function getBacktestStrategyRepository(): IBacktestStrategyRepository {
  if (!_repo) {
    
    _repo = new DrizzleBacktestStrategyRepository()
  }
  return _repo!
}
