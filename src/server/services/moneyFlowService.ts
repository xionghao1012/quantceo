import { fetchDailyMoneyFlow, fetchRealtimeMoneyFlow, type MoneyFlowData, type MoneyFlowRealtime } from '../data/eastmoneyMoneyFlow.js'
import { fetchFundamental } from '../data/fundamental.js'
import { redis } from '../data/redis.js'
import { getMoneyFlowRepository } from '../repositories/IMoneyFlowRepository.js'

const MONEYFLOW_CACHE_KEY = (code: string) => `moneyflow:rt:${code}`
const MONEYFLOW_LAST_UPDATE_KEY = 'moneyflow:last_update'
const MONEYFLOW_STALE_THRESHOLD_MS = 60_000
const FLOAT_CAP_CACHE_KEY = (code: string) => `moneyflow:floatcap:${code}`
const SSE_URL = 'https://push2.eastmoney.com/api/qt/clist/get'
const SSE_FIELDS = 'f12,f14,f62,f184,f66,f70,f2,f3'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'degraded'

let currentStatus: ConnectionStatus = 'disconnected'
const currentSource = 'eastmoney'
let lastDataTimestamp = 0
let lastSuccessfulFetch = 0
let reconnectAttempts = 0
const MAX_RECONNECT_DELAY = 300_000
const MAX_RECONNECT_ATTEMPTS = 50

const KNOWN_LIMITUP_CODES = new Set<string>()
const floatCapCache = new Map<string, number>()

export function __resetMoneyFlowCaches(): void {
  floatCapCache.clear()
  KNOWN_LIMITUP_CODES.clear()
}

async function getLimitUpCodes(): Promise<void> {
  try {
    const today = new Date().toISOString().split('T')[0]
    const rows = await getMoneyFlowRepository().getLimitUpCodes(today)
    rows.forEach(r => KNOWN_LIMITUP_CODES.add(r.code))
  } catch {}
}

export async function getFloatMarketCap(code: string): Promise<number | null> {
  if (floatCapCache.has(code)) return floatCapCache.get(code)!

  try {
    const cached = await redis.get(FLOAT_CAP_CACHE_KEY(code))
    if (cached) {
      const val = Number(cached)
      if (val > 0) {
        floatCapCache.set(code, val)
        return val
      }
    }
  } catch {}

  try {
    const fundamental = await fetchFundamental(code)
    if (fundamental?.floatMarketCap && fundamental.floatMarketCap > 0) {
      floatCapCache.set(code, fundamental.floatMarketCap)
      try {
        await redis.setex(FLOAT_CAP_CACHE_KEY(code), 86400, String(fundamental.floatMarketCap))
      } catch {}
      return fundamental.floatMarketCap
    }
  } catch {}

  return null
}

export async function crossValidate(data: MoneyFlowRealtime): Promise<void> {
  try {
    const dailyNetInflowAbs = await getMoneyFlowRepository().getLatestDailyNetInflow(data.code)
    if (dailyNetInflowAbs === null) return

    const dailyNetInflow = Math.abs(dailyNetInflowAbs)
    const rtNetInflow = Math.abs(data.netInflowMain)

    if (dailyNetInflow > 0 && rtNetInflow > 0) {
      const ratio = rtNetInflow / dailyNetInflow
      if (Number.isFinite(ratio) && ratio > 5) {
        await createAlert(data.code, data.name, 'cross_validate_fail', {
          message: `实时数据与日数据偏差过大 (${ratio.toFixed(1)}x)`,
          rtNetInflow: data.netInflowMain,
          dailyNetInflow: dailyNetInflowAbs,
        })
      }
    }
  } catch {}
}

async function processMoneyFlowItem(raw: any): Promise<void> {
  const code = raw.f12
  if (!code) return

  const name = raw.f14 || code
  const close = Number(raw.f2) || 0
  const netInflowMain = (Number(raw.f62) || 0) / 10000
  const netInflowSuperLarge = (Number(raw.f184) || 0) / 10000
  const netInflowLarge = (Number(raw.f62) || 0) / 10000 - netInflowSuperLarge
  const netInflowMedium = 0
  const netInflowSmall = 0
  const changePct = Number(raw.f3) || 0

  const data: MoneyFlowRealtime = {
    code,
    name,
    updateTime: new Date(),
    close,
    netInflowSuperLarge,
    netInflowLarge,
    netInflowMedium,
    netInflowSmall,
    netInflowMain,
    netInflowMainPct: close > 0 ? (netInflowMain / close) : 0,
  }

  lastDataTimestamp = Date.now()
  lastSuccessfulFetch = lastDataTimestamp

  await redis.setex(MONEYFLOW_LAST_UPDATE_KEY, 300, String(lastDataTimestamp))

  const limitUp = KNOWN_LIMITUP_CODES.has(code)
  const auctionAnomaly = isAuctionAnomaly(close)

  const floatCap = await getFloatMarketCap(code)
  const validation = validateData(data, floatCap || undefined)
  if (!validation.valid) {
    await createAlert(code, name, 'data_anomaly', { reason: validation.reason, ...data })
  }

  if (validation.valid) {
    await crossValidate(data)
  }

  await saveRealtimeMoneyFlow(data, {
    isLimitUp: limitUp,
    isAuctionAnomaly: auctionAnomaly,
    anomalyReason: auctionAnomaly ? 'zero_price_post_auction' : undefined,
  })

  await cacheMoneyFlow(code, data)
}

