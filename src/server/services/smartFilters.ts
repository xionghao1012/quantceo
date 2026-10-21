import type { KLine } from '../../shared/types.js'
import { getSmartFiltersRepository } from '../repositories/ISmartFiltersRepository.js'
import type { ISmartFiltersRepository } from '../repositories/ISmartFiltersRepository.js'
import { redis } from '../data/redis.js'

export interface SmartFilterResult {
  code: string
  name: string
  signals: {
    washTrading: WashTradingSignal | null
    goodNewsDump: GoodNewsDumpSignal | null
    chipDistribution: ChipDistributionSignal | null
    volumeAnomaly: VolumeAnomalySignal | null
  }
  filtered: boolean
  reasons: string[]
}

export interface WashTradingSignal {
  score: number
  level: 'low' | 'medium' | 'high'
  description: string
  evidence: {
    largeOrderCount: number
    samePriceTrades: number
    buySellRatio: number
  }
}

export interface GoodNewsDumpSignal {
  score: number
  level: 'low' | 'medium' | 'high'
  description: string
  evidence: {
    openGapPct: number
    closeChangePct: number
    volumeRatio: number
    isHighOpen: boolean
  }
}

export interface ChipDistributionSignal {
  level: 'low_position' | 'high_position'
  score: number
  description: string
  evidence: {
    avgPosition: number
    volumeConcentration: number
  }
}

export interface VolumeAnomalySignal {
  score: number
  level: 'low' | 'medium' | 'high'
  description: string
  evidence: {
    volumeRatio: number
    avgVolumeRatio: number
    trend: 'surge' | 'collapse'
  }
}

export interface SmartFilterConfig {
  enableWashTrading: boolean
  enableGoodNewsDump: boolean
  enableChipDistribution: boolean
  enableVolumeAnomaly: boolean
  washTradingThreshold?: number
  volumeAnomalyThreshold?: number
}

const DEFAULT_CONFIG: SmartFilterConfig = {
  enableWashTrading: true,
  enableGoodNewsDump: true,
  enableChipDistribution: true,
  enableVolumeAnomaly: true,
  washTradingThreshold: 0.3,
  volumeAnomalyThreshold: 3.0,
}

export async function analyzeSmartFilters(
  code: string,
  name: string,
  config: Partial<SmartFilterConfig> = {}
): Promise<SmartFilterResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const result: SmartFilterResult = {
    code,
    name,
    signals: {
      washTrading: null,
      goodNewsDump: null,
      chipDistribution: null,
      volumeAnomaly: null,
    },
    filtered: false,
    reasons: [],
  }

  const [washResult, volumeResult, chipResult, dumpResult] = await Promise.all([
    cfg.enableWashTrading ? detectWashTrading(code) : null,
    cfg.enableVolumeAnomaly ? detectVolumeAnomaly(code) : null,
    cfg.enableChipDistribution ? analyzeChipDistribution(code) : null,
    cfg.enableGoodNewsDump ? detectGoodNewsDump(code) : null,
  ])

  if (washResult) {
    result.signals.washTrading = washResult
    if (washResult.level !== 'low') {
      result.reasons.push(`庄股对倒风险(${washResult.level})`)
    }
  }

  if (dumpResult) {
    result.signals.goodNewsDump = dumpResult
    if (dumpResult.level !== 'low') {
      result.reasons.push(`利好兑现风险(${dumpResult.level})`)
    }
  }

  if (chipResult) {
    result.signals.chipDistribution = chipResult
    if (chipResult.level === 'high_position') {
      result.reasons.push('高位筹码集中')
    }
  }

  if (volumeResult) {
    result.signals.volumeAnomaly = volumeResult
    if (volumeResult.level !== 'low') {
      result.reasons.push(`成交量异常(${volumeResult.level})`)
    }
  }

  result.filtered = result.reasons.length > 0

  return result
}

async function detectWashTrading(code: string): Promise<WashTradingSignal | null> {
  try {
    const recent = new Date()
    recent.setDate(recent.getDate() - 1)

    const repo = getSmartFiltersRepository()
    const rows = await repo.getMinuteKlinesByCode(code, recent)

    if (rows.length < 30) return null

    const prices = rows.map(r => Number(r.close))
    const samePriceCount = countSamePriceTrades(prices)
    const priceVariance = calculateVariance(prices)

    const washScore = Math.min(100, (samePriceCount / rows.length) * 100 + (priceVariance < 0.01 ? 30 : 0))

    let level: 'low' | 'medium' | 'high' = 'low'
    if (washScore > 60) level = 'high'
    else if (washScore > 30) level = 'medium'

    const descriptions: Record<string, string> = {
      low: '未检测到明显对倒行为',
      medium: '存在一定对敲迹象',
      high: '高度疑似庄股对倒',
    }

    return {
      score: Math.round(washScore),
      level,
      description: descriptions[level],
      evidence: {
        largeOrderCount: rows.filter(r => Number(r.volume) > 10000).length,
        samePriceTrades: samePriceCount,
        buySellRatio: calculateBuySellRatio(rows),
      },
    }
  } catch {
    return null
  }
}

function countSamePriceTrades(prices: number[]): number {
  let count = 0
  const tolerance = 0.001
  for (let i = 1; i < prices.length; i++) {
    if (Math.abs(prices[i] - prices[i - 1]) / prices[i - 1] < tolerance) {
      count++
    }
  }
  return count
}

function calculateVariance(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const squaredDiffs = values.map(v => (v - mean) ** 2)
  return squaredDiffs.reduce((a, b) => a + b, 0) / values.length
}

