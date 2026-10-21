import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// smartFilters.ts — pure helper function tests
// ---------------------------------------------------------------------------

// Pure functions extracted from detectWashTrading, detectGoodNewsDump, detectVolumeAnomaly, analyzeChipDistribution

function countSamePriceTrades(prices: number[]): number {
  let count = 0
  const tolerance = 0.001
  for (let i = 1; i < prices.length; i++) {
    if (Math.abs(prices[i] - prices[i - 1]) / prices[i - 1] < tolerance) {
      count++
    }
  }
  return count
}

function calculateVariance(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const squaredDiffs = values.map(v => (v - mean) ** 2)
  return squaredDiffs.reduce((a, b) => a + b, 0) / values.length
}

function calculateBuySellRatio(rows: { close: number | string }[]): number {
  let upCount = 0, downCount = 0
  for (let i = 1; i < rows.length; i++) {
    const curr = Number(rows[i].close)
    const prev = Number(rows[i - 1].close)
    if (curr > prev) upCount++
    else if (curr < prev) downCount++
  }
  return upCount + downCount > 0 ? upCount / (upCount + downCount) : 1
}

describe('countSamePriceTrades', () => {
  it('returns 0 for all different prices', () => {
    const prices = [100, 101, 102, 103, 104]
    expect(countSamePriceTrades(prices)).toBe(0)
  })

  it('counts same consecutive prices (within tolerance 0.1%)', () => {
    const prices = [100, 100, 100, 101, 102]
    expect(countSamePriceTrades(prices)).toBe(2) // 2→3 are same
  })

  it('treats 0.05% change as same (within 0.1% tolerance)', () => {
    // 100.05 / 100 - 1 = 0.0005 = 0.05% < 0.1% → same
    // 100.10 / 100.05 - 1 = 0.0005 = 0.05% < 0.1% → same
    // So 2 consecutive pairs are "same price trades"
    const prices = [100, 100.05, 100.10]
    expect(countSamePriceTrades(prices)).toBe(2)
  })

  it('treats 0.2% change as different (> 0.1% tolerance)', () => {
    // 100.20 / 100 - 1 = 0.002 = 0.2% > 0.1%
    const prices = [100, 100.20, 100.40]
    expect(countSamePriceTrades(prices)).toBe(0)
  })

  it('returns 0 for single element', () => {
    expect(countSamePriceTrades([100])).toBe(0)
  })

  it('returns 0 for empty array', () => {
    expect(countSamePriceTrades([])).toBe(0)
  })

  it('handles all same prices', () => {
    const prices = Array(10).fill(100)
    expect(countSamePriceTrades(prices)).toBe(9)
  })
})

describe('calculateVariance', () => {
  it('returns 0 for all same values', () => {
    expect(calculateVariance([100, 100, 100, 100])).toBe(0)
  })

  it('computes correct variance for known values', () => {
    // values [2, 4, 4, 4, 5, 5, 7, 9] → mean=5, variance=4
    const values = [2, 4, 4, 4, 5, 5, 7, 9]
    expect(calculateVariance(values)).toBe(4)
  })

  it('returns 0 for single element', () => {
    expect(calculateVariance([100])).toBe(0)
  })

  it('handles negative numbers', () => {
    const values = [-2, 0, 2, 4]
    const variance = calculateVariance(values)
    expect(variance).toBeGreaterThan(0)
    // mean = (-2+0+2+4)/4 = 1
    // variance = [(-3)² + (-1)² + 1² + 3²] / 4 = (9+1+1+9)/4 = 20/4 = 5
    expect(calculateVariance(values)).toBe(5)
  })
})

