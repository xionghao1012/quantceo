import { describe, it, expect } from 'vitest'

// --- Pure functions extracted from recTracking.ts ---

function calcPnL(entryPrice: number, exitPrice: number): { pnl: number; pnlPercent: number } {
  const pnl = entryPrice > 0 ? exitPrice - entryPrice : 0
  const pnlPercent = entryPrice > 0 ? (pnl / entryPrice) * 100 : 0
  return { pnl: Math.round(pnl * 100) / 100, pnlPercent: Math.round(pnlPercent * 100) / 100 }
}

function calcBacktestStats(trades: Array<{
  entryDate: string
  exitDate: string
  entryPrice: number
  exitPrice: number
  code: string
  name: string
}>): {
  totalReturn: number; annualReturn: number; sharpe: number
  maxDrawdown: number; winRate: number; tradeCount: number
  wins: number; losses: number; avgReturn: number; avgHoldDays: number
} {
  if (trades.length === 0) {
    return { totalReturn: 0, annualReturn: 0, sharpe: 0, maxDrawdown: 0, winRate: 0, tradeCount: 0, wins: 0, losses: 0, avgReturn: 0, avgHoldDays: 0 }
  }

  let wins = 0, losses = 0
  let totalHoldDays = 0
  const tradesWithReturn = trades.map(t => {
    const ep = t.entryPrice || 0
    const xp = t.exitPrice || 0
    const pnl = xp - ep
    const returnPct = ep > 0 ? (pnl / ep) * 100 : 0
    if (returnPct > 0) wins++
    else if (returnPct < 0) losses++
    const ed = new Date(String(t.entryDate))
    const xd = new Date(String(t.exitDate))
    totalHoldDays += Math.max(0, Math.round((xd.getTime() - ed.getTime()) / 86400000))
    return { ...t, returnPct }
  })

  const capital = 100000
  const initialCash = capital
  let cash = initialCash
  const equity: { date: string; value: number }[] = []
  const dateSet = new Set<string>()
  for (const t of trades) {
    dateSet.add(String(t.entryDate))
    dateSet.add(String(t.exitDate))
  }
  const sortedDates = Array.from(dateSet).sort()
  for (const date of sortedDates) {
    const dayEntries = trades.filter(t => String(t.entryDate) === date)
    const dayExits = trades.filter(t => String(t.exitDate) === date)
    for (const t of dayEntries) cash -= t.entryPrice * 100
    for (const t of dayExits) cash += t.exitPrice * 100
    const holdingsValue = trades
      .filter(t => String(t.entryDate) <= date && String(t.exitDate) > date)
      .reduce((s, t) => s + t.exitPrice * 100, 0)
    equity.push({ date, value: cash + holdingsValue })
  }

  const totalReturn = equity.length > 0
    ? (equity[equity.length - 1].value - initialCash) / initialCash * 100
    : 0
  let sum = 0, sumSq = 0
  for (let i = 1; i < equity.length; i++) {
    const r = (equity[i].value - equity[i - 1].value) / equity[i - 1].value
    if (r !== 0) { sum += r; sumSq += r * r }
  }
  const n = equity.length - 1
  const avgReturn = n > 0 ? sum / n : 0
  const variance = n > 0 ? sumSq / n - avgReturn * avgReturn : 0
  const stdDev = Math.sqrt(Math.max(0, variance))
  const sharpe = stdDev > 0 ? avgReturn / stdDev * Math.sqrt(252) : 0
  let peak = initialCash
  let maxDrawdown = 0
  for (const e of equity) {
    if (e.value > peak) peak = e.value
    const dd = (peak - e.value) / peak * 100
    if (dd > maxDrawdown) maxDrawdown = dd
  }
  const annualReturn = n > 0 ? totalReturn * (252 / n) : 0
  const totalTrades = tradesWithReturn.length
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0
  const avgReturnPct = totalTrades > 0 ? tradesWithReturn.reduce((s, t) => s + t.returnPct, 0) / totalTrades : 0
  const avgHoldDays = totalTrades > 0 ? totalHoldDays / totalTrades : 0

  return {
    totalReturn: Math.round(totalReturn * 100) / 100,
    annualReturn: Math.round(annualReturn * 100) / 100,
    sharpe: Math.round(sharpe * 10000) / 10000,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    winRate: Math.round(winRate * 100) / 100,
    tradeCount: totalTrades,
    wins,
    losses,
    avgReturn: Math.round(avgReturnPct * 100) / 100,
    avgHoldDays: Math.round(avgHoldDays * 10) / 10,
  }
}

