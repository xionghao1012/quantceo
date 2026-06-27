import type { KLine, BacktestRequest, BacktestResult, Trade, Rule } from '../../shared/types.js'
import { calcMA, calcMACD, calcRSI, LazyIndicators } from '../indicators/index.js'
import { evaluateRules, extractNeededIndicators } from '../engine/ruleEngine.js'

const COMMISSION_RATE = 0.00025
const STAMP_TAX = 0.001
const SLIPPAGE = 0.001

function calcWarmup(needed: Set<string>): number {
  let w = 30
  for (const ind of needed) {
    const m = ind.match(/^ma(\d+)$/)
    if (m) w = Math.max(w, Number(m[1]))
  }
  if (needed.has('rsi')) w = Math.max(w, 14)
  if (needed.has('macd') || needed.has('macdSignal') || needed.has('macdHistogram')) w = Math.max(w, 26)
  if (needed.has('bbUpper') || needed.has('bbMiddle') || needed.has('bbLower')) w = Math.max(w, 20)
  return w
}

export function runBacktest(klines: KLine[], req: BacktestRequest, rules: Rule[]): BacktestResult {
  const needed = extractNeededIndicators(rules)
  const lazy = new LazyIndicators(klines, needed)

  function resolve(val: number | string, values: Record<string, number>): number {
    if (typeof val === 'number') return val
    return values[val] ?? NaN
  }

  function valuesAt(i: number) {
    return {
      ma5: lazy.mas['MA5']?.[i] ?? NaN,
      ma10: lazy.mas['MA10']?.[i] ?? NaN,
      ma20: lazy.mas['MA20']?.[i] ?? NaN,
      ma60: lazy.mas['MA60']?.[i] ?? NaN,
      macd: lazy.macd.macd[i] ?? NaN,
      macdSignal: lazy.macd.signal[i] ?? NaN,
      macdHistogram: lazy.macd.histogram[i] ?? NaN,
      rsi: lazy.rsi[i] ?? NaN,
      close: lazy.closes[i] ?? NaN,
      bbUpper: lazy.needsBB ? (lazy.bollinger.upper[i] ?? NaN) : NaN,
      bbMiddle: lazy.needsBB ? (lazy.bollinger.middle[i] ?? NaN) : NaN,
      bbLower: lazy.needsBB ? (lazy.bollinger.lower[i] ?? NaN) : NaN,
    }
  }

  const n = klines.length
  const warmup = calcWarmup(needed)

  const startIdx = req.startDate ? klines.findIndex(k => k.date >= req.startDate!) : warmup
  let endIdx = n - 1
  if (req.endDate) {
    for (let i = n - 1; i >= 0; i--) {
      if (klines[i].date <= req.endDate!) { endIdx = i; break }
    }
  }

  let capital = req.initialCapital
  let holdings = 0
  let entryPrice = 0
  let entryDate = ''
  const trades: Trade[] = []
  const equity: { date: string; value: number }[] = []
  let peak = capital
  let maxDrawdown = 0
  let wins = 0
  let losses = 0

  for (let i = Math.max(warmup, startIdx); i <= endIdx && i < n; i++) {
    const k = klines[i]
    const values = valuesAt(i)
    const prevValues = i > 0 ? valuesAt(i - 1) : values
    const signals = evaluateRules(values, prevValues, rules, resolve)
    if (signals.includes('BUY') && holdings === 0) {
      const price = k.close * (1 + SLIPPAGE)
      const shares = Math.floor(capital / price / 100) * 100
      const cost = shares * price
      const commission = cost * COMMISSION_RATE
      if (cost + commission <= capital) {
        holdings = shares
        capital -= (cost + commission)
        entryPrice = price
        entryDate = k.date
      }
    } else if (signals.includes('SELL') && holdings > 0) {
      const price = k.close * (1 - SLIPPAGE)
      const proceeds = holdings * price
      const commission = proceeds * COMMISSION_RATE
      const tax = proceeds * STAMP_TAX
      const costBasis = holdings * entryPrice
      const pnl = proceeds - commission - tax - costBasis
      trades.push({
        entryDate, exitDate: k.date,
        direction: 'SELL', entryPrice, exitPrice: price,
        shares: holdings, pnl,
        returnPct: costBasis > 0 ? pnl / costBasis * 100 : 0,
      })
      if (pnl > 0) wins++; else losses++
      capital += proceeds - commission - tax
      holdings = 0
    }

    const totalValue = capital + holdings * k.close
    equity.push({ date: k.date, value: totalValue })
    if (totalValue > peak) peak = totalValue
    const dd = (peak - totalValue) / peak * 100
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  const totalReturn = (equity[equity.length - 1]?.value - req.initialCapital) / req.initialCapital * 100
  const totalTrades = trades.length
  const winRate = totalTrades > 0 ? wins / totalTrades * 100 : 0

  let sum = 0, sumSq = 0
  for (let i = 1; i < equity.length; i++) {
    const r = (equity[i].value - equity[i - 1].value) / equity[i - 1].value
    if (r !== 0) { sum += r; sumSq += r * r }
  }
  const tradingDays = equity.length - 1
  const avgReturn = tradingDays > 0 ? sum / tradingDays : 0
  const variance = tradingDays > 0 ? sumSq / tradingDays - avgReturn * avgReturn : 0
  const stdDev = Math.sqrt(Math.max(0, variance))
  const sharpe = stdDev > 0 ? avgReturn / stdDev * Math.sqrt(252) : 0

  return {
    totalReturn,
    annualReturn: totalReturn * (252 / Math.max(equity.length - 1, 1)),
    sharpe,
    maxDrawdown,
    winRate,
    tradeCount: totalTrades,
    trades,
    equity,
  }
}
