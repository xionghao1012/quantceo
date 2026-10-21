import type { KLine } from '../../shared/types.js'

export class LazyIndicators {
  private _mas?: Record<string, number[]>
  private _macd?: MACDResult
  private _rsi?: number[]
  private _bollinger?: { upper: number[]; middle: number[]; lower: number[] }
  private _kdj?: KDJResult
  private _closes?: number[]

  constructor(
    private klines: KLine[],
    private needed: Set<string>,
  ) {}

  get closes(): number[] {
    if (!this._closes) this._closes = this.klines.map(k => k.close)
    return this._closes
  }

  get mas(): Record<string, number[]> {
    if (!this._mas) {
      const periods: number[] = []
      for (const ind of this.needed) {
        const m = ind.match(/^ma(\d+)$/i)
        if (m) periods.push(Number(m[1]))
      }
      this._mas = calcMA(this.klines, periods.length ? [...new Set(periods)] : [])
    }
    return this._mas
  }

  get macd(): MACDResult {
    if (!this._macd) this._macd = calcMACD(this.klines)
    return this._macd
  }

  get rsi(): number[] {
    if (!this._rsi) this._rsi = calcRSI(this.klines)
    return this._rsi
  }

  get bollinger() {
    if (!this._bollinger) this._bollinger = calcBollinger(this.klines)
    return this._bollinger
  }

  get needsBB(): boolean {
    for (const ind of this.needed) {
      if (ind.startsWith('bb')) return true
    }
    return false
  }

  get kdj(): KDJResult {
    if (!this._kdj) this._kdj = calcKDJ(this.klines)
    return this._kdj
  }

  get needsKDJ(): boolean {
    return this.needed.has('kdj') || this.needed.has('kdj_k') || this.needed.has('kdj_d') || this.needed.has('kdj_j')
  }

  get length(): number {
    return this.klines.length
  }
}

function sma(values: number[], period: number): number[] {
  const result: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { result.push(NaN); continue }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += values[j]
    result.push(sum / period)
  }
  return result
}

function ema(values: number[], period: number): number[] {
  const result: number[] = []
  const k = 2 / (period + 1)
  for (let i = 0; i < values.length; i++) {
    if (i === 0) { result.push(values[0]); continue }
    result.push(values[i] * k + result[i - 1] * (1 - k))
  }
  return result
}

function rma(values: number[], period: number): number[] {
  const result: number[] = []
  const alpha = 1 / period
  for (let i = 0; i < values.length; i++) {
    if (i === 0) { result.push(values[0]); continue }
    result.push(alpha * values[i] + (1 - alpha) * result[i - 1])
  }
  return result
}

export interface MACDResult {
  macd: number[]
  signal: number[]
  histogram: number[]
}

export function calcMA(klines: KLine[], periods = [5, 10, 20, 60]): Record<string, number[]> {
  const closes = klines.map(k => k.close)
  const result: Record<string, number[]> = {}
  for (const p of periods) {
    result[`MA${p}`] = sma(closes, p)
  }
  return result
}

export function calcMACD(klines: KLine[], fast = 12, slow = 26, signalPeriod = 9): MACDResult {
  const closes = klines.map(k => k.close)
  const fastEma = ema(closes, fast)
  const slowEma = ema(closes, slow)
  const macdLine = fastEma.map((v, i) => v - slowEma[i])
  const signalLine = ema(macdLine, signalPeriod)
  const histogram = macdLine.map((v, i) => v - signalLine[i])
  return { macd: macdLine, signal: signalLine, histogram }
}

export function calcRSI(klines: KLine[], period = 14): number[] {
  const closes = klines.map(k => k.close)
  const changes: number[] = [0]
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1])
  }
  const gains = changes.map(c => c > 0 ? c : 0)
  const losses = changes.map(c => c < 0 ? -c : 0)
  const avgGain = rma(gains, period)
  const avgLoss = rma(losses, period)
  return avgGain.map((g, i) => {
    if (avgLoss[i] === 0) return 100
    return 100 - (100 / (1 + g / avgLoss[i]))
  })
}

export function calcBollinger(klines: KLine[], period = 20, multiplier = 2) {
  const closes = klines.map(k => k.close)
  const ma = sma(closes, period)
  const upper: number[] = []
  const lower: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { upper.push(NaN); lower.push(NaN); continue }
    let sumSq = 0
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += (closes[j] - ma[i]) ** 2
    }
    const std = Math.sqrt(sumSq / period)
    upper.push(ma[i] + multiplier * std)
    lower.push(ma[i] - multiplier * std)
  }
  return { upper, middle: ma, lower }
}

export interface KDJResult {
  k: number[]
  d: number[]
  j: number[]
}

export function calcKDJ(klines: KLine[], period = 9, kPeriod = 3, dPeriod = 3): KDJResult {
  const highs = klines.map(k => k.high)
  const lows = klines.map(k => k.low)
  const closes = klines.map(k => k.close)
  const rsv: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { rsv.push(NaN); continue }
    let max = -Infinity, min = Infinity
    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] > max) max = highs[j]
      if (lows[j] < min) min = lows[j]
    }
    rsv.push(max === min ? 50 : (closes[i] - min) / (max - min) * 100)
  }
  const k: number[] = []
  const d: number[] = []
  const j: number[] = []
  for (let i = 0; i < rsv.length; i++) {
    if (isNaN(rsv[i])) { k.push(NaN); d.push(NaN); j.push(NaN); continue }
    if (i === period - 1) {
      k.push((2 * rsv[i] + 50) / 3)
      d.push((2 * k[i] + 50) / 3)
    } else {
      k.push((2 * rsv[i] + (k[i - 1] || 50) * (kPeriod - 1)) / kPeriod)
      d.push((2 * k[i] + (d[i - 1] || 50) * (dPeriod - 1)) / dPeriod)
    }
    j.push(3 * k[i] - 2 * d[i])
  }
  return { k, d, j }
}

export function calcBBPosition(klines: KLine[], period = 20): number[] {
  const bb = calcBollinger(klines, period)
  return klines.map((k, i) => {
    if (isNaN(bb.upper[i]) || bb.upper[i] === bb.lower[i]) return NaN
    return (k.close - bb.lower[i]) / (bb.upper[i] - bb.lower[i])
  })
}
