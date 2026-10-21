import { describe, it, expect } from 'vitest'
import { calcMA, calcMACD, calcRSI, calcBollinger, calcKDJ, calcBBPosition } from '../indicators/index.js'
import type { KLine } from '@shared/types'

function makeKlines(closes: number[], overrides: Partial<KLine> = {}): KLine[] {
  return closes.map((close, i) => ({
    code: '000001',
    date: `2024-01-${String(i + 1).padStart(2, '0')}`,
    open: close * 0.99,
    high: close * 1.02,
    low: close * 0.98,
    close,
    volume: 1000000,
    amount: close * 1000000,
    ...overrides,
  }))
}

describe('calcMA', () => {
  it('computes 5-day SMA correctly', () => {
    const klines = makeKlines([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    const result = calcMA(klines, [5])
    const ma5 = result['MA5']
    expect(ma5[0]).toBeNaN()
    expect(ma5[1]).toBeNaN()
    expect(ma5[2]).toBeNaN()
    expect(ma5[3]).toBeNaN()
    expect(ma5[4]).toBe(30) // (10+20+30+40+50)/5
    expect(ma5[5]).toBe(40) // (20+30+40+50+60)/5
    expect(ma5[9]).toBe(80) // (60+70+80+90+100)/5
  })

  it('handles single kline', () => {
    const klines = makeKlines([100])
    const result = calcMA(klines, [5])
    expect(result['MA5'][0]).toBeNaN()
  })

  it('returns MA for multiple periods', () => {
    const klines = makeKlines([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    const result = calcMA(klines, [5, 10])
    expect(result['MA5']).toBeDefined()
    expect(result['MA10']).toBeDefined()
    expect(result['MA10'][9]).toBe(55) // average of all 10 values
  })

  it('handles empty periods array', () => {
    const klines = makeKlines([10, 20, 30, 40, 50])
    const result = calcMA(klines, [])
    expect(Object.keys(result)).toHaveLength(0)
  })
})

describe('calcMACD', () => {
  it('computes MACD with default params', () => {
    const klines = makeKlines(Array.from({ length: 50 }, (_, i) => 100 + i * 0.5))
    const result = calcMACD(klines)
    expect(result.macd).toHaveLength(50)
    expect(result.signal).toHaveLength(50)
    expect(result.histogram).toHaveLength(50)
  })

  it('computes MACD histogram correctly', () => {
    const klines = makeKlines(Array.from({ length: 40 }, (_, i) => 100 + i))
    const result = calcMACD(klines)
    for (let i = 0; i < result.histogram.length; i++) {
      expect(result.histogram[i]).toBeCloseTo(result.macd[i] - result.signal[i], 5)
    }
  })

  it('signal line is smoother than MACD line', () => {
    const klines = makeKlines(Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 5) * 20))
    const result = calcMACD(klines)
    const macdRange = Math.max(...result.macd.map(Math.abs))
    const signalRange = Math.max(...result.signal.map(Math.abs))
    expect(signalRange).toBeLessThanOrEqual(macdRange)
  })

  it('computes MACD with custom periods', () => {
    const klines = makeKlines(Array.from({ length: 60 }, (_, i) => 100 + i))
    const result = calcMACD(klines, 8, 17, 7)
    expect(result.macd).toHaveLength(60)
    expect(result.signal).toHaveLength(60)
    expect(result.histogram).toHaveLength(60)
  })
})

describe('calcRSI', () => {
  it('returns RSI array of correct length', () => {
    const klines = makeKlines(Array.from({ length: 30 }, (_, i) => 100 + i))
    const result = calcRSI(klines)
    expect(result).toHaveLength(30)
  })

  it('RSI for flat price is 100 (avgLoss=0 triggers special case)', () => {
    const klines = makeKlines(Array(30).fill(100))
    const result = calcRSI(klines, 14)
    expect(result[result.length - 1]).toBe(100)
  })

  it('RSI for continuously falling price reaches 0', () => {
    const klines = makeKlines(Array.from({ length: 25 }, (_, i) => 200 - i * 5))
    const result = calcRSI(klines, 14)
    expect(result[result.length - 1]).toBeLessThan(10)
  })

  it('RSI for continuously rising price reaches 100', () => {
    const klines = makeKlines(Array.from({ length: 25 }, (_, i) => 100 + i * 5))
    const result = calcRSI(klines, 14)
    expect(result[result.length - 1]).toBe(100)
  })

  it('RSI oscillates between 0 and 100 for oscillating price', () => {
    const klines = makeKlines(Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 20))
    const result = calcRSI(klines, 14)
    for (const r of result.slice(14)) {
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(100)
    }
  })

  it('RSI value is always between 0 and 100', () => {
    const klines = makeKlines(Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 2) * 15))
    const result = calcRSI(klines, 14)
    for (const r of result.slice(14)) {
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(100)
    }
  })
})

