import { broadcast } from './wsServer.js'
import { redis } from '../data/redis.js'
import { LazyIndicators } from '../indicators/index.js'
import type { KLine } from '../../shared/types.js'
import { getCompositeAlertRepository, setCompositeAlertRepository } from '../repositories/ICompositeAlertRepository.js'

export { setCompositeAlertRepository }

const DEDUP_KEY = (code: string, type: string) => `composite_alert:${type}:${code}`
const DEDUP_TTL = 300
const STATE_KEY = (code: string) => `composite_state:${code}`

type CompositeState = 'IDLE' | 'WATCHING_INFLOW' | 'WATCHING_OUTFLOW' | 'CONFIRMED_INFLOW' | 'CONFIRMED_OUTFLOW' | 'RESONANCE_TRIGGERED'

interface StateEntry {
  state: CompositeState
  inflowMinutes: number
  outflowMinutes: number
  lastFlow: number
  lastUpdate: number
  resonanceTriggered: boolean
  resonanceTime?: number
}

async function getState(code: string): Promise<StateEntry> {
  try {
    const raw = await redis.get(STATE_KEY(code))
    if (raw) return JSON.parse(raw)
  } catch {}
  return { state: 'IDLE', inflowMinutes: 0, outflowMinutes: 0, lastFlow: 0, lastUpdate: Date.now(), resonanceTriggered: false }
}

async function saveState(code: string, entry: StateEntry): Promise<void> {
  try {
    await redis.setex(STATE_KEY(code), 600, JSON.stringify(entry))
  } catch {}
}

async function logTransition(code: string, from: CompositeState, to: CompositeState, context: object): Promise<void> {
  try {
    const repo = getCompositeAlertRepository()
    await repo.saveAlert(code, code, `state_${from}_${to}`, {
      ...context, from, to, ts: new Date().toISOString(),
    })
  } catch {}
}

async function isDupulicated(code: string, type: string): Promise<boolean> {
  try {
    return await redis.exists(DEDUP_KEY(code, type)) === 1
  } catch {
    return false
  }
}

async function markAlerted(code: string, type: string): Promise<void> {
  try {
    await redis.setex(DEDUP_KEY(code, type), DEDUP_TTL, '1')
  } catch {}
}

async function checkMacdGoldenCross(code: string): Promise<boolean> {
  try {
    const repo = getCompositeAlertRepository()
    const rows = await repo.getKlinesForMacd(code, 60)
    if (rows.length < 30) return false
    const klines = rows
    const ind = new LazyIndicators(klines, new Set(['macd']))
    const m = ind.macd
    const n = m.macd.length
    if (n < 2) return false
    const prevMacd = m.macd[n - 2], currMacd = m.macd[n - 1]
    const prevSignal = m.signal[n - 2], currSignal = m.signal[n - 1]
    return prevMacd <= prevSignal && currMacd > currSignal
  } catch {
    return false
  }
}

async function checkVolumeSurge(code: string): Promise<number> {
  try {
    const repo = getCompositeAlertRepository()
    const rows = await repo.getKlinesForVolume(code, 30)
    if (rows.length < 20) return 1
    const klines = rows
    const avgVol = klines.slice(0, -1).reduce((s, k) => s + k.volume, 0) / (klines.length - 1)
    const todayVol = klines[klines.length - 1].volume
    return avgVol > 0 ? todayVol / avgVol : 1
  } catch {
    return 1
  }
}

export async function checkSustainedFlow(code: string, netInflowMain: number, config: { sustainedMinutes: number }): Promise<{ sustained: boolean; direction: 'inflow' | 'outflow' }> {
  const entry = await getState(code)
  const now = Date.now()
  const stale = now - entry.lastUpdate > 120_000

  let newState: CompositeState = entry.state
  let inflowMins = entry.inflowMinutes
  let outflowMins = entry.outflowMinutes
  const isInflow = netInflowMain > 0
  const isOutflow = netInflowMain < 0

  if (stale) {
    inflowMins = 0
    outflowMins = 0
  }

  if (isInflow) {
    inflowMins = stale ? 1 : inflowMins + 1
    outflowMins = 0
    if (inflowMins >= config.sustainedMinutes) {
      newState = 'CONFIRMED_INFLOW'
    } else if (entry.state === 'IDLE' || entry.state === 'WATCHING_OUTFLOW') {
      newState = 'WATCHING_INFLOW'
    }
  } else if (isOutflow) {
    outflowMins = stale ? 1 : outflowMins + 1
    inflowMins = 0
    if (outflowMins >= config.sustainedMinutes) {
      newState = 'CONFIRMED_OUTFLOW'
    } else if (entry.state === 'IDLE' || entry.state === 'WATCHING_INFLOW') {
      newState = 'WATCHING_OUTFLOW'
    }
  } else {
    inflowMins = 0
    outflowMins = 0
    newState = 'IDLE'
  }

  const newEntry: StateEntry = {
    state: newState,
    inflowMinutes: inflowMins,
    outflowMinutes: outflowMins,
    lastFlow: netInflowMain,
    lastUpdate: now,
    resonanceTriggered: entry.resonanceTriggered,
    resonanceTime: entry.resonanceTime,
  }

  if (newState !== entry.state) {
    await logTransition(code, entry.state, newState, {
      inflowMins, outflowMins, netInflowMain,
    })
  }
  await saveState(code, newEntry)

  const sustained = newState === 'CONFIRMED_INFLOW' || newState === 'CONFIRMED_OUTFLOW'
  return { sustained, direction: newState === 'CONFIRMED_INFLOW' ? 'inflow' : 'outflow' }
}