export function isAuctionAnomaly(close: number): boolean {
  const now = new Date()
  const h = now.getHours(), m = now.getMinutes()
  const timeNum = h * 100 + m
  if (timeNum < 930) return false
  if (timeNum > 931 && close === 0) return true
  return false
}

export function validateData(data: MoneyFlowRealtime, floatMarketCap?: number): { valid: boolean; reason?: string } {
  if (data.close <= 0) return { valid: false, reason: 'invalid_price' }
  if (Math.abs(data.netInflowMainPct) > 100) return { valid: false, reason: 'invalid_pct' }
  if (floatMarketCap && floatMarketCap > 0) {
    const mainInflowAbs = Math.abs(data.netInflowMain)
    const limitPct = floatMarketCap * 0.05
    if (mainInflowAbs > limitPct) {
      return { valid: false, reason: `inflow_exceeds_5pct_float_cap:${(mainInflowAbs / floatMarketCap * 100).toFixed(2)}%` }
    }
  }
  return { valid: true }
}

async function cacheMoneyFlow(code: string, data: MoneyFlowRealtime): Promise<void> {
  try {
    await redis.setex(MONEYFLOW_CACHE_KEY(code), 30, JSON.stringify(data))
  } catch {}
}

async function getCachedMoneyFlow(code: string): Promise<MoneyFlowRealtime | null> {
  try {
    const raw = await redis.get(MONEYFLOW_CACHE_KEY(code))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

async function saveDailyMoneyFlow(data: MoneyFlowData): Promise<void> {
  try {
    await getMoneyFlowRepository().saveDailyMoneyFlow(data)
  } catch (e: any) {
    console.error(`[MoneyFlow] Daily save error for ${data.code}:`, e.message)
  }
}

async function saveRealtimeMoneyFlow(data: MoneyFlowRealtime, flags: { isLimitUp: boolean; isAuctionAnomaly: boolean; anomalyReason?: string }): Promise<void> {
  try {
    await getMoneyFlowRepository().saveRealtimeMoneyFlow(data, flags)
  } catch (e: any) {
    console.error(`[MoneyFlow] Realtime save error for ${data.code}:`, e.message)
  }
}

async function createAlert(code: string, name: string, alertType: string, detail: object): Promise<void> {
  try {
    const existing = await getMoneyFlowRepository().getAlert(code, alertType)
    if (existing) return
    await getMoneyFlowRepository().saveAlert(code, name, alertType, detail)
  } catch {}
}

async function updateSourceStatus(success: boolean, failMsg?: string): Promise<void> {
  try {
    await getMoneyFlowRepository().updateSourceStatus(success, failMsg)
  } catch {}
}

export async function fetchAllDailyMoneyFlow(): Promise<number> {
  const allStocks = await getMoneyFlowRepository().getActiveStocks()
  let saved = 0
  const BATCH = 20

  for (let i = 0; i < allStocks.length; i += BATCH) {
    const chunk = allStocks.slice(i, i + BATCH)
    const results = await Promise.allSettled(chunk.map(s => fetchDailyMoneyFlow(s.code, 5)))

    for (let j = 0; j < chunk.length; j++) {
      const result = results[j]
      if (result.status !== 'fulfilled') continue
      for (const data of result.value) {
        await saveDailyMoneyFlow(data)
        saved++
      }
    }

    console.log(`[MoneyFlow] Daily: ${Math.min(i + BATCH, allStocks.length)}/${allStocks.length}`)
    await new Promise(r => setTimeout(r, 200))
  }

  return saved
}

let controller: AbortController | null = null
let sseRetryTimeout: ReturnType<typeof setTimeout> | null = null
let staleCheckInterval: ReturnType<typeof setInterval> | null = null
let healthCheckInterval: ReturnType<typeof setInterval> | null = null

async function sseConnect(): Promise<void> {
  if (controller) {
    controller.abort()
    controller = null
  }
  controller = new AbortController()

  const url = `${SSE_URL}?pn=1&pz=100&np=1&fltt=2&invt=2&fs=m:0+t:6,m:0+t:13,m:1+t:2,m:1+t:23&fields=${SSE_FIELDS}`

  currentStatus = reconnectAttempts === 0 ? 'connecting' : 'reconnecting'
  console.log(`[MoneyFlow] Connecting SSE (attempt ${reconnectAttempts + 1})...`)

  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY)

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://quote.eastmoney.com/',
      },
      signal: controller.signal,
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    reconnectAttempts = 0
    currentStatus = 'connected'
    console.log('[MoneyFlow] SSE connected')

    const reader = res.body?.getReader()
    if (!reader) throw new Error('No readable stream')

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data:')) continue
          try {
            const jsonStr = line.slice(5).trim()
            const json = JSON.parse(jsonStr)
            const items: any[] = json?.data?.diff || []
            for (const item of items) {
              await processMoneyFlowItem(item).catch(() => {})
            }
          } catch {}
        }
      }
    } finally {
      reader.releaseLock()
    }
  } catch (e: any) {
    if (e.name === 'AbortError') return
    console.error(`[MoneyFlow] SSE error: ${e.message}`)
    scheduleReconnect()
  }
}

