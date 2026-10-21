import { Router } from 'express'
import { eq, desc } from 'drizzle-orm'
import { db } from '../db/db.js'
import { signals, userStrategies } from '../db/schema.js'
import { getOrFetchKlines } from '../data/cache.js'
import { scanResonance, ResonanceScanInput } from '../scan/index.js'
import { requireAuth } from '../middleware/auth.js'
import type { ResonanceConfig, ResonanceTemplate, ResonanceSignal, KLine } from '../../shared/types.js'

export interface ResonanceBacktestInput {
  code: string
  config: ResonanceConfig
  fundSignals: { code: string; score: number; date: string }[]
  startDate: string
  endDate: string
  initialCapital?: number
}

export interface ResonanceBacktestResult {
  code: string
  startDate: string
  endDate: string
  initialCapital: number
  finalCapital: number
  totalReturn: number
  tradeCount: number
  winRate: number
  trades: { date: string; price: number; action: 'BUY' | 'SELL'; pnl?: number }[]
}

export function runResonanceBacktest(input: ResonanceBacktestInput, klines: KLine[]): ResonanceBacktestResult {
  const { code, config, fundSignals, startDate, endDate, initialCapital = 100000 } = input

  const filtered = klines.filter(k => k.date >= startDate && k.date <= endDate)
  const fundMap = new Map(fundSignals.filter(f => f.code === code).map(f => [f.date, f.score]))

  const trades: { date: string; price: number; action: 'BUY' | 'SELL'; pnl?: number }[] = []
  let capital = initialCapital
  let position = 0
  let inPosition = false

  for (let i = 30; i < filtered.length; i++) {
    const segment = filtered.slice(0, i + 1)
    const fundScore = fundMap.get(filtered[i].date) || 0
    const scanned = scanResonance({ klines: segment, config, fundScore })

    if (scanned && !inPosition && scanned.combinedScore > 0) {
      position = Math.floor(capital / filtered[i].close)
      capital -= position * filtered[i].close
      trades.push({ date: filtered[i].date, price: filtered[i].close, action: 'BUY' })
      inPosition = true
    } else if (scanned && inPosition && scanned.combinedScore < 0) {
      capital += position * filtered[i].close
      trades.push({ date: filtered[i].date, price: filtered[i].close, action: 'SELL', pnl: capital - initialCapital })
      position = 0
      inPosition = false
    }
  }

  if (inPosition) {
    capital += position * filtered[filtered.length - 1].close
    trades.push({ date: filtered[filtered.length - 1].date, price: filtered[filtered.length - 1].close, action: 'SELL', pnl: capital - initialCapital })
  }

  const totalReturn = (capital - initialCapital) / initialCapital * 100
  const winningTrades = trades.filter(t => t.action === 'SELL' && t.pnl && t.pnl > 0)
  const sellTrades = trades.filter(t => t.action === 'SELL')
  const winRate = sellTrades.length > 0
    ? (winningTrades.length / sellTrades.length) * 100
    : 0

  return {
    code,
    startDate,
    endDate,
    initialCapital,
    finalCapital: capital,
    totalReturn,
    tradeCount: sellTrades.length,
    winRate,
    trades,
  }
}

const router = Router()

