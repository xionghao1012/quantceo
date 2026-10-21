export interface MoneyFlowData {
  code: string
  name: string
  date: string
  close: number
  changePct: number
  netInflowSuperLarge: number
  netInflowLarge: number
  netInflowMedium: number
  netInflowSmall: number
  netInflowMain: number
  netInflowMainPct: number
  turnoverRate?: number
}

export interface MoneyFlowRealtime {
  code: string
  name: string
  updateTime: Date
  close: number
  netInflowSuperLarge: number
  netInflowLarge: number
  netInflowMedium: number
  netInflowSmall: number
  netInflowMain: number
  netInflowMainPct: number
}

export interface MoneyFlowMinute {
  code: string
  datetime: string
  close: number
  netInflowSuperLarge: number
  netInflowLarge: number
  netInflowMedium: number
  netInflowSmall: number
  netInflowMain: number
}

export interface MoneyFlowResult {
  data: MoneyFlowData[]
  source: string
  timestamp: Date
}

export interface MoneyFlowMinuteResult {
  data: MoneyFlowMinute[]
  source: string
  timestamp: Date
}

export interface SourceAdapter {
  readonly name: string
  readonly priority: number
  fetchDailyMoneyFlow(code: string, days?: number): Promise<MoneyFlowData[]>
  fetchMinuteMoneyFlow?(code: string, date?: string): Promise<MoneyFlowMinute[]>
  isAvailable(): Promise<boolean>
}

export interface SourceManagerConfig {
  enableFallback?: boolean
  healthCheckInterval?: number
  fallbackDelay?: number
}