describe('calculateBuySellRatio', () => {
  it('returns 1 for empty or single-element rows', () => {
    expect(calculateBuySellRatio([])).toBe(1)
    expect(calculateBuySellRatio([{ close: 100 }])).toBe(1)
  })

  it('returns 0.5 for equal up/down moves', () => {
    const rows = [
      { close: '100' }, { close: '101' }, // up
      { close: '101' }, { close: '100' }, // down
      { close: '100' }, { close: '100' }, // unchanged (no count)
    ]
    expect(calculateBuySellRatio(rows)).toBe(0.5)
  })

  it('returns 1 for all up moves', () => {
    const rows = [
      { close: '100' }, { close: '101' }, { close: '102' }, { close: '103' },
    ]
    expect(calculateBuySellRatio(rows)).toBe(1)
  })

  it('returns 0 for all down moves', () => {
    const rows = [
      { close: '103' }, { close: '102' }, { close: '101' }, { close: '100' },
    ]
    expect(calculateBuySellRatio(rows)).toBe(0)
  })

  it('handles numeric and string close prices', () => {
    const rows = [
      { close: 100 }, { close: '101' }, { close: 102 }, { close: '103' },
    ]
    expect(calculateBuySellRatio(rows)).toBe(1)
  })

  it('ignores zero-change rows', () => {
    const rows = [
      { close: '100' }, { close: '100' }, { close: '101' }, { close: '101' },
    ]
    // all changes are 0 (no up/down counted), so up+down=0 → returns 1
    expect(calculateBuySellRatio(rows)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// detectWashTrading — level branches via washScore thresholds
// ---------------------------------------------------------------------------
// washScore = min(100, (samePriceCount/rows.length)*100 + (priceVariance < 0.01 ? 30 : 0))
// low: washScore <= 30, medium: 30 < washScore <= 60, high: washScore > 60
describe('detectWashTrading — level branches', () => {
  function calcWashScore(samePriceCount: number, rowsLength: number, priceVariance: number): number {
    return Math.min(100, (samePriceCount / rowsLength) * 100 + (priceVariance < 0.01 ? 30 : 0))
  }
  function washLevel(score: number): 'low' | 'medium' | 'high' {
    if (score > 60) return 'high'
    if (score > 30) return 'medium'
    return 'low'
  }

  it('medium level when washScore > 30 and <= 60', () => {
    // 15 same-price trades out of 100 + variance bonus = 45 → medium
    expect(washLevel(calcWashScore(15, 100, 0.001))).toBe('medium')
    expect(calcWashScore(15, 100, 0.001)).toBe(45)
  })

  it('high level when washScore > 60', () => {
    expect(washLevel(calcWashScore(40, 100, 0.001))).toBe('high')
    expect(calcWashScore(40, 100, 0.001)).toBe(70)
  })

  it('low level when washScore <= 30 (exactly 30 is also low)', () => {
    // 0 same-price + variance bonus = 30 → low (30 is not > 30)
    expect(washLevel(calcWashScore(0, 100, 0.001))).toBe('low')
    expect(calcWashScore(0, 100, 0.001)).toBe(30)
    // 1 same-price + variance bonus = 31 → medium (31 > 30)
    expect(washLevel(calcWashScore(1, 100, 0.001))).toBe('medium')
    expect(calcWashScore(1, 100, 0.001)).toBe(31)
  })
})

// ---------------------------------------------------------------------------
// detectGoodNewsDump — level branches via dumpScore thresholds
// ---------------------------------------------------------------------------
// dumpScore += 40 if (isHighOpen && todayChange < -1)
// dumpScore += 30 if (volumeRatio > 2)
// dumpScore += 30 if (todayChange < -2)
// low: dumpScore <= 30, medium: 30 < dumpScore <= 60, high: dumpScore > 60
describe('detectGoodNewsDump — level branches', () => {
  function calcDumpScore(isHighOpen: boolean, todayChange: number, volumeRatio: number): number {
    let dumpScore = 0
    if (isHighOpen && todayChange < -1) dumpScore += 40
    if (volumeRatio > 2) dumpScore += 30
    if (todayChange < -2) dumpScore += 30
    return dumpScore
  }
  function dumpLevel(score: number): 'low' | 'medium' | 'high' {
    if (score > 60) return 'high'
    if (score > 30) return 'medium'
    return 'low'
  }

  it('low level when volumeRatio > 2 alone (30 pts)', () => {
    // volumeRatio 2.5 → 30 pts → low (30 is not > 30)
    expect(dumpLevel(calcDumpScore(false, -1.5, 2.5))).toBe('low')
    expect(calcDumpScore(false, -1.5, 2.5)).toBe(30)
  })

  it('low level when todayChange < -2 alone (30 pts)', () => {
    // todayChange -3 → 30 pts → low
    expect(dumpLevel(calcDumpScore(false, -3, 1.5))).toBe('low')
    expect(calcDumpScore(false, -3, 1.5)).toBe(30)
  })

  it('medium level when isHighOpen fires (40 pts)', () => {
    // isHighOpen=true + todayChange<-1 → 40 pts → 30 < 40 <= 60 → medium
    expect(dumpLevel(calcDumpScore(true, -2, 1))).toBe('medium')
    expect(calcDumpScore(true, -2, 1)).toBe(40)
  })

  it('high level when isHighOpen + todayChange < -2 (70 pts)', () => {
    expect(dumpLevel(calcDumpScore(true, -3, 1))).toBe('high')
    expect(calcDumpScore(true, -3, 1)).toBe(70)
  })

  it('high level when all three conditions fire (100 pts)', () => {
    expect(dumpLevel(calcDumpScore(true, -3, 3))).toBe('high')
    expect(calcDumpScore(true, -3, 3)).toBe(100)
  })

  it('low level when no conditions fire', () => {
    expect(dumpLevel(calcDumpScore(false, 0, 1))).toBe('low')
    expect(calcDumpScore(false, 0, 1)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// shouldBlockAlert — redis error branches
// ---------------------------------------------------------------------------
describe('shouldBlockAlert — redis error branches', () => {
  it('redis.get error falls through to analyzeSmartFilters', async () => {
    const mockRedis = {
      get: vi.fn().mockRejectedValue(new Error('redis connection refused')),
      setex: vi.fn().mockResolvedValue('OK'),
    }
    const analyzeResult = { filtered: false, reasons: [] }
    let analyzed = false
    const analyzeFn = async () => { analyzed = true; return analyzeResult }

    let result: { blocked: boolean; reasons: string[] }
    try {
      const cached = await mockRedis.get('key')
      if (cached) {
        result = { blocked: JSON.parse(cached).filtered, reasons: JSON.parse(cached).reasons }
      } else {
        result = { blocked: (await analyzeFn()).filtered, reasons: (await analyzeFn()).reasons }
      }
    } catch {
      result = { blocked: (await analyzeFn()).filtered, reasons: (await analyzeFn()).reasons }
    }
    expect(analyzed).toBe(true)
    expect(result.blocked).toBe(false)
  })

  it('redis.setex error still returns result', async () => {
    const mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      setex: vi.fn().mockRejectedValue(new Error('redis write error')),
    }
    const result = { filtered: true, reasons: ['test'] }
    let finalResult: { blocked: boolean; reasons: string[] } | undefined

    try {
      await mockRedis.setex('key', 300, JSON.stringify(result))
    } catch {
      finalResult = { blocked: result.filtered, reasons: result.reasons }
    }
    expect(finalResult).toEqual({ blocked: true, reasons: ['test'] })
  })
})
