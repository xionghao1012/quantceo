import type { KLine } from '../../shared/types.js'
import {DrizzleCompositeAlertRepository} from './DrizzleCompositeAlertRepository.js';

export interface ICompositeAlertRepository {
  // Real-time data
  getRecentRealtimeData(since: Date, limit?: number): Promise<Array<{
    code: string
    name: string
    netInflowMain: string | number | null
    netInflowMainPct: string | number | null
    closePrice: string | number | null
    updateTime: Date
  }>>

  // Stocks / limit up
  isSTOrLimitUp(code: string): Promise<boolean>

  // Klines for tech analysis
  getKlinesForMacd(code: string, limit?: number): Promise<KLine[]>
  getKlinesForVolume(code: string, limit?: number): Promise<KLine[]>

  // Alerts persistence
  saveAlert(code: string, name: string, alertType: string, detail: object): Promise<void>
}

// Module-level repo
let _repo: ICompositeAlertRepository | null = null

export function setCompositeAlertRepository(repo: ICompositeAlertRepository): void {
  _repo = repo
}

export function getCompositeAlertRepository(): ICompositeAlertRepository {
  if (!_repo) {
    
    _repo = new DrizzleCompositeAlertRepository()
  }
  return _repo!
}