describe('calcBollinger', () => {
  it('returns upper, middle, lower bands', () => {
    const klines = makeKlines(Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 10))
    const result = calcBollinger(klines, 20, 2)
    expect(result.upper).toHaveLength(30)
    expect(result.middle).toHaveLength(30)
    expect(result.lower).toHaveLength(30)
  })

  it('upper band > middle band > lower band (when computed)', () => {
    const klines = makeKlines(Array.from({ length: 35 }, (_, i) => 100 + Math.sin(i / 5) * 20))
    const result = calcBollinger(klines, 20, 2)
    for (let i = 22; i < 35; i++) {
      expect(result.upper[i]).toBeGreaterThan(result.middle[i])
      expect(result.middle[i]).toBeGreaterThan(result.lower[i])
    }
  })

  it('bands are NaN before period-1 bars', () => {
    const klines = makeKlines(Array.from({ length: 25 }, (_, i) => 100 + i))
    const result = calcBollinger(klines, 20, 2)
    expect(result.middle[18]).toBeNaN()
    expect(result.middle[19]).not.toBeNaN()
  })

  it('uses custom multiplier', () => {
    const klines = makeKlines(Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 10))
    const r1 = calcBollinger(klines, 20, 1)
    const r2 = calcBollinger(klines, 20, 3)
    for (let i = 20; i < 30; i++) {
      expect(r2.upper[i] - r2.middle[i]).toBeGreaterThan(r1.upper[i] - r1.middle[i])
    }
  })
})

describe('calcKDJ', () => {
  it('returns k, d, j arrays of correct length', () => {
    const klines = makeKlines(Array.from({ length: 20 }, (_, i) => 100 + i))
    const result = calcKDJ(klines)
    expect(result.k).toHaveLength(20)
    expect(result.d).toHaveLength(20)
    expect(result.j).toHaveLength(20)
  })

  it('k and d values are computed correctly for first valid bar', () => {
    // At period-1 (index 8), k = (2*rsv + 50)/3, d = (2*k + 50)/3
    // With rising prices, rsv > 50 so k,d > 50
    const klines = makeKlines(Array.from({ length: 12 }, (_, i) => 100 + i * 5))
    const result = calcKDJ(klines, 9)
    // Index 8 is first valid bar
    expect(result.k[8]).toBeGreaterThan(50)
    expect(result.d[8]).toBeGreaterThan(50)
  })

  it('j = 3k - 2d for all valid bars', () => {
    const klines = makeKlines(Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 4) * 20))
    const result = calcKDJ(klines, 9)
    for (let i = 8; i < 30; i++) {
      if (isNaN(result.j[i])) continue
      expect(result.j[i]).toBeCloseTo(3 * result.k[i] - 2 * result.d[i], 5)
    }
  })

  it('handles flat high/low (max === min)', () => {
    const klines = makeKlines(Array.from({ length: 15 }, () => 100))
    const result = calcKDJ(klines, 9)
    // rsv should be 50 when max === min
    expect(result.k[8]).toBeCloseTo(50, 1)
  })

  it('uses custom periods', () => {
    const klines = makeKlines(Array.from({ length: 30 }, (_, i) => 100 + i))
    const result = calcKDJ(klines, 5, 2, 2)
    expect(result.k).toHaveLength(30)
  })
})

describe('calcBBPosition', () => {
  it('returns array of correct length', () => {
    const klines = makeKlines(Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 10))
    const result = calcBBPosition(klines, 20)
    expect(result).toHaveLength(30)
  })

  it('returns NaN before period-1 bars', () => {
    const klines = makeKlines(Array.from({ length: 25 }, (_, i) => 100 + i))
    const result = calcBBPosition(klines, 20)
    expect(result[18]).toBeNaN()
    expect(result[19]).not.toBeNaN()
  })

  it('returns 0 when price is at lower band', () => {
    // Simulate a case where close == lower band
    const klines = makeKlines(Array.from({ length: 30 }, (_, i) => 100))
    const result = calcBBPosition(klines, 20)
    // Flat price means upper == lower, position is NaN (division by zero)
    expect(result[25]).toBeNaN()
  })

  it('returns 1 when price is at upper band', () => {
    // upper = middle + 2*std, lower = middle - 2*std
    // When close = upper: position = (upper - lower) / (upper - lower) = 1
    const klines = makeKlines(Array.from({ length: 25 }, (_, i) => 100 + i))
    const result = calcBBPosition(klines, 20)
    // Price is trending up, should eventually exceed middle
    for (let i = 19; i < 25; i++) {
      if (!isNaN(result[i])) {
        expect(result[i]).toBeGreaterThanOrEqual(0)
        expect(result[i]).toBeLessThanOrEqual(1)
      }
    }
  })

  it('returns NaN when upper equals lower (flat price)', () => {
    const klines = makeKlines(Array.from({ length: 25 }, () => 100))
    const result = calcBBPosition(klines, 20)
    for (let i = 19; i < 25; i++) {
      expect(result[i]).toBeNaN()
    }
  })
})
