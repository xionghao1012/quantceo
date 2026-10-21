import {DrizzleLimitUpRepository} from './DrizzleLimitUpRepository.js';
export type LimitUpRecordRow = {
  code: string
  date: string
  close_price: number
  prev_close: number
}

export interface LimitUpRecordInput {
  code: string
  name: string
  date: string
  prevClose: number
  closePrice: number
  limitUpPrice: number
  changePct: number
  limitRatio: number
  consecutiveDays: number
  volume: number
  amount: number
  isFirstBoard: boolean
}

export interface ILimitUpRepository {
  // limit_up_records
  getLimitUpRecord(code: string, date: string): Promise<LimitUpRecordRow | null>
  getLimitUpRecordsInRange(startDate: string, endDate: string): Promise<LimitUpRecordRow[]>
  upsertLimitUpRecord(input: LimitUpRecordInput): Promise<void>

  // klines
  getKlinesByDate(date: string): Promise<{ code: string; close: number; volume: number; amount: number }[]>
  getKlinesByCodeAndDate(code: string, date: string): Promise<{ code: string; close: number } | null>

  // stocks
  getAllStocks(): Promise<{ code: string; name: string }[]>
}

let _repo: ILimitUpRepository | null = null

export function setLimitUpRepository(repo: ILimitUpRepository): void {
  _repo = repo
}

export function getLimitUpRepository(): ILimitUpRepository {
  if (!_repo) {
    
    _repo = new DrizzleLimitUpRepository()
  }
  return _repo!
}
