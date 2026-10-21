/**
 * resonance.ts -- runResonanceBacktest and PRESET_TEMPLATES supplementary coverage
 * Targets: BUY branch, SELL branch, forced close (inPosition), filtered < 60,
 *          PRESET_TEMPLATES structure
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runResonanceBacktest, PRESET_TEMPLATES } from '../routes/resonance.js'
import type { KLine } from '../../shared/types.js'
import type { ResonanceBacktestInput } from '../routes/resonance.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKlines(count: number, startDate: string = '2024-01-01'): KLine[] {
  const klines: KLine[] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(startDate)
    d.setDate(d.getDate() + i)
    klines.push({
      code: '600519',
      date: d.toISOString().slice(0, 10),
      open: 100 + i,
      high: 105 + i,
      low: 98 + i,
      close: 102 + i,
      volume: 1_000_000,
      amount: 102_000_000,
      turn: 5.0,
    } as any)
  }
  return klines
}

// ---------------------------------------------------------------------------
// Mock scanResonance
// Uses a Map keyed by klines.length to track which iteration is which,
// independent of the global scanCallCount counter.
// ---------------------------------------------------------------------------

// Map from klines length (segment size) to combinedScore
// The backtest loop passes segment = filtered.slice(0, i+1), so
// segment.length = i+1, and i = segment.length - 1
// The backtest loop runs from i=30 to i=filtered.length-1
// We pre-fill scores for all iterations the backtest might run.
const mockScoresByKlineLen = new Map<number, number>()

vi.mock('../scan/index.js', () => {
  return {
    scanResonance: vi.fn((input: { klines: KLine[]; config: any; fundScore: number }) => {
      const len = input.klines.length
      const score = mockScoresByKlineLen.get(len) ?? 0
      if (score === -999) return null
      return {
        code: '600519',
        combinedScore: score,
        techScore: score,
        fundScore: input.fundScore,
        signals: [],
        indicators: {},
      }
    }),
  }
})

// ---------------------------------------------------------------------------
// PRESET_TEMPLATES -- verify count and structure
// ---------------------------------------------------------------------------
describe('PRESET_TEMPLATES', () => {
  it('has exactly 3 templates', () => {
    expect(PRESET_TEMPLATES).toHaveLength(3)
  })

  it('each template has required fields', () => {
    for (const t of PRESET_TEMPLATES) {
      expect(t).toHaveProperty('id')
      expect(t).toHaveProperty('name')
      expect(t).toHaveProperty('description')
      expect(t).toHaveProperty('config')
      expect(t.config).toHaveProperty('fundWeight')
      expect(t.config).toHaveProperty('techWeight')
      expect(t.config).toHaveProperty('indicators')
    }
  })

  it('template ids are 1, 2, 3', () => {
    expect(PRESET_TEMPLATES.map(t => t.id)).toEqual([1, 2, 3])
  })
})

// ---------------------------------------------------------------------------
// runResonanceBacktest -- BUY branch (combinedScore > 0)
// ---------------------------------------------------------------------------
describe('runResonanceBacktest -- BUY branch', () => {
  beforeEach(() => {
    mockScoresByKlineLen.clear()
  })

  it('triggers BUY when combinedScore > 0 and not in position', () => {
    // Backtest loop: i from 30 to filtered.length-1 (65 klines -> i=30..64)
    // segment.length = i+1, so range is 31..65
    // First iteration (i=30, segment.length=31): score=10 triggers BUY
    for (let len = 31; len <= 65; len++) {
      mockScoresByKlineLen.set(len, 0) // default: no signal
    }
    mockScoresByKlineLen.set(31, 10) // i=30 -> BUY

    const klines = makeKlines(65)
    const input: ResonanceBacktestInput = {
      code: '600519',
      config: { fundWeight: 0.5, techWeight: 0.5, indicators: [] },
      fundSignals: [],
      startDate: '2024-01-01',
      endDate: '2024-03-31',
    }

    const result = runResonanceBacktest(input, klines)

    expect(result.trades.length).toBeGreaterThan(0)
    const buyTrades = result.trades.filter(t => t.action === 'BUY')
    expect(buyTrades.length).toBeGreaterThan(0)
    // First buy should be at segment.length=31 -> klines[30].close = 132
    expect(buyTrades[0].price).toBe(132)
  })
})

// ---------------------------------------------------------------------------
// runResonanceBacktest -- SELL branch (combinedScore < 0)
// ---------------------------------------------------------------------------
describe('runResonanceBacktest -- SELL branch', () => {
  beforeEach(() => {
    mockScoresByKlineLen.clear()
  })

  it('triggers SELL when combinedScore < 0 and in position', () => {
    // BUY at i=30 (segment.length=31), SELL at i=40 (segment.length=41)
    for (let len = 31; len <= 65; len++) {
      mockScoresByKlineLen.set(len, 0)
    }
    mockScoresByKlineLen.set(31, 10)  // i=30 -> BUY
    mockScoresByKlineLen.set(41, -5)  // i=40 -> SELL

    const klines = makeKlines(65)
    const input: ResonanceBacktestInput = {
      code: '600519',
      config: { fundWeight: 0.5, techWeight: 0.5, indicators: [] },
      fundSignals: [],
      startDate: '2024-01-01',
      endDate: '2024-03-31',
    }

    const result = runResonanceBacktest(input, klines)

    const sellTrades = result.trades.filter(t => t.action === 'SELL')
    expect(sellTrades.length).toBeGreaterThan(0)
    expect(sellTrades[0].pnl).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// runResonanceBacktest -- forced close (inPosition at end)
// ---------------------------------------------------------------------------
describe('runResonanceBacktest -- forced close at end of period', () => {
  beforeEach(() => {
    mockScoresByKlineLen.clear()
  })

  it('closes position at end when still in position', () => {
    // BUY at i=30, never SELLs -- forced close at end of loop
    for (let len = 31; len <= 65; len++) {
      mockScoresByKlineLen.set(len, 0)
    }
    mockScoresByKlineLen.set(31, 8) // BUY only

    const klines = makeKlines(65)
    const input: ResonanceBacktestInput = {
      code: '600519',
      config: { fundWeight: 0.5, techWeight: 0.5, indicators: [] },
      fundSignals: [],
      startDate: '2024-01-01',
      endDate: '2024-03-31',
    }

    const result = runResonanceBacktest(input, klines)

    const sellTrades = result.trades.filter(t => t.action === 'SELL')
    // Forced close at end of loop (lines 60-63) generates a SELL
    expect(sellTrades.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// runResonanceBacktest -- filtered.length < 60 (no iteration)
// ---------------------------------------------------------------------------
describe('runResonanceBacktest -- filtered.length < 60', () => {
  beforeEach(() => {
    mockScoresByKlineLen.clear()
  })

  it('returns zero trades when not enough klines', () => {
    // 30 klines: loop starts at i=30, but filtered.length=30 -> loop never runs
    const klines = makeKlines(30)
    const input: ResonanceBacktestInput = {
      code: '600519',
      config: { fundWeight: 0.5, techWeight: 0.5, indicators: [] },
      fundSignals: [],
      startDate: '2024-01-01',
      endDate: '2024-01-30',
    }

    const result = runResonanceBacktest(input, klines)

    expect(result.tradeCount).toBe(0)
    expect(result.finalCapital).toBe(100000) // no capital used
  })
})

// ---------------------------------------------------------------------------
// runResonanceBacktest -- multiple buy/sell cycles
// ---------------------------------------------------------------------------
describe('runResonanceBacktest -- multiple buy/sell cycles', () => {
  beforeEach(() => {
    mockScoresByKlineLen.clear()
  })

  it('handles alternating buy/sell signals', () => {
    // BUY at i=31 (segment.length=32), SELL at i=35 (len=36)
    // BUY at i=40 (len=41), SELL at i=45 (len=46)
    for (let len = 31; len <= 65; len++) {
      mockScoresByKlineLen.set(len, 0)
    }
    mockScoresByKlineLen.set(32, 10)  // i=31 -> BUY
    mockScoresByKlineLen.set(36, -8)  // i=35 -> SELL
    mockScoresByKlineLen.set(41, 12)  // i=40 -> BUY
    mockScoresByKlineLen.set(46, -6)  // i=45 -> SELL

    const klines = makeKlines(65)
    const input: ResonanceBacktestInput = {
      code: '600519',
      config: { fundWeight: 0.5, techWeight: 0.5, indicators: [] },
      fundSignals: [],
      startDate: '2024-01-01',
      endDate: '2024-03-31',
    }

    const result = runResonanceBacktest(input, klines)

    const buyTrades = result.trades.filter(t => t.action === 'BUY')
    const sellTrades = result.trades.filter(t => t.action === 'SELL')
    expect(buyTrades.length).toBe(2)
    expect(sellTrades.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// runResonanceBacktest -- winRate = 0 (no sell trades at all)
// ---------------------------------------------------------------------------
describe('runResonanceBacktest -- winRate = 0 when no sell trades', () => {
  beforeEach(() => {
    mockScoresByKlineLen.clear()
  })

  it('returns winRate 0 when forced-close SELL is unprofitable', () => {
    // All scores are 0 except one BUY, no SELL signal — forced close at end
    // Forced close at end: price went down from buy price → pnl < 0 → winRate = 0
    for (let len = 31; len <= 65; len++) {
      mockScoresByKlineLen.set(len, 0)
    }
    // BUY only at len=31 (i=30). Price at i=30 = 132, final price < 132 → loss
    mockScoresByKlineLen.set(31, 10)

    const klines = makeKlines(65)
    // Override last kline close to be LOWER than buy price for loss
    klines[klines.length - 1].close = 100 // forced close at much lower price
    const input: ResonanceBacktestInput = {
      code: '600519',
      config: { fundWeight: 0.5, techWeight: 0.5, indicators: [] },
      fundSignals: [],
      startDate: '2024-01-01',
      endDate: '2024-03-31',
    }

    const result = runResonanceBacktest(input, klines)

    // Only the forced close at end generates a SELL
    const sellTrades = result.trades.filter(t => t.action === 'SELL')
    expect(sellTrades.length).toBe(1)
    // winRate = 0 because forced-close SELL has pnl < 0 (sold at loss)
    expect(result.winRate).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// runResonanceBacktest -- BUY then SELL → winRate = 100
// ---------------------------------------------------------------------------
describe('runResonanceBacktest -- winRate = 100 when all sells are profitable', () => {
  beforeEach(() => {
    mockScoresByKlineLen.clear()
  })

  it('computes winRate correctly when all sells are winning', () => {
    // BUY at i=31 (len=32, price=132), SELL at i=35 (len=36, price=136)
    // price went up → profitable sell → winRate = 100
    for (let len = 31; len <= 65; len++) {
      mockScoresByKlineLen.set(len, 0)
    }
    mockScoresByKlineLen.set(32, 10)  // BUY
    mockScoresByKlineLen.set(36, -5)  // SELL at higher price (klines[35].close = 137)

    const klines = makeKlines(65)
    const input: ResonanceBacktestInput = {
      code: '600519',
      config: { fundWeight: 0.5, techWeight: 0.5, indicators: [] },
      fundSignals: [],
      startDate: '2024-01-01',
      endDate: '2024-03-31',
      initialCapital: 100000,
    }

    const result = runResonanceBacktest(input, klines)

    const sellTrades = result.trades.filter(t => t.action === 'SELL')
    expect(sellTrades.length).toBe(1)
    expect(result.winRate).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// PRESET_TEMPLATES -- verify exact template names and indicator counts
// ---------------------------------------------------------------------------
describe('PRESET_TEMPLATES -- template names and indicator structure', () => {
  it('has correct template names', () => {
    expect(PRESET_TEMPLATES[0].name).toBe('保守型共振')
    expect(PRESET_TEMPLATES[1].name).toBe('激进型共振')
    expect(PRESET_TEMPLATES[2].name).toBe('布林带共振')
  })

  it('each template has exactly 4 indicators', () => {
    for (const t of PRESET_TEMPLATES) {
      expect(t.config.indicators).toHaveLength(4)
    }
  })

  it('conservative template (id=1) has correct weights', () => {
    const t = PRESET_TEMPLATES[0]
    expect(t.config.fundWeight).toBe(0.6)
    expect(t.config.techWeight).toBe(0.4)
    expect(t.config.indicators[0].name).toBe('rsi')
    expect(t.config.indicators[0].enabled).toBe(true)
  })

  it('aggressive template (id=2) has correct weights', () => {
    const t = PRESET_TEMPLATES[1]
    expect(t.config.fundWeight).toBe(0.4)
    expect(t.config.techWeight).toBe(0.6)
    expect(t.config.indicators[1].name).toBe('kdj')
    expect(t.config.indicators[1].enabled).toBe(true)
  })

  it('bollinger template (id=3) has correct weights', () => {
    const t = PRESET_TEMPLATES[2]
    expect(t.config.fundWeight).toBe(0.5)
    expect(t.config.techWeight).toBe(0.5)
    expect(t.config.indicators[1].name).toBe('bollinger')
    expect(t.config.indicators[1].enabled).toBe(true)
  })
})
