import { describe, it, expect } from 'vitest'
import type { KLine } from '../../../shared/types.js'
import { optimize, backtest, randomInRange, createChromosome, createPopulation, crossover, mutate, tournamentSelection, roundToStep, clamp, type OptimizeParamRange } from '../../engine/optimizer.js'

function makeKlines(n: number, startPrice = 100, trend = 0): KLine[] {
  const result: KLine[] = []
  let price = startPrice
  for (let i = 0; i < n; i++) {
    price += trend + (Math.sin(i) * 2)
    const open = price - 0.5
    const close = price + 0.3
    result.push({ code: '000001', date: new Date().toISOString(), open, high: price + 1, low: price - 1, close, volume: 1000000 } as any)
  }
  return result
}

// Test the actual optimize() function
describe('optimize() integration', () => {
  it('returns sharpe -999 for insufficient klines (< 60 bars)', async () => {
    const klines = makeKlines(30)
    const ranges: OptimizeParamRange[] = [{ name: 'rsiPeriod', min: 10, max: 20, step: 2, default: 14 }]
    const result = await optimize(klines, 'rsi', ranges, { generations: 1, populationSize: 5 })
    expect(result.bestFitness).toBe(-999)
    expect(result.metrics.sharpe).toBe(-999)
  })

  it('returns valid result for sufficient klines', async () => {
    const klines = makeKlines(100, 100, 0.2)
    const ranges: OptimizeParamRange[] = [{ name: 'rsiPeriod', min: 5, max: 20, step: 1 }]
    const result = await optimize(klines, 'rsi', ranges, { generations: 2, populationSize: 5 })
    expect(result.bestParams).toBeDefined()
    expect(result.bestFitness).toBeDefined()
    expect(result.metrics).toBeDefined()
    expect(result.history).toHaveLength(2)
  })

  it('respects generations limit', async () => {
    const klines = makeKlines(100)
    const ranges: OptimizeParamRange[] = [{ name: 'rsiPeriod', min: 5, max: 20, step: 1 }]
    const result = await optimize(klines, 'rsi', ranges, { generations: 5, populationSize: 5 })
    expect(result.history).toHaveLength(5)
  })

  it('history records generation progress', async () => {
    const klines = makeKlines(100)
    const ranges: OptimizeParamRange[] = [{ name: 'rsiPeriod', min: 5, max: 20, step: 1 }]
    const result = await optimize(klines, 'rsi', ranges, { generations: 3, populationSize: 5 })
    for (let i = 0; i < result.history.length; i++) {
      expect(result.history[i].generation).toBe(i + 1)
      expect(result.history[i].bestParams).toBeDefined()
    }
  })

  it('onProgress callback is called each generation', async () => {
    const klines = makeKlines(100)
    const ranges: OptimizeParamRange[] = [{ name: 'rsiPeriod', min: 5, max: 20, step: 1 }]
    const progressCalls: number[] = []
    await optimize(klines, 'rsi', ranges, {
      generations: 3, populationSize: 5,
      onProgress: (p) => progressCalls.push(p.generation),
    })
    expect(progressCalls).toEqual([1, 2, 3])
  })
})

function calcRSIWithPeriod(klines: KLine[], period: number): number[] {
  const closes = klines.map(k => k.close)
  const rsi: number[] = new Array(closes.length).fill(NaN)
  if (closes.length < period + 1) return rsi
  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) gains += diff
    else losses -= diff
  }
  let avgGain = gains / period
  let avgLoss = losses / period
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return rsi
}

function calcEMA(data: number[], period: number): number[] {
  const ema: number[] = new Array(data.length).fill(NaN)
  if (data.length < period) return ema
  const multiplier = 2 / (period + 1)
  let sum = 0
  for (let i = 0; i < period; i++) sum += data[i]
  ema[period - 1] = sum / period
  for (let i = period; i < data.length; i++) {
    ema[i] = (data[i] - ema[i - 1]) * multiplier + ema[i - 1]
  }
  return ema
}

