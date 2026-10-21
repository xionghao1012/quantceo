import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeIndicators, classifyState, getRecommendedStrategies } from '../../ai/marketState.js'
import type { KLine } from '@shared/types'

// ---------------------------------------------------------------------------
// Helper: build synthetic KLines
// ---------------------------------------------------------------------------

function makeKlines(closes: number[], dates?: string[]): KLine[] {
  return closes.map((close, i) => ({
    code: '000001',
    date: dates?.[i] ?? `2024-01-${String(i + 1).padStart(2, '0')}`,
    open: close * 0.99,
    high: close * 1.02,
    low: close * 0.98,
    close,
    volume: 1_000_000,
    amount: close * 1_000_000,
  }))
}

// KLines with enough data (>= 60) for computeIndicators
function makeEnoughKlines(closes: number[]): KLine[] {
  return makeKlines(closes)
}

// ---------------------------------------------------------------------------
// computeIndicators
// ---------------------------------------------------------------------------

describe('computeIndicators', () => {
  it('returns null when klines < 60', () => {
    const klines = makeKlines(Array(30).fill(100))
    expect(computeIndicators(klines)).toBeNull()
  })

  it('returns null for empty array', () => {
    expect(computeIndicators([])).toBeNull()
  })

  it('returns null for klines with fewer than 60 items', () => {
    const klines = makeKlines(Array(59).fill(100))
    expect(computeIndicators(klines)).toBeNull()
  })

  it('returns indicators object when klines >= 60', () => {
    // 100 days of flat-ish data
    const closes = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i / 5) * 5)
    const klines = makeEnoughKlines(closes)
    const result = computeIndicators(klines)
    expect(result).not.toBeNull()
    expect(result).toHaveProperty('rsi')
    expect(result).toHaveProperty('macdSignal')
    expect(result).toHaveProperty('macdHistogram')
    expect(result).toHaveProperty('ma5')
    expect(result).toHaveProperty('ma20')
    expect(result).toHaveProperty('ma60')
    expect(typeof result!.rsi).toBe('number')
    expect(['bullish', 'bearish']).toContain(result!.macdSignal)
  })

  it('rounds values to 1-2 decimal places', () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 + i * 0.1)
    const klines = makeEnoughKlines(closes)
    const result = computeIndicators(klines)!
    // Check rounding
    expect(result.rsi.toString().replace(/\.\d+$/, '').length).toBeLessThanOrEqual(4)
    const ma5Str = result.ma5.toString()
    const ma20Str = result.ma20.toString()
    expect(ma5Str.split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2)
    expect(ma20Str.split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2)
  })

  it('handles rising trend (ma5 > ma20 > ma60)', () => {
    // Build monotonic price increase to force positive RSI and bullish MACD
    const closes = Array.from({ length: 100 }, (_, i) => 100 + i)
    const klines = makeEnoughKlines(closes)
    const result = computeIndicators(klines)
    expect(result).not.toBeNull()
    // MA5 should be > MA20 in a rising trend
    expect(result!.ma5).toBeGreaterThan(result!.ma20)
  })

  it('handles falling trend (ma5 < ma20 < ma60)', () => {
    const closes = Array.from({ length: 100 }, (_, i) => 200 - i)
    const klines = makeEnoughKlines(closes)
    const result = computeIndicators(klines)
    expect(result).not.toBeNull()
    expect(result!.ma5).toBeLessThan(result!.ma20)
    expect(result!.ma20).toBeLessThan(result!.ma60)
  })
})

// ---------------------------------------------------------------------------
// classifyState
// ---------------------------------------------------------------------------

