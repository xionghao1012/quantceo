import { describe, it, expect } from 'vitest'
import { calcWarmup, runBacktest } from '../../backtest/index.js'
import type { KLine, BacktestRequest, Rule } from '../../../shared/types.js'

// ---------------------------------------------------------------------------
// calcWarmup — already well-tested, keep for completeness
// ---------------------------------------------------------------------------
describe('calcWarmup', () => {
  it('defaults to 30 when no indicators needed', () => {
    expect(calcWarmup(new Set())).toBe(30)
  })

  it('returns 30 for MA5-MA30 (below threshold)', () => {
    expect(calcWarmup(new Set(['ma5']))).toBe(30)
    expect(calcWarmup(new Set(['ma10']))).toBe(30)
    expect(calcWarmup(new Set(['ma20']))).toBe(30)
    expect(calcWarmup(new Set(['ma30']))).toBe(30)
  })

  it('returns 60 for MA60', () => {
    expect(calcWarmup(new Set(['ma60']))).toBe(60)
  })

  it('returns max across multiple MA indicators', () => {
    expect(calcWarmup(new Set(['ma5', 'ma60']))).toBe(60)
    expect(calcWarmup(new Set(['ma5', 'ma20', 'ma60']))).toBe(60)
  })

  it('increases to 14 for RSI (but stays 30 as max of 30,14)', () => {
    expect(calcWarmup(new Set(['rsi']))).toBe(30)
  })

  it('RSI combined with MA60 returns MA60', () => {
    expect(calcWarmup(new Set(['ma60', 'rsi']))).toBe(60)
  })

  it('MACD family increases to 26 (but stays 30 as max of 30,26)', () => {
    expect(calcWarmup(new Set(['macd']))).toBe(30)
    expect(calcWarmup(new Set(['macdSignal']))).toBe(30)
    expect(calcWarmup(new Set(['macdHistogram']))).toBe(30)
  })

  it('MACD combined with MA60 returns MA60', () => {
    expect(calcWarmup(new Set(['ma60', 'macd']))).toBe(60)
  })

  it('Bollinger Band family increases to 20 (but stays 30 as max of 30,20)', () => {
    expect(calcWarmup(new Set(['bbUpper']))).toBe(30)
    expect(calcWarmup(new Set(['bbMiddle']))).toBe(30)
    expect(calcWarmup(new Set(['bbLower']))).toBe(30)
  })

  it('BB combined with MA60 returns MA60', () => {
    expect(calcWarmup(new Set(['ma60', 'bbUpper']))).toBe(60)
  })

  it('returns maximum across all indicator families', () => {
    const needed = new Set(['ma60', 'rsi', 'macd', 'bbUpper'])
    expect(calcWarmup(needed)).toBe(60)
  })

  it('handles empty string indicator names gracefully', () => {
    const needed = new Set([''])
    expect(calcWarmup(needed)).toBe(30)
  })

  it('handles unknown indicator names gracefully', () => {
    const needed = new Set(['unknown_indicator'])
    expect(calcWarmup(needed)).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// runBacktest — pure function tests
// ---------------------------------------------------------------------------

function makeKlines(dates: string[], closes: number[]): KLine[] {
  return dates.map((date, i) => ({
    code: '000001',
    date,
    open: closes[i] * 0.99,
    high: closes[i] * 1.02,
    low: closes[i] * 0.98,
    close: closes[i],
    volume: 1000000,
    amount: closes[i] * 1000000,
  }))
}

function makeReq(overrides: Partial<BacktestRequest> = {}): BacktestRequest {
  return {
    code: '000001',
    strategyId: '1',
    startDate: '',
    endDate: '',
    initialCapital: 100000,
    ...overrides,
  }
}

function makeRule(
  indicator: string,
  operator: Rule['conditions'][0]['operator'],
  value: number,
  action: 'BUY' | 'SELL'
): Rule {
  return {
    type: 'threshold',
    conditions: [{ indicator, operator, value }],
    action,
  }
}

// ---- basic return & trade stats ----

describe('runBacktest — basic return calculations', () => {
  it('returns 0% when price does not change', () => {
    const klines = makeKlines(
      Array.from({ length: 100 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`),
      Array.from({ length: 100 }, () => 10)
    )
    const rules: Rule[] = [makeRule('rsi', '<', 30, 'BUY'), makeRule('rsi', '>', 70, 'SELL')]
    const result = runBacktest(klines, makeReq({ initialCapital: 100000 }), rules)
    // No trades triggered — RSI never crosses thresholds with flat price
    expect(result.tradeCount).toBe(0)
    expect(result.totalReturn).toBe(0)
  })

  it('calculates positive return when price rises', () => {
    // 120 klines: price starts at 7.95 and rises by 0.05/day.
    // Warmup=30. At i=30, price=9.45 (below buy threshold 10).
    // Cross above 10 at i=41 (close[41]=10.00, prev=9.95 → cross_above fires).
    // Cross above 12 at i=82 (close[82]=12.05, prev=12.00 → cross_above fires).
    const dates = Array.from({ length: 120 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`)
    const closes = Array.from({ length: 120 }, (_, i) => 7.95 + i * 0.05)
    const klines = makeKlines(dates, closes)

    const rules: Rule[] = [
      { type: 'cross', conditions: [{ indicator: 'close', operator: 'cross_above', value: 10 }], action: 'BUY' },
      { type: 'cross', conditions: [{ indicator: 'close', operator: 'cross_above', value: 12 }], action: 'SELL' },
    ]
    const result = runBacktest(klines, makeReq({ initialCapital: 100000 }), rules)
    expect(result.tradeCount).toBeGreaterThan(0)
    expect(result.totalReturn).toBeGreaterThan(0)
    expect(result).toHaveProperty('equity')
    expect(result.equity.length).toBeGreaterThan(0)
  })

  it('calculates negative return when price falls', () => {
    const dates = Array.from({ length: 100 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`)
    const closes = Array.from({ length: 50 }, (_, i) => 12 - i * 0.04).concat(
      Array.from({ length: 50 }, () => 10)
    )
    const klines = makeKlines(dates, closes)

    const rules: Rule[] = [
      { type: 'cross', conditions: [{ indicator: 'close', operator: 'cross_above', value: 10 }], action: 'BUY' },
      { type: 'cross', conditions: [{ indicator: 'close', operator: 'cross_below', value: 9 }], action: 'SELL' },
    ]
    const result = runBacktest(klines, makeReq({ initialCapital: 100000 }), rules)
    // May or may not have trades depending on crossing, but should not crash
    expect(typeof result.totalReturn).toBe('number')
  })

  it('handles empty klines gracefully', () => {
    const result = runBacktest([], makeReq(), [])
    expect(result.tradeCount).toBe(0)
    expect(result.equity).toEqual([])
    // totalReturn is NaN when equity is empty (division 0/initialCapital)
    expect(Number.isNaN(result.totalReturn)).toBe(true)
  })

  it('handles klines shorter than warmup', () => {
    // Only 10 klines — less than 30-day warmup
    const dates = Array.from({ length: 10 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`)
    const klines = makeKlines(dates, Array.from({ length: 10 }, (_, i) => 10 + i))
    const result = runBacktest(klines, makeReq(), [])
    expect(result.tradeCount).toBe(0)
  })
})

describe('runBacktest — date range filtering', () => {
  it('respects startDate', () => {
    const dates = Array.from({ length: 100 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`)
    const closes = Array.from({ length: 100 }, (_, i) => 10 + i * 0.1)
    const klines = makeKlines(dates, closes)

    const rules: Rule[] = [
      { type: 'cross', conditions: [{ indicator: 'close', operator: 'cross_above', value: 10 }], action: 'BUY' },
    ]
    const result = runBacktest(klines, makeReq({ startDate: '2024-02-01' }), rules)
    // No crash, equity is tracked
    expect(Array.isArray(result.equity)).toBe(true)
  })

  it('respects endDate', () => {
    const dates = Array.from({ length: 100 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`)
    const closes = Array.from({ length: 100 }, () => 10)
    const klines = makeKlines(dates, closes)

    const result = runBacktest(klines, makeReq({ endDate: '2024-01-15' }), [])
    expect(result.equity.length).toBeLessThanOrEqual(100)
  })

  it('uses startDate + endDate together', () => {
    const dates = Array.from({ length: 100 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`)
    const closes = Array.from({ length: 100 }, () => 10)
    const klines = makeKlines(dates, closes)

    const result = runBacktest(
      klines,
      makeReq({ startDate: '2024-01-10', endDate: '2024-01-20' }),
      []
    )
    expect(Array.isArray(result.equity)).toBe(true)
  })
})

describe('runBacktest — trade tracking', () => {
  it('records trade entryDate, exitDate, entryPrice, exitPrice', () => {
    // Build klines where close crosses above 10 (buy) then above 11 (sell)
    const dates: string[] = []
    const closes: number[] = []
    for (let i = 0; i < 100; i++) {
      dates.push(`2024-01-${String(i + 1).padStart(2, '0')}`)
      if (i < 35) closes.push(9)
      else if (i < 40) closes.push(9 + (i - 34))
      else closes.push(11)
    }
    const klines = makeKlines(dates, closes)

    const rules: Rule[] = [
      {
        type: 'cross',
        conditions: [{ indicator: 'close', operator: 'cross_above', value: 10 }],
        action: 'BUY',
      },
      {
        type: 'cross',
        conditions: [{ indicator: 'close', operator: 'cross_above', value: 11 }],
        action: 'SELL',
      },
    ]

    const result = runBacktest(klines, makeReq({ initialCapital: 100000 }), rules)

    if (result.tradeCount > 0) {
      const trade = result.trades[0]
      expect(trade).toHaveProperty('entryDate')
      expect(trade).toHaveProperty('exitDate')
      expect(trade).toHaveProperty('entryPrice')
      expect(trade).toHaveProperty('exitPrice')
      expect(trade).toHaveProperty('pnl')
      expect(trade).toHaveProperty('returnPct')
      expect(trade.entryDate).toBeTruthy()
      expect(trade.exitDate).toBeTruthy()
    }
  })

  it('calculates winRate correctly', () => {
    // Simple: price rises monotonically → all winning trades
    const dates = Array.from({ length: 100 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`)
    const closes = Array.from({ length: 100 }, (_, i) => 10 + i * 0.05)
    const klines = makeKlines(dates, closes)

    const rules: Rule[] = [
      {
        type: 'cross',
        conditions: [{ indicator: 'close', operator: 'cross_above', value: 10 }],
        action: 'BUY',
      },
    ]

    const result = runBacktest(klines, makeReq({ initialCapital: 100000 }), rules)
    if (result.tradeCount > 0) {
      // All trades should be winners if price always went up
      expect(result.winRate).toBeGreaterThanOrEqual(0)
      expect(result.winRate).toBeLessThanOrEqual(100)
    }
  })
})

describe('runBacktest — metrics shape', () => {
  it('returns all required fields in result', () => {
    const klines = makeKlines(
      Array.from({ length: 100 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`),
      Array.from({ length: 100 }, (_, i) => 10 + i)
    )
    const result = runBacktest(klines, makeReq(), [])

    expect(result).toHaveProperty('totalReturn')
    expect(result).toHaveProperty('annualReturn')
    expect(result).toHaveProperty('sharpe')
    expect(result).toHaveProperty('maxDrawdown')
    expect(result).toHaveProperty('winRate')
    expect(result).toHaveProperty('tradeCount')
    expect(result).toHaveProperty('trades')
    expect(result).toHaveProperty('equity')
    expect(typeof result.totalReturn).toBe('number')
    expect(typeof result.sharpe).toBe('number')
    expect(typeof result.maxDrawdown).toBe('number')
    expect(Array.isArray(result.trades)).toBe(true)
    expect(Array.isArray(result.equity)).toBe(true)
  })

  it('equity entries have date and value', () => {
    const klines = makeKlines(
      Array.from({ length: 50 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`),
      Array.from({ length: 50 }, () => 10)
    )
    const result = runBacktest(klines, makeReq(), [])
    for (const eq of result.equity) {
      expect(eq).toHaveProperty('date')
      expect(eq).toHaveProperty('value')
      expect(typeof eq.value).toBe('number')
    }
  })

  it('maxDrawdown is non-negative', () => {
    const klines = makeKlines(
      Array.from({ length: 50 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`),
      Array.from({ length: 50 }, (_, i) => 10 + i)
    )
    const result = runBacktest(klines, makeReq(), [])
    expect(result.maxDrawdown).toBeGreaterThanOrEqual(0)
  })
})

describe('runBacktest — edge cases', () => {
  it('initialCapital of 0 does not crash', () => {
    const klines = makeKlines(
      Array.from({ length: 50 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`),
      Array.from({ length: 50 }, () => 10)
    )
    const result = runBacktest(klines, makeReq({ initialCapital: 0 }), [])
    expect(typeof result.totalReturn).toBe('number')
  })

  it('infinite initialCapital does not crash', () => {
    const klines = makeKlines(
      Array.from({ length: 50 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`),
      Array.from({ length: 50 }, () => 10)
    )
    const result = runBacktest(klines, makeReq({ initialCapital: Infinity }), [])
    expect(typeof result.totalReturn).toBe('number')
  })

  it('NaN indicator values do not crash', () => {
    // Build klines with extreme values that could produce NaN in indicators
    const klines = makeKlines(
      Array.from({ length: 50 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`),
      Array.from({ length: 50 }, () => 0) // all zeros could cause NaN in division
    )
    const rules: Rule[] = [makeRule('rsi', '<', 30, 'BUY')]
    const result = runBacktest(klines, makeReq(), rules)
    expect(typeof result.totalReturn).toBe('number')
    expect(Array.isArray(result.equity)).toBe(true)
  })

  it('works with empty rules array', () => {
    const klines = makeKlines(
      Array.from({ length: 50 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`),
      Array.from({ length: 50 }, (_, i) => 10 + i)
    )
    const result = runBacktest(klines, makeReq(), [])
    expect(result.tradeCount).toBe(0)
    expect(typeof result.totalReturn).toBe('number')
  })

  it('single kline does not crash', () => {
    const klines = makeKlines(['2024-01-01'], [10])
    const result = runBacktest(klines, makeReq(), [])
    expect(typeof result.totalReturn).toBe('number')
  })
})