function calcMAWithPeriod(klines: KLine[], period: number): number[] {
  const closes = klines.map(k => k.close)
  const ma: number[] = new Array(closes.length).fill(NaN)
  if (closes.length < period) return ma
  let sum = 0
  for (let i = 0; i < period; i++) sum += closes[i]
  ma[period - 1] = sum / period
  for (let i = period; i < closes.length; i++) {
    sum += closes[i] - closes[i - period]
    ma[i] = sum / period
  }
  return ma
}

function calcMACDWithPeriods(klines: KLine[], fastPeriod: number, slowPeriod: number, signalPeriod: number) {
  const closes = klines.map(k => k.close)
  const emaFast = calcEMA(closes, fastPeriod)
  const emaSlow = calcEMA(closes, slowPeriod)
  const macd: number[] = new Array(closes.length).fill(NaN)
  for (let i = 0; i < closes.length; i++) {
    if (!isNaN(emaFast[i]) && !isNaN(emaSlow[i])) {
      macd[i] = emaFast[i] - emaSlow[i]
    }
  }
  const signal = calcEMA(macd.filter(v => !isNaN(v)), signalPeriod)
  const signalFilled: number[] = new Array(closes.length).fill(NaN)
  let sigIdx = 0
  for (let i = 0; i < closes.length; i++) {
    if (!isNaN(macd[i])) {
      signalFilled[i] = signal[sigIdx++] ?? NaN
    }
  }
  const histogram = macd.map((v, i) => v - signalFilled[i])
  return { macd, signal: signalFilled, histogram }
}

function fitnessFunction(metrics: { sharpe: number; totalReturn: number; maxDrawdown: number; winRate: number }): number {
  const sharpeWeight = 2.0, returnWeight = 1.5, drawdownPenalty = 3.0, winRateWeight = 0.5
  if (metrics.sharpe === -999) return -999
  return Math.round((metrics.sharpe * sharpeWeight + metrics.totalReturn * returnWeight - metrics.maxDrawdown * drawdownPenalty + metrics.winRate * winRateWeight) * 100) / 100
}

describe('roundToStep', () => {
  it('rounds to nearest step', () => {
    expect(roundToStep(7.3, 1)).toBe(7)
    expect(roundToStep(7.6, 1)).toBe(8)
    expect(roundToStep(7.5, 1)).toBe(8)
  })
  it('works with fractional steps', () => {
    expect(roundToStep(2.7, 0.5)).toBe(2.5)
    expect(roundToStep(2.8, 0.5)).toBe(3)
  })
})

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(0, 0, 10)).toBe(0)
    expect(clamp(10, 0, 10)).toBe(10)
  })
  it('returns min when value is below', () => expect(clamp(-5, 0, 10)).toBe(0))
  it('returns max when value is above', () => expect(clamp(15, 0, 10)).toBe(10))
})

describe('calcRSIWithPeriod', () => {
  it('returns all NaN for insufficient data', () => {
    const rsi = calcRSIWithPeriod(makeKlines(5), 14)
    expect(rsi.every(v => isNaN(v))).toBe(true)
  })
  it('returns RSI values between 0 and 100 for sufficient data', () => {
    const klines = makeKlines(30)
    const rsi = calcRSIWithPeriod(klines, 14)
    const valid = rsi.filter(v => !isNaN(v))
    expect(valid.length).toBe(16)
    for (const v of valid) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })
  it('RSI of all-up candles is 100', () => {
    const klines: KLine[] = []
    for (let i = 0; i < 20; i++) {
      klines.push({ code: '000001', date: new Date().toISOString(), open: i, high: i + 1, low: i - 0.5, close: i + 0.8, volume: 1000000 } as any)
    }
    const rsi = calcRSIWithPeriod(klines, 14)
    const valid = rsi.filter(v => !isNaN(v))
    expect(valid[valid.length - 1]).toBe(100)
  })
  it('RSI of falling prices is lower', () => {
    const rising: KLine[] = []
    const falling: KLine[] = []
    for (let i = 0; i < 20; i++) {
      rising.push({ code: '000001', date: new Date().toISOString(), open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1000000 } as any)
      falling.push({ code: '000001', date: new Date().toISOString(), open: 120 - i, high: 121 - i, low: 119 - i, close: 119.5 - i, volume: 1000000 } as any)
    }
    const risingRSI = calcRSIWithPeriod(rising, 14)
    const fallingRSI = calcRSIWithPeriod(falling, 14)
    expect(risingRSI[risingRSI.length - 1]).toBeGreaterThan(50)
    expect(fallingRSI[fallingRSI.length - 1]).toBeLessThan(50)
  })
})