function clampPage(page: number, limit: number): { page: number; limit: number; offset: number } {
  return {
    page: Math.max(1, page),
    limit: Math.min(100, Math.max(1, limit)),
    offset: (Math.max(1, page) - 1) * Math.min(100, Math.max(1, limit)),
  }
}

function formatRecTrackingRow(r: {
  id: number; dailyPickId: number | null; code: string; name: string
  pickDate: string; entryDate: string | null; entryPrice: string | number
  exitDate: string | null; exitPrice: string | number
  status: string; pnl: string | number; pnlPercent: string | number
  notes: string | null; createdAt: Date
}) {
  return {
    id: r.id,
    dailyPickId: r.dailyPickId,
    code: r.code,
    name: r.name,
    pickDate: r.pickDate,
    entryDate: r.entryDate,
    entryPrice: Number(r.entryPrice),
    exitDate: r.exitDate,
    exitPrice: Number(r.exitPrice),
    status: r.status,
    pnl: Number(r.pnl),
    pnlPercent: Number(r.pnlPercent),
    notes: r.notes,
    createdAt: r.createdAt,
  }
}

// --- Tests ---

describe('calcPnL (pure, extracted from exit route)', () => {
  it('calculates profit correctly', () => {
    const result = calcPnL(10, 12)
    expect(result.pnl).toBe(2)
    expect(result.pnlPercent).toBe(20)
  })

  it('calculates loss correctly', () => {
    const result = calcPnL(10, 8)
    expect(result.pnl).toBe(-2)
    expect(result.pnlPercent).toBe(-20)
  })

  it('returns zero when entryPrice is 0', () => {
    const result = calcPnL(0, 12)
    expect(result.pnl).toBe(0)
    expect(result.pnlPercent).toBe(0)
  })

  it('handles fractional prices', () => {
    const result = calcPnL(10.5, 12.6)
    expect(result.pnl).toBe(2.1)
    expect(result.pnlPercent).toBeCloseTo(20, 1)
  })

  it('rounds to 2 decimal places', () => {
    const result = calcPnL(10, 12.333)
    expect(result.pnl).toBe(2.33)
  })
})

