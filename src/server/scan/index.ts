import type { KLine, Stock, Signal, Rule, ResonanceConfig, ResonanceSignal } from '../../shared/types.js'
import type { MACDResult, KDJResult } from '../indicators/index.js'
import { calcMA, calcMACD, calcRSI, calcKDJ, calcBBPosition, LazyIndicators } from '../indicators/index.js'
import { getOrFetchKlines } from '../data/cache.js'
import { evaluateCondition, resolveVal, extractNeededIndicators } from '../engine/ruleEngine.js'

export const strategies = [
  {
    id: 1, name: 'MA5/20 金叉',
    check: (v: Record<string, number>, p: Record<string, number>) =>
      !isNaN(v.ma5) && !isNaN(v.ma20) && p.ma5 <= p.ma20 && v.ma5 > v.ma20,
    strength: 70,
  },
  {
    id: 1, name: 'MA5/20 死叉',
    check: (v: Record<string, number>, p: Record<string, number>) =>
      !isNaN(v.ma5) && !isNaN(v.ma20) && p.ma5 >= p.ma20 && v.ma5 < v.ma20,
    strength: 70,
  },
  {
    id: 2, name: 'MA10/60 金叉',
    check: (v: Record<string, number>, p: Record<string, number>) =>
      !isNaN(v.ma10) && !isNaN(v.ma60) && p.ma10 <= p.ma60 && v.ma10 > v.ma60,
    strength: 80,
  },
  {
    id: 2, name: 'MA10/60 死叉',
    check: (v: Record<string, number>, p: Record<string, number>) =>
      !isNaN(v.ma10) && !isNaN(v.ma60) && p.ma10 >= p.ma60 && v.ma10 < v.ma60,
    strength: 80,
  },
  {
    id: 3, name: 'MACD 金叉',
    check: (v: Record<string, number>, p: Record<string, number>) =>
      !isNaN(v.macd) && !isNaN(v.macdSignal) && p.macd <= p.macdSignal && v.macd > v.macdSignal,
    strength: 60,
  },
  {
    id: 3, name: 'MACD 死叉',
    check: (v: Record<string, number>, p: Record<string, number>) =>
      !isNaN(v.macd) && !isNaN(v.macdSignal) && p.macd >= p.macdSignal && v.macd < v.macdSignal,
    strength: 60,
  },
  {
    id: 4, name: 'RSI 超卖',
    check: (v: Record<string, number>, _p: Record<string, number>) =>
      !isNaN(v.rsi) && v.rsi < 30,
    strength: 50,
  },
  {
    id: 4, name: 'RSI 超买',
    check: (v: Record<string, number>, _p: Record<string, number>) =>
      !isNaN(v.rsi) && v.rsi > 70,
    strength: 50,
  },
]

export interface ScanResult {
  code: string
  name: string
  price: number
  signals: {
    strategyId: number
    strategyName: string
    direction: 'BUY' | 'SELL'
    strength: number
  }[]
  totalStrength: number
}

export function scanStock(
  code: string, name: string, klines: KLine[],
  customRules?: Rule[], customRuleName?: string,
  lazy?: LazyIndicators,
): ScanResult | null {
  if (klines.length < 100) return null

  let closes: number[]
  let mas: Record<string, number[]>
  let macd: MACDResult
  let rsi: number[]

  if (lazy) {
    closes = lazy.closes
    mas = lazy.mas
    macd = lazy.macd
    rsi = lazy.rsi
  } else {
    closes = klines.map(k => k.close)
    mas = calcMA(klines)
    macd = calcMACD(klines)
    rsi = calcRSI(klines)
  }

  const lastIdx = klines.length - 1
  const prevIdx = lastIdx - 1
  if (lastIdx < 0 || prevIdx < 0) return null

  function valuesAt(i: number): Record<string, number> {
    return {
      ma5: mas['MA5']?.[i] ?? NaN,
      ma10: mas['MA10']?.[i] ?? NaN,
      ma20: mas['MA20']?.[i] ?? NaN,
      ma60: mas['MA60']?.[i] ?? NaN,
      macd: macd.macd[i] ?? NaN,
      macdSignal: macd.signal[i] ?? NaN,
      macdHistogram: macd.histogram[i] ?? NaN,
      rsi: rsi[i] ?? NaN,
      close: closes[i] ?? NaN,
      bbUpper: lazy?.needsBB ? (lazy.bollinger.upper[i] ?? NaN) : NaN,
      bbMiddle: lazy?.needsBB ? (lazy.bollinger.middle[i] ?? NaN) : NaN,
      bbLower: lazy?.needsBB ? (lazy.bollinger.lower[i] ?? NaN) : NaN,
    }
  }

  const v = valuesAt(lastIdx)
  const p = valuesAt(prevIdx)
  const signals: ScanResult['signals'] = []

  if (customRules && customRules.length > 0) {
    for (const rule of customRules) {
      const triggered = rule.conditions.every(c => {
        const val = v[c.indicator]
        const prev = p[c.indicator]
        if (isNaN(val) || isNaN(prev)) return false
        const threshold = resolveVal(c.value, v)
        const prevThreshold = resolveVal(c.value, p)
        if (isNaN(threshold) || isNaN(prevThreshold)) return false
        return evaluateCondition(val, prev, threshold, prevThreshold, c.operator)
      })
      if (triggered) {
        signals.push({
          strategyId: 999,
          strategyName: customRuleName || '自定义策略',
          direction: rule.action,
          strength: 75,
        })
      }
    }
  } else {
    for (const strat of strategies) {
      if (strat.check(v, p)) {
        const direction = strat.name.includes('金叉') || strat.name.includes('超卖') ? 'BUY' : 'SELL'
        signals.push({
          strategyId: strat.id,
          strategyName: strat.name,
          direction,
          strength: strat.strength,
        })
      }
    }
  }

  if (signals.length === 0) return null

  const totalStrength = signals.reduce((s, sig) => s + (sig.direction === 'BUY' ? sig.strength : -sig.strength), 0)

  return {
    code, name,
    price: klines[lastIdx].close,
    signals,
    totalStrength,
  }
}