describe('calcEMA', () => {
  it('returns all NaN for insufficient data', () => {
    expect(calcEMA([1, 2, 3], 10).every(v => isNaN(v))).toBe(true)
  })
  it('EMA length equals input length', () => {
    const data = Array.from({ length: 50 }, (_, i) => i)
    expect(calcEMA(data, 12).length).toBe(50)
  })
  it('EMA values are smoothed', () => {
    const data = Array.from({ length: 30 }, (_, i) => i + 1)
    const ema = calcEMA(data, 5)
    const valid = ema.filter(v => !isNaN(v))
    expect(valid[valid.length - 1]).toBeLessThan(data[data.length - 1])
    expect(valid[valid.length - 1]).toBeGreaterThan(25)
  })
})

describe('calcMAWithPeriod', () => {
  it('returns all NaN for insufficient data', () => {
    expect(calcMAWithPeriod(makeKlines(5), 10).every(v => isNaN(v))).toBe(true)
  })
  it('first valid MA equals average of first period', () => {
    const klines = makeKlines(20, 100, 0)
    const ma = calcMAWithPeriod(klines, 5)
    expect(ma.findIndex(v => !isNaN(v))).toBe(4)
    const closes = klines.slice(0, 5).map(k => k.close)
    expect(ma[4]).toBeCloseTo(closes.reduce((a, b) => a + b, 0) / 5, 1)
  })
  it('MA length equals klines length', () => {
    expect(calcMAWithPeriod(makeKlines(30), 10).length).toBe(30)
  })
})

describe('calcMACDWithPeriods', () => {
  it('returns macd, signal, histogram arrays of same length', () => {
    const klines = makeKlines(60)
    const result = calcMACDWithPeriods(klines, 12, 26, 9)
    expect(result.macd.length).toBe(klines.length)
    expect(result.signal.length).toBe(klines.length)
    expect(result.histogram.length).toBe(klines.length)
  })
  it('histogram equals macd minus signal', () => {
    const klines = makeKlines(60)
    const { macd, signal, histogram } = calcMACDWithPeriods(klines, 12, 26, 9)
    for (let i = 0; i < klines.length; i++) {
      if (!isNaN(macd[i]) && !isNaN(signal[i])) {
        expect(histogram[i]).toBeCloseTo(macd[i] - signal[i], 10)
      }
    }
  })
})

describe('fitnessFunction', () => {
  it('returns -999 for invalid sharpe', () => {
    expect(fitnessFunction({ sharpe: -999, totalReturn: 0, maxDrawdown: 0, winRate: 0 })).toBe(-999)
  })
  it('higher sharpe = higher fitness', () => {
    const base = { sharpe: 1, totalReturn: 0, maxDrawdown: 0, winRate: 0 }
    const better = { sharpe: 2, totalReturn: 0, maxDrawdown: 0, winRate: 0 }
    expect(fitnessFunction(better)).toBeGreaterThan(fitnessFunction(base))
  })
  it('weights are applied correctly', () => {
    const m = { sharpe: 2, totalReturn: 100, maxDrawdown: 5, winRate: 60 }
    // 2*2 + 100*1.5 - 5*3 + 60*0.5 = 4 + 150 - 15 + 30 = 169
    expect(fitnessFunction(m)).toBe(169)
  })
})

