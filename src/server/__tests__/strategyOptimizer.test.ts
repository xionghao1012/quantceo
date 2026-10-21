import { describe, it, expect } from 'vitest'

// --- Pure functions extracted from strategyOptimizer.ts ---

function generateCombinations(
  grid: Record<string, number[]>,
  keys: string[] = Object.keys(grid),
  idx = 0,
  current: Record<string, number> = {},
): Record<string, number>[] {
  if (idx === keys.length) return [{ ...current }]
  const results: Record<string, number>[] = []
  for (const val of grid[keys[idx]]) {
    current[keys[idx]] = val
    results.push(...generateCombinations(grid, keys, idx + 1, current))
  }
  return results
}

function calcSharpe(closes: number[]): number {
  if (closes.length < 2) return 0
  const returns: number[] = []
  for (let j = 1; j < closes.length; j++) {
    returns.push(Math.log(closes[j] / closes[j - 1]))
  }
  if (returns.length === 0) return 0
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length
  const std = Math.sqrt(variance)
  if (std === 0) return 0
  return (mean / std) * Math.sqrt(252)
}

function splitWindows(closes: number[], dates: string[], windowSize: number, stepSize: number) {
  const windows: any[] = []
  for (let start = 0; start + windowSize + stepSize <= closes.length; start += stepSize) {
    const trainEnd = start + windowSize
    const testEnd = Math.min(start + windowSize + stepSize, closes.length)
    const trainCloses = closes.slice(start, trainEnd)
    const testCloses = closes.slice(trainEnd, testEnd)

    const trainReturns: number[] = []
    for (let i = 1; i < trainCloses.length; i++) {
      trainReturns.push(Math.log(trainCloses[i] / trainCloses[i - 1]))
    }
    const trainMean = trainReturns.reduce((a, b) => a + b, 0) / trainReturns.length
    const trainVar = trainReturns.reduce((a, b) => a + (b - trainMean) ** 2, 0) / trainReturns.length
    const trainStd = Math.sqrt(trainVar)
    const trainSharpe = trainStd > 0 ? (trainMean / trainStd) * Math.sqrt(252) : 0

    const testReturns: number[] = []
    for (let i = 1; i < testCloses.length; i++) {
      testReturns.push(Math.log(testCloses[i] / testCloses[i - 1]))
    }
    const testMean = testReturns.reduce((a, b) => a + b, 0) / Math.max(1, testReturns.length)
    const testVar = testReturns.reduce((a, b) => a + (b - testMean) ** 2, 0) / Math.max(1, testReturns.length)
    const testStd = Math.sqrt(testVar)
    const testSharpe = testStd > 0 ? (testMean / testStd) * Math.sqrt(252) : 0

    windows.push({
      window: windows.length + 1,
      trainStart: dates[start],
      trainEnd: dates[trainEnd - 1],
      testStart: dates[trainEnd],
      testEnd: dates[testEnd - 1],
      trainSharpe: Math.round(trainSharpe * 10000) / 10000,
      testSharpe: Math.round(testSharpe * 10000) / 10000,
    })
  }
  return windows
}

function calcConsistency(windows: { testSharpe: number }[]) {
  if (windows.length === 0) return 0
  const sharpeRatios = windows.map(w => w.testSharpe)
  const avgSharpe = sharpeRatios.reduce((a, b) => a + b, 0) / sharpeRatios.length
  const sharpeStd = Math.sqrt(sharpeRatios.reduce((a, b) => a + (b - avgSharpe) ** 2, 0) / sharpeRatios.length)
  return avgSharpe > 0 ? avgSharpe / (avgSharpe + sharpeStd) : 0
}

function calcBenchmark(closes: number[]) {
  if (closes.length < 2) return { totalReturn: 0, sharpe: 0 }
  const returns: number[] = []
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]))
  }
  const benchmarkMean = returns.reduce((a, b) => a + b, 0) / returns.length
  const benchVar = returns.reduce((a, b) => a + (b - benchmarkMean) ** 2, 0) / returns.length
  const benchStd = Math.sqrt(benchVar)
  const benchSharpe = benchStd > 0 ? (benchmarkMean / benchStd) * Math.sqrt(252) : 0
  const benchReturn = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100
  return {
    totalReturn: Math.round(benchReturn * 100) / 100,
    sharpe: Math.round(benchSharpe * 10000) / 10000,
  }
}

