import { describe, it, expect } from 'vitest'

// ─── Pure functions extracted from riskManagement.ts ─────────────────────────────

function kellyFraction(winRate: number, avgWin: number, avgLoss: number): number {
  if (avgLoss === 0) return 0.25
  const b = avgWin / Math.abs(avgLoss)
  const p = winRate / 100
  const q = 1 - p
  const k = (p * b - q) / b
  return Math.max(0, Math.min(0.25, k))
}

function calcVaRHistorical(returns: number[], confidenceLevel: number, holdingDays: number) {
  if (returns.length === 0) return { varValue: 0, cvarValue: 0 }
  const sorted = [...returns].sort((a, b) => a - b)
  const idx = Math.floor(sorted.length * (1 - confidenceLevel / 100))
  const varValue = sorted[idx] * Math.sqrt(holdingDays)
  const tail = sorted.slice(0, idx + 1)
  const cvarValue = tail.reduce((a, b) => a + b, 0) / tail.length * Math.sqrt(holdingDays)
  return { varValue, cvarValue }
}

function calcVaRParametric(returns: number[], confidenceLevel: number, holdingDays: number) {
  if (returns.length === 0) return { varValue: 0, cvarValue: 0 }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length
  const std = Math.sqrt(variance)
  const zScore = confidenceLevel === 99 ? 2.326 : confidenceLevel === 95 ? 1.645 : 1.282
  const varValue = (mean - zScore * std) * Math.sqrt(holdingDays)
  const cvarValue = varValue * 1.25
  return { varValue, cvarValue }
}

function calcMaxDrawdown(closes: number[]): { maxDD: number; ddStart: number; ddEnd: number; recoveryDays: number } {
  if (closes.length === 0) return { maxDD: 0, ddStart: 0, ddEnd: 0, recoveryDays: 0 }
  let peak = closes[0]
  let maxDD = 0
  let ddStart = 0, ddEnd = 0
  let currentPeak = 0

  for (let i = 0; i < closes.length; i++) {
    if (closes[i] > peak) { peak = closes[i]; currentPeak = i }
    const dd = (peak - closes[i]) / peak * 100
    if (dd > maxDD && dd > 0.1) {
      maxDD = dd
      ddStart = currentPeak
      ddEnd = i
    }
  }

  let recoveryDays = 0
  for (let i = ddEnd; i < closes.length; i++) {
    if (closes[i] >= closes[ddStart]) { recoveryDays = i - ddEnd; break }
  }

  return { maxDD, ddStart, ddEnd, recoveryDays }
}

function calcATR(klines: { high: number; low: number; close: number }[], multiplier: number): number {
  if (klines.length < 3) return 0
  let atr = 0
  for (let i = 2; i < klines.length; i++) {
    const high = klines[i].high, low = klines[i].low
    const prevClose = klines[i - 1].close
    atr += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
  }
  atr /= (klines.length - 2)
  return atr * multiplier
}

function calcVolatilityStopLoss(closes: number[], volatilityPercent: number): number {
  const returns: number[] = []
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]))
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length
  const vol = Math.sqrt(variance * 252)
  return closes[closes.length - 1] * (1 - vol * volatilityPercent / 100)
}

function calcRiskScore(volatility: number, rsi: number): number {
  return ((volatility * 100 + (100 - Math.min(100, Math.max(0, rsi))) / 2) / 150)
}

function calcMASupportStopLoss(closes: number[]): number {
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20
  return ma20 * 0.98
}

