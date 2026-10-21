import { broadcast } from './wsServer.js'
import { redis } from '../data/redis.js'
import type { KLine } from '../../shared/types.js'
import { LazyIndicators } from '../indicators/index.js'
import { shouldBlockAlert } from './smartFilters.js'
import { getMoneyFlowAlertRepository, setMoneyFlowAlertRepository } from '../repositories/IMoneyFlowAlertRepository.js'

export { setMoneyFlowAlertRepository }

const ALERT_DEDUP_KEY = (code: string, configId: number) => `mf_alert_dedup:${code}:${configId}`
const DEDUP_TTL = 300

interface MoneyFlowRealtimeRow {
  code: string
  name: string
  netInflowMain: string | number | null
  netInflowMainPct: string | number | null
  closePrice: string | number | null
  updateTime: Date
}

async function checkTechResonance(code: string, config: { techResonanceMacd: boolean; techResonanceMa: boolean }): Promise<boolean> {
  if (!config.techResonanceMacd && !config.techResonanceMa) return true

  try {
    const repo = getMoneyFlowAlertRepository()
    const klines = await repo.getKlinesForTech(code, 90)

    if (klines.length < 30) return true
    const ind = new LazyIndicators(klines, new Set(['ma5', 'ma20', 'macd']))

    if (config.techResonanceMacd) {
      const m = ind.macd
      const n = m.macd.length
      if (n >= 2) {
        const prevMacd = m.macd[n - 2], currMacd = m.macd[n - 1]
        const prevSignal = m.signal[n - 2], currSignal = m.signal[n - 1]
        if (prevMacd <= prevSignal && currMacd > currSignal) return true
      }
    }

    if (config.techResonanceMa) {
      const ma = ind.mas
      const ma5 = ma['MA5'], ma20 = ma['MA20']
      if (ma5 && ma20 && ma5.length >= 2 && ma20.length >= 2) {
        const n5 = ma5.length, n20 = ma20.length
        if (ma5[n5 - 2] <= ma20[n5 - 2] && ma5[n5 - 1] > ma20[n5 - 1]) return true
      }
    }

    return false
  } catch {
    return true
  }
}

async function isDupulicated(code: string, configId: number): Promise<boolean> {
  try {
    const exists = await redis.exists(ALERT_DEDUP_KEY(code, configId))
    return exists === 1
  } catch {
    return false
  }
}

async function markAlerted(code: string, configId: number): Promise<void> {
  try {
    await redis.setex(ALERT_DEDUP_KEY(code, configId), DEDUP_TTL, '1')
  } catch {}
}

async function pushAlert(config: any, data: MoneyFlowRealtimeRow, reason: string): Promise<void> {
  broadcast({
    type: 'alert_triggered',
    code: data.code,
    name: data.name,
    message: reason,
    timestamp: new Date().toISOString(),
    price: Number(data.closePrice),
    change: Number(data.netInflowMain),
  })

  try {
    const repo = getMoneyFlowAlertRepository()
    await repo.saveAlert(data.code, data.name, 'threshold', {
      configId: config.id, reason, netInflowMain: data.netInflowMain,
      netInflowMainPct: data.netInflowMainPct, closePrice: data.closePrice,
    })
  } catch {}
}

async function checkAlert(config: any, data: MoneyFlowRealtimeRow): Promise<void> {
  if (!config.enabled) return

  const code = config.code
  if (code && code !== data.code) return

  const netInflowMain = Number(data.netInflowMain)
  const netInflowMainPct = Number(data.netInflowMainPct)
  const thresholdValue = Number(config.thresholdValue)

  let triggered = false
  let reason = ''

  if (config.thresholdType === 'absolute') {
    const effective = config.direction === 'outflow' ? -netInflowMain : netInflowMain
    if (effective >= thresholdValue) {
      triggered = true
      reason = `绝对值阈值触发：${config.direction === 'outflow' ? '流出' : '流入'} ${(effective / 10000).toFixed(2)}万 ≥ ${(thresholdValue / 10000).toFixed(2)}万`
    }
  } else if (config.thresholdType === 'relative') {
    const pct = config.direction === 'outflow' ? -netInflowMainPct : netInflowMainPct
    if (pct >= thresholdValue) {
      triggered = true
      reason = `变化率阈值触发：${config.direction === 'outflow' ? '流出率' : '流入率'} ${pct.toFixed(2)}% ≥ ${thresholdValue.toFixed(2)}%`
    }
  }

  if (!triggered) return
  if (await isDupulicated(data.code, config.id)) return

  const repo = getMoneyFlowAlertRepository()

  if (config.basicFilterEnabled) {
    if (await repo.isST(data.code)) return
    if (await repo.isLimitUp(data.code)) return
  }

  if (config.techResonanceEnabled) {
    const techOk = await checkTechResonance(data.code, {
      techResonanceMacd: !!config.techResonanceMacd,
      techResonanceMa: !!config.techResonanceMa,
    })
    if (!techOk) return
  }

  if (config.smartFilterEnabled) {
    const { blocked, reasons } = await shouldBlockAlert(data.code, data.name)
    if (blocked) {
      console.log(`[MoneyFlowAlert] Blocked ${data.code}: ${reasons.join(', ')}`)
      return
    }
  }

  await pushAlert(config, data, reason)
  await markAlerted(data.code, config.id)
}

let checkInterval: ReturnType<typeof setInterval> | null = null
let isRunning = false

export async function startAlertEngine(): Promise<void> {
  if (isRunning) return
  isRunning = true
  console.log('[MoneyFlowAlert] Engine starting...')

  checkInterval = setInterval(async () => {
    try {
      const now = new Date()
      const h = now.getHours(), m = now.getMinutes()
      const timeNum = h * 100 + m
      if (timeNum < 930 || timeNum >= 1500) return

      const recent = new Date()
      recent.setMinutes(recent.getMinutes() - 5)

      const repo = getMoneyFlowAlertRepository()
      const configs = await repo.getEnabledConfigs()

      if (!configs.length) return

      const recentRows = await repo.getRecentRealtimeData(recent, 500)

      for (const data of recentRows) {
        for (const config of configs) {
          await checkAlert(config, data)
        }
      }
    } catch (e: any) {
      console.error('[MoneyFlowAlert] Check error:', e.message)
    }
  }, 30_000)

  console.log('[MoneyFlowAlert] Engine started (30s check interval)')
}

export function stopAlertEngine(): void {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
  isRunning = false
  console.log('[MoneyFlowAlert] Engine stopped')
}

export async function createAlertConfig(userId: number, params: {
  code?: string; name?: string; thresholdType: string; thresholdValue: number;
  direction?: string; techResonanceEnabled?: boolean; techResonanceMacd?: boolean;
  techResonanceMa?: boolean; basicFilterEnabled?: boolean; smartFilterEnabled?: boolean;
}): Promise<number> {
  const repo = getMoneyFlowAlertRepository()
  return repo.createAlertConfig(userId, params)
}

export async function listAlertConfigs(userId: number): Promise<any[]> {
  const repo = getMoneyFlowAlertRepository()
  return repo.listAlertConfigs(userId)
}

export async function deleteAlertConfig(userId: number, configId: number): Promise<boolean> {
  const repo = getMoneyFlowAlertRepository()
  return repo.deleteAlertConfig(userId, configId)
}

export async function toggleAlertConfig(userId: number, configId: number, enabled: boolean): Promise<boolean> {
  const repo = getMoneyFlowAlertRepository()
  return repo.toggleAlertConfig(userId, configId, enabled)
}
