import { describe, it, expect } from 'vitest'
import {
  extractNeededIndicators,
  evaluateCondition,
  getIndicatorValues,
  resolveVal,
  evaluateRules,
} from '../engine/ruleEngine.js'
import type { Rule } from '@shared/types'
import type { MACDResult } from '../indicators/index.js'

describe('extractNeededIndicators', () => {
  it('extracts indicators from single rule with numeric threshold', () => {
    const rules: Rule[] = [
      {
        id: '1',
        action: 'BUY',
        conditions: [
          { indicator: 'RSI', operator: '<', value: 30 },
        ],
      } as any,
    ]
    const result = extractNeededIndicators(rules)
    expect(result.has('rsi')).toBe(true)
  })

  it('extracts indicators from single rule with string threshold', () => {
    const rules: Rule[] = [
      {
        id: '1',
        action: 'BUY',
        conditions: [
          { indicator: 'MACD', operator: 'cross_above', value: 'macdSignal' },
        ],
      } as any,
    ]
    const result = extractNeededIndicators(rules)
    expect(result.has('macd')).toBe(true)
    expect(result.has('macdsignal')).toBe(true)
  })

  it('extracts multiple indicators from multiple conditions', () => {
    const rules: Rule[] = [
      {
        id: '1',
        action: 'BUY',
        conditions: [
          { indicator: 'RSI', operator: '<', value: 30 },
          { indicator: 'MA20', operator: '>', value: 'close' },
        ],
      } as any,
    ]
    const result = extractNeededIndicators(rules)
    expect(result.has('rsi')).toBe(true)
    expect(result.has('ma20')).toBe(true)
    expect(result.has('close')).toBe(true)
  })

  it('extracts from multiple rules', () => {
    const rules: Rule[] = [
      {
        id: '1',
        action: 'BUY',
        conditions: [{ indicator: 'RSI', operator: '<', value: 30 }],
      } as any,
      {
        id: '2',
        action: 'SELL',
        conditions: [{ indicator: 'MACD', operator: 'cross_below', value: 'macdSignal' }],
      } as any,
    ]
    const result = extractNeededIndicators(rules)
    expect(result.has('rsi')).toBe(true)
    expect(result.has('macd')).toBe(true)
    expect(result.has('macdsignal')).toBe(true)
  })

  it('returns lowercase indicators', () => {
    const rules: Rule[] = [
      {
        id: '1',
        action: 'BUY',
        conditions: [{ indicator: 'MA5', operator: '>', value: 100 }],
      } as any,
    ]
    const result = extractNeededIndicators(rules)
    expect(result.has('ma5')).toBe(true)
    expect(result.has('MA5')).toBe(false)
  })

  it('returns empty set for empty rules array', () => {
    const result = extractNeededIndicators([])
    expect(result.size).toBe(0)
  })
})