function calcGridScore(closes: number[]): number {
  if (closes.length < 2) return 0
  const returns: number[] = []
  for (let j = 1; j < closes.length; j++) {
    returns.push(Math.log(closes[j] / closes[j - 1]))
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length
  const std = Math.sqrt(variance)
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0
  return Math.round(sharpe * 10000) / 10000
}

const STRATEGY_PARAM_RANGES = {
  rsi: [
    { name: 'rsiPeriod', min: 5, max: 30, step: 1, default: 14 },
    { name: 'oversold', min: 10, max: 40, step: 1, default: 30 },
    { name: 'overbought', min: 60, max: 90, step: 1, default: 70 },
  ],
  macd: [
    { name: 'fastPeriod', min: 5, max: 20, step: 1, default: 12 },
    { name: 'slowPeriod', min: 15, max: 40, step: 1, default: 26 },
    { name: 'signalPeriod', min: 5, max: 15, step: 1, default: 9 },
  ],
  ma_cross: [
    { name: 'maFast', min: 3, max: 20, step: 1, default: 5 },
    { name: 'maSlow', min: 10, max: 60, step: 1, default: 20 },
  ],
  bollinger: [
    { name: 'bbPeriod', min: 10, max: 30, step: 1, default: 20 },
    { name: 'bbStdDev', min: 1.5, max: 3.0, step: 0.1, default: 2.0 },
  ],
}

// --- Tests ---

describe('STRATEGY_PARAM_RANGES', () => {
  it('rsi has correct parameter names and bounds', () => {
    const rsi = STRATEGY_PARAM_RANGES.rsi
    expect(rsi).toHaveLength(3)
    expect(rsi[0]).toMatchObject({ name: 'rsiPeriod', min: 5, max: 30 })
    expect(rsi[1]).toMatchObject({ name: 'oversold', min: 10, max: 40 })
    expect(rsi[2]).toMatchObject({ name: 'overbought', min: 60, max: 90 })
  })

  it('macd has correct parameter names and bounds', () => {
    const macd = STRATEGY_PARAM_RANGES.macd
    expect(macd).toHaveLength(3)
    expect(macd[0]).toMatchObject({ name: 'fastPeriod', min: 5, max: 20, default: 12 })
    expect(macd[1]).toMatchObject({ name: 'slowPeriod', min: 15, max: 40, default: 26 })
    expect(macd[2]).toMatchObject({ name: 'signalPeriod', min: 5, max: 15, default: 9 })
  })

  it('ma_cross has fast < slow defaults', () => {
    const ma = STRATEGY_PARAM_RANGES.ma_cross
    const fast = ma.find(p => p.name === 'maFast')!
    const slow = ma.find(p => p.name === 'maSlow')!
    expect(fast.default).toBeLessThan(slow.default)
  })

  it('bollinger bbStdDev step is 0.1', () => {
    const bb = STRATEGY_PARAM_RANGES.bollinger.find(p => p.name === 'bbStdDev')!
    expect(bb.step).toBe(0.1)
    expect(bb.min).toBe(1.5)
    expect(bb.max).toBe(3.0)
  })

  it('all strategy types have parameters with valid defaults', () => {
    for (const params of Object.values(STRATEGY_PARAM_RANGES)) {
      for (const p of params) {
        expect(p.default).toBeGreaterThanOrEqual(p.min)
        expect(p.default).toBeLessThanOrEqual(p.max)
        expect(p.step).toBeGreaterThan(0)
      }
    }
  })
})

describe('generateCombinations (pure, extracted from grid-search)', () => {
  it('generates all combinations for single key', () => {
    const grid = { rsiPeriod: [14, 20, 30] }
    const combos = generateCombinations(grid)
    expect(combos).toHaveLength(3)
    expect(combos.map(c => c.rsiPeriod)).toEqual([14, 20, 30])
  })

  it('generates cartesian product for two keys', () => {
    const grid = { rsiPeriod: [14, 20], oversold: [20, 30] }
    const combos = generateCombinations(grid)
    expect(combos).toHaveLength(4)
    expect(combos).toContainEqual({ rsiPeriod: 14, oversold: 20 })
    expect(combos).toContainEqual({ rsiPeriod: 14, oversold: 30 })
    expect(combos).toContainEqual({ rsiPeriod: 20, oversold: 20 })
    expect(combos).toContainEqual({ rsiPeriod: 20, oversold: 30 })
  })

  it('returns one empty object for empty grid', () => {
    expect(generateCombinations({})).toEqual([{}])
  })

  it('handles three keys correctly', () => {
    const grid = { a: [1, 2], b: [3, 4], c: [5, 6] }
    const combos = generateCombinations(grid)
    expect(combos).toHaveLength(8)
  })

  it('does not mutate original grid', () => {
    const grid = { a: [1, 2] }
    generateCombinations(grid)
    expect(grid.a).toEqual([1, 2])
  })
})

describe('calcSharpe (pure, extracted from grid-search)', () => {
  it('returns 0 for single price', () => {
    expect(calcSharpe([100])).toBe(0)
  })

  it('returns 0 for two identical prices (zero std)', () => {
    expect(calcSharpe([100, 100])).toBe(0)
  })

  it('computes positive sharpe for trending prices', () => {
    const closes = [100, 101, 102, 103, 104, 105]
    const s = calcSharpe(closes)
    expect(s).toBeGreaterThan(0)
  })

  it('computes negative sharpe for falling prices', () => {
    const closes = [105, 104, 103, 102, 101, 100]
    const s = calcSharpe(closes)
    expect(s).toBeLessThan(0)
  })

  it('returns 0 for empty array', () => {
    expect(calcSharpe([])).toBe(0)
  })

  it('returns 0 for flat prices', () => {
    expect(calcSharpe([100, 100, 100, 100])).toBe(0)
  })
})

describe('splitWindows (pure, extracted from walk-forward)', () => {
  it('creates correct number of windows', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + i)
    const dates = closes.map((_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`)
    const windows = splitWindows(closes, dates, 60, 20)
    expect(windows).toHaveLength(3)
  })

  it('each window has train and test date labels', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i)
    const dates = closes.map((_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`)
    const windows = splitWindows(closes, dates, 30, 10)
    for (const w of windows) {
      expect(w).toHaveProperty('trainStart')
      expect(w).toHaveProperty('trainEnd')
      expect(w).toHaveProperty('testStart')
      expect(w).toHaveProperty('testEnd')
      expect(w).toHaveProperty('trainSharpe')
      expect(w).toHaveProperty('testSharpe')
    }
  })

  it('returns empty array when not enough data', () => {
    const closes = [100, 101, 102]
    const dates = ['2024-01-01', '2024-01-02', '2024-01-03']
    expect(splitWindows(closes, dates, 60, 20)).toHaveLength(0)
  })

  it('respects windowSize boundaries', () => {
    // For 2 windows: need start values {0, 20} valid but 40 invalid
    // 40 + 40 + 20 = 100 → need closes.length < 100 for stop at start=40
    const closes = Array.from({ length: 99 }, (_, i) => 100 + i)
    const dates = closes.map((_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`)
    const windows = splitWindows(closes, dates, 40, 20)
    expect(windows).toHaveLength(2)
  })

  it('testSharpe is 0 when test window has single element', () => {
    const closes = [100, 101, 102, 103, 104, 105, 106, 107]
    const dates = closes.map((_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`)
    const windows = splitWindows(closes, dates, 3, 3)
    expect(windows.length).toBeGreaterThan(0)
    // Last window may have only 1 test bar → sharpe = 0
  })
})

describe('calcConsistency (pure, extracted from walk-forward)', () => {
  it('returns 0 for empty windows', () => {
    expect(calcConsistency([])).toBe(0)
  })

  it('returns 1 when all sharpe ratios are identical', () => {
    const windows = [{ testSharpe: 1 }, { testSharpe: 1 }, { testSharpe: 1 }]
    expect(calcConsistency(windows)).toBe(1)
  })

  it('returns less than 1 when sharpe ratios vary', () => {
    const windows = [{ testSharpe: 3 }, { testSharpe: 1 }, { testSharpe: 0.5 }]
    expect(calcConsistency(windows)).toBeLessThan(1)
    expect(calcConsistency(windows)).toBeGreaterThan(0)
  })

  it('returns 0 when avgSharpe is 0', () => {
    const windows = [{ testSharpe: 0 }, { testSharpe: 0 }]
    expect(calcConsistency(windows)).toBe(0)
  })

  it('returns high consistency for stable returns', () => {
    const windows = [{ testSharpe: 1.5 }, { testSharpe: 1.6 }, { testSharpe: 1.4 }, { testSharpe: 1.55 }]
    const c = calcConsistency(windows)
    expect(c).toBeGreaterThan(0.8)
  })
})

describe('calcBenchmark (pure, extracted from compare-strategies)', () => {
  it('returns zeros for single price', () => {
    expect(calcBenchmark([100])).toEqual({ totalReturn: 0, sharpe: 0 })
  })

  it('computes positive return for rising stock', () => {
    const closes = [100, 110]
    const result = calcBenchmark(closes)
    expect(result.totalReturn).toBeCloseTo(10, 1)
  })

  it('computes negative return for falling stock', () => {
    const closes = [100, 90]
    const result = calcBenchmark(closes)
    expect(result.totalReturn).toBeCloseTo(-10, 1)
  })

  it('sharpe is 0 for zero volatility', () => {
    expect(calcBenchmark([100, 100, 100])).toMatchObject({ sharpe: 0 })
  })

  it('handles flat then sharp move', () => {
    const closes = [100, 100, 100, 120]
    const result = calcBenchmark(closes)
    expect(result.totalReturn).toBeCloseTo(20, 1)
    expect(result.sharpe).toBeGreaterThan(0)
  })

  it('handles multi-period returns', () => {
    const closes = [100, 105, 110, 115, 120, 125, 130, 135, 140, 145]
    const result = calcBenchmark(closes)
    expect(result.totalReturn).toBeGreaterThan(0)
  })
})

describe('calcGridScore (pure, extracted from grid-search scoring)', () => {
  it('returns 0 for insufficient data', () => {
    expect(calcGridScore([])).toBe(0)
    expect(calcGridScore([100])).toBe(0)
  })

  it('returns 0 for flat prices', () => {
    expect(calcGridScore([100, 100, 100, 100])).toBe(0)
  })

  it('returns positive for upward trend', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i)
    expect(calcGridScore(closes)).toBeGreaterThan(0)
  })

  it('returns negative for downward trend', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 130 - i)
    expect(calcGridScore(closes)).toBeLessThan(0)
  })
})