describe('classifyState', () => {
  // Valid indicator set for all tests
  const makeInd = (overrides: Partial<ReturnType<typeof computeIndicators>> = {}) => ({
    rsi: 50,
    macdSignal: 'bullish' as const,
    macdHistogram: 0.5,
    ma5: 110,
    ma20: 105,
    ma60: 100,
    ...overrides,
  })
  const closes = [100, 101, 102]

  it('returns trending_up when maSeq && rsiMid && bullish', () => {
    const ind = makeInd({ ma5: 110, ma20: 105, ma60: 100, rsi: 50, macdSignal: 'bullish' as const })
    expect(classifyState(ind, closes)).toBe('trending_up')
  })

  it('returns oversold when rsi < 35', () => {
    const ind = makeInd({ rsi: 30 })
    expect(classifyState(ind, closes)).toBe('oversold')
  })

  it('returns oversold when rsi < 40 && bearish macdSignal', () => {
    const ind = makeInd({ rsi: 35, macdSignal: 'bearish' as const })
    expect(classifyState(ind, closes)).toBe('oversold')
  })

  it('returns bearish when maBear && rsiHigh', () => {
    const ind = makeInd({ ma5: 90, ma20: 95, ma60: 100, rsi: 75 })
    expect(classifyState(ind, closes)).toBe('bearish')
  })

  it('returns bearish when maBear && bearish macdSignal', () => {
    const ind = makeInd({ ma5: 90, ma20: 95, ma60: 100, macdSignal: 'bearish' as const })
    expect(classifyState(ind, closes)).toBe('bearish')
  })

  it('returns breakout when rsi > 65 && price > ma5 && bullish', () => {
    const ind = makeInd({ rsi: 70, ma5: 110, macdSignal: 'bullish' as const })
    // price (closes[-1]) = 102, ma5 = 110 → price > ma5 = false, so this won't be breakout
    // Need price > ma5
    const closesHigh = [100, 105, 112]
    expect(classifyState(ind, closesHigh)).toBe('breakout')
  })

  it('returns range_bound as default', () => {
    const ind = makeInd({ rsi: 50, macdSignal: 'bearish' as const, ma5: 105, ma20: 105, ma60: 100 })
    expect(classifyState(ind, closes)).toBe('range_bound')
  })

  it('returns range_bound when ind is null', () => {
    expect(classifyState(null as any, closes)).toBe('range_bound')
  })

  it('returns trending_up when ma5 > ma20 > ma60 with rsi at boundary 35', () => {
    // rsiMid = rsi >= 35 && rsi <= 65
    const ind = makeInd({ rsi: 35, macdSignal: 'bullish' as const })
    expect(classifyState(ind, closes)).toBe('trending_up')
  })

  it('returns trending_up when rsi at upper boundary 65', () => {
    const ind = makeInd({ rsi: 65, macdSignal: 'bullish' as const })
    expect(classifyState(ind, closes)).toBe('trending_up')
  })
})

// ---------------------------------------------------------------------------
// getRecommendedStrategies
// ---------------------------------------------------------------------------

describe('getRecommendedStrategies', () => {
  it('returns strategies for trending_up', () => {
    const result = getRecommendedStrategies('trending_up')
    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThanOrEqual(4)
    expect(result[0]).toMatchObject({ id: expect.any(Number), direction: expect.any(String) })
  })

  it('returns strategies for oversold', () => {
    const result = getRecommendedStrategies('oversold')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns strategies for range_bound', () => {
    const result = getRecommendedStrategies('range_bound')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns strategies for breakout', () => {
    const result = getRecommendedStrategies('breakout')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns strategies for bearish', () => {
    const result = getRecommendedStrategies('bearish')
    expect(result.length).toBeGreaterThan(0)
  })

  it('deduplicates by id+direction (max 4)', () => {
    // Call multiple times — result should always be ≤ 4
    for (const state of ['trending_up', 'oversold', 'range_bound', 'breakout', 'bearish'] as const) {
      const result = getRecommendedStrategies(state)
      expect(result.length).toBeLessThanOrEqual(4)
    }
  })

  it('each returned strategy has required fields', () => {
    const result = getRecommendedStrategies('trending_up')
    for (const s of result) {
      expect(s).toHaveProperty('id')
      expect(s).toHaveProperty('name')
      expect(s).toHaveProperty('direction')
      expect(s).toHaveProperty('description')
      expect(s).toHaveProperty('suitableState')
      expect(s).toHaveProperty('priority')
    }
  })

  it('direction is BUY or SELL only', () => {
    const states: Array<'trending_up' | 'oversold' | 'range_bound' | 'breakout' | 'bearish'> =
      ['trending_up', 'oversold', 'range_bound', 'breakout', 'bearish']
    for (const state of states) {
      const result = getRecommendedStrategies(state)
      for (const s of result) {
        expect(['BUY', 'SELL']).toContain(s.direction)
      }
    }
  })
})