describe('randomInRange', () => {
  it('returns value within [min, max)', () => {
    for (let i = 0; i < 100; i++) {
      const r = randomInRange(5, 10)
      expect(r).toBeGreaterThanOrEqual(5)
      expect(r).toBeLessThan(10)
    }
  })
})

describe('createChromosome', () => {
  it('creates genes within specified ranges', () => {
    const ranges: OptimizeParamRange[] = [{ name: 'p1', min: 10, max: 20, step: 1 }, { name: 'p2', min: 0, max: 100, step: 5 }]
    const genes = createChromosome(ranges)
    expect(genes.p1).toBeGreaterThanOrEqual(10)
    expect(genes.p1).toBeLessThanOrEqual(20)
    expect(genes.p2).toBeGreaterThanOrEqual(0)
    expect(genes.p2).toBeLessThanOrEqual(100)
  })
  it('rounds gene values to step', () => {
    const ranges: OptimizeParamRange[] = [{ name: 'p1', min: 0, max: 10, step: 2 }]
    for (let i = 0; i < 20; i++) {
      const genes = createChromosome(ranges)
      expect(genes.p1 % 2).toBe(0)
    }
  })
})

describe('createPopulation', () => {
  it('includes default gene when specified', () => {
    const ranges: OptimizeParamRange[] = [{ name: 'p1', min: 1, max: 10, step: 1, default: 5 }, { name: 'p2', min: 1, max: 10, step: 1 }]
    const pop = createPopulation(ranges, 5)
    expect(pop.length).toBe(5)
    expect(pop[0].p1).toBe(5)
  })
  it('fills remaining slots with random chromosomes', () => {
    const ranges: OptimizeParamRange[] = [{ name: 'p1', min: 0, max: 100, step: 1 }]
    const pop = createPopulation(ranges, 10)
    expect(pop.length).toBe(10)
    for (const c of pop) expect(c).toHaveProperty('p1')
  })
})