function calcRecentLowStopLoss(klines: { low: number }[]): number {
  const lows = klines.slice(-20).map(k => k.low)
  return Math.min(...lows) * 0.99
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('kellyFraction', () => {
  it('returns 0.25 when avgLoss is 0', () => {
    expect(kellyFraction(60, 3, 0)).toBe(0.25)
  })

  it('calculates positive kelly for favorable odds', () => {
    const k = kellyFraction(60, 3, 2)
    expect(k).toBeGreaterThan(0)
    expect(k).toBeLessThanOrEqual(0.25)
  })

  it('returns 0 when kelly is negative (unfavorable odds)', () => {
    const k = kellyFraction(30, 2, 3)
    expect(k).toBe(0)
  })

  it('caps at 0.25', () => {
    const k = kellyFraction(90, 10, 1)
    expect(k).toBe(0.25)
  })

  it('handles edge case: zero winRate', () => {
    expect(kellyFraction(0, 3, 2)).toBe(0)
  })

  it('handles 100% winRate', () => {
    const k = kellyFraction(100, 3, 2)
    expect(k).toBe(0.25)
  })

  it('handles equal win/loss at 50% winRate', () => {
    const k = kellyFraction(50, 2, 2)
    expect(k).toBe(0)
  })

  it('handles avgLoss close to 0 with small positive kelly', () => {
    // Very small loss: b = 3/0.001 = 3000, p = 0.6, q = 0.4
    // k = (0.6*3000 - 0.4)/3000 = (1800 - 0.4)/3000 ≈ 0.5999 → capped at 0.25
    expect(kellyFraction(60, 3, 0.001)).toBe(0.25)
  })
})

describe('calcVaRHistorical', () => {
  it('returns zeros for empty returns', () => {
    const result = calcVaRHistorical([], 95, 1)
    expect(result.varValue).toBe(0)
    expect(result.cvarValue).toBe(0)
  })

  it('calculates VaR at 95% confidence', () => {
    const returns = [-0.05, -0.04, -0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.04,
                     -0.06, -0.07, -0.08, -0.09, -0.10, 0.05, 0.06, 0.07, 0.08, 0.09]
    const result = calcVaRHistorical(returns, 95, 1)
    expect(result.varValue).toBeLessThan(0)
    expect(result.cvarValue).toBeLessThanOrEqual(result.varValue)
  })

  it('VaR scales with sqrt of holding days', () => {
    const returns = [-0.05, -0.04, -0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.04]
    const var1 = calcVaRHistorical(returns, 95, 1)
    const var4 = calcVaRHistorical(returns, 95, 4)
    expect(var4.varValue).toBeCloseTo(var1.varValue * 2, 1)
  })

  it('VaR is more negative at higher confidence', () => {
    const returns = Array.from({ length: 100 }, (_, i) => (Math.random() - 0.5) * 0.1)
    const var95 = calcVaRHistorical(returns, 95, 1)
    const var99 = calcVaRHistorical(returns, 99, 1)
    expect(var99.varValue).toBeLessThan(var95.varValue)
  })

  it('VaR with single return value', () => {
    const result = calcVaRHistorical([0.05], 95, 1)
    expect(result.varValue).toBe(0.05)
  })
})

describe('calcVaRParametric', () => {
  it('returns zeros for empty returns', () => {
    const result = calcVaRParametric([], 95, 1)
    expect(result.varValue).toBe(0)
  })

  it('VaR is more negative at 99% than 95%', () => {
    const returns = Array.from({ length: 100 }, (_, i) => (Math.random() - 0.5) * 0.1)
    const var95 = calcVaRParametric(returns, 95, 1)
    const var99 = calcVaRParametric(returns, 99, 1)
    expect(var99.varValue).toBeLessThan(var95.varValue)
  })

  it('CVaR is 1.25x VaR', () => {
    const returns = Array.from({ length: 100 }, (_, i) => (Math.random() - 0.5) * 0.1)
    const result = calcVaRParametric(returns, 95, 1)
    expect(result.cvarValue).toBeCloseTo(result.varValue * 1.25, 5)
  })

  it('returns 0 for zero-variance returns', () => {
    const returns = Array(50).fill(0.01)
    const result = calcVaRParametric(returns, 95, 1)
    expect(result.varValue).toBeCloseTo(0.01, 4)
  })

  it('handles holding days > 1', () => {
    const returns = Array.from({ length: 100 }, (_, i) => 0.001 * (Math.random()))
    const var1 = calcVaRParametric(returns, 95, 1)
    const var4 = calcVaRParametric(returns, 95, 4)
    expect(Math.abs(var4.varValue)).toBeGreaterThan(Math.abs(var1.varValue))
  })
})

describe('calcMaxDrawdown', () => {
  it('returns 0 for monotonic increase', () => {
    const closes = [100, 105, 110, 115]
    const result = calcMaxDrawdown(closes)
    expect(result.maxDD).toBe(0)
    expect(result.recoveryDays).toBe(0)
  })

  it('detects drawdown from peak', () => {
    const closes = [100, 120, 105, 102, 108, 115]
    const result = calcMaxDrawdown(closes)
    expect(result.maxDD).toBeGreaterThan(0)
    expect(result.ddStart).toBeGreaterThan(0)
  })

  it('returns 0 for single price', () => {
    const result = calcMaxDrawdown([100])
    expect(result.maxDD).toBe(0)
  })

  it('calculates recovery days after trough', () => {
    const closes = [100, 120, 80, 90, 100, 125]
    const result = calcMaxDrawdown(closes)
    expect(result.recoveryDays).toBeGreaterThan(0)
  })

  it('returns 0 for empty array', () => {
    const result = calcMaxDrawdown([])
    expect(result.maxDD).toBe(0)
  })

  it('detects no drawdown for flat prices', () => {
    const closes = Array(10).fill(100)
    const result = calcMaxDrawdown(closes)
    expect(result.maxDD).toBe(0)
  })

  it('detects deepest drawdown correctly', () => {
    // Peak at 0: 100, Trough at 3: 60, MaxDD = (100-60)/100 = 40%
    const closes = [100, 95, 80, 60, 70, 85, 90, 100]
    const result = calcMaxDrawdown(closes)
    expect(result.maxDD).toBeCloseTo(40, 1)
  })

  it('recovery days is 0 when price never recovers', () => {
    const closes = [100, 120, 80, 70, 65, 60]
    const result = calcMaxDrawdown(closes)
    expect(result.recoveryDays).toBe(0)
  })
})

describe('calcATR', () => {
  it('returns 0 for insufficient klines', () => {
    expect(calcATR([{ high: 10, low: 9, close: 9.5 }], 2)).toBe(0)
    expect(calcATR([{ high: 10, low: 9, close: 9.5 }, { high: 11, low: 10, close: 10.5 }], 2)).toBe(0)
  })

  it('calculates ATR with multiplier', () => {
    const klines = [
      { high: 10, low: 9, close: 9.5 },
      { high: 11, low: 9.5, close: 10 },
      { high: 12, low: 10, close: 11 },
      { high: 13, low: 11, close: 12 },
    ]
    expect(calcATR(klines, 2)).toBeGreaterThan(0)
  })

  it('ATR increases with larger multiplier', () => {
    const klines = [
      { high: 10, low: 9, close: 9.5 },
      { high: 11, low: 9.5, close: 10 },
      { high: 12, low: 10, close: 11 },
      { high: 13, low: 11, close: 12 },
      { high: 14, low: 12, close: 13 },
    ]
    expect(calcATR(klines, 3)).toBeGreaterThan(calcATR(klines, 2))
  })
})

describe('calcVolatilityStopLoss', () => {
  it('returns stop below current price for trending up data', () => {
    const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
                    110, 111, 112, 113, 114, 115, 116, 117, 118, 119]
    const stop = calcVolatilityStopLoss(closes, 2)
    expect(stop).toBeLessThan(closes[closes.length - 1])
  })

  it('returns current price for zero volatility', () => {
    const closes = Array(20).fill(100)
    expect(calcVolatilityStopLoss(closes, 2)).toBe(100)
  })

  it('returns higher stop for lower volatility', () => {
    const lowVolCloses = Array.from({ length: 20 }, (_, i) => 100 + Math.sin(i / 2) * 0.5)
    const highVolCloses = Array.from({ length: 20 }, (_, i) => 100 + Math.sin(i / 2) * 5)
    const lowStop = calcVolatilityStopLoss(lowVolCloses, 2)
    const highStop = calcVolatilityStopLoss(highVolCloses, 2)
    expect(lowStop).toBeGreaterThan(highStop)
  })
})