function calculateBuySellRatio(rows: any[]): number {
  let upCount = 0, downCount = 0
  for (let i = 1; i < rows.length; i++) {
    if (Number(rows[i].close) > Number(rows[i - 1].close)) upCount++
    else if (Number(rows[i].close) < Number(rows[i - 1].close)) downCount++
  }
  return upCount + downCount > 0 ? upCount / (upCount + downCount) : 1
}

async function detectGoodNewsDump(code: string): Promise<GoodNewsDumpSignal | null> {
  try {
    const repo = getSmartFiltersRepository()
    const rows = await repo.getMoneyFlowByCode(code, 5)

    if (rows.length < 2) return null

    const today = rows[0]
    const prev = rows[1]

    const prevClose = Number(prev.closePrice) || 0
    const todayClose = Number(today.closePrice) || 0
    const todayChange = Number(today.changePct) || 0

    const openGapPct = prevClose > 0 ? (todayClose - prevClose) / prevClose * 100 : 0
    const isHighOpen = openGapPct > 2

    let volumeRatio = 1
    const avgTurnover = rows.reduce((sum, r) => sum + Number(r.turnoverRate || 0), 0) / rows.length
    const todayTurnover = Number(today.turnoverRate || 0)
    if (avgTurnover > 0) {
      volumeRatio = todayTurnover / avgTurnover
    }

    let dumpScore = 0
    if (isHighOpen && todayChange < -1) dumpScore += 40
    if (volumeRatio > 2) dumpScore += 30
    if (todayChange < -2) dumpScore += 30

    let level: 'low' | 'medium' | 'high' = 'low'
    if (dumpScore > 60) level = 'high'
    else if (dumpScore > 30) level = 'medium'

    const descriptions: Record<string, string> = {
      low: '未检测到利好兑现',
      medium: '存在利好兑现嫌疑',
      high: '高度疑似利好兑现',
    }

    return {
      score: Math.round(dumpScore),
      level,
      description: descriptions[level],
      evidence: {
        openGapPct: Math.round(openGapPct * 100) / 100,
        closeChangePct: Math.round(todayChange * 100) / 100,
        volumeRatio: Math.round(volumeRatio * 100) / 100,
        isHighOpen,
      },
    }
  } catch {
    return null
  }
}

async function analyzeChipDistribution(code: string): Promise<ChipDistributionSignal | null> {
  try {
    const repo = getSmartFiltersRepository()
    const rows = await repo.getMinuteKlinesByCodeAndLimit(code, 500)

    if (rows.length < 100) return null

    const volumes = rows.map(r => Number(r.volume))
    const prices = rows.map(r => Number(r.close))

    const priceRange = Math.max(...prices) - Math.min(...prices)
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length
    const position = priceRange > 0 ? (avgPrice - Math.min(...prices)) / priceRange : 0.5

    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length
    const concentration = avgVolume > 0
      ? volumes.filter(v => v > avgVolume * 1.5).length / volumes.length
      : 0

    const level: 'low_position' | 'high_position' = position > 0.7 ? 'high_position' : 'low_position'

    return {
      level,
      score: Math.round(position * 100),
      description: level === 'high_position' ? '价格处于筹码密集区上方' : '价格处于筹码密集区',
      evidence: {
        avgPosition: Math.round(position * 100) / 100,
        volumeConcentration: Math.round(concentration * 100) / 100,
      },
    }
  } catch {
    return null
  }
}

async function detectVolumeAnomaly(code: string): Promise<VolumeAnomalySignal | null> {
  try {
    const repo = getSmartFiltersRepository()
    const rows = await repo.getMoneyFlowByCode(code, 20)

    if (rows.length < 5) return null

    const avgTurnover = rows.slice(1).reduce((sum, r) => sum + Number(r.turnoverRate || 0), 0) / (rows.length - 1)
    const todayTurnover = Number(rows[0].turnoverRate || 0)

    if (avgTurnover <= 0) return null

    const volumeRatio = todayTurnover / avgTurnover

    const recentRatios = rows.slice(0, 5).map(r => Number(r.turnoverRate || 0) / avgTurnover)
    const trend: 'surge' | 'collapse' = recentRatios[0] > recentRatios[4] ? 'surge' : 'collapse'

    let level: 'low' | 'medium' | 'high' = 'low'
    if (volumeRatio > 4) level = 'high'
    else if (volumeRatio > 2.5) level = 'medium'

    const descriptions: Record<string, string> = {
      low: '成交量正常',
      medium: '成交量异常放大',
      high: '成交量剧烈波动',
    }

    return {
      score: Math.round(Math.min(100, volumeRatio * 25)),
      level,
      description: descriptions[level],
      evidence: {
        volumeRatio: Math.round(volumeRatio * 100) / 100,
        avgVolumeRatio: 1.0,
        trend,
      },
    }
  } catch {
    return null
  }
}

export async function shouldBlockAlert(
  code: string,
  name: string,
  config: Partial<SmartFilterConfig> = {}
): Promise<{ blocked: boolean; reasons: string[] }> {
  const cacheKey = `smart_filter:${code}`
  try {
    const cached = await redis.get(cacheKey)
    if (cached) {
      const parsed = JSON.parse(cached)
      return { blocked: parsed.filtered, reasons: parsed.reasons }
    }
  } catch {}

  const result = await analyzeSmartFilters(code, name, config)

  try {
    await redis.setex(cacheKey, 300, JSON.stringify(result))
  } catch {}

  return { blocked: result.filtered, reasons: result.reasons }
}
