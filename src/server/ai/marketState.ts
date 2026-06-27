import type { KLine } from '../../shared/types.js'
import { calcRSI, calcMACD, calcMA } from '../indicators/index.js'

export type MarketState = 'trending_up' | 'oversold' | 'range_bound' | 'breakout' | 'bearish'

export interface MarketStateResult {
  state: MarketState
  index: string
  indexName: string
  indexPrice: number
  indexChange: number
  indicators: {
    rsi: number
    macdSignal: 'bullish' | 'bearish'
    macdHistogram: number
    ma5: number
    ma20: number
    ma60: number
    trend: 'up' | 'down' | 'neutral'
  }
  recommendedStrategies: StrategyRecommendation[]
  updatedAt: string
}

export interface StrategyRecommendation {
  id: number
  name: string
  direction: 'BUY' | 'SELL'
  description: string
  suitableState: MarketState
  priority: number
}

const INDEX_CODES: Record<string, string> = {
  '000300': 'sh000300',
  '000001': 'sh000001',
}

const INDEX_NAMES: Record<string, string> = {
  '000300': '沪深300',
  '000001': '上证指数',
}

const STRATEGIES: StrategyRecommendation[] = [
  { id: 1, name: 'MA5/20 金叉', direction: 'BUY', description: '短线趋势转多，均线多头排列', suitableState: 'trending_up', priority: 1 },
  { id: 1, name: 'MA5/20 死叉', direction: 'SELL', description: '短线趋势转空，均线空头排列', suitableState: 'bearish', priority: 1 },
  { id: 2, name: 'MA10/60 金叉', direction: 'BUY', description: '中线趋势转多，适合顺势持仓', suitableState: 'trending_up', priority: 2 },
  { id: 2, name: 'MA10/60 死叉', direction: 'SELL', description: '中线趋势转空，建议减仓', suitableState: 'bearish', priority: 2 },
  { id: 3, name: 'MACD 金叉', direction: 'BUY', description: '动能由负转正，短期强势信号', suitableState: 'breakout', priority: 1 },
  { id: 3, name: 'MACD 死叉', direction: 'SELL', description: '动能由正转负，短期弱势信号', suitableState: 'bearish', priority: 1 },
  { id: 4, name: 'RSI 超卖', direction: 'BUY', description: '指标处于超卖区间，关注反弹机会', suitableState: 'oversold', priority: 1 },
  { id: 4, name: 'RSI 超买', direction: 'SELL', description: '指标处于超买区间，注意回调风险', suitableState: 'breakout', priority: 1 },
]

async function fetchIndexKlines(secid: string, days = 100): Promise<KLine[]> {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${secid},day,,,${days},qfq`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.qq.com/' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const rows = json.data?.[secid]?.day
  if (!rows?.length) throw new Error(`No data for ${secid}`)
  return rows.map((row: any) => ({
    code: secid.replace('sh', '').replace('sz', ''),
    date: row[0],
    open: Number(row[1]),
    close: Number(row[2]),
    high: Number(row[3]),
    low: Number(row[4]),
    volume: Number(row[5]),
    amount: Number(row[6]) || 0,
  }))
}

function computeIndicators(klines: KLine[]) {
  if (klines.length < 60) return null
  const reversed = [...klines].reverse()
  const closes = reversed.map(k => k.close)
  const rsi = calcRSI(klines)
  const macd = calcMACD(klines)
  const ma = calcMA(klines, [5, 20, 60])

  const last = closes.length - 1
  return {
    rsi: Math.round(rsi[last] * 10) / 10,
    macdSignal: macd.macd[last] > macd.signal[last] ? 'bullish' as const : 'bearish' as const,
    macdHistogram: Math.round((macd.macd[last] - macd.signal[last]) * 100) / 100,
    ma5: Math.round(ma['MA5']?.[last] * 100) / 100,
    ma20: Math.round(ma['MA20']?.[last] * 100) / 100,
    ma60: Math.round(ma['MA60']?.[last] * 100) / 100,
  }
}

function classifyState(ind: ReturnType<typeof computeIndicators>, closes: number[]): MarketState {
  if (!ind) return 'range_bound'
  const { rsi, macdSignal, ma5, ma20, ma60 } = ind
  const price = closes[closes.length - 1]

  const maSeq = ma5 > ma20 && ma20 > ma60
  const maBear = ma5 < ma20 && ma20 < ma60
  const rsiHigh = rsi > 70
  const rsiLow = rsi < 35
  const rsiMid = rsi >= 35 && rsi <= 65

  if (maSeq && rsiMid && macdSignal === 'bullish') return 'trending_up'
  if (rsiLow || (rsi < 40 && macdSignal === 'bearish')) return 'oversold'
  if (maBear && (rsiHigh || macdSignal === 'bearish')) return 'bearish'
  if (rsi > 65 && price > ma5 && macdSignal === 'bullish') return 'breakout'
  return 'range_bound'
}

function getRecommendedStrategies(state: MarketState): StrategyRecommendation[] {
  const stateStrategies: Record<MarketState, number[]> = {
    trending_up: [1, 2, 3],
    oversold: [4, 3],
    range_bound: [4, 1],
    breakout: [3, 1],
    bearish: [2, 3, 4],
  }
  const ids = stateStrategies[state] || []
  const map = new Map<number, StrategyRecommendation>()
  for (const id of ids) {
    for (const s of STRATEGIES) {
      if (s.id === id && !map.has(id * 10 + (s.direction === 'BUY' ? 1 : 2))) {
        map.set(id * 10 + (s.direction === 'BUY' ? 1 : 2), s)
      }
    }
  }
  return [...map.values()].slice(0, 4)
}

export async function getMarketState(indexCode = '000300'): Promise<MarketStateResult> {
  const secid = INDEX_CODES[indexCode] || 'sh000300'
  const indexName = INDEX_NAMES[indexCode] || '沪深300'

  const klines = await fetchIndexKlines(secid, 100)
  const closes = klines.map(k => k.close)

  const indicators = computeIndicators(klines)
  if (!indicators) throw new Error('数据不足')

  const state = classifyState(indicators, closes)

  const latest = klines[klines.length - 1]
  const prev = klines[klines.length - 2]
  const indexChange = prev ? ((latest.close - prev.close) / prev.close) * 100 : 0

  return {
    state,
    index: indexCode,
    indexName,
    indexPrice: Math.round(latest.close * 100) / 100,
    indexChange: Math.round(indexChange * 100) / 100,
    indicators: {
      rsi: indicators.rsi,
      macdSignal: indicators.macdSignal,
      macdHistogram: indicators.macdHistogram,
      ma5: indicators.ma5,
      ma20: indicators.ma20,
      ma60: indicators.ma60,
      trend: indicators.ma5 > indicators.ma20 ? 'up' : indicators.ma5 < indicators.ma20 ? 'down' : 'neutral',
    },
    recommendedStrategies: getRecommendedStrategies(state),
    updatedAt: new Date().toISOString(),
  }
}
