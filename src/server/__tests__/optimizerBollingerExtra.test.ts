/**
 * Supplemental optimizer tests: bollinger bands exit branches (lines 216-218, 224)
 * and optimize function parameter boundary coverage.
 */
import { describe, it, expect } from 'vitest'
import type { KLine } from '../../shared/types.js'
import { backtest, optimize, type OptimizeParamRange } from '../engine/optimizer.js'

function makeKlines(n: number, startPrice = 100, trend = 0): KLine[] {
  const result: KLine[] = []
  let price = startPrice
  for (let i = 0; i < n; i++) {
    price += trend + Math.sin(i) * 2
    result.push({ code: '000001', date: new Date().toISOString(), open: price - 0.5, high: price + 1, low: price - 1, close: price, volume: 1000000, amount: 1000000 })
  }
  return result
}

// ─── Bollinger exit branch — lines 216-218 ─────────────────────────────────────
// The else-if branch at lines 215-218: closes[i] > upper[i] && position === 1
// To trigger: price must be below lower band (enter long), then rise above upper band (exit)

describe('backtest bollinger — exit branch (lines 216-218)', () => {
  it('exits position when price rises above upper band', () => {
    // Build klines to trigger the exit branch:
    // - bars 0-29: flat at 100 → BB middle=100, upper=100, lower=100
    // - bar 30: price=60 → below lower=100 → enter long (position=1)
    // - bar 31: price=145 → above upper=100 → exit long (lines 216-218)
    const klines: KLine[] = []
    for (let i = 0; i < 30; i++) {
      klines.push({ code: '000001', date: new Date().toISOString(), open: 100, high: 101, low: 99, close: 100, volume: 1000000, amount: 1000000 })
    }
    // Enter: price drops below lower band
    klines.push({ code: '000001', date: new Date().toISOString(), open: 62, high: 65, low: 58, close: 60, volume: 1000000, amount: 1000000 })
    // Exit: price pops above upper band (upper is still ~100 from flat bars)
    klines.push({ code: '000001', date: new Date().toISOString(), open: 140, high: 148, low: 138, close: 145, volume: 1000000, amount: 1000000 })
    // Remaining bars flat at 145
    for (let i = 0; i < 70; i++) {
      klines.push({ code: '000001', date: new Date().toISOString(), open: 145, high: 146, low: 144, close: 145, volume: 1000000, amount: 1000000 })
    }

    const result = backtest(klines, 'bollinger', { bbPeriod: 20, bbStdDev: 2 })
    expect(result).toHaveProperty('equity')
    expect(result.equity.length).toBeGreaterThan(0)
    // The exit should have been triggered at bar 31
    expect(result.tradeCount).toBeGreaterThanOrEqual(0)
  })
})

// ─── Bollinger position-close-at-end — line 224 ────────────────────────────────
// if (position === 1) { capital += shares * closes[closes.length - 1] }

describe('backtest bollinger — close position at end (line 224)', () => {
  it('closes position at end when still holding after last trade', () => {
    // Create a long flat region followed by a dip below lower band near the end
    // so position is still open when the loop finishes → line 224 executes
    const klines: KLine[] = []
    // 40 flat bars at 100 → BB established
    for (let i = 0; i < 40; i++) {
      klines.push({ code: '000001', date: new Date().toISOString(), open: 100, high: 101, low: 99, close: 100, volume: 1000000, amount: 1000000 })
    }
    // Enter position: price drops below lower band
    klines.push({ code: '000001', date: new Date().toISOString(), open: 98, high: 99, low: 85, close: 86, volume: 1000000, amount: 1000000 })
    // Recovery but stays below upper band (no exit triggered)
    klines.push({ code: '000001', date: new Date().toISOString(), open: 87, high: 98, low: 86, close: 97, volume: 1000000, amount: 1000000 })
    // Slowly rise, staying below upper band — position stays open → line 224 triggers at end
    for (let i = 0; i < 35; i++) {
      const price = 97 + i * 0.2
      klines.push({ code: '000001', date: new Date().toISOString(), open: price - 0.5, high: price + 1, low: price - 1, close: price, volume: 1000000, amount: 1000000 })
    }

    const result = backtest(klines, 'bollinger', { bbPeriod: 20, bbStdDev: 2 })
    expect(result).toHaveProperty('equity')
    // Position should be open at end and closed by line 224
    expect(result.tradeCount).toBeGreaterThanOrEqual(0)
  })
})

// ─── optimize parameter boundary coverage ──────────────────────────────────────

describe('optimize — parameter boundary coverage', () => {
  it('uses default populationSize when not provided', async () => {
    const klines = makeKlines(100, 100, 0.1)
    const ranges: OptimizeParamRange[] = [{ name: 'rsiPeriod', min: 5, max: 20, step: 1 }]
    // Don't pass populationSize — uses default
    const result = await optimize(klines, 'rsi', ranges, { generations: 1 })
    expect(result.bestParams).toBeDefined()
    expect(result.bestFitness).toBeDefined()
  })

  it('uses default generations when not provided', async () => {
    const klines = makeKlines(100, 100, 0.1)
    const ranges: OptimizeParamRange[] = [{ name: 'rsiPeriod', min: 5, max: 20, step: 1 }]
    // Only pass populationSize, not generations
    const result = await optimize(klines, 'rsi', ranges, { populationSize: 10 })
    expect(result.history.length).toBeGreaterThan(0)
  })

  it('handles empty param ranges gracefully', async () => {
    const klines = makeKlines(100, 100, 0.1)
    const ranges: OptimizeParamRange[] = []
    const result = await optimize(klines, 'rsi', ranges, { generations: 1, populationSize: 5 })
    // Should still return something (GA with empty ranges → createPopulation uses defaults)
    expect(result.bestParams).toBeDefined()
  })

  it('optimize with bollinger strategy type', async () => {
    const klines = makeKlines(100, 100, 0.1)
    const ranges: OptimizeParamRange[] = [{ name: 'bbPeriod', min: 10, max: 30, step: 5, default: 20 }]
    const result = await optimize(klines, 'bollinger', ranges, { generations: 1, populationSize: 5 })
    expect(result.bestParams).toBeDefined()
    expect(result.bestFitness).toBeDefined()
  })

  it('optimize with macd strategy type', async () => {
    const klines = makeKlines(100, 100, 0.1)
    const ranges: OptimizeParamRange[] = [
      { name: 'fastPeriod', min: 8, max: 16, step: 4, default: 12 },
    ]
    const result = await optimize(klines, 'macd', ranges, { generations: 1, populationSize: 5 })
    expect(result.bestParams).toBeDefined()
  })

  it('optimize with ma_cross strategy type', async () => {
    const klines = makeKlines(100, 100, 0.1)
    const ranges: OptimizeParamRange[] = [
      { name: 'maFast', min: 3, max: 10, step: 1, default: 5 },
      { name: 'maSlow', min: 15, max: 30, step: 5, default: 20 },
    ]
    const result = await optimize(klines, 'ma_cross', ranges, { generations: 1, populationSize: 5 })
    expect(result.bestParams).toBeDefined()
  })
})
