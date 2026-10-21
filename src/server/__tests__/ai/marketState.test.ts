import { describe, it, expect } from 'vitest'
import type { KLine } from '../../../shared/types.js'
import { computeIndicators, classifyState, getRecommendedStrategies } from '../../ai/marketState.js'
import type { MarketState } from '../../ai/marketState.js'

function makeKlines(n: number, startPrice = 100, trend = 0): KLine[] {
  const result: KLine[] = []
  let price = startPrice
  for (let i = 0; i < n; i++) {
    price += trend + Math.sin(i * 0.5)
    result.push({
      code: '000001',
      date: new Date(Date.now() - (n - i) * 86400000).toISOString().slice(0, 10),
      open: price - 0.5,
      close: price,
      high: price + 1,
      low: price - 1,
      volume: 1000000,
    } as any)
  }
  return result
}

describe('computeIndicators', () => {
  it('returns null for insufficient data (< 60 bars)', () => {
    const klines = makeKlines(30)
    expect(computeIndicators(klines)).toBeNull()
  })

  it('returns object for sufficient data', () => {
    const klines = makeKlines(100, 100, 0.2)
    const result = computeIndicators(klines)
    expect(result).not.toBeNull()
    expect(result).toHaveProperty('rsi')
    expect(result).toHaveProperty('macdHistogram')
    expect(result).toHaveProperty('ma5')
    expect(result).toHaveProperty('ma20')
    expect(result).toHaveProperty('ma60')
  })

  it('rsi is between 0 and 100', () => {
    const klines = makeKlines(100)
    const result = computeIndicators(klines)
    expect(result!.rsi).toBeGreaterThanOrEqual(0)
    expect(result!.rsi).toBeLessThanOrEqual(100)
  })

  it('MA values are ordered ma5 < ma20 < ma60 in uptrend', () => {
    const klines = makeKlines(100, 100, 0.3)
    const result = computeIndicators(klines)
    expect(result!.ma5).toBeGreaterThan(result!.ma20)
    expect(result!.ma20).toBeGreaterThan(result!.ma60)
  })
})

describe('classifyState', () => {
  it('classifies trending_up when ma5 > ma20 > ma60 and rsi mid (35-65) and bullish', () => {
    const ind = { rsi: 55, macdSignal: 'bullish' as const, ma5: 110, ma20: 105, ma60: 100, trend: 'up' as const }
    const closes = [100, 102, 105, 107, 110]
    expect(classifyState(ind as any, closes)).toBe('trending_up')
  })

  it('classifies oversold when rsi < 35', () => {
    const ind = { rsi: 28, macdSignal: 'bearish' as const, ma5: 95, ma20: 100, ma60: 105, trend: 'down' as const }
    const closes = [105, 103, 100, 98, 95]
    expect(classifyState(ind as any, closes)).toBe('oversold')
  })

  it('classifies bearish when ma5 < ma20 < ma60 and rsi > 70 or bearish', () => {
    const ind = { rsi: 75, macdSignal: 'bearish' as const, ma5: 90, ma20: 95, ma60: 100, trend: 'down' as const }
    const closes = [100, 97, 94, 91, 88]
    expect(classifyState(ind as any, closes)).toBe('bearish')
  })

  it('classifies range_bound by default', () => {
    const ind = { rsi: 50, macdSignal: 'bullish' as const, ma5: 100, ma20: 100, ma60: 100, trend: 'neutral' as const }
    const closes = [100, 101, 99, 100, 101, 99, 100]
    expect(classifyState(ind as any, closes)).toBe('range_bound')
  })

  it('classifies breakout when rsi > 65 and price > ma5 and bullish', () => {
    const ind = { rsi: 70, macdSignal: 'bullish' as const, ma5: 100, ma20: 98, ma60: 95, trend: 'up' as const }
    const closes = [100, 101, 102]
    expect(classifyState(ind as any, closes)).toBe('breakout')
  })
})

describe('getRecommendedStrategies', () => {
  it('returns strategies for oversold state (includes RSI and MACD)', () => {
    const strategies = getRecommendedStrategies('oversold')
    expect(strategies.length).toBeGreaterThan(0)
    const names = strategies.map(s => s.name)
    expect(names.some(n => n.includes('RSI'))).toBe(true)
    expect(names.some(n => n.includes('MACD'))).toBe(true)
  })

  it('returns strategies for bearish state (includes MA and MACD)', () => {
    const strategies = getRecommendedStrategies('bearish')
    expect(strategies.length).toBeGreaterThan(0)
    const names = strategies.map(s => s.name)
    expect(names.some(n => n.includes('MA'))).toBe(true)
    expect(names.some(n => n.includes('MACD'))).toBe(true)
  })

  it('returns strategies for breakout state', () => {
    const strategies = getRecommendedStrategies('breakout')
    expect(strategies.length).toBeGreaterThan(0)
  })

  it('all strategies have required fields', () => {
    const states: MarketState[] = ['trending_up', 'oversold', 'range_bound', 'breakout', 'bearish']
    for (const state of states) {
      const strategies = getRecommendedStrategies(state)
      for (const s of strategies) {
        expect(s).toHaveProperty('id')
        expect(s).toHaveProperty('name')
        expect(s).toHaveProperty('direction')
        expect(s).toHaveProperty('description')
        expect(s).toHaveProperty('suitableState')
        expect(s).toHaveProperty('priority')
      }
    }
  })
})
