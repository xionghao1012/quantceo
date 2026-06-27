// ---- Types ----
export interface KLine { open: number; high: number; low: number; close: number; volume: number }

// ---- MA ----
export function calcMA(klines: KLine[], period: number): number[] {
  const arr: number[] = []
  for (let i = 0; i < klines.length; i++) {
    if (i < period - 1) { arr.push(NaN); continue }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += klines[j].close
    arr.push(sum / period)
  }
  return arr
}

// ---- EMA ----
export function calcEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const arr = [values[0]]
  for (let i = 1; i < values.length; i++) arr.push(values[i] * k + arr[i - 1] * (1 - k))
  return arr
}

// ---- MACD ----
export function calcMACD(klines: KLine[], fast = 12, slow = 26, signalPeriod = 9) {
  const closes = klines.map(k => k.close)
  const emaFast = calcEMA(closes, fast)
  const emaSlow = calcEMA(closes, slow)
  const macd = emaFast.map((v, i) => v - emaSlow[i])
  const signal = calcEMA(macd, signalPeriod)
  const histogram = macd.map((v, i) => v - signal[i])
  return { macd, signal, histogram }
}

// ---- RSI ----
export function calcRSI(klines: KLine[], period = 14): number[] {
  const rsi: number[] = new Array(klines.length).fill(NaN)
  if (klines.length < period + 1) return rsi
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const diff = klines[i].close - klines[i - 1].close
    if (diff > 0) avgGain += diff; else avgLoss -= diff
  }
  avgGain /= period; avgLoss /= period
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < klines.length; i++) {
    const diff = klines[i].close - klines[i - 1].close
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return rsi
}

// ---- Bollinger ----
export function calcBollinger(klines: KLine[], period = 20, multiplier = 2) {
  const closes = klines.map(k => k.close)
  const middle: number[] = [], upper: number[] = [], lower: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { middle.push(NaN); upper.push(NaN); lower.push(NaN); continue }
    const slice = closes.slice(i - period + 1, i + 1)
    const mean = slice.reduce((s, v) => s + v, 0) / period
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period
    const std = Math.sqrt(variance)
    middle.push(mean)
    upper.push(mean + std * multiplier)
    lower.push(mean - std * multiplier)
  }
  return { upper, middle, lower }
}

// ---- ATR ----
export function calcATR(klines: KLine[], period = 14): number[] {
  const tr: number[] = [NaN]
  for (let i = 1; i < klines.length; i++) {
    tr.push(Math.max(
      klines[i].high - klines[i].low,
      Math.abs(klines[i].high - klines[i - 1].close),
      Math.abs(klines[i].low - klines[i - 1].close)
    ))
  }
  const atr: number[] = []
  for (let i = 0; i < tr.length; i++) {
    if (i < period) { atr.push(NaN); continue }
    if (i === period) {
      let sum = 0
      for (let j = 1; j <= period; j++) sum += tr[j]
      atr.push(sum / period)
    } else {
      atr.push((atr[i - 1] * (period - 1) + tr[i]) / period)
    }
  }
  return atr
}

// ---- Batch ----
export function calcAll(klines: KLine[]) {
  return {
    ma5: calcMA(klines, 5),
    ma10: calcMA(klines, 10),
    ma20: calcMA(klines, 20),
    ma60: calcMA(klines, 60),
    macd: calcMACD(klines),
    rsi: calcRSI(klines),
    bollinger: calcBollinger(klines),
    atr: calcATR(klines),
  }
}
