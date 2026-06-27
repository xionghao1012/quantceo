import { describe, it, expect } from 'vitest'
import { runBacktest } from '../backtest/index.js'
import { evaluateRules } from '../engine/ruleEngine.js'
import type { KLine, Rule } from '@shared/types'

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

function identityResolve(val: number | string): number {
  return val as number
}

function resolveIndicator(val: number | string, values: Record<string, number>): number {
  if (typeof val === 'number') return val
  return values[val] ?? NaN
}

describe('evaluateRules', () => {
  it('returns BUY when cross_above triggers', () => {
    const prevValues = { ma5: 20, ma20: 25 }
    const values = { ma5: 30, ma20: 25 }
    const rules: Rule[] = [
      {
        type: 'cross',
        action: 'BUY',
        conditions: [{ indicator: 'ma5', operator: 'cross_above', value: 'ma20' }],
      },
    ]
    const result = evaluateRules(values, prevValues, rules, resolveIndicator)
    expect(result).toContain('BUY')
  })

  it('returns SELL when cross_below triggers', () => {
    const prevValues = { ma5: 30, ma20: 25 }
    const values = { ma5: 20, ma20: 25 }
    const rules: Rule[] = [
      {
        type: 'cross',
        action: 'SELL',
        conditions: [{ indicator: 'ma5', operator: 'cross_below', value: 'ma20' }],
      },
    ]
    const result = evaluateRules(values, prevValues, rules, resolveIndicator)
    expect(result).toContain('SELL')
  })

  it('does not trigger when no cross occurs', () => {
    const prevValues = { ma5: 20, ma20: 25 }
    const values = { ma5: 22, ma20: 24 }
    const rules: Rule[] = [
      {
        type: 'cross',
        action: 'BUY',
        conditions: [{ indicator: 'ma5', operator: 'cross_above', value: 'ma20' }],
      },
    ]
    const result = evaluateRules(values, prevValues, rules, resolveIndicator)
    expect(result).not.toContain('BUY')
  })

  it('triggers threshold > operator', () => {
    const values = { rsi: 80 }
    const prevValues = { rsi: 80 }
    const rules: Rule[] = [
      {
        type: 'threshold',
        action: 'SELL',
        conditions: [{ indicator: 'rsi', operator: '>', value: 70 }],
      },
    ]
    const result = evaluateRules(values, prevValues, rules, identityResolve)
    expect(result).toContain('SELL')
  })

  it('triggers threshold < operator', () => {
    const values = { rsi: 20 }
    const prevValues = { rsi: 20 }
    const rules: Rule[] = [
      {
        type: 'threshold',
        action: 'BUY',
        conditions: [{ indicator: 'rsi', operator: '<', value: 30 }],
      },
    ]
    const result = evaluateRules(values, prevValues, rules, identityResolve)
    expect(result).toContain('BUY')
  })

  it('does not trigger when threshold not met', () => {
    const values = { rsi: 50 }
    const prevValues = { rsi: 50 }
    const rules: Rule[] = [
      {
        type: 'threshold',
        action: 'BUY',
        conditions: [{ indicator: 'rsi', operator: '<', value: 30 }],
      },
    ]
    const result = evaluateRules(values, prevValues, rules, identityResolve)
    expect(result).not.toContain('BUY')
  })

  it('triggers equality with tolerance', () => {
    const values = { macd: 0.0005 }
    const prevValues = { macd: 0.0005 }
    const rules: Rule[] = [
      {
        type: 'threshold',
        action: 'BUY',
        conditions: [{ indicator: 'macd', operator: '==', value: 0 }],
      },
    ]
    const result = evaluateRules(values, prevValues, rules, identityResolve)
    expect(result).toContain('BUY')
  })

  it('returns empty array when no rules match', () => {
    const values = { ma5: 10, ma20: 30 }
    const prevValues = { ma5: 10, ma20: 30 }
    const rules: Rule[] = [
      {
        type: 'cross',
        action: 'BUY',
        conditions: [{ indicator: 'ma5', operator: 'cross_above', value: 'ma20' }],
      },
    ]
    const result = evaluateRules(values, prevValues, rules, resolveIndicator)
    expect(result).toHaveLength(0)
  })

  it('returns multiple signals from multiple rules', () => {
    const values = { ma5: 35, ma20: 25, rsi: 80 }
    const prevValues = { ma5: 20, ma20: 25, rsi: 80 }
    const rules: Rule[] = [
      {
        type: 'cross',
        action: 'BUY',
        conditions: [{ indicator: 'ma5', operator: 'cross_above', value: 'ma20' }],
      },
      {
        type: 'threshold',
        action: 'SELL',
        conditions: [{ indicator: 'rsi', operator: '>', value: 70 }],
      },
    ]
    const result = evaluateRules(values, prevValues, rules, resolveIndicator)
    expect(result).toContain('BUY')
    expect(result).toContain('SELL')
  })

  it('handles NaN values gracefully', () => {
    const values = { ma5: NaN, ma20: 25 }
    const prevValues = { ma5: NaN, ma20: 25 }
    const rules: Rule[] = [
      {
        type: 'cross',
        action: 'BUY',
        conditions: [{ indicator: 'ma5', operator: 'cross_above', value: 'ma20' }],
      },
    ]
    const result = evaluateRules(values, prevValues, rules, resolveIndicator)
    expect(result).not.toContain('BUY')
  })
})

