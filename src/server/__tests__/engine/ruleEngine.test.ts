import { describe, it, expect } from 'vitest'
import {
  extractNeededIndicators,
  evaluateCondition,
  getIndicatorValues,
  resolveVal,
  evaluateRules,
} from '../../engine/ruleEngine.js'
import type { Rule, Condition } from '../../../shared/types.js'
import type { MACDResult } from '../../indicators/index.js'

describe('extractNeededIndicators', () => {
  it('extracts indicators from rules', () => {
    const rules: Rule[] = [
      {
        id: '1',
        name: 'RSI Test',
        direction: 'BUY',
        conditions: [
          { indicator: 'RSI', operator: '<', value: 30 },
        ],
        action: 'BUY',
      } as any,
    ]
    const result = extractNeededIndicators(rules)
    expect(result.has('rsi')).toBe(true)
  })

  it('extracts multiple indicators', () => {
    const rules: Rule[] = [
      {
        id: '1',
        name: 'Multi',
        direction: 'BUY',
        conditions: [
          { indicator: 'RSI', operator: '<', value: 30 },
          { indicator: 'MACD', operator: '>', value: 0 },
        ],
        action: 'BUY',
      } as any,
    ]
    const result = extractNeededIndicators(rules)
    expect(result.has('rsi')).toBe(true)
    expect(result.has('macd')).toBe(true)
  })

  it('extracts string values as indicators', () => {
    const rules: Rule[] = [
      {
        id: '1',
        name: 'String Value',
        direction: 'BUY',
        conditions: [
          { indicator: 'MA5', operator: '>', value: 'MA10' },
        ],
        action: 'BUY',
      } as any,
    ]
    const result = extractNeededIndicators(rules)
    expect(result.has('ma5')).toBe(true)
    expect(result.has('ma10')).toBe(true)
  })

  it('handles empty rules', () => {
    expect(extractNeededIndicators([]).size).toBe(0)
  })
})

describe('evaluateCondition', () => {
  it('handles > operator', () => {
    expect(evaluateCondition(10, 5, 5, 2, '>')).toBe(true)
    expect(evaluateCondition(4, 5, 5, 2, '>')).toBe(false)
  })

  it('handles < operator', () => {
    expect(evaluateCondition(4, 5, 5, 2, '<')).toBe(true)
    expect(evaluateCondition(10, 5, 5, 2, '<')).toBe(false)
  })

  it('handles == operator with tolerance', () => {
    // abs(val - threshold) < 0.001
    expect(evaluateCondition(5.0005, 5, 5, 2, '==')).toBe(true)
    expect(evaluateCondition(5.001, 5, 5, 2, '==')).toBe(false) // 0.001 is NOT < 0.001
    expect(evaluateCondition(5.01, 5, 5, 2, '==')).toBe(false)
  })

  it('handles cross_above operator', () => {
    // prevVal <= prevThreshold && val > threshold
    // MA5 crosses above MA10: prev MA5(5) <= prev MA10(6) && current MA5(6) > current MA10(5)
    expect(evaluateCondition(6, 5, 5, 6, 'cross_above')).toBe(true)
    // When already above, no cross
    expect(evaluateCondition(7, 6, 5, 4, 'cross_above')).toBe(false)
    // When below but didn't cross
    expect(evaluateCondition(4, 5, 5, 6, 'cross_above')).toBe(false)
  })

  it('handles cross_below operator', () => {
    // prevVal >= prevThreshold && val < threshold
    // MA5 crosses below MA10: prev MA5(6) >= prev MA10(5) && current MA5(4) < current MA10(5)
    expect(evaluateCondition(4, 6, 5, 5, 'cross_below')).toBe(true)
    // When already below, no cross
    expect(evaluateCondition(3, 4, 5, 6, 'cross_below')).toBe(false)
    // When above but didn't cross
    expect(evaluateCondition(6, 5, 5, 4, 'cross_below')).toBe(false)
  })

  it('returns false for unknown operator', () => {
    expect(evaluateCondition(10, 5, 5, 2, 'unknown' as any)).toBe(false)
  })
})

describe('resolveVal', () => {
  it('returns number as-is', () => {
    expect(resolveVal(5, {})).toBe(5)
    expect(resolveVal(-3.14, {})).toBe(-3.14)
  })

  it('resolves string from values', () => {
    const values = { MA5: 100, MA10: 200 }
    expect(resolveVal('MA5', values)).toBe(100)
    expect(resolveVal('MA10', values)).toBe(200)
  })

  it('returns NaN for unknown string', () => {
    expect(resolveVal('UNKNOWN', { MA5: 100 })).toBeNaN()
  })
})