describe('evaluateCondition', () => {
  describe('>', () => {
    it('returns true when val is greater than threshold', () => {
      expect(evaluateCondition(50, 40, 30, 20, '>')).toBe(true)
    })

    it('returns false when val is equal to threshold', () => {
      expect(evaluateCondition(30, 40, 30, 20, '>')).toBe(false)
    })

    it('returns false when val is less than threshold', () => {
      expect(evaluateCondition(20, 40, 30, 20, '>')).toBe(false)
    })

    it('works with negative numbers', () => {
      expect(evaluateCondition(-10, -20, -20, -30, '>')).toBe(true)
    })
  })

  describe('<', () => {
    it('returns true when val is less than threshold', () => {
      expect(evaluateCondition(20, 30, 30, 40, '<')).toBe(true)
    })

    it('returns false when val is equal to threshold', () => {
      expect(evaluateCondition(30, 20, 30, 40, '<')).toBe(false)
    })

    it('returns false when val is greater than threshold', () => {
      expect(evaluateCondition(40, 30, 30, 40, '<')).toBe(false)
    })
  })

  describe('==', () => {
    it('returns true when val equals threshold within epsilon', () => {
      expect(evaluateCondition(30.0005, 40, 30, 40, '==')).toBe(true)
    })

    it('returns true when val equals threshold exactly', () => {
      expect(evaluateCondition(30, 40, 30, 40, '==')).toBe(true)
    })

    it('returns false when val differs beyond epsilon', () => {
      expect(evaluateCondition(30.01, 40, 30, 40, '==')).toBe(false)
    })
  })

  describe('cross_above', () => {
    it('returns true when val crosses above threshold', () => {
      // prevVal <= prevThreshold AND val > threshold
      expect(evaluateCondition(35, 25, 30, 30, 'cross_above')).toBe(true)
    })

    it('returns true when val was below and crosses to above', () => {
      expect(evaluateCondition(31, 29, 30, 30, 'cross_above')).toBe(true)
    })

    it('returns false when val was already above threshold', () => {
      expect(evaluateCondition(35, 35, 30, 30, 'cross_above')).toBe(false)
    })

    it('returns false when val was above and stays above', () => {
      expect(evaluateCondition(40, 35, 30, 30, 'cross_above')).toBe(false)
    })

    it('returns false when val crosses below threshold', () => {
      expect(evaluateCondition(25, 35, 30, 30, 'cross_above')).toBe(false)
    })
  })

  describe('cross_below', () => {
    it('returns true when val crosses below threshold', () => {
      // prevVal >= prevThreshold AND val < threshold
      expect(evaluateCondition(25, 35, 30, 30, 'cross_below')).toBe(true)
    })

    it('returns true when val was above and crosses to below', () => {
      expect(evaluateCondition(29, 31, 30, 30, 'cross_below')).toBe(true)
    })

    it('returns false when val was already below threshold', () => {
      expect(evaluateCondition(25, 25, 30, 30, 'cross_below')).toBe(false)
    })

    it('returns false when val was below and stays below', () => {
      expect(evaluateCondition(20, 25, 30, 30, 'cross_below')).toBe(false)
    })

    it('returns false when val crosses above threshold', () => {
      expect(evaluateCondition(35, 25, 30, 30, 'cross_below')).toBe(false)
    })
  })

  it('returns false for unknown operator', () => {
    expect(evaluateCondition(50, 40, 30, 20, 'unknown' as any)).toBe(false)
  })
})

describe('getIndicatorValues', () => {
  const emptyMacd: MACDResult = { macd: [], signal: [], histogram: [] }
  const emptyMas: Record<string, number[]> = {}
  const emptyCloses: number[] = []

  it('returns NaN for all indicators when arrays are empty', () => {
    const result = getIndicatorValues(0, emptyMas, emptyMacd, [], [])
    expect(Object.values(result).every(v => Number.isNaN(v))).toBe(true)
  })

  it('returns present values when indices exist', () => {
    const mas = { MA5: [10, 20, 30], MA10: [15, 25, 35] }
    const macd: MACDResult = { macd: [1, 2, 3], signal: [0.5, 1.5, 2.5], histogram: [0.5, 0.5, 0.5] }
    const rsi = [70, 65, 60]
    const closes = [100, 101, 102]

    const result = getIndicatorValues(1, mas, macd, rsi, closes)

    expect(result.ma5).toBe(20)
    expect(result.ma10).toBe(25)
    expect(result.macd).toBe(2)
    expect(result.macdSignal).toBe(1.5)
    expect(result.macdHistogram).toBe(0.5)
    expect(result.rsi).toBe(65)
    expect(result.close).toBe(101)
  })

  it('returns NaN for missing MAs while others are present', () => {
    const mas = { MA5: [10, 20, 30] }
    const macd: MACDResult = { macd: [1, 2, 3], signal: [0.5, 1.5, 2.5], histogram: [0.5, 0.5, 0.5] }
    const rsi = [70, 65, 60]
    const closes = [100, 101, 102]

    const result = getIndicatorValues(1, mas, macd, rsi, closes)

    expect(result.ma5).toBe(20)
    expect(Number.isNaN(result.ma10)).toBe(true)
    expect(Number.isNaN(result.ma20)).toBe(true)
    expect(Number.isNaN(result.ma60)).toBe(true)
  })

  it('returns NaN for out-of-range index', () => {
    const mas = { MA5: [10, 20, 30] }
    const macd: MACDResult = { macd: [1, 2, 3], signal: [0.5, 1.5, 2.5], histogram: [0.5, 0.5, 0.5] }
    const rsi = [70, 65, 60]
    const closes = [100, 101, 102]

    const result = getIndicatorValues(100, mas, macd, rsi, closes)

    expect(Number.isNaN(result.ma5)).toBe(true)
    expect(Number.isNaN(result.macd)).toBe(true)
    expect(Number.isNaN(result.rsi)).toBe(true)
    expect(Number.isNaN(result.close)).toBe(true)
  })
})