export const PRESET_TEMPLATES: ResonanceTemplate[] = [
  {
    id: 1,
    name: '保守型共振',
    description: '资金 + RSI 超卖，适合震荡市',
    config: {
      fundWeight: 0.6,
      techWeight: 0.4,
      indicators: [
        { name: 'rsi', params: { oversold: 30, overbought: 70, weight: 1 }, enabled: true },
        { name: 'kdj', params: { weight: 0.5 }, enabled: false },
        { name: 'bollinger', params: { weight: 0.5 }, enabled: false },
        { name: 'macd', params: { weight: 0.5 }, enabled: false },
      ],
    },
  },
  {
    id: 2,
    name: '激进型共振',
    description: 'KDJ + MACD 金叉共振',
    config: {
      fundWeight: 0.4,
      techWeight: 0.6,
      indicators: [
        { name: 'rsi', params: { oversold: 30, overbought: 70, weight: 0.5 }, enabled: false },
        { name: 'kdj', params: { weight: 1 }, enabled: true },
        { name: 'bollinger', params: { weight: 0.5 }, enabled: true },
        { name: 'macd', params: { weight: 1 }, enabled: true },
      ],
    },
  },
  {
    id: 3,
    name: '布林带共振',
    description: '布林带 + RSI，适合均值回归策略',
    config: {
      fundWeight: 0.5,
      techWeight: 0.5,
      indicators: [
        { name: 'rsi', params: { oversold: 25, overbought: 75, weight: 1 }, enabled: true },
        { name: 'bollinger', params: { weight: 1.5 }, enabled: true },
        { name: 'kdj', params: { weight: 0.5 }, enabled: false },
        { name: 'macd', params: { weight: 0.5 }, enabled: false },
      ],
    },
  },
]

router.get('/templates', (_req, res) => {
  res.json(PRESET_TEMPLATES)
})

router.get('/templates/:id', (req, res) => {
  const t = PRESET_TEMPLATES.find(t => t.id === Number(req.params.id))
  if (!t) return res.status(404).json({ error: 'Template not found' })
  res.json(t)
})

router.post('/scan', async (req, res) => {
  const { codes, config, fundSignals } = req.body as {
    codes?: string[]
    config?: ResonanceConfig
    fundSignals?: { code: string; score: number }[]
  }

  if (!config || !fundSignals?.length) {
    return res.status(400).json({ error: 'Missing config or fundSignals' })
  }

  const fundMap = new Map(fundSignals.map(f => [f.code, f.score]))
  const results: ResonanceSignal[] = []

  for (const code of codes || []) {
    const fundScore = fundMap.get(code) || 0
    const { klines } = await getOrFetchKlines(code)
    if (klines.length < 60) continue

    const scanned = scanResonance({ klines, config, fundScore })
    if (scanned) results.push(scanned)
  }

  results.sort((a, b) => Math.abs(b.combinedScore) - Math.abs(a.combinedScore))
  res.json({ count: results.length, results })
})

router.post('/backtest', async (req, res) => {
  const { code, config, fundSignals, startDate, endDate, initialCapital = 100000 } = req.body as {
    code: string
    config: ResonanceConfig
    fundSignals: { code: string; score: number; date: string }[]
    startDate: string
    endDate: string
    initialCapital?: number
  }

  const { klines } = await getOrFetchKlines(code)
  if (!klines.length) return res.status(404).json({ error: 'No data' })

  const filtered = klines.filter(k => k.date >= startDate && k.date <= endDate)
  if (filtered.length < 60) return res.status(400).json({ error: 'Insufficient data' })

  const result = runResonanceBacktest({ code, config, fundSignals, startDate, endDate, initialCapital }, filtered)
  res.json(result)
})

router.post('/save-template', requireAuth, async (req, res) => {
  const { name, description, config } = req.body as {
    name: string
    description: string
    config: ResonanceConfig
  }

  const rows = await db.insert(userStrategies).values({
    userId: req.user!.userId,
    name: `[共振模板] ${name}`,
    description,
    config: JSON.stringify({ resonanceConfig: config }),
  }).returning()

  res.json(rows[0])
})

router.get('/my-templates', requireAuth, async (req, res) => {
  const rows = await db.select().from(userStrategies)
    .where(eq(userStrategies.userId, req.user!.userId))
    .orderBy(desc(userStrategies.createdAt))

  const templates = rows
    .filter(r => r.name.startsWith('[共振模板]'))
    .map(r => {
      const cfg = typeof r.config === 'string' ? JSON.parse(r.config) : r.config
      return {
        id: r.id,
        name: r.name.replace('[共振模板] ', ''),
        description: r.description || '',
        config: cfg?.resonanceConfig,
        createdAt: r.createdAt,
      }
    })

  res.json(templates)
})

export default router
