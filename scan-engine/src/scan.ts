// ---- Types ----
export interface KLine { code: string; date: string; open: number; high: number; low: number; close: number; volume: number; amount: number }
export interface Signal { strategyId: number; strategyName: string; direction: 'BUY' | 'SELL'; strength: number }
export interface ScanResult { code: string; name: string; price: number; signals: Signal[] }

// ---- Indicators ----
function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const arr = [data[0]]
  for (let i = 1; i < data.length; i++) arr.push(data[i] * k + arr[i - 1] * (1 - k))
  return arr
}

function calcMA(klines: KLine[], period: number): number[] {
  const arr: number[] = []
  for (let i = 0; i < klines.length; i++) {
    if (i < period - 1) { arr.push(NaN); continue }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += klines[j].close
    arr.push(sum / period)
  }
  return arr
}

function calcMACD(klines: KLine[]) {
  const closes = klines.map(k => k.close)
  const ema12 = calcEMA(closes, 12)
  const ema26 = calcEMA(closes, 26)
  const macd = ema12.map((v, i) => v - ema26[i])
  const signal = calcEMA(macd, 9)
  const histogram = macd.map((v, i) => v - signal[i])
  return { macd, signal, histogram }
}

function calcRSI(klines: KLine[], period = 14): number[] {
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

// ---- Strategies ----
interface Strategy {
  id: number; name: string; direction: 'BUY' | 'SELL'
  check: (v: Record<string, number>, p: Record<string, number>) => boolean
  strength: number
}

const STRATEGIES: Strategy[] = [
  { id: 1, name: 'MA5/20 金叉', direction: 'BUY', strength: 70,
    check: (v, p) => !isNaN(v.ma5) && !isNaN(v.ma20) && p.ma5 <= p.ma20 && v.ma5 > v.ma20 },
  { id: 1, name: 'MA5/20 死叉', direction: 'SELL', strength: 70,
    check: (v, p) => !isNaN(v.ma5) && !isNaN(v.ma20) && p.ma5 >= p.ma20 && v.ma5 < v.ma20 },
  { id: 2, name: 'MA10/60 金叉', direction: 'BUY', strength: 80,
    check: (v, p) => !isNaN(v.ma10) && !isNaN(v.ma60) && p.ma10 <= p.ma60 && v.ma10 > v.ma60 },
  { id: 2, name: 'MA10/60 死叉', direction: 'SELL', strength: 80,
    check: (v, p) => !isNaN(v.ma10) && !isNaN(v.ma60) && p.ma10 >= p.ma60 && v.ma10 < v.ma60 },
  { id: 3, name: 'MACD 金叉', direction: 'BUY', strength: 60,
    check: (v, p) => !isNaN(v.macd) && !isNaN(v.macdSignal) && p.macd <= p.macdSignal && v.macd > v.macdSignal },
  { id: 3, name: 'MACD 死叉', direction: 'SELL', strength: 60,
    check: (v, p) => !isNaN(v.macd) && !isNaN(v.macdSignal) && p.macd >= p.macdSignal && v.macd < v.macdSignal },
  { id: 4, name: 'RSI 超卖', direction: 'BUY', strength: 50,
    check: (v, _p) => !isNaN(v.rsi) && v.rsi < 30 },
  { id: 4, name: 'RSI 超买', direction: 'SELL', strength: 50,
    check: (v, _p) => !isNaN(v.rsi) && v.rsi > 70 },
  { id: 5, name: 'MACD 零轴下方金叉', direction: 'BUY', strength: 75,
    check: (v, p) => !isNaN(v.macd) && !isNaN(v.macdSignal) && v.macd < 0 && p.macd <= p.macdSignal && v.macd > v.macdSignal },
  { id: 6, name: '放量突破', direction: 'BUY', strength: 65,
    check: (v, p) => !isNaN(v.volRatio) && v.volRatio > 1.5 && !isNaN(v.changePct) && v.changePct > 2 },
]

// ---- Scan Logic ----
export function scanStock(code: string, name: string, klines: KLine[], customRules?: any[]): ScanResult | null {
  if (klines.length < 30) return null

  const closes = klines.map(k => k.close)
  const last = closes[closes.length - 1]

  const ma5 = calcMA(klines, 5)
  const ma10 = calcMA(klines, 10)
  const ma20 = calcMA(klines, 20)
  const ma60 = calcMA(klines, 60)
  const { macd, signal: macdSignal } = calcMACD(klines)
  const rsi = calcRSI(klines)

  const avgVol20 = klines.slice(-20).reduce((s, k) => s + k.volume, 0) / 20
  const volRatio = avgVol20 > 0 ? klines[klines.length - 1].volume / avgVol20 : 1
  const prevClose = klines.length >= 2 ? klines[klines.length - 2].close : last
  const changePct = prevClose > 0 ? ((last - prevClose) / prevClose) * 100 : 0

  const cur = { ma5: ma5.at(-1)!, ma10: ma10.at(-1)!, ma20: ma20.at(-1)!, ma60: ma60.at(-1)!, macd: macd.at(-1)!, macdSignal: macdSignal.at(-1)!, rsi: rsi.at(-1)!, volRatio, changePct }
  const prev = { ma5: ma5.at(-2)!, ma10: ma10.at(-2)!, ma20: ma20.at(-2)!, ma60: ma60.at(-2)!, macd: macd.at(-2)!, macdSignal: macdSignal.at(-2)!, rsi: rsi.at(-2)!, volRatio: volRatio, changePct: 0 }

  const strategies = customRules?.length ? customRules.filter(r => r.type !== 'BUILTIN_GROUP').map(r => ({
    id: 999, name: r.name || '自定义策略', direction: r.action === 'BUY' ? 'BUY' : 'SELL' as 'BUY' | 'SELL',
    check: (v: Record<string, number>, p: Record<string, number>) => evaluateRule(r, v, p),
    strength: 50,
  })) : STRATEGIES

  const signals: Signal[] = []
  for (const s of strategies) {
    try {
      if (s.check(cur, prev)) signals.push({ strategyId: s.id, strategyName: s.name, direction: s.direction, strength: s.strength })
    } catch {}
  }

  if (!signals.length) return null
  return { code, name, price: last, signals }
}

function evaluateRule(rule: any, cur: Record<string, number>, _prev: Record<string, number>): boolean {
  if (!rule.conditions?.length) return false
  return rule.conditions.every((c: any) => {
    const key = c.indicator?.toLowerCase()
    const val = key ? cur[key] : NaN
    if (isNaN(val)) return false
    const target = typeof c.value === 'number' ? c.value : NaN
    if (isNaN(target)) return false
    switch (c.operator) {
      case 'gt': case 'above': return val > target
      case 'lt': case 'below': return val < target
      case 'gte': return val >= target
      case 'lte': return val <= target
      case 'eq': return Math.abs(val - target) < 0.001
      default: return false
    }
  })
}

export function scanStocks(stocks: { code: string; name: string }[], allKlines: Record<string, KLine[]>): ScanResult[] {
  const results: ScanResult[] = []
  for (const s of stocks) {
    const klines = allKlines[s.code]
    if (!klines) continue
    const r = scanStock(s.code, s.name, klines)
    if (r) results.push(r)
  }
  return results
}