async function pushCompositeAlert(code: string, name: string, reason: string, detail: object): Promise<void> {
  broadcast({
    type: 'alert_triggered',
    code,
    name,
    message: reason,
    timestamp: new Date().toISOString(),
    alertType: 'composite',
    ...detail as any,
  })
  try {
    const repo = getCompositeAlertRepository()
    await repo.saveAlert(code, name, 'composite_resonance', { reason, ...detail })
  } catch {}
}

interface MoneyFlowRow {
  code: string
  name: string
  netInflowMain: string | number | null
  netInflowMainPct: string | number | null
  closePrice: string | number | null
  updateTime: Date
}

export async function checkCompositeAlert(
  data: MoneyFlowRow,
  options: { sustainedMinutes: number; inflowThreshold: number; volumeRatioMin: number }
): Promise<void> {
  const repo = getCompositeAlertRepository()
  if (await repo.isSTOrLimitUp(data.code)) return

  const netInflowMain = Number(data.netInflowMain)
  const [macdCross, volRatio] = await Promise.all([
    checkMacdGoldenCross(data.code),
    checkVolumeSurge(data.code),
  ])

  const { sustained, direction } = await checkSustainedFlow(data.code, netInflowMain, {
    sustainedMinutes: options.sustainedMinutes,
  })

  const inflowOk = netInflowMain > options.inflowThreshold
  const volOk = volRatio >= options.volumeRatioMin

  if (inflowOk && macdCross && volOk && sustained) {
    if (await isDupulicated(data.code, 'resonance')) return
    const reason = `三重共振：资金流入${(netInflowMain / 10000).toFixed(2)}万 + MACD金叉 + 放量${volRatio.toFixed(1)}倍 + 连续${options.sustainedMinutes}分钟净流入`
    await pushCompositeAlert(data.code, data.name, reason, {
      netInflowMain,
      netInflowMainPct: data.netInflowMainPct,
      macdCross,
      volumeRatio: volRatio,
      sustainedDirection: direction,
      sustainedMinutes: options.sustainedMinutes,
      price: data.closePrice,
    })
    await markAlerted(data.code, 'resonance')
    const entry = await getState(data.code)
    entry.resonanceTriggered = true
    entry.resonanceTime = Date.now()
    await saveState(data.code, entry)
    return
  }

  if (sustained && inflowOk) {
    const type = direction === 'inflow' ? 'sustained_inflow' : 'sustained_outflow'
    if (await isDupulicated(data.code, type)) return
    const reason = `连续${options.sustainedMinutes}分钟${direction === 'inflow' ? '净流入' : '净流出'}: ${(netInflowMain / 10000).toFixed(2)}万`
    await pushCompositeAlert(data.code, data.name, reason, {
      netInflowMain,
      sustainedDirection: direction,
      sustainedMinutes: options.sustainedMinutes,
      price: data.closePrice,
    })
    await markAlerted(data.code, type)
  }
}

let checkInterval: ReturnType<typeof setInterval> | null = null
let isRunning = false

export async function startCompositeAlertEngine(): Promise<void> {
  if (isRunning) return
  isRunning = true
  console.log('[CompositeAlert] Engine starting...')

  checkInterval = setInterval(async () => {
    try {
      const now = new Date()
      const h = now.getHours(), m = now.getMinutes()
      const timeNum = h * 100 + m
      if (timeNum < 930 || timeNum >= 1500) return

      const recent = new Date()
      recent.setMinutes(recent.getMinutes() - 5)

      const repo = getCompositeAlertRepository()
      const recentRows = await repo.getRecentRealtimeData(recent, 500)

      const options = {
        sustainedMinutes: 3,
        inflowThreshold: 1000_0000,
        volumeRatioMin: 1.5,
      }

      for (const data of recentRows) {
        await checkCompositeAlert(data, options).catch(() => {})
      }
    } catch (e: any) {
      console.error('[CompositeAlert] Check error:', e.message)
    }
  }, 30_000)

  console.log('[CompositeAlert] Engine started (30s check interval, 3min sustained, 1.5x volume)')
}

export function stopCompositeAlertEngine(): void {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
  isRunning = false
  console.log('[CompositeAlert] Engine stopped')
}

export async function getCompositeState(code: string): Promise<StateEntry> {
  return getState(code)
}