describe('runBacktest', () => {
  it('returns valid backtest result structure', () => {
    const klines = makeKlines(Array.from({ length: 80 }, (_, i) => 100 + i))
    const rules: Rule[] = [
      {
        type: 'threshold',
        action: 'BUY',
        conditions: [{ indicator: 'ma5', operator: '>', value: 'ma20' }],
      },
    ]
    const req = { code: '000001', strategyId: '1', startDate: '2024-01-01', endDate: '2024-03-01', initialCapital: 100000 }
    const result = runBacktest(klines, req, rules)
    expect(result).toHaveProperty('totalReturn')
    expect(result).toHaveProperty('annualReturn')
    expect(result).toHaveProperty('sharpe')
    expect(result).toHaveProperty('maxDrawdown')
    expect(result).toHaveProperty('winRate')
    expect(result).toHaveProperty('tradeCount')
    expect(result).toHaveProperty('trades')
    expect(result).toHaveProperty('equity')
    expect(Array.isArray(result.trades)).toBe(true)
    expect(Array.isArray(result.equity)).toBe(true)
  })

  it('starts with 0 trades for flat price', () => {
    const klines = makeKlines(Array(80).fill(100))
    const rules: Rule[] = [
      {
        type: 'threshold',
        action: 'BUY',
        conditions: [{ indicator: 'ma5', operator: '>', value: 'ma20' }],
      },
    ]
    const req = { code: '000001', strategyId: '1', startDate: '2024-01-01', endDate: '2024-03-01', initialCapital: 100000 }
    const result = runBacktest(klines, req, rules)
    expect(result.tradeCount).toBe(0)
  })

  it('equity length equals klines length after warmup', () => {
    const klines = makeKlines(Array.from({ length: 70 }, (_, i) => 100 + i * 0.5))
    const rules: Rule[] = [
      {
        type: 'cross',
        action: 'BUY',
        conditions: [{ indicator: 'ma5', operator: 'cross_above', value: 'ma20' }],
      },
    ]
    const req = { code: '000001', strategyId: '1', startDate: '2024-01-01', endDate: '2024-03-01', initialCapital: 100000 }
    const result = runBacktest(klines, req, rules)
    // equity starts after warmup period (30 candles for MA20)
    expect(result.equity.length).toBe(klines.length - 30)
  })

  it('calculates non-zero totalReturn for trending price', () => {
    const klines = makeKlines(Array.from({ length: 70 }, (_, i) => 100 + i))
    const rules: Rule[] = [
      {
        type: 'cross',
        action: 'BUY',
        conditions: [{ indicator: 'ma5', operator: 'cross_above', value: 'ma20' }],
      },
    ]
    const req = { code: '000001', strategyId: '1', startDate: '2024-01-01', endDate: '2024-03-01', initialCapital: 100000 }
    const result = runBacktest(klines, req, rules)
    expect(result.totalReturn).not.toBeNaN()
  })
})
