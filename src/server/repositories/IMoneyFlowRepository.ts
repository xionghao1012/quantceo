import type { MoneyFlowRealtime, MoneyFlowData } from '../data/eastmoneyMoneyFlow.js'
import {DrizzleMoneyFlowRepository} from './DrizzleMoneyFlowRepository.js';

export interface IMoneyFlowRepository {
  // 涨停记录
  getLimitUpCodes(date: string): Promise<{ code: string }[]>

  // 日资金流向
  getDailyMoneyFlow(code: string): Promise<any[]>
  saveDailyMoneyFlow(data: MoneyFlowData): Promise<void>

  // 实时资金流向
  saveRealtimeMoneyFlow(data: MoneyFlowRealtime, flags: { isLimitUp: boolean; isAuctionAnomaly: boolean; anomalyReason?: string }): Promise<void>

  // 交叉验证：查日线数据
  getLatestDailyNetInflow(code: string): Promise<number | null>

  // 告警
  getAlert(code: string, alertType: string): Promise<{ id: number } | null>
  saveAlert(code: string, name: string, alertType: string, detail: object): Promise<void>

  // 股票
  getActiveStocks(): Promise<{ code: string; name: string }[]>

  // 数据源状态
  updateSourceStatus(success: boolean, failMsg?: string): Promise<void>
}

// 模块级 repository 实例
 
let _repo: IMoneyFlowRepository | null = null

export function setMoneyFlowRepository(repo: IMoneyFlowRepository): void {
  _repo = repo
}

export function getMoneyFlowRepository(): IMoneyFlowRepository {
  if (!_repo) {
    // 延迟导入避免循环依赖
     
    
    _repo = new DrizzleMoneyFlowRepository()
  }
  return _repo!
}
