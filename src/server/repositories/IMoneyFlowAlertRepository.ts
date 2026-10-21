import type { KLine } from '../../shared/types.js'
import {DrizzleMoneyFlowAlertRepository} from './DrizzleMoneyFlowAlertRepository.js';

export type MoneyFlowAlertConfig = {
  id: number
  userId: number
  code: string | null
  name: string | null
  enabled: boolean
  thresholdType: string
  thresholdValue: string
  direction: string
  techResonanceEnabled: boolean
  techResonanceMacd: boolean
  techResonanceMa: boolean
  basicFilterEnabled: boolean
  smartFilterEnabled: boolean
  createdAt: Date
}

export interface IMoneyFlowAlertRepository {
  // Alert configs
  getEnabledConfigs(): Promise<MoneyFlowAlertConfig[]>
  createAlertConfig(userId: number, params: {
    code?: string; name?: string; thresholdType: string; thresholdValue: number;
    direction?: string; techResonanceEnabled?: boolean; techResonanceMacd?: boolean;
    techResonanceMa?: boolean; basicFilterEnabled?: boolean; smartFilterEnabled?: boolean;
  }): Promise<number>
  listAlertConfigs(userId: number): Promise<MoneyFlowAlertConfig[]>
  deleteAlertConfig(userId: number, configId: number): Promise<boolean>
  toggleAlertConfig(userId: number, configId: number, enabled: boolean): Promise<boolean>

  // Real-time data
  getRecentRealtimeData(since: Date, limit?: number): Promise<Array<{
    code: string
    name: string
    netInflowMain: string | number | null
    netInflowMainPct: string | number | null
    closePrice: string | number | null
    updateTime: Date
  }>>

  // Stocks
  isST(code: string): Promise<boolean>
  isLimitUp(code: string): Promise<boolean>

  // Klines for tech analysis
  getKlinesForTech(code: string, limit?: number): Promise<KLine[]>

  // Alerts persistence
  saveAlert(code: string, name: string, alertType: string, detail: object): Promise<void>
}

// Module-level repo
let _repo: IMoneyFlowAlertRepository | null = null

export function setMoneyFlowAlertRepository(repo: IMoneyFlowAlertRepository): void {
  _repo = repo
}

export function getMoneyFlowAlertRepository(): IMoneyFlowAlertRepository {
  if (!_repo) {
    
    _repo = new DrizzleMoneyFlowAlertRepository()
  }
  return _repo!
}
