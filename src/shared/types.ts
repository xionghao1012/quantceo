export interface Stock {
  code: string
  name: string
  exchange: 'SH' | 'SZ'
  status: 'active' | 'suspended' | 'delisted'
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

export type MinutePeriod = 'm1' | 'm5' | 'm15' | 'm30' | 'm60'

export interface MinuteKLine {
  code: string
  datetime: string
  period: MinutePeriod
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number
}

export interface Indicator {
  name: string
  value: number
  threshold?: number
}

export interface Signal {
  code: string
  date: string
  direction: 'BUY' | 'SELL' | 'HOLD'
  strength: number
  indicators: Indicator[]
  reason: string
}

export interface Strategy {
  id: string
  name: string
  config: StrategyConfig
}

export interface StrategyConfig {
  indicators: { name: string; params: Record<string, number> }[]
  rules: Rule[]
}

export interface Rule {
  type: 'cross' | 'threshold' | 'combination'
  conditions: Condition[]
  action: 'BUY' | 'SELL'
}

export interface Condition {
  indicator: string
  operator: '>' | '<' | '==' | 'cross_above' | 'cross_below'
  value: number | string
}

export interface BacktestRequest {
  code: string
  strategyId: string
  startDate: string
  endDate: string
  initialCapital: number
}

export interface BacktestResult {
  totalReturn: number
  annualReturn: number
  sharpe: number
  maxDrawdown: number
  winRate: number
  tradeCount: number
  trades: Trade[]
  equity: { date: string; value: number }[]
}

export interface Trade {
  entryDate: string
  exitDate: string
  direction: 'BUY' | 'SELL'
  entryPrice: number
  exitPrice: number
  shares: number
  pnl: number
  returnPct: number
}

export type UserRole = 'free' | 'pro' | 'premium' | 'admin'

export interface User {
  id: number
  ssoUserId?: number
  email: string
  name: string
  avatar: string
  role: UserRole
  settings: Record<string, any>
  usage: Record<string, any>
  createdAt: string
  updatedAt: string
}

export interface AuthRegisterRequest {
  email: string
  password: string
  name?: string
}

export interface AuthLoginRequest {
  email: string
  password: string
}

export interface AuthResponse {
  token: string
  refreshToken: string
  user: User
}

export interface WatchlistItem {
  id: number
  userId: number
  groupId: number | null
  code: string
  note: string
  addedAt: string
}

export interface WatchlistGroup {
  id: number
  userId: number
  name: string
  color: string
  sortOrder: number
  createdAt: string
}

export interface Position {
  id: number
  userId: number
  code: string
  name: string
  quantity: number
  entryPrice: number
  stopLoss: number | null
  takeProfit: number | null
  status: 'open' | 'closed'
  notes: string
  createdAt: string
  updatedAt: string
}

export interface JwtPayload {
  userId: number
  email: string
  role: UserRole
  iat: number
  exp: number
}

export interface Session {
  id: number
  userId: number
  refreshToken: string
  expiresAt: string
  createdAt: string
}

export interface UserProfile {
  id: number
  email: string
  name: string
  avatar: string
  role: UserRole
  settings: Record<string, any>
  usage: Record<string, any>
  createdAt: string
  subscription?: { plan: string; endDate: string; status: string }
}

export type OptimizationStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface OptimizeParamRange {
  name: string
  min: number
  max: number
  step: number
  default?: number
}

export interface OptimizeRequest {
  strategyType: 'rsi' | 'macd' | 'ma_cross' | 'bollinger' | 'custom'
  symbol: string
  startDate: string
  endDate: string
  paramRanges: OptimizeParamRange[]
  populationSize?: number
  generations?: number
  initialCapital?: number
}

export interface OptimizeResult {
  id: string
  status: OptimizationStatus
  progress: number
  generation: number
  totalGenerations: number
  bestParams: Record<string, number>
  bestFitness: number
  metrics: {
    sharpe: number
    maxDrawdown: number
    winRate: number
    totalReturn: number
    tradeCount: number
  }
  history: { generation: number; fitness: number; params: Record<string, number> }[]
  error?: string
}

export interface OptimizationProgress {
  generation: number
  bestFitness: number
  bestParams: Record<string, number>
  metrics: {
    sharpe: number
    maxDrawdown: number
    winRate: number
    totalReturn: number
    tradeCount: number
  }
}