describe('calcBacktestStats (pure, extracted from backtest route)', () => {
  it('returns zeros for empty trades', () => {
    const result = calcBacktestStats([])
    expect(result.totalReturn).toBe(0)
    expect(result.sharpe).toBe(0)
    expect(result.tradeCount).toBe(0)
    expect(result.winRate).toBe(0)
  })

  it('calculates positive return for profitable trades', () => {
    const trades = [
      { entryDate: '2024-01-01', exitDate: '2024-01-10', entryPrice: 100, exitPrice: 110, code: '000001', name: '股票A' },
      { entryDate: '2024-01-11', exitDate: '2024-01-20', entryPrice: 100, exitPrice: 115, code: '000002', name: '股票B' },
    ]
    const result = calcBacktestStats(trades)
    expect(result.totalReturn).toBeGreaterThan(0)
    expect(result.tradeCount).toBe(2)
    expect(result.wins).toBe(2)
    expect(result.losses).toBe(0)
    expect(result.winRate).toBe(100)
  })

  it('calculates negative return for losing trades', () => {
    const trades = [
      { entryDate: '2024-01-01', exitDate: '2024-01-10', entryPrice: 100, exitPrice: 90, code: '000001', name: '股票A' },
      { entryDate: '2024-01-11', exitDate: '2024-01-20', entryPrice: 100, exitPrice: 85, code: '000002', name: '股票B' },
    ]
    const result = calcBacktestStats(trades)
    expect(result.totalReturn).toBeLessThan(0)
    expect(result.wins).toBe(0)
    expect(result.losses).toBe(2)
    expect(result.winRate).toBe(0)
  })

  it('calculates hold days correctly', () => {
    const trades = [
      { entryDate: '2024-01-01', exitDate: '2024-01-11', entryPrice: 100, exitPrice: 110, code: '000001', name: '股票A' },
    ]
    const result = calcBacktestStats(trades)
    expect(result.avgHoldDays).toBe(10)
  })

  it('mix of wins and losses', () => {
    const trades = [
      { entryDate: '2024-01-01', exitDate: '2024-01-10', entryPrice: 100, exitPrice: 110, code: '000001', name: '赢' },
      { entryDate: '2024-01-11', exitDate: '2024-01-20', entryPrice: 100, exitPrice: 90, code: '000002', name: '输' },
    ]
    const result = calcBacktestStats(trades)
    expect(result.winRate).toBe(50)
    expect(result.wins).toBe(1)
    expect(result.losses).toBe(1)
  })

  it('calculates maxDrawdown', () => {
    const trades = [
      { entryDate: '2024-01-01', exitDate: '2024-01-05', entryPrice: 100, exitPrice: 80, code: '000001', name: '大跌' },
      { entryDate: '2024-01-06', exitDate: '2024-01-10', entryPrice: 100, exitPrice: 120, code: '000002', name: '大涨' },
    ]
    const result = calcBacktestStats(trades)
    expect(result.maxDrawdown).toBeGreaterThan(0)
  })

  it('handles trades on same day', () => {
    const trades = [
      { entryDate: '2024-01-01', exitDate: '2024-01-01', entryPrice: 100, exitPrice: 105, code: '000001', name: '日内' },
    ]
    const result = calcBacktestStats(trades)
    expect(result.tradeCount).toBe(1)
    expect(result.avgHoldDays).toBe(0)
  })

  it('avgReturn is mean of individual returns', () => {
    const trades = [
      { entryDate: '2024-01-01', exitDate: '2024-01-10', entryPrice: 100, exitPrice: 110, code: '000001', name: 'A' },
      { entryDate: '2024-01-11', exitDate: '2024-01-20', entryPrice: 100, exitPrice: 120, code: '000002', name: 'B' },
    ]
    const result = calcBacktestStats(trades)
    // (10 + 20) / 2 = 15
    expect(result.avgReturn).toBeCloseTo(15, 1)
  })
})

describe('clampPage (pure utility)', () => {
  it('clamps page to minimum 1', () => {
    const { page, offset } = clampPage(0, 50)
    expect(page).toBe(1)
    expect(offset).toBe(0)
  })

  it('clamps limit to maximum 100', () => {
    const { limit } = clampPage(1, 200)
    expect(limit).toBe(100)
  })

  it('clamps limit to minimum 1', () => {
    const { limit } = clampPage(1, 0)
    expect(limit).toBe(1)
  })

  it('calculates correct offset', () => {
    const { offset } = clampPage(3, 20)
    expect(offset).toBe(40)
  })

  it('handles negative values', () => {
    const { page, limit, offset } = clampPage(-5, -10)
    expect(page).toBe(1)
    expect(limit).toBe(1)
    expect(offset).toBe(0)
  })
})

describe('formatRecTrackingRow (pure, extracted from list route)', () => {
  it('converts entryPrice and exitPrice to numbers', () => {
    const input = {
      id: 1, dailyPickId: 10, code: '000001', name: '测试',
      pickDate: '2024-01-01', entryDate: '2024-01-02', entryPrice: '10.5',
      exitDate: '2024-01-10', exitPrice: '12.3',
      status: 'closed', pnl: '170', pnlPercent: '16.19',
      notes: 'good trade', createdAt: new Date(),
    }
    const result = formatRecTrackingRow(input)
    expect(result.entryPrice).toBe(10.5)
    expect(result.exitPrice).toBe(12.3)
    expect(result.pnl).toBe(170)
  })

  it('handles null entry/exit dates', () => {
    const input = {
      id: 1, dailyPickId: null, code: '000001', name: '测试',
      pickDate: '2024-01-01', entryDate: null, entryPrice: '0',
      exitDate: null, exitPrice: '0',
      status: 'pending', pnl: '0', pnlPercent: '0',
      notes: null, createdAt: new Date(),
    }
    const result = formatRecTrackingRow(input)
    expect(result.entryDate).toBeNull()
    expect(result.exitDate).toBeNull()
    expect(result.pnl).toBe(0)
  })
})
