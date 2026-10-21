import {DrizzleTradeJournalRepository} from './DrizzleTradeJournalRepository.js';
export interface TradeJournalEntry {
  id: number
  userId: number
  code: string
  name: string | null
  direction: string
  entryDate: string
  exitDate: string | null
  entryPrice: string
  exitPrice: string | null
  shares: number
  pnl: string | null
  returnPct: string | null
  tags: string[] | null
  notes: string | null
  strategy: string | null
  rating: number
  createdAt: Date
  updatedAt: Date
}

export interface CreateTradeJournalInput {
  userId: number
  code: string
  name?: string
  direction: string
  entryDate: string
  exitDate?: string | null
  entryPrice: string
  exitPrice?: string | null
  shares: number
  pnl?: string | null
  returnPct?: string | null
  tags?: string[]
  notes?: string | null
  strategy?: string | null
  rating?: number
}

export interface UpdateTradeJournalInput {
  exitDate?: string | null
  exitPrice?: string | null
  tags?: string[]
  notes?: string | null
  strategy?: string | null
  rating?: number
  pnl?: string | null
  returnPct?: string | null
}

export interface TradeJournalStats {
  totalClosed: number
  totalOpen: number
  wins: number
  losses: number
  winRate: number
  totalPnl: number
  avgPnl: number
  avgReturn: number
  bestTrade: number
  worstTrade: number
  profitFactor: number
  expectancy: number
  monthlyTrend: Array<{ month: Date; count: number; pnl: number }>
}

export interface PnlCalendarEntry {
  period: Date | string
  count: number
  pnl: number
  avgReturn: number
}

export interface ITradeJournalRepository {
  create(input: CreateTradeJournalInput): Promise<TradeJournalEntry>
  findById(id: number, userId: number): Promise<TradeJournalEntry | null>
  findByUserId(userId: number, options?: {
    limit?: number
    offset?: number
    tag?: string
    strategy?: string
    direction?: string
    startDate?: string
    endDate?: string
    status?: 'open' | 'closed'
  }): Promise<{ rows: TradeJournalEntry[]; total: number }>
  update(id: number, userId: number, input: UpdateTradeJournalInput): Promise<TradeJournalEntry>
  delete(id: number, userId: number): Promise<void>
  getStats(userId: number): Promise<TradeJournalStats>
  getPnlCalendar(userId: number, year?: number, mode?: 'daily' | 'monthly'): Promise<{
    mode: string
    calendar: PnlCalendarEntry[]
  }>
}

// Module-level repository instance
let _repo: ITradeJournalRepository | null = null

export function setTradeJournalRepository(repo: ITradeJournalRepository): void {
  _repo = repo
}

export function getTradeJournalRepository(): ITradeJournalRepository {
  if (!_repo) {
    
    _repo = new DrizzleTradeJournalRepository()
  }
  return _repo!
}