describe('getIndicatorValues', () => {
  it('returns indicator values at index', () => {
    const mas = {
      'MA5': [100, 101, 102],
      'MA10': [99, 100, 101],
      'MA20': [98, 99, 100],
      'MA60': [95, 96, 97],
    }
    const macd: MACDResult = {
      macd: [1, 2, 3],
      signal: [0.5, 1, 1.5],
      histogram: [0.5, 1, 1.5],
    }
    const rsi = [30, 35, 40]
    const closes = [100, 101, 102]

    const result = getIndicatorValues(1, mas, macd, rsi, closes)

    expect(result.ma5).toBe(101)
    expect(result.ma10).toBe(100)
    expect(result.ma20).toBe(99)
    expect(result.ma60).toBe(96)
    expect(result.macd).toBe(2)
    expect(result.macdSignal).toBe(1)
    expect(result.rsi).toBe(35)
    expect(result.close).toBe(101)
  })

  it('returns NaN for missing indicators', () => {
    const mas = { 'MA5': [100] }
    const macd: MACDResult = { macd: [], signal: [], histogram: [] }
    const rsi: number[] = []
    const closes: number[] = []

    const result = getIndicatorValues(0, mas, macd, rsi, closes)

    expect(result.ma5).toBe(100)
    expect(result.ma10).toBeNaN()
    expect(result.macd).toBeNaN()
    expect(result.rsi).toBeNaN()
  })
})

describe('evaluateRules', () => {
  const resolve = resolveVal

  it('evaluates rules and returns triggered actions', () => {
    const values = { RSI: 25, close: 100 }
    const prevValues = { RSI: 35, close: 98 }
    const rules: Rule[] = [
      {
        id: '1',
        name: 'RSI Oversold',
        direction: 'BUY',
        conditions: [
          { indicator: 'RSI', operator: '<', value: 30 },
        ],
        action: 'BUY',
      } as any,
    ]

    const signals = evaluateRules(values, prevValues, rules, resolve)
    expect(signals).toContain('BUY')
  })

  it('returns empty array when no rules trigger', () => {
    const values = { RSI: 50, close: 100 }
    const prevValues = { RSI: 35, close: 98 }
    const rules: Rule[] = [
      {
        id: '1',
        name: 'RSI Oversold',
        direction: 'BUY',
        conditions: [
          { indicator: 'RSI', operator: '<', value: 30 },
        ],
        action: 'BUY',
      } as any,
    ]

    const signals = evaluateRules(values, prevValues, rules, resolve)
    expect(signals).toEqual([])
  })

  it('requires all conditions to pass (AND logic)', () => {
    const values = { RSI: 25, MACD: 1 }
    const prevValues = { RSI: 35, MACD: -1 }
    const rules: Rule[] = [
      {
        id: '1',
        name: 'RSI + MACD',
        direction: 'BUY',
        conditions: [
          { indicator: 'RSI', operator: '<', value: 30 },
          { indicator: 'MACD', operator: '>', value: 0 },
        ],
        action: 'BUY',
      } as any,
    ]

    const signals = evaluateRules(values, prevValues, rules, resolve)
    expect(signals).toContain('BUY')
  })

  it('returns multiple actions if multiple rules trigger', () => {
    const values = { RSI: 25, MACD: 1 }
    const prevValues = { RSI: 35, MACD: -1 }
    const rules: Rule[] = [
      {
        id: '1',
        name: 'RSI',
        direction: 'BUY',
        conditions: [{ indicator: 'RSI', operator: '<', value: 30 }],
        action: 'BUY',
      } as any,
      {
        id: '2',
        name: 'MACD',
        direction: 'BUY',
        conditions: [{ indicator: 'MACD', operator: '>', value: 0 }],
        action: 'MACD_BUY',
      } as any,
    ]

    const signals = evaluateRules(values, prevValues, rules, resolve)
    expect(signals).toContain('BUY')
    expect(signals).toContain('MACD_BUY')
  })

  it('handles cross_above conditions', () => {
    const values = { MA5: 101, MA10: 100 }
    const prevValues = { MA5: 99, MA10: 100 }
    const rules: Rule[] = [
      {
        id: '1',
        name: 'Golden Cross',
        direction: 'BUY',
        conditions: [
          { indicator: 'MA5', operator: 'cross_above', value: 'MA10' },
        ],
        action: 'BUY',
      } as any,
    ]

    const signals = evaluateRules(values, prevValues, rules, resolve)
    expect(signals).toContain('BUY')
  })

  it('handles NaN values gracefully', () => {
    const values = { RSI: NaN, close: 100 }
    const prevValues = { RSI: NaN, close: 98 }
    const rules: Rule[] = [
      {
        id: '1',
        name: 'RSI',
        direction: 'BUY',
        conditions: [{ indicator: 'RSI', operator: '<', value: 30 }],
        action: 'BUY',
      } as any,
    ]

    const signals = evaluateRules(values, prevValues, rules, resolve)
    expect(signals).toEqual([])
  })
})
