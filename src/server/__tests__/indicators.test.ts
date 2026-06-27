import { describe, it, expect } from 'vitest'
import { calcMA, calcMACD, calcRSI, calcBollinger } from '../indicators/index.js'
import type { KLine } from '@shared/types'

function makeKlines(closes: number[]): KLine[] {
  return closes.map((close, i) => ({
    code: '000001',
    date: `2024-01-${String(i + 1).padStart(2, '0')}`,
    open: close * 0.99,
    high: close * 1.02,
    low: close * 0.98,
    close,
    volume: 1000000,
    amount: close * 1000000,
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
    // Signal (EMA of MACD) should have smaller amplitude
    const macdRange = Math.max(...result.macd.map(Math.abs))
    const signalRange = Math.max(...result.signal.map(Math.abs))
    expect(signalRange).toBeLessThanOrEqual(macdRange)
  })
})

describe('calcRSI', () => {
  it('returns RSI array of correct length', () => {
    const klines = makeKlines(Array.from({ length: 30 }, (_, i) => 100 + i))
    const result = calcRSI(klines)
    expect(result).toHaveLength(30)
  })

  it('RSI for flat price is 100 (avgLoss=0 triggers special case)', () => {
    // When price is flat, gains=losses=0, avgLoss=0 triggers return 100
    const klines = makeKlines(Array(30).fill(100))
    const result = calcRSI(klines, 14)
    expect(result[result.length - 1]).toBe(100)
  })

  it('RSI for continuously falling price reaches 0', () => {
    // Only losses → avgGain=0, avgLoss>0 → RSI → 0
    const klines = makeKlines(Array.from({ length: 25 }, (_, i) => 200 - i * 5))
    const result = calcRSI(klines, 14)
    expect(result[result.length - 1]).toBeLessThan(10)
  })

  it('RSI for continuously rising price reaches 100', () => {
    // Only gains → avgLoss=0 → RSI = 100
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
    // At i=18 (period-2), middle was computed from only 19 values, not 20
    expect(result.middle[18]).toBeNaN()
    // At i=19, we have exactly 20 values → valid
    expect(result.middle[19]).not.toBeNaN()
  })
})