export async function scanAllStocks(stocks: Stock[], onProgress?: (done: number, total: number) => void): Promise<ScanResult[]> {
  const results: ScanResult[] = []
  const total = stocks.length
  let done = 0

  for (const s of stocks) {
    try {
      const result = await getOrFetchKlines(s.code)
      const scanned = scanStock(s.code, s.name, result.klines)
      if (scanned) results.push(scanned)
    } catch {}
    done++
    if (onProgress && done % 50 === 0) onProgress(done, total)
  }

  results.sort((a, b) => Math.abs(b.totalStrength) - Math.abs(a.totalStrength))
  return results
}

export interface ResonanceScanInput {
  klines: KLine[]
  config: ResonanceConfig
  fundScore: number
}

export function scanResonance(input: ResonanceScanInput): ResonanceSignal | null {
  const { klines, config, fundScore } = input
  if (klines.length < 60) return null

  const closes = klines.map(k => k.close)
  const rsi = calcRSI(klines)
  const kdj = calcKDJ(klines)
  const bbPos = calcBBPosition(klines)
  const macd = calcMACD(klines)

  const lastIdx = klines.length - 1
  const prevIdx = lastIdx - 1

  let techScore = 0
  const triggered: ResonanceSignal['triggeredIndicators'] = []

  for (const ind of config.indicators) {
    if (!ind.enabled) continue

    switch (ind.name) {
      case 'rsi': {
        const r = rsi[lastIdx]
        if (!isNaN(r)) {
          const buyScore = r < (ind.params.oversold ?? 30) ? 1 : r > (ind.params.overbought ?? 70) ? -1 : 0
          techScore += buyScore * ind.params.weight * config.techWeight
          if (buyScore !== 0) triggered.push({ name: 'RSI', value: r, threshold: buyScore > 0 ? 30 : 70 })
        }
        break
      }
      case 'kdj': {
        const k = kdj.k[lastIdx], d = kdj.d[lastIdx]
        const pk = kdj.k[prevIdx], pd = kdj.d[prevIdx]
        if (!isNaN(k) && !isNaN(d)) {
          const goldCross = pk <= pd && k > d
          const deadCross = pk >= pd && k < d
          const oversold = k < 20 && d < 20
          const overbought = k > 80 && d > 80
          if (goldCross || oversold) {
            techScore += (ind.params.weight ?? 1) * config.techWeight
            triggered.push({ name: 'KDJ 金叉/超卖', value: k, threshold: 20 })
          } else if (deadCross || overbought) {
            techScore -= (ind.params.weight ?? 1) * config.techWeight
            triggered.push({ name: 'KDJ 死叉/超买', value: k, threshold: 80 })
          }
        }
        break
      }
      case 'bollinger': {
        const bp = bbPos[lastIdx]
        if (!isNaN(bp)) {
          const weight = ind.params.weight ?? 1
          if (bp < 0.2) {
            techScore += weight * config.techWeight
            triggered.push({ name: '布林下轨', value: bp, threshold: 0.2 })
          } else if (bp > 0.8) {
            techScore -= weight * config.techWeight
            triggered.push({ name: '布林上轨', value: bp, threshold: 0.8 })
          }
        }
        break
      }
      case 'macd': {
        const m = macd.macd[lastIdx], s = macd.signal[lastIdx]
        const pm = macd.macd[prevIdx], ps = macd.signal[prevIdx]
        if (!isNaN(m) && !isNaN(s) && !isNaN(pm)) {
          if (pm <= ps && m > s) {
            techScore += (ind.params.weight ?? 1) * config.techWeight
            triggered.push({ name: 'MACD 金叉', value: m, threshold: s })
          } else if (pm >= ps && m < s) {
            techScore -= (ind.params.weight ?? 1) * config.techWeight
            triggered.push({ name: 'MACD 死叉', value: m, threshold: s })
          }
        }
        break
      }
    }
  }

  const combinedScore = fundScore * config.fundWeight + techScore
  if (triggered.length === 0) return null

  return {
    code: klines[0].code,
    name: klines[0].code,
    price: closes[lastIdx],
    fundScore,
    techScore,
    combinedScore,
    triggeredIndicators: triggered,
  }
}