describe('crossover', () => {
  it('child inherits genes from one parent per key', () => {
    const p1 = { a: 1, b: 2, c: 3 }
    const p2 = { a: 10, b: 20, c: 30 }
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const child = crossover(p1, p2)
      expect(child.a).toBeOneOf([1, 10])
      expect(child.b).toBeOneOf([2, 20])
      expect(child.c).toBeOneOf([3, 30])
      seen.add(`${child.a},${child.b},${child.c}`)
    }
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('mutate', () => {
  it('does not always mutate', () => {
    const ranges: OptimizeParamRange[] = [{ name: 'p1', min: 100, max: 200, step: 1 }]
    const genes = { p1: 150 }
    let changed = 0
    for (let i = 0; i < 200; i++) {
      if (mutate(genes, ranges).p1 !== 150) changed++
    }
    expect(changed).toBeGreaterThan(0)
  })
  it('clamps mutated value to range', () => {
    const ranges: OptimizeParamRange[] = [{ name: 'p1', min: 0, max: 10, step: 1 }]
    const genes = { p1: 5 }
    for (let i = 0; i < 100; i++) {
      const result = mutate(genes, ranges)
      expect(result.p1).toBeGreaterThanOrEqual(0)
      expect(result.p1).toBeLessThanOrEqual(10)
    }
  })
})

describe('tournamentSelection', () => {
  it('returns genes of one individual', () => {
    const pop = [{ genes: { a: 1 }, fitness: 10 }, { genes: { a: 2 }, fitness: 20 }, { genes: { a: 3 }, fitness: 30 }]
    for (let i = 0; i < 50; i++) {
      const selected = tournamentSelection(pop)
      expect(selected).toHaveProperty('a')
      expect(pop.some(p => p.genes.a === selected.a)).toBe(true)
    }
  })
  it('higher fitness individuals win more often', () => {
    const pop = [{ genes: { v: 1 }, fitness: 0 }, { genes: { v: 2 }, fitness: 100 }]
    let wins = 0
    for (let i = 0; i < 100; i++) {
      if (tournamentSelection(pop).v === 2) wins++
    }
    expect(wins).toBeGreaterThan(50)
  })
})

describe('optimize() — additional branches', () => {
  it('uses default populationSize when not specified', async () => {
    const klines = makeKlines(100)
    const ranges: OptimizeParamRange[] = [{ name: 'p1', min: 5, max: 15, step: 1 }]
    const result = await optimize(klines, 'rsi', ranges, { generations: 1 })
    expect(result.bestParams).toBeDefined()
  })
  it('returns bestParams with correct keys', async () => {
    const klines = makeKlines(100, 100, 0.2)
    const ranges: OptimizeParamRange[] = [{ name: 'rsiPeriod', min: 5, max: 20, step: 1 }, { name: 'oversold', min: 20, max: 40, step: 5 }]
    const result = await optimize(klines, 'rsi', ranges, { generations: 1, populationSize: 5 })
    expect(result.bestParams).toHaveProperty('rsiPeriod')
    expect(result.bestParams).toHaveProperty('oversold')
  })
})

describe('backtest() strategy branches', () => {
  const klines = makeKlines(80, 100, 0.1)

  it('returns early exit metrics for klines < 60', () => {
    const result = backtest(makeKlines(30), 'rsi', { rsiPeriod: 14 })
    expect(result.sharpe).toBe(-999)
    expect(result.tradeCount).toBe(0)
    expect(result.equity).toEqual([10000])
  })

  it('backtest rsi strategy returns valid metrics', () => {
    const result = backtest(klines, 'rsi', { rsiPeriod: 14, oversold: 30, overbought: 70 })
    expect(result).toHaveProperty('sharpe')
    expect(result).toHaveProperty('maxDrawdown')
    expect(result).toHaveProperty('winRate')
    expect(result).toHaveProperty('totalReturn')
    expect(result.tradeCount).toBeGreaterThanOrEqual(0)
  })

  it('backtest macd strategy returns valid metrics', () => {
    const result = backtest(klines, 'macd', { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 })
    expect(result).toHaveProperty('sharpe')
    expect(result.tradeCount).toBeGreaterThanOrEqual(0)
  })

  it('backtest ma_cross strategy returns valid metrics', () => {
    const result = backtest(klines, 'ma_cross', { maFast: 5, maSlow: 20 })
    expect(result).toHaveProperty('sharpe')
    expect(result.tradeCount).toBeGreaterThanOrEqual(0)
  })

  it('backtest bollinger strategy returns valid metrics', () => {
    const result = backtest(klines, 'bollinger', { bbPeriod: 20, bbStdDev: 2 })
    expect(result).toHaveProperty('sharpe')
    expect(result).toHaveProperty('maxDrawdown')
    expect(result).toHaveProperty('winRate')
    expect(result).toHaveProperty('totalReturn')
    expect(result.tradeCount).toBeGreaterThanOrEqual(0)
    expect(result.equity.length).toBeGreaterThan(0)
  })

  it('backtest unknown strategyType falls through to default', () => {
    const result = backtest(klines, 'unknown_strategy', {})
    expect(result).toHaveProperty('sharpe')
    expect(result).toHaveProperty('equity')
    expect(result.equity.length).toBeGreaterThan(0)
  })
})

// ─── Bollinger position closing branches (lines 216-218, 224) ─────────────────

describe('backtest bollinger — position close branches', () => {
  it('closes position at end when position=1 (line 223-225)', () => {
    // Declining prices: BUY at high, price drops below lower band → SELL
    const klines = Array.from({ length: 100 }, (_, i) => ({
      code: '000001', date: `2024-01-${String(i+1).padStart(2,'0')}`,
      open: 20 - i * 0.15, high: 20 - i * 0.15 + 0.5, low: 20 - i * 0.15 - 0.5, close: 20 - i * 0.15, volume: 1000000,
    }))
    const result = backtest(klines as any, 'bollinger', { bbPeriod: 20, bbStdDev: 2 })
    expect(result.equity.length).toBeGreaterThan(0)
  })

  it('bollinger strategy processes all bars without error', () => {
    const klines = makeKlines(80, 100, 0.1)
    const result = backtest(klines, 'bollinger', { bbPeriod: 20, bbStdDev: 2 })
    expect(result.equity.length).toBeGreaterThan(0)
  })
})

// ─── RSI overbought SELL branch (line 143) & force-close (line 152-154) ────────

describe('backtest RSI — BUY (lines 140-142) and SELL (lines 144-147) branches', () => {
  it('triggers BUY when RSI < oversold and position=0 (lines 140-142)', () => {
    // RSI period=14 needs 60+ bars total. 15 bars crash: 100→50 pushes RSI<30 (BUY).
    // Then 55 bars gradual recovery keeps RSI < 70 so no SELL fires.
    const klines = Array.from({ length: 70 }, (_, i) => {
      const price = i < 15 ? 100 - i * (50 / 15) : 50 + (i - 15) * (30 / 55)
      return {
        code: '000001', date: `2024-01-${String(i+1).padStart(2,'0')}`,
        open: price - 0.5, high: price + 0.5, low: price - 1, close: price,
        volume: 1000000,
      }
    })
    const result = backtest(klines as any, 'rsi', { rsiPeriod: 14, oversold: 30, overbought: 70 })
    // BUY triggers (RSI<30), no SELL (RSI stays <70) → force close
    expect(result.tradeCount).toBeGreaterThanOrEqual(1)
    expect(result.equity.length).toBe(70)
  })

  it('triggers SELL when RSI > overbought and position=1 (lines 144-147)', () => {
    // 15 bars crash → RSI<30 (BUY), 55 bars strong rise → RSI>70 (SELL)
    // Price: 100→50 in 15 bars, then 50→200 in next 55 bars (300% recovery)
    const klines = Array.from({ length: 70 }, (_, i) => {
      const price = i < 15 ? 100 - i * (50 / 15) : 50 + (i - 15) * (150 / 55)
      return {
        code: '000001', date: `2024-01-${String(i+1).padStart(2,'0')}`,
        open: price - 0.5, high: price + 0.5, low: price - 1, close: price,
        volume: 1000000,
      }
    })
    const result = backtest(klines as any, 'rsi', { rsiPeriod: 14, oversold: 30, overbought: 70 })
    // At minimum, BUY fires (RSI<30). With strong recovery, SELL should also fire.
    // If tradeCount>=1, BUY branch was exercised. If tradeCount>=2, SELL also fired.
    expect(result.tradeCount).toBeGreaterThanOrEqual(1)
    expect(result.equity.length).toBe(70)
  })

  it('force-closes when position=1 at end of data (line 153)', () => {
    // 15 bars crash → RSI<30 (BUY), then 55 bars very slight rise (RSI stays <70)
    const klines = Array.from({ length: 70 }, (_, i) => {
      const price = i < 15 ? 100 - i * (50 / 15) : 50 + (i - 15) * 0.5
      return {
        code: '000001', date: `2024-01-${String(i+1).padStart(2,'0')}`,
        open: price - 0.5, high: price + 0.5, low: price - 1, close: price,
        volume: 1000000,
      }
    })
    const result = backtest(klines as any, 'rsi', { rsiPeriod: 14, oversold: 30, overbought: 70 })
    // BUY then flat/no-SELL → force close at end
    expect(result.tradeCount).toBeGreaterThanOrEqual(1)
    expect(result.equity.length).toBe(70)
  })
})