function scheduleReconnect(): void {
  if (currentStatus === 'disconnected') return

  reconnectAttempts++
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY)
  currentStatus = reconnectAttempts >= MAX_RECONNECT_ATTEMPTS ? 'failed' : 'reconnecting'

  if (sseRetryTimeout) clearTimeout(sseRetryTimeout)
  sseRetryTimeout = setTimeout(() => {
    sseConnect()
  }, delay)

  console.log(`[MoneyFlow] Scheduling reconnect in ${Math.round(delay / 1000)}s`)
}

function checkStaleData(): void {
  const now = Date.now()
  if (lastDataTimestamp > 0 && now - lastDataTimestamp > MONEYFLOW_STALE_THRESHOLD_MS) {
    console.warn(`[MoneyFlow] Data stale: ${Math.round((now - lastDataTimestamp) / 1000)}s without update`)
    createAlert('SYSTEM', 'SYSTEM', 'data_stale', {
      message: `数据停止更新超过 ${Math.round((now - lastDataTimestamp) / 1000)} 秒`,
      lastUpdate: new Date(lastDataTimestamp).toISOString(),
      staleMs: now - lastDataTimestamp,
    }).catch(() => {})
  }
}

function checkConnectionHealth(): void {
  const now = Date.now()
  if (lastSuccessfulFetch > 0 && now - lastSuccessfulFetch > MONEYFLOW_STALE_THRESHOLD_MS) {
    console.warn(`[MoneyFlow] Health check failed: ${Math.round((now - lastSuccessfulFetch) / 1000)}s since last fetch`)
    if (currentStatus === 'connected') {
      currentStatus = 'degraded'
    }
  }
}

export async function startRealtime(): Promise<void> {
  if (currentStatus === 'connected' || currentStatus === 'connecting') return

  console.log('[MoneyFlow] Starting real-time feed...')

  try {
    await getLimitUpCodes()
    await updateSourceStatus(true)
  } catch (e: any) {
    console.warn(`[MoneyFlow] Init error: ${e.message}`)
  }

  if (staleCheckInterval) clearInterval(staleCheckInterval)
  staleCheckInterval = setInterval(checkStaleData, MONEYFLOW_STALE_THRESHOLD_MS)

  if (healthCheckInterval) clearInterval(healthCheckInterval)
  healthCheckInterval = setInterval(checkConnectionHealth, MONEYFLOW_STALE_THRESHOLD_MS)

  await sseConnect()

  console.log('[MoneyFlow] Real-time feed initialized')
}

export function stopRealtime(): void {
  if (controller) {
    controller.abort()
    controller = null
  }
  if (sseRetryTimeout) {
    clearTimeout(sseRetryTimeout)
    sseRetryTimeout = null
  }
  if (staleCheckInterval) {
    clearInterval(staleCheckInterval)
    staleCheckInterval = null
  }
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval)
    healthCheckInterval = null
  }
  currentStatus = 'disconnected'
  console.log('[MoneyFlow] Real-time feed stopped')
}

export async function backfillDaily(days = 5): Promise<number> {
  console.log(`[MoneyFlow] Backfilling daily data for last ${days} days...`)
  return fetchAllDailyMoneyFlow()
}

export async function getMoneyFlow5d(code: string): Promise<{ netInflowMain: number; count: number } | null> {
  try {
    const rows = await getMoneyFlowRepository().getDailyMoneyFlow(code)
    const sorted = [...rows].sort((a, b) => {
      const da = new Date(a.tradeDate as any).getTime()
      const db = new Date(b.tradeDate as any).getTime()
      return db - da
    }).slice(0, 5)

    if (sorted.length === 0) return null

    const total = sorted.reduce((sum, r) => sum + Number(r.netInflowMain || 0), 0)
    return { netInflowMain: total, count: rows.length }
  } catch {
    return null
  }
}

export async function getRealtimeMoneyFlow(code: string): Promise<MoneyFlowRealtime | null> {
  const cached = await getCachedMoneyFlow(code)
  if (cached) return cached

  const raw = await fetchRealtimeMoneyFlow(code)
  if (!raw) return null
  await cacheMoneyFlow(code, raw)
  return raw
}

export function getConnectionStatus(): { status: ConnectionStatus; source: string; lastUpdate: number } {
  return {
    status: currentStatus,
    source: currentSource,
    lastUpdate: lastDataTimestamp,
  }
}
