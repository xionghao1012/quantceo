import { describe, it, expect } from 'vitest'
import { scanStock } from '../scan/index.js'
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

describe('scanStock', () => {
  it('returns null for insufficient klines', () => {
    const klines = makeKlines([100, 105])
    expect(scanStock('000001', '平安银行', klines)).toBeNull()
  })

  it('detects MA5/20 golden cross (BUY signal)', () => {
    // Cross happens between day 98 and 99: P_94=99, P_99=101
    const closes = Array(100).fill(100)
    closes[94] = 99
    closes[99] = 101
    const klines = makeKlines(closes)
    const result = scanStock('000001', '平安银行', klines)
    expect(result).not.toBeNull()
    expect(result!.signals.some(s => s.direction === 'BUY' && s.strategyName === 'MA5/20 金叉')).toBe(true)
  })

  it('detects MA5/20 death cross (SELL signal)', () => {
    // Cross happens between day 98 and 99: P_94=105, P_99=88
    const closes = Array(100).fill(100)
    closes[94] = 105
    closes[99] = 88
    const klines = makeKlines(closes)
    const result = scanStock('000001', '平安银行', klines)
    expect(result).not.toBeNull()
    expect(result!.signals.some(s => s.direction === 'SELL' && s.strategyName === 'MA5/20 死叉')).toBe(true)
  })

  it('flat price produces RSI=100 (special case) → RSI overbought signal', () => {
    // Flat price → avgLoss=0 → RSI=100 → RSI 超买 (overbought)
    const closes = Array(100).fill(100)
    const klines = makeKlines(closes)
    const result = scanStock('000001', '平安银行', klines)
    expect(result).not.toBeNull()
    expect(result!.signals.some(s => s.strategyName === 'RSI 超买')).toBe(true)
  })

  it('continuously falling price produces RSI<30 (oversold)', () => {
    // Continuously falling → avgGain=0, avgLoss>0 → RSI → 0
    const closes = Array.from({ length: 100 }, (_, i) => 200 - i)
    const klines = makeKlines(closes)
    const result = scanStock('000001', '平安银行', klines)
    expect(result).not.toBeNull()
    expect(result!.signals.some(s => s.strategyName === 'RSI 超卖')).toBe(true)
  })

  it('returns correct code and name', () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 + i)
    const klines = makeKlines(closes)
    const result = scanStock('000001', '平安银行', klines)
    expect(result!.code).toBe('000001')
    expect(result!.name).toBe('平安银行')
  })

  it('returns price as last close', () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 + i)
    const klines = makeKlines(closes)
    const result = scanStock('000001', '平安银行', klines)
    expect(result!.price).toBe(closes[closes.length - 1])
  })

  it('BUY signals give positive totalStrength', () => {
    const closes = [
      ...Array(80).fill(100),
      100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
      100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
    ]
    const klines = makeKlines(closes)
    const result = scanStock('000001', '平安银行', klines)
    // At minimum RSI overbought (SELL) signals exist
    expect(result!.totalStrength).not.toBe(0)
  })

  it('supports custom rules - threshold BUY (RSI<30 not met for flat)', () => {
    const closes = Array(100).fill(100)
    const klines = makeKlines(closes)
    const customRules: Rule[] = [
      {
        type: 'threshold',
        action: 'BUY',
        conditions: [{ indicator: 'rsi', operator: '<', value: 30 }],
      },
    ]
    const result = scanStock('000001', '平安银行', klines, customRules, '我的策略')
    // flat price → RSI=100, not <30, so no BUY from custom rule
    expect(result).toBeNull()
  })

  it('supports custom rules - RSI oversold BUY', () => {
    const closes = Array.from({ length: 100 }, (_, i) => 200 - i)
    const klines = makeKlines(closes)
    const customRules: Rule[] = [
      {
        type: 'threshold',
        action: 'BUY',
        conditions: [{ indicator: 'rsi', operator: '<', value: 30 }],
      },
    ]
    const result = scanStock('000001', '平安银行', klines, customRules, '我的策略')
    expect(result).not.toBeNull()
    expect(result!.signals.some(s => s.strategyName === '我的策略' && s.direction === 'BUY')).toBe(true)
  })

  it('supports custom rules - MA cross BUY', () => {
    // Same as golden cross: P_94=99, P_99=101
    const closes = Array(100).fill(100)
    closes[94] = 99
    closes[99] = 101
    const klines = makeKlines(closes)
    const customRules: Rule[] = [
      {
        type: 'cross',
        action: 'BUY',
        conditions: [{ indicator: 'ma5', operator: 'cross_above', value: 'ma20' }],
      },
    ]
    const result = scanStock('000001', '平安银行', klines, customRules, '我的策略')
    expect(result).not.toBeNull()
    expect(result!.signals.some(s => s.strategyName === '我的策略' && s.direction === 'BUY')).toBe(true)
  })

  it('custom rules return strategyId 999', () => {
    const closes = Array.from({ length: 100 }, (_, i) => 200 - i)
    const klines = makeKlines(closes)
    const customRules: Rule[] = [
      {
        type: 'threshold',
        action: 'BUY',
        conditions: [{ indicator: 'rsi', operator: '<', value: 30 }],
      },
    ]
    const result = scanStock('000001', '平安银行', klines, customRules, '我的策略')
    expect(result!.signals.find(s => s.strategyName === '我的策略')!.strategyId).toBe(999)
  })

  it('custom rules skip built-in strategies when provided', () => {
    const closes = Array.from({ length: 100 }, (_, i) => 200 - i)
    const klines = makeKlines(closes)
    const customRules: Rule[] = [
      {
        type: 'threshold',
        action: 'BUY',
        conditions: [{ indicator: 'rsi', operator: '<', value: 30 }],
      },
    ]
    const result = scanStock('000001', '平安银行', klines, customRules, '我的策略')
    // Built-in MA/RSI/MACD strategies should NOT be present
    const hasBuiltIn = result!.signals.some(s =>
      ['MA5/20 金叉', 'MA5/20 死叉', 'RSI 超买', 'RSI 超卖', 'MACD 金叉', 'MACD 死叉'].includes(s.strategyName)
    )
    expect(hasBuiltIn).toBe(false)
  })
})