describe('calcRiskScore', () => {
  it('returns value between 0 and 1 typically', () => {
    const score = calcRiskScore(0.02, 50)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  it('increases with volatility', () => {
    expect(calcRiskScore(0.05, 50)).toBeGreaterThan(calcRiskScore(0.01, 50))
  })

  it('decreases with high RSI (overbought)', () => {
    expect(calcRiskScore(0.02, 80)).toBeLessThan(calcRiskScore(0.02, 20))
  })

  it('handles RSI at 0 (most oversold)', () => {
    // At RSI=0, the rsi component is (100-0)/2 = 50
    // RiskScore = (vol*100 + 50) / 150 = (2+50)/150 ≈ 0.35
    const score = calcRiskScore(0.02, 0)
    expect(score).toBeGreaterThan(0.3)
  })

  it('handles RSI at 100 (most overbought)', () => {
    const score = calcRiskScore(0.02, 100)
    expect(score).toBeLessThan(0.1)
  })
})

describe('calcMASupportStopLoss', () => {
  it('returns MA20 * 0.98 as stop price', () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 + i)
    const stop = calcMASupportStopLoss(closes)
    const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20
    expect(stop).toBeCloseTo(ma20 * 0.98, 5)
  })

  it('handles exactly 20 closes', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i * 2)
    const stop = calcMASupportStopLoss(closes)
    const ma20 = closes.reduce((a, b) => a + b, 0) / 20
    expect(stop).toBeCloseTo(ma20 * 0.98, 5)
  })
})

describe('calcRecentLowStopLoss', () => {
  it('returns 0.99 * minimum of last 20 lows', () => {
    const klines = Array.from({ length: 25 }, (_, i) => ({ low: 100 - i * 0.5 }))
    const stop = calcRecentLowStopLoss(klines)
    const expectedLow = Math.min(...klines.slice(-20).map(k => k.low))
    expect(stop).toBeCloseTo(expectedLow * 0.99, 5)
  })

  it('handles fewer than 20 klines', () => {
    const klines = [{ low: 90 }, { low: 95 }, { low: 85 }]
    expect(calcRecentLowStopLoss(klines)).toBeCloseTo(85 * 0.99, 5)
  })
})