describe('resolveVal', () => {
  it('returns the number directly when val is a number', () => {
    expect(resolveVal(30, {})).toBe(30)
  })

  it('returns negative numbers correctly', () => {
    expect(resolveVal(-20, {})).toBe(-20)
  })

  it('returns zero correctly', () => {
    expect(resolveVal(0, {})).toBe(0)
  })

  it('returns the value from values map when val is a string', () => {
    const values = { macdSignal: 25.5 }
    expect(resolveVal('macdSignal', values)).toBe(25.5)
  })

  it('returns NaN when string key is not in values', () => {
    const values = { otherIndicator: 25.5 }
    expect(Number.isNaN(resolveVal('macdSignal', values))).toBe(true)
  })

  it('returns NaN for empty values map with string val', () => {
    expect(Number.isNaN(resolveVal('close', {}))).toBe(true)
  })
})

describe('evaluateRules', () => {
  const defaultResolve = resolveVal

  it('returns signals from triggered rules', () => {
    const values = { RSI: 25, close: 100 }
    const prevValues = { RSI: 35, close: 99 }
    const rules: Rule[] = [
      {
        id: '1',
        action: 'BUY',
        conditions: [{ indicator: 'RSI', operator: '<', value: 30 }],
      } as any,
    ]

    const signals = evaluateRules(values, prevValues, rules, defaultResolve)
    expect(signals).toEqual(['BUY'])
  })

  it('returns empty array when no rules triggered', () => {
    const values = { rsi: 35, close: 100 }
    const prevValues = { rsi: 25, close: 99 }
    const rules: Rule[] = [
      {
        id: '1',
        action: 'BUY',
        conditions: [{ indicator: 'RSI', operator: '<', value: 30 }],
      } as any,
    ]

    const signals = evaluateRules(values, prevValues, rules, defaultResolve)
    expect(signals).toEqual([])
  })

  it('returns multiple signals when multiple rules triggered', () => {
    const values = { RSI: 25, MACD: 2, macdSignal: 1 }
    const prevValues = { RSI: 35, MACD: 0.5, macdSignal: 1.5 }
    const rules: Rule[] = [
      {
        id: '1',
        action: 'BUY',
        conditions: [{ indicator: 'RSI', operator: '<', value: 30 }],
      } as any,
      {
        id: '2',
        action: 'STRONG_BUY',
        conditions: [{ indicator: 'MACD', operator: 'cross_above', value: 'macdSignal' }],
      } as any,
    ]

    const signals = evaluateRules(values, prevValues, rules, defaultResolve)
    expect(signals).toEqual(['BUY', 'STRONG_BUY'])
  })

  it('requires all conditions to be true for rule trigger', () => {
    const values = { RSI: 25, MA20: 105 }
    const prevValues = { RSI: 35, MA20: 95 }
    const rules: Rule[] = [
      {
        id: '1',
        action: 'BUY',
        conditions: [
          { indicator: 'RSI', operator: '<', value: 30 },
          { indicator: 'MA20', operator: '>', value: 100 },
        ],
      } as any,
    ]

    const signals = evaluateRules(values, prevValues, rules, defaultResolve)
    expect(signals).toEqual(['BUY'])
  })

  it('does not trigger when one condition fails', () => {
    const values = { RSI: 35, MA20: 105 }
    const prevValues = { RSI: 25, MA20: 95 }
    const rules: Rule[] = [
      {
        id: '1',
        action: 'BUY',
        conditions: [
          { indicator: 'RSI', operator: '<', value: 30 },
          { indicator: 'MA20', operator: '>', value: 100 },
        ],
      } as any,
    ]

    const signals = evaluateRules(values, prevValues, rules, defaultResolve)
    expect(signals).toEqual([])
  })

  it('returns empty array for empty rules', () => {
    const values = { rsi: 25 }
    const prevValues = { rsi: 35 }

    const signals = evaluateRules(values, prevValues, [], defaultResolve)
    expect(signals).toEqual([])
  })

  it('does not trigger when current value is NaN', () => {
    const values = { RSI: NaN, close: 100 }
    const prevValues = { RSI: 35, close: 99 }
    const rules: Rule[] = [
      {
        id: '1',
        action: 'BUY',
        conditions: [{ indicator: 'RSI', operator: '<', value: 30 }],
      } as any,
    ]

    const signals = evaluateRules(values, prevValues, rules, defaultResolve)
    expect(signals).toEqual([])
  })

  it('does not trigger when previous value is NaN', () => {
    const values = { RSI: 25, close: 100 }
    const prevValues = { RSI: NaN, close: 99 }
    const rules: Rule[] = [
      {
        id: '1',
        action: 'BUY',
        conditions: [{ indicator: 'RSI', operator: '<', value: 30 }],
      } as any,
    ]

    const signals = evaluateRules(values, prevValues, rules, defaultResolve)
    expect(signals).toEqual([])
  })

  it('does not trigger when threshold is NaN', () => {
    const values = { RSI: 25, close: NaN }
    const prevValues = { RSI: 35, close: 99 }
    const rules: Rule[] = [
      {
        id: '1',
        action: 'BUY',
        conditions: [{ indicator: 'RSI', operator: '<', value: 'close' }],
      } as any,
    ]

    const signals = evaluateRules(values, prevValues, rules, defaultResolve)
    expect(signals).toEqual([])
  })

  it('does not trigger when previous threshold is NaN', () => {
    const values = { RSI: 25, close: 100 }
    const prevValues = { RSI: 35, close: NaN }
    const rules: Rule[] = [
      {
        id: '1',
        action: 'BUY',
        conditions: [{ indicator: 'RSI', operator: '<', value: 'close' }],
      } as any,
    ]

    const signals = evaluateRules(values, prevValues, rules, defaultResolve)
    expect(signals).toEqual([])
  })

  it('uses custom resolve function', () => {
    const values = { RSI: 25 }
    const prevValues = { RSI: 35 }
    const customResolve = (val: number | string) => 29
    const rules: Rule[] = [
      {
        id: '1',
        action: 'BUY',
        conditions: [{ indicator: 'RSI', operator: '<', value: 30 }],
      } as any,
    ]

    const signals = evaluateRules(values, prevValues, rules, customResolve)
    expect(signals).toEqual(['BUY'])
  })

  it('handles cross_above operator correctly', () => {
    const values = { MACD: 2.5, macdSignal: 2.0 }
    const prevValues = { MACD: 1.5, macdSignal: 2.0 }
    const rules: Rule[] = [
      {
        id: '1',
        action: 'BUY',
        conditions: [{ indicator: 'MACD', operator: 'cross_above', value: 'macdSignal' }],
      } as any,
    ]

    const signals = evaluateRules(values, prevValues, rules, defaultResolve)
    expect(signals).toEqual(['BUY'])
  })

  it('handles cross_below operator correctly', () => {
    const values = { MACD: 1.5, macdSignal: 2.0 }
    const prevValues = { MACD: 2.5, macdSignal: 2.0 }
    const rules: Rule[] = [
      {
        id: '1',
        action: 'SELL',
        conditions: [{ indicator: 'MACD', operator: 'cross_below', value: 'macdSignal' }],
      } as any,
    ]

    const signals = evaluateRules(values, prevValues, rules, defaultResolve)
    expect(signals).toEqual(['SELL'])
  })
})
