import cron from 'node-cron'
import { sql } from 'drizzle-orm'
import { getStocksRepository } from '../repositories/IStocksRepository.js'
import { getSignalsRepository } from '../repositories/ISignalsRepository.js'
import { getDailyMetricsRepository } from '../repositories/IDailyMetricsRepository.js'
import { getRecTrackingRepository } from '../repositories/IRecTrackingRepository.js'
import { getSchedulerLogRepository } from '../repositories/ISchedulerLogRepository.js'
import { getUsersRepository } from '../repositories/IUsersRepository.js'
import { getPredictionsRepository } from '../repositories/IPredictionsRepository.js'
import { getOrFetchKlines, getOrFetchMinuteKlines } from '../data/cache.js'
import { scanStock } from '../scan/index.js'
import { db } from '../db/db.js'
import { stocks, signals, priceAlerts, dailyPicks, positions } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { computeLimitUpRecords } from './limitUp.js'
import { calcRSI, calcMACD, calcMA, calcBollinger } from '../indicators/index.js'
import type { KLine, MinutePeriod } from '../../shared/types.js'

function loadProModules(): any {
  const mod = { __esModule: true } as any
  async function load(name: string, fnName: string) {
    try { const m = await import(name); mod[fnName] = m[fnName] } catch {}
  }
  let loaded = false
  mod._ensure = async () => {
    if (loaded) return
    loaded = true
    await Promise.all([
      load('../ai/predict.js', 'evaluatePredictions'),
      load('../ai/predict.js', 'selectDailyPicks'),
      load('../ai/predict.js', 'getHoldings'),
      load('../ai/predict.js', 'loadKlines'),
      load('../ai/predict.js', 'predictOne'),
      load('../ai/predict.js', 'savePrediction'),
      load('../ai/dailyPicksAI.js', 'generateDailyPicks'),
      load('../ai/pickEvaluator.js', 'evaluateAllUnrated'),
      load('../ai/positionAlert.js', 'analyzeAllPositions'),
      load('../ai/intradayAlert.js', 'checkIntradayAnomalies'),
      load('./push/dispatcher.js', 'dispatchPush'),
    ])
  }
  return mod
}

const pro = loadProModules()

function getBoard(code: string, exchange: string): string {
  if (exchange === 'SH') {
    if (code.startsWith('688')) return 'kcb'
    return 'hsb'
  }
  if (code.startsWith('30')) return 'cyb'
  return 'hsb'
}

export async function computeDailyMetrics(metricDate?: string): Promise<number> {
  const finalDate = metricDate || today()
  if (!(await marketDataReady(finalDate))) {
    console.log(`[Scheduler] 日指标 ${finalDate}：行情还没入库，跳过（等 18:00 同步后再算）`)
    return 0
  }
  const allStocks = await getStocksRepository().findAll()
  const BATCH = 50
  let computed = 0

  for (let i = 0; i < allStocks.length; i += BATCH) {
    const chunk = allStocks.slice(i, i + BATCH)
    await Promise.allSettled(chunk.map(async (stock) => {
      try {
        const { rows } = await db.execute(sql`
          SELECT date::text, open::numeric, high::numeric, low::numeric,
                 close::numeric, volume, amount::numeric
          FROM klines
          WHERE code = ${stock.code}
          ORDER BY date DESC
          LIMIT 90
        `) as { rows: any[] }

        if (!rows.length || rows.length < 20) return

        const klines = rows.reverse() as KLine[]
        const closes = klines.map(k => k.close)
        const last = closes[closes.length - 1]

        const rsiArr = calcRSI(klines)
        const lastRSI = rsiArr[rsiArr.length - 1]

        const macd = calcMACD(klines)
        const lastMacd = macd.macd[macd.macd.length - 1]
        const lastSignal = macd.signal[macd.signal.length - 1]
        const macdSignal = lastMacd - lastSignal

        const ma5 = calcMA(klines, [5]).MA5
        const ma20 = calcMA(klines, [20]).MA20
        const ma60 = calcMA(klines, [60]).MA60
        const lastMa5 = ma5?.[ma5.length - 1]
        const lastMa20 = ma20?.[ma20.length - 1]
        const lastMa60 = ma60?.[ma60.length - 1]

        const bb = calcBollinger(klines, 20, 2)
        const bbUpper = bb.upper[bb.upper.length - 1]
        const bbLower = bb.lower[bb.lower.length - 1]
        const bbPos = bbUpper !== bbLower ? ((last - bbLower) / (bbUpper - bbLower)) * 100 : 50

        const maAlign = (!isNaN(lastMa5) && !isNaN(lastMa20) && !isNaN(lastMa60)) ?
          (lastMa5 > lastMa20 && lastMa20 > lastMa60 ? 1 : 0) : 0

        const avgVol = klines.slice(-20).reduce((s, k) => s + k.volume, 0) / 20
        const volRatio = avgVol > 0 ? klines[klines.length - 1].volume / avgVol : 1

        const returns: number[] = []
        for (let j = 1; j < klines.length; j++) {
          returns.push(Math.log(klines[j].close / klines[j - 1].close))
        }
        const mean = returns.reduce((s, r) => s + r, 0) / returns.length
        const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length
        const volatility = Math.sqrt(variance * 252) * 100

        const mom10 = closes.length >= 11 ? ((closes[closes.length - 1] - closes[closes.length - 11]) / closes[closes.length - 11]) * 100 : 0

        const prevClose = klines.length >= 2 ? klines[klines.length - 2].close : last
        const changePct = prevClose > 0 ? ((last - prevClose) / prevClose) * 100 : 0

        const board = getBoard(stock.code, stock.exchange)

        await getDailyMetricsRepository().upsert({
          metricDate: finalDate,
          code: stock.code,
          name: stock.name,
          exchange: stock.exchange,
          board,
          rsi: String(Math.round(lastRSI * 10) / 10),
          changePct: String(Math.round(changePct * 100) / 100),
          volRatio: String(Math.round(volRatio * 100) / 100),
          macdSignal: String(Math.round(macdSignal * 100) / 100),
          bbPosition: String(Math.round(bbPos * 10) / 10),
          maAlignment: maAlign,
          volatility: String(Math.round(volatility * 1000000) / 1000000),
          momentum: String(Math.round(mom10 * 100) / 100),
        })
        computed++
      } catch (e: any) {}
    }))
    console.log(`[Metrics] ${Math.min(i + BATCH, allStocks.length)}/${allStocks.length}...`)
  }
  // 和信号扫描同样的道理：0 产出被记成 success，catch-up 就永远不再重试，
  // 指标排行/选股筛选会静默停在旧日期上
  if (allStocks.length > 0 && computed === 0) {
    throw new Error(`日指标计算失败：${allStocks.length} 只股票一只都没算出来`)
  }
  console.log(`[Scheduler] Daily metrics computed: ${computed}/${allStocks.length} stocks`)
  return computed
}

async function signalScanForDate(scanDate: string): Promise<number> {
  if (!(await marketDataReady(scanDate))) {
    console.log(`[Scheduler] 信号扫描 ${scanDate}：行情还没入库，跳过`)
    return 0
  }
  const allStocks = await getStocksRepository().findAll()
  let signalsWritten = 0
  let stocksExamined = 0
  let writeErrors = 0
  let firstWriteError = ''
  const BATCH_SIZE = 50
  for (let i = 0; i < allStocks.length; i += BATCH_SIZE) {
    const chunk = allStocks.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      chunk.map(async (s) => {
        try {
          const cache = await getOrFetchKlines(s.code)
          const scanned = scanStock(s.code, s.name, cache.klines)
          if (!scanned) return null
          return { s, scanned }
        } catch { return null }
      })
    )
    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      stocksExamined++
      if (!result.value) continue
      const { s, scanned } = result.value
      for (const sig of scanned.signals) {
        try {
          await getSignalsRepository().create({
            code: s.code, name: s.name, scanDate,
            strategyId: sig.strategyId, strategyName: sig.strategyName,
            direction: sig.direction, strength: sig.strength,
            price: String(scanned.price), reason: `${sig.strategyName} ${sig.direction}`,
          })
          signalsWritten++
        } catch (e: any) {
          // 写入失败不能吞：之前这里 catch {} 让"每天 0 产出"被记成 success，
          // 免费版第一卖点（信号扫描）静默死了一个多月都没人发现
          writeErrors++
          if (!firstWriteError) firstWriteError = e?.message || String(e)
        }
      }
    }
  }
  // 一只都没扫到 = 扫描链路坏了（K 线取不到 / 指标全 NaN）。
  // 这种"0 结果"必须当失败记，否则 catch-up 会一直判定为 up-to-date，
  // 免费版第一卖点（信号扫描）就静默死掉，没人发现。
  if (allStocks.length > 0 && stocksExamined === 0) {
    throw new Error(`信号扫描失败：${allStocks.length} 只股票都没能取到 K 线`)
  }
  // 有信号却一条都写不进去 = 写库坏了（列约束/迁移问题），同样必须报失败
  if (signalsWritten === 0 && writeErrors > 0) {
    throw new Error(`信号扫描失败：产出信号但全部写入失败（${writeErrors} 次）：${firstWriteError}`)
  }
  if (writeErrors > 0) {
    console.warn(`[Scheduler] Signal scan ${scanDate}: 有 ${writeErrors} 次写入失败（首个错误：${firstWriteError}）`)
  }
  console.log(`[Scheduler] Signal scan ${scanDate}: 检查 ${stocksExamined}/${allStocks.length}，产出 ${signalsWritten} 个信号`)
  return signalsWritten
}

async function aiDailyPicksForDate(pickDate: string): Promise<number> {
  await pro._ensure()
  if (!pro.generateDailyPicks) return 0
  const picks = await pro.generateDailyPicks()
  if (picks.length === 0) return 0
  for (const p of picks) {
    const existing = await getRecTrackingRepository().findByCodeAndDate(p.code, pickDate)
    if (!existing) {
      await getRecTrackingRepository().create({ code: p.code, name: p.name, pickDate, status: 'pending' })
    }
  }
  return picks.length
}

async function aiPredictionsForDate(predictDate: string): Promise<number> {
  await pro._ensure()
  // 没有预测日当天的 K 线就别预测：否则基准价是几天前的，
  // 评估时会把多天涨跌算成 1 天（生产 118 条历史全是这么被污染的）
  if (!(await marketDataReady(predictDate))) {
    console.log(`[Scheduler] AI 预测 ${predictDate}：行情还没入库，跳过`)
    return 0
  }
  const targetDateStr = nextTradingDay(predictDate)

  const picks = pro.selectDailyPicks ? await pro.selectDailyPicks(30) : []
  const proUsers = await getUsersRepository().findProUsers()
  const allHoldings = new Set<string>()
  for (const u of proUsers) {
    const h = pro.getHoldings ? await pro.getHoldings(u.id) : []
    h.forEach((c: any) => allHoldings.add(c))
  }
  picks.forEach((p: any) => allHoldings.add(p.code))

  // ai/predict.js 属于 Pro 边界：OSS 版里是 stub，没有这些导出。
  // 这里只在「有候选股」时才会执行（OSS 下永远进不来），用 any 绕开 stub 的类型面。
  const predictMod: any = await import('../ai/predict.js')
  const { loadKlines, predictOne, savePrediction, marketBreadthText } = predictMod
  const { getMoneyFlow5d } = await import('./moneyFlowService.js')
  // 市场环境只查一次，整批共用
  const marketContext = await marketBreadthText(predictDate)
  let ok = 0
  let failed = 0
  let firstError = ''
  for (const code of allHoldings) {
    try {
      const klines = await loadKlines(code, 90)
      if (klines.length < 30) continue
      const last = klines[klines.length - 1]
      const mf5d = await getMoneyFlow5d(code)
      const result = await predictOne({ code, name: picks.find((p: any) => p.code === code)?.name || code, klines, daysAhead: 1, mainNetInflow5d: mf5d?.netInflowMain, marketContext })
      await savePrediction(code, '', predictDate, targetDateStr, last.close, result, klines[klines.length - 1].date)
      ok++
      await new Promise(r => setTimeout(r, 200))
    } catch (e: any) {
      // 不能吞：之前这里 catch {} 让「模型名写错 + 资金流 null 崩溃」这种
      // 全量失败被记成 success/0 产出，AI 预测静默死了一个多月
      failed++
      if (!firstError) firstError = e?.message || String(e)
    }
  }
  if (allHoldings.size > 0 && ok === 0 && failed > 0) {
    throw new Error(`AI 预测全部失败（${failed} 只）：${firstError}`)
  }
  if (failed > 0) console.warn(`[Scheduler] AI 预测 ${predictDate}: ${failed} 只失败（首个错误：${firstError}）`)
  return ok
}

async function checkPriceAlerts() {
  const activeAlerts = await db.select().from(priceAlerts)
    .where(and(eq(priceAlerts.enabled, true)))

  if (activeAlerts.length === 0) return

  const alertMap = new Map<string, typeof activeAlerts>()
  for (const alert of activeAlerts) {
    if (!alertMap.has(alert.code)) alertMap.set(alert.code, [])
    alertMap.get(alert.code)!.push(alert)
  }

  const codes = [...alertMap.keys()]
  const BATCH_SIZE = 30

  for (let i = 0; i < codes.length; i += BATCH_SIZE) {
    const batch = codes.slice(i, i + BATCH_SIZE)
    await Promise.all(
      batch.map(async (code) => {
        try {
          const cache = await getOrFetchKlines(code)
          if (!cache.klines.length) return
          const latest = cache.klines[cache.klines.length - 1]
          const yesterday = cache.klines.length >= 2 ? cache.klines[cache.klines.length - 2] : null
          const currentPrice = Number(latest.close)
          const changePct = yesterday ? ((currentPrice - Number(yesterday.close)) / Number(yesterday.close)) * 100 : 0

          const alerts = alertMap.get(code) || []
          for (const alert of alerts) {
            if (alert.triggeredAt) continue
            let triggered = false
            const target = Number(alert.targetValue)

            switch (alert.condition) {
              case 'price_gte': triggered = currentPrice >= target; break
              case 'price_lte': triggered = currentPrice <= target; break
              case 'change_pct_gte': triggered = changePct >= target; break
              case 'change_pct_lte': triggered = changePct <= target; break
              case 'cross_above':
              case 'cross_below': {
                if (cache.klines.length < 2) break
                const maShort: number[] = []
                const maLong: number[] = []
                const period = Math.round(target)
                for (let j = Math.max(0, cache.klines.length - period * 2); j < cache.klines.length; j++) {
                  const sumShort = cache.klines.slice(Math.max(0, j - period + 1), j + 1).reduce((s, k) => s + Number(k.close), 0)
                  maShort.push(sumShort / Math.min(period, j + 1))
                  if (j >= period - 1) {
                    const sumLong = cache.klines.slice(Math.max(0, j - period * 2 + 1), j + 1).reduce((s, k) => s + Number(k.close), 0)
                    maLong.push(sumLong / Math.min(period * 2, j + 1))
                  }
                }
                if (maShort.length < 2 || maLong.length < 2) break
                const prevShort = maShort[maShort.length - 2]
                const currShort = maShort[maShort.length - 1]
                const prevLong = maLong[maLong.length - 2]
                const currLong = maLong[maLong.length - 1]
                if (alert.condition === 'cross_above') triggered = prevShort <= prevLong && currShort > currLong
                else triggered = prevShort >= prevLong && currShort < currLong
                break
              }
            }

            if (triggered) {
              await db.update(priceAlerts).set({ triggeredAt: new Date() }).where(eq(priceAlerts.id, alert.id))

              const isSL = alert.name?.startsWith('止损 ')
              const isTP = alert.name?.startsWith('止盈 ')
              if ((isSL || isTP) && alert.userId) {
                const pos = await db.select().from(positions)
                  .where(and(
                    eq(positions.userId, alert.userId),
                    eq(positions.code, alert.code),
                    eq(positions.status, 'open'),
                  )).limit(1)
                if (pos.length) {
                  await db.update(positions).set({ status: 'closed', updatedAt: new Date() })
                    .where(eq(positions.id, pos[0].id))
                  console.log(`[Scheduler] Position closed: ${alert.code} (${isSL ? 'SL' : 'TP'})`)
                }
              }

              const conditionLabels: Record<string, string> = {
                price_gte: `价格 ≥ ${target}`,
                price_lte: `价格 ≤ ${target}`,
                change_pct_gte: `涨幅 ≥ ${target}%`,
                change_pct_lte: `跌幅 ≤ ${target}%`,
                cross_above: `MA${Math.round(target)} 上穿`,
                cross_below: `MA${Math.round(target)} 下穿`,
              }
              pro.dispatchPush && await pro.dispatchPush({
                type: 'alert',
                alertText: `${alert.name || alert.code}(${alert.code}) 触发告警：${conditionLabels[alert.condition] || alert.condition}${isSL ? '（止损）' : isTP ? '（止盈）' : ''}`,
                code: alert.code,
              })
              console.log(`[Scheduler] Price alert triggered: ${alert.code} ${alert.condition} ${target}`)
            }
          }
        } catch (e: any) {
          console.error(`[Scheduler] Price alert check failed for ${code}:`, e.message)
        }
      })
    )
  }
}

// 业务日期一律按北京时间取。toISOString() 是 UTC，凌晨 0-8 点会算成前一天；
// 加上 8 小时后取 UTC 日期就是北京日期（不依赖容器时区）。
function ymd(d: Date): string {
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().split('T')[0]
}

function today(): string { return ymd(new Date()) }

/**
 * 目标交易日的 K 线是否已经入库。
 * 用它挡住两类错误：容器凌晨重启时 catch-up 用昨天的 K 线算出「今天」的信号/指标；
 * 以及 15:30 的指标任务跑在 18:00 的行情同步之前。
 * 只查几只主力票（走 code 索引），全表 max(date) 要扫 1600 万行。
 */
async function marketDataReady(date: string): Promise<boolean> {
  try {
    const r = await db.execute(sql`
      SELECT max(date)::text AS d FROM klines
      WHERE code IN ('600519', '000001', '600036', '601318', '000858')
    `) as any
    const d = r?.rows?.[0]?.d
    return !!d && d >= date
  } catch {
    return true // 查不到就放行，别把正常任务卡死
  }
}

/** 下一个交易日：至少跳过周末（节假日由 evaluatePredictions 兜） */
export function nextTradingDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  do {
    d.setTime(d.getTime() + 24 * 3600 * 1000)
  } while ([0, 6].includes(d.getUTCDay()))
  return d.toISOString().slice(0, 10)
}

async function getLastRunDate(taskName: string): Promise<string | null> {
  return getSchedulerLogRepository().findLastSuccess(taskName)
}

export function getWeekdaysBetween(start: string, end: string): string[] {
  const dates: string[] = []
  const cur = new Date(start + 'T00:00:00+08:00')
  const last = new Date(end + 'T00:00:00+08:00')
  while (cur <= last) {
    const d = ymd(cur)                                  // 北京日期
    const day = new Date(d + 'T00:00:00Z').getUTCDay()  // 这一天是周几
    if (day !== 0 && day !== 6) dates.push(d)
    // 按毫秒推进，不受容器时区/夏令时影响
    cur.setTime(cur.getTime() + 24 * 3600 * 1000)
  }
  return dates
}

async function runWithCatchUp(
  taskName: string,
  fn: (execDate: string) => Promise<number>,
  maxCatchUpDays = 10,
) {
  const todayStr = today()
  const lastRun = await getLastRunDate(taskName)
  const startDate = lastRun || todayStr
  const missedDates = getWeekdaysBetween(startDate, todayStr).filter(d => d > (lastRun || ''))
  const limit = Math.min(maxCatchUpDays, 30)

  if (missedDates.length > limit) {
    console.log(`[Scheduler] ${taskName}: too many missed (${missedDates.length}), catching up last ${limit}`)
    missedDates.splice(0, missedDates.length - limit)
  }

  if (missedDates.length > 0) {
    console.log(`[Scheduler] ${taskName}: catching up ${missedDates.length} missed days`)
    for (const d of missedDates) {
      await getSchedulerLogRepository().insertStart(taskName, d)
      try {
        const count = await fn(d)
        await getSchedulerLogRepository().upsertEnd(taskName, d, count)
        console.log(`[Scheduler] ${taskName} (${d}) done: ${count}`)
      } catch (e: any) {
        await getSchedulerLogRepository().upsertEnd(taskName, d, 0, e.message)
        console.error(`[Scheduler] ${taskName} (${d}) failed: ${e.message}`)
      }
    }
  } else {
    console.log(`[Scheduler] ${taskName}: already up to date`)
  }
}

export function startScheduler() {
  const useExternal = !!(process.env as any).USE_EXTERNAL_SCHEDULER;
  void useExternal;

  // ---- On startup: catch up missed date-based tasks ----
  (async () => {
    try {
      console.log('[Scheduler] Checking for missed tasks...')
      await runWithCatchUp('daily_metrics', computeDailyMetrics, 10)
      await runWithCatchUp('signal_scan', signalScanForDate, 10)
      await runWithCatchUp('ai_daily_picks', aiDailyPicksForDate, 5)
      await runWithCatchUp('ai_predictions', aiPredictionsForDate, 5)
      console.log('[Scheduler] Catch-up check complete')
    } catch (e: any) {
      console.error('[Scheduler] Catch-up failed:', e.message)
    }
  })()

  if (useExternal) {
    console.log('[Scheduler] Using external scheduler — skipping cross-service cron jobs')
    cron.schedule('*/5 9-15 * * 1-5', async () => { await checkPriceAlerts() })
    cron.schedule('*/5 9,10,11,13,14 * * 1-5', async () => {
      console.log('[Scheduler] Checking intraday anomalies...')
      try {
        const { checkIntradayAnomalies } = await import('../ai/intradayAlert.js')
        const proUsers = await getUsersRepository().findProUsers()
        for (const user of proUsers) {
          try { await checkIntradayAnomalies(user.id) } catch {}
        }
      } catch (e: any) { console.error('[Scheduler] Intraday anomaly check failed:', e.message) }
    })
    console.log('[Scheduler] Intraday cron jobs registered (external scheduler handles pipeline)')
    return
  }

  cron.schedule('0 18 * * 1-5', async () => {
    console.log('[Scheduler] Starting daily data update...')
    const d = today()
    await getSchedulerLogRepository().insertStart('daily_data', d)
    const allStocks = await getStocksRepository().findAll()
    let updated = 0
    const BATCH_SIZE = 50
    for (let i = 0; i < allStocks.length; i += BATCH_SIZE) {
      const chunk = allStocks.slice(i, i + BATCH_SIZE)
      await Promise.all(
        chunk.map(async (s) => {
          try {
            const result = await getOrFetchKlines(s.code)
            if (result.source === 'api') updated++
          } catch {}
        })
      )
      console.log(`[Scheduler] Data update: ${Math.min(i + BATCH_SIZE, allStocks.length)}/${allStocks.length}`)
    }
    await getSchedulerLogRepository().upsertEnd('daily_data', d, updated)
    console.log(`[Scheduler] Data update complete. Updated: ${updated}/${allStocks.length}`)
  })

  cron.schedule('30 18 * * 1-5', async () => {
    console.log('[Scheduler] Starting daily signal scan...')
    const scanDate = today()

    await getSchedulerLogRepository().insertStart('signal_scan', scanDate)

    // 扫描逻辑只有一份（signalScanForDate），cron 和 catch-up 走同一条路，
    // 免得两边行为不一致（之前 cron 抄了一份，catch-up 那份坏了 cron 那份没坏）
    let signalsWritten = 0
    try {
      signalsWritten = await signalScanForDate(scanDate)
    } catch (e: any) {
      await getSchedulerLogRepository().upsertEnd('signal_scan', scanDate, 0, e.message)
      console.error('[Scheduler] Signal scan failed:', e.message)
      return
    }

    if (signalsWritten > 0) {
      const latestSignals = await getSignalsRepository().findByDate(scanDate, 100)
      const signalItems = latestSignals.map(s => ({
        code: s.code,
        name: s.name,
        direction: s.direction,
        strength: Number(s.strength),
        strategyName: s.strategyName,
        price: String(s.price),
      }))
      pro.dispatchPush && await pro.dispatchPush({ type: 'signal', signals: signalItems })
      console.log(`[Scheduler] Push dispatched for ${signalItems.length} signals`)

      pro.dispatchPush && await pro.dispatchPush({ type: 'dailyDigest', signals: signalItems, digestText: `今日共产生 ${signalsWritten} 个信号` })
      console.log(`[Scheduler] Daily digest dispatched`)
    }
    await getSchedulerLogRepository().upsertEnd('signal_scan', scanDate, signalsWritten)
  })

  // 策略擂台周报：每周五收盘后生成，可直接复制发公众号/小红书
  cron.schedule('20 18 * * 5', async () => {
    try {
      const { generateWeeklyReport } = await import('./paperWeeklyReport.js')
      const r = await generateWeeklyReport()
      console.log(r ? `[Scheduler] 擂台周报已生成（${r.weekStart} ~ ${r.weekEnd}）` : '[Scheduler] 擂台周报：没有进行中的比赛')
    } catch (e: any) {
      console.error('[Scheduler] 擂台周报生成失败:', e.message)
    }
  })

  cron.schedule('0 18 * * 5', async () => {
    console.log('[Scheduler] Starting weekly report...')
    const scanDate = new Date().toISOString().slice(0, 10)
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)

    const weekSignals = await getSignalsRepository().findByDateRange(weekAgo, scanDate, 50)

    const totalSignals = weekSignals.reduce((sum, s) => sum + (Number(s.strength) || 0), 0)
    const buySignals = weekSignals.filter(s => s.direction === 'BUY' || s.direction === '买入').length
    const sellSignals = weekSignals.filter(s => s.direction === 'SELL' || s.direction === '卖出').length

    const content = `
      <h3>本周信号统计</h3>
      <ul>
        <li>总信号数: ${weekSignals.length}</li>
        <li>买入信号: ${buySignals}</li>
        <li>卖出信号: ${sellSignals}</li>
      </ul>
      <h3>最新信号</h3>
      <ul>
        ${weekSignals.slice(0, 10).map(s => `<li>${s.name}(${s.code}) — ${s.direction} 强度${s.strength}</li>`).join('')}
      </ul>
    `

    pro.dispatchPush && await pro.dispatchPush({ type: 'weeklyReport', digestText: content })
    console.log('[Scheduler] Weekly report dispatched')
  })

  cron.schedule('*/5 9-15 * * 1-5', async () => {
    await checkPriceAlerts()
  })

  const MINUTE_PERIODS: MinutePeriod[] = ['m5', 'm15', 'm30', 'm60']

  async function refreshMinuteKlines() {
    const now = new Date()
    const h = now.getHours(), m = now.getMinutes()
    const timeNum = h * 100 + m
    if (timeNum < 930 || timeNum >= 1500) return

    const activeStocks = new Set<string>()

    const posRows = await db.select({ code: positions.code }).from(positions)
    posRows.forEach(r => activeStocks.add(r.code))

    const pickRows = await db.select({ code: dailyPicks.code }).from(dailyPicks)
    pickRows.forEach(r => activeStocks.add(r.code))

    if (activeStocks.size === 0) return

    const codes = [...activeStocks]
    const periodIdx = timeNum < 1100 ? 0 : timeNum < 1330 ? 1 : 2
    const period = MINUTE_PERIODS[periodIdx]

    console.log(`[Scheduler] Minute refresh: ${codes.length} stocks, period=${period}`)
    let refreshed = 0
    const BATCH = 10
    for (let i = 0; i < codes.length; i += BATCH) {
      const chunk = codes.slice(i, i + BATCH)
      await Promise.allSettled(chunk.map(async (code) => {
        try {
          await getOrFetchMinuteKlines(code, period)
          refreshed++
        } catch {}
      }))
    }
    console.log(`[Scheduler] Minute refresh done: ${refreshed}/${codes.length}`)
  }

  cron.schedule('*/15 9-15 * * 1-5', async () => {
    await refreshMinuteKlines()
  })

  cron.schedule('0 8 * * 1-5', async () => {
    console.log('[Scheduler] Generating AI-powered daily picks...')
    const d = today()
    await getSchedulerLogRepository().insertStart('ai_daily_picks', d)
    try {
      const picks = pro.generateDailyPicks ? await pro.generateDailyPicks() : (console.log("[Scheduler] generateDailyPicks not available"), [])
      if (picks.length === 0) {
        console.log('[Scheduler] No AI picks today.')
        await getSchedulerLogRepository().upsertEnd('ai_daily_picks', d, 0)
        return
      }
      console.log(`[Scheduler] AI daily picks generated: ${picks.length} stocks`)

      const todayStr = new Date().toISOString().slice(0, 10)
      for (const p of picks) {
        const existing = await getRecTrackingRepository().findByCodeAndDate(p.code, todayStr)
        if (!existing) {
          await getRecTrackingRepository().create({ code: p.code, name: p.name, pickDate: todayStr, status: 'pending' })
        }
      }

      pro.dispatchPush && await pro.dispatchPush({
        type: 'dailyDigest',
        signals: picks.map((p: any) => ({
          code: p.code,
          name: p.name,
          direction: p.analysis.direction === 'buy' ? 'BUY' : p.analysis.direction === 'hold' ? 'HOLD' : 'SELL',
          strength: p.analysis.score,
          strategyName: 'AI精选',
          price: String(p.price),
        })),
        digestText: `今日 AI 精选 ${picks.length} 只股票`,
      })
      await getSchedulerLogRepository().upsertEnd('ai_daily_picks', d, picks.length)
      console.log('[Scheduler] Daily picks push dispatched')
    } catch (e: any) {
      await getSchedulerLogRepository().upsertEnd('ai_daily_picks', d, 0, e.message)
      console.error('[Scheduler] AI daily picks failed:', e)
    }
  })

  // 必须排在 18:00 行情同步之后：原来 15:30 算，K 线还没更新，指标永远算在数据之前
  cron.schedule('40 18 * * 1-5', async () => {
    console.log('[Scheduler] Computing daily metrics...')
    const d = today()
    await getSchedulerLogRepository().insertStart('daily_metrics', d)
    try {
      await computeDailyMetrics()
      await getSchedulerLogRepository().upsertEnd('daily_metrics', d, 1)
    } catch (e: any) {
      await getSchedulerLogRepository().upsertEnd('daily_metrics', d, 0, e.message)
      console.error('[Scheduler] Daily metrics failed:', e)
    }
  })

  cron.schedule('40 18 * * 1-5', async () => {
    console.log('[Scheduler] Computing limit-up records...')
    const d = today()
    await getSchedulerLogRepository().insertStart('limit_up', d)
    try {
      const written = await computeLimitUpRecords(d)
      await getSchedulerLogRepository().upsertEnd('limit_up', d, written)
      console.log(`[Scheduler] Limit-up records computed: ${written}`)
    } catch (e: any) {
      await getSchedulerLogRepository().upsertEnd('limit_up', d, 0, e.message)
      console.error('[Scheduler] Limit-up computation failed:', e)
    }
  })

  cron.schedule('45 18 * * 1-5', async () => {
    console.log('[Scheduler] Computing strategy backtests...')
    try {
      const { runStrategyBacktestAllPeriods } = await import('./backtestStrategyService.js')

      const { rows } = await db.execute(sql`
        SELECT config FROM strategies WHERE config->>'type' = 'scoring_strategy'
      `)

      const today = ymd(new Date())

      const { rows: earliest } = await db.execute(sql`
        SELECT MIN(metric_date) AS d FROM daily_metrics
      `)
      const startDate = (earliest[0] as any)?.d || '2025-01-01'

      for (const row of rows) {
        const config = row.config as any

        const allPeriods = await runStrategyBacktestAllPeriods({
          strategyKey: config.key,
          strategyLabel: config.label,
          scoreSQL: config.scoreSQL || '',
          conditionsSQL: (config.conditions || []).map((c: any) => c.sql),
          startDate,
          endDate: today,
          initialCapital: 1000000,
          topN: 5,
          commissionRate: 0.00025,
          stampTaxRate: 0.001,
          slippage: 0.001,
        })

        for (const [holdingDays, output] of Object.entries(allPeriods) as any) {
          const period = Number(holdingDays)
          await db.execute(sql`
            INSERT INTO strategy_backtest_runs (
              strategy_key, strategy_label, start_date, end_date,
              trade_direction, holding_periods, initial_capital, top_n, allocation,
              commission_rate, stamp_tax_rate, slippage,
              total_return, annual_return, sharpe, max_drawdown,
              win_rate, trade_count, avg_hold_days,
              return_1d, return_3d, return_5d, return_10d,
              trades, equity_curve, triggered_by, computation_ms
            ) VALUES (
              ${config.key}, ${config.label}, ${startDate}, ${today},
              'long', ${sql.raw(`ARRAY[${period}]::integer[]`)}, 1000000, 5, 'score_weighted',
              0.00025, 0.001, 0.001,
              ${output.stats.totalReturn}, ${output.stats.annualReturn}, ${output.stats.sharpe}, ${output.stats.maxDrawdown},
              ${output.stats.winRate}, ${output.stats.tradeCount}, ${output.stats.avgHoldDays},
              ${output.stats.return1d}, ${output.stats.return3d}, ${output.stats.return5d}, ${output.stats.return10d},
              ${JSON.stringify(output.trades)}::jsonb, ${JSON.stringify(output.equityCurve)}::jsonb, 'scheduler', 0
            )
            ON CONFLICT (strategy_key, start_date, end_date, top_n)
            DO UPDATE SET
              total_return = EXCLUDED.total_return,
              annual_return = EXCLUDED.annual_return,
              sharpe = EXCLUDED.sharpe,
              max_drawdown = EXCLUDED.max_drawdown,
              win_rate = EXCLUDED.win_rate,
              trade_count = EXCLUDED.trade_count,
              avg_hold_days = EXCLUDED.avg_hold_days,
              return_1d = EXCLUDED.return_1d,
              return_3d = EXCLUDED.return_3d,
              return_5d = EXCLUDED.return_5d,
              return_10d = EXCLUDED.return_10d,
              trades = EXCLUDED.trades,
              equity_curve = EXCLUDED.equity_curve,
              triggered_by = 'scheduler',
              created_at = NOW()
          `)
        }
        console.log(`[Scheduler] Strategy backtest done: ${config.label}`)
      }
      console.log('[Scheduler] All strategy backtests complete.')
    } catch (e) {
      console.error('[Scheduler] Strategy backtests failed:', e)
    }
  })

  cron.schedule('45 18 * * 1-5', async () => {
    console.log('[Scheduler] Generating AI predictions for top stocks...')
    try {
      const { selectDailyPicks, getHoldings, loadKlines, predictOne, savePrediction } = await import('../ai/predict.js')
      const { getMoneyFlow5d } = await import('./moneyFlowService.js')

      const picks = pro.selectDailyPicks ? await pro.selectDailyPicks(30) : []
      const proUsers = await getUsersRepository().findProUsers()
      const allHoldings = new Set<string>()
      for (const u of proUsers) {
        const h = pro.getHoldings ? await pro.getHoldings(u.id) : []
        h.forEach((c: any) => allHoldings.add(c))
      }
      picks.forEach((p: any) => allHoldings.add(p.code))

      const today = new Date().toISOString().slice(0, 10)
      const targetDate = new Date()
      targetDate.setDate(targetDate.getDate() + 1)
      const targetDateStr = targetDate.toISOString().slice(0, 10)

      let ok = 0, fail = 0
      for (const code of allHoldings) {
        try {
          const klines = await loadKlines(code, 90)
          if (klines.length < 30) continue
          const last = klines[klines.length - 1]
          const mf5d = await getMoneyFlow5d(code)
          const result = await predictOne({
            code,
            name: picks.find((p: any) => p.code === code)?.name || code,
            klines,
            daysAhead: 1,
            mainNetInflow5d: mf5d?.netInflowMain,
          })
          await savePrediction(code, '', today, targetDateStr, last.close, result)
          ok++
          await new Promise(r => setTimeout(r, 200))
        } catch (e: any) {
          fail++
        }
      }
      console.log(`[Scheduler] AI predictions: ${ok} ok, ${fail} failed`)
    } catch (e: any) {
      console.error('[Scheduler] AI predictions failed:', e.message)
    }
  })

  cron.schedule('15 15 * * 1-5', async () => {
    console.log('[Scheduler] Starting money flow daily backfill...')
    const d = today()
    await getSchedulerLogRepository().insertStart('moneyflow_daily', d)
    try {
      const { backfillDaily } = await import('./moneyFlowService.js')
      const count = await backfillDaily(5)
      await getSchedulerLogRepository().upsertEnd('moneyflow_daily', d, count)
      console.log(`[Scheduler] Money flow daily backfill: ${count} records`)
    } catch (e: any) {
      await getSchedulerLogRepository().upsertEnd('moneyflow_daily', d, 0, e.message)
      console.error('[Scheduler] Money flow daily backfill failed:', e.message)
    }
  })

  cron.schedule('32 15 * * 1-5', async () => {
    console.log('[Scheduler] Evaluating previous AI predictions...')
    try {
      const updated = pro.evaluatePredictions ? await pro.evaluatePredictions() : 0
      console.log(`[Scheduler] Evaluated ${updated} predictions`)
    } catch (e: any) {
      console.error('[Scheduler] AI evaluation failed:', e.message)
    }
  })

  cron.schedule('33 15 * * 1-5', async () => {
    console.log('[Scheduler] Evaluating daily picks performance...')
    try {
      const count = await pro.evaluateAllUnrated ? await pro.evaluateAllUnrated() : (console.log("[Scheduler] evaluateAllUnrated not available"), 0)
      console.log(`[Scheduler] Evaluated ${count} daily picks`)
    } catch (e: any) {
      console.error('[Scheduler] Daily picks evaluation failed:', e.message)
    }
  })

  cron.schedule('25 9 * * 1-5', async () => {
    console.log('[Scheduler] Pushing AI predictions digest...')
    try {
      const { dispatchPush } = await import('./push/dispatcher.js')

      const today = new Date().toISOString().slice(0, 10)
      const preds = await getPredictionsRepository().findByDate(today, 10)

      if (preds.length === 0) return

      const signals = preds.map(p => ({
        code: p.stockCode,
        name: p.stockName || p.stockCode,
        direction: p.direction === 'up' ? '📈' : p.direction === 'down' ? '📉' : '➡️',
        strength: Math.round(p.confidence / 20),
        // 不再在推送里带「置信度」：实测命中率低于无脑基准，写 75% 置信是误导
        strategyName: `AI 解读: ${p.direction === 'up' ? '偏多' : p.direction === 'down' ? '偏空' : '震荡'}`,
        price: p.targetPrice ? String(Number(p.targetPrice).toFixed(2)) : undefined,
      }))

      let text = `🤖 AI 技术面解读 ${today}\n`
      for (const p of preds) {
        const dir = p.direction === 'up' ? '📈偏多' : p.direction === 'down' ? '📉偏空' : '➡️震荡'
        text += `\n${p.stockCode} ${p.stockName || p.stockCode}: ${dir}`
        if (p.targetPrice) text += ` 目标${Number(p.targetPrice).toFixed(2)}`
        if (p.stopLoss) text += ` 止损${Number(p.stopLoss).toFixed(2)}`
      }
      text += '\n\n⚠️ 技术面解读，非买卖建议'

      pro.dispatchPush && await pro.dispatchPush({ type: 'dailyDigest', signals, digestText: text })
      console.log(`[Scheduler] Pushed AI predictions to ${preds.length} stocks`)
    } catch (e: any) {
      console.error('[Scheduler] Push AI predictions failed:', e.message)
    }
  })

  cron.schedule('30 8 * * 1-5', async () => {
    console.log('[Scheduler] Analyzing position alerts...')
    try {
      const { users } = await import('../db/schema.js')
      const { eq } = await import('drizzle-orm')
      const { analyzeAllPositions } = await import('../ai/positionAlert.js')
      const { dispatchPush } = await import('./push/dispatcher.js')

      const proUsers = await getUsersRepository().findProUsers()
      for (const user of proUsers) {
        try {
          const alerts = await analyzeAllPositions(user.id)
          const sellAlerts = alerts.filter((a: any) => a.recommendation === 'sell' && a.confidence >= 60)
          if (sellAlerts.length === 0) continue
          const signals = sellAlerts.map((a: any) => ({
            code: a.code, name: a.name, direction: '📉',
            strength: Math.round(a.confidence / 20),
            strategyName: `AI预警卖出 置信${a.confidence}%`,
            price: a.currentPrice.toFixed(2),
          }))
          let text = `🚨 AI持仓预警 ${new Date().toISOString().slice(0, 10)}\n`
          for (const a of sellAlerts) {
            text += `\n🚩 ${a.code} ${a.name}: 建议卖出 置信${a.confidence}%`
            text += `\n   现价${a.currentPrice.toFixed(2)} 盈亏${a.pnlPercent.toFixed(1)}% 理由: ${a.reasoning}`
          }
          text += '\n\n⚠️ 不构成投资建议'
          pro.dispatchPush && await pro.dispatchPush({ type: 'alert', signals, alertText: text })
          console.log(`[Scheduler] Sent ${sellAlerts.length} position alerts to user ${user.id}`)
        } catch { /* skip user */ }
      }
    } catch (e: any) {
      console.error('[Scheduler] Position alerts failed:', e.message)
    }
  })

  cron.schedule('*/5 9,10,11,13,14 * * 1-5', async () => {
    console.log('[Scheduler] Checking intraday anomalies...')
    try {
      const { checkIntradayAnomalies } = await import('../ai/intradayAlert.js')
      const proUsers = await getUsersRepository().findProUsers()
      for (const user of proUsers) {
        try {
          await checkIntradayAnomalies(user.id)
        } catch { /* skip user */ }
      }
    } catch (e: any) {
      console.error('[Scheduler] Intraday anomaly check failed:', e.message)
    }
  })

  // Paper Trading: 每日收盘后撮合 pending 订单（15:05 执行）
  cron.schedule('5 15 * * 1-5', async () => {
    console.log('[Scheduler] Running paper trading matching...')
    try {
      const { matchAllPendingOrders, snapshotAllAccounts } = await import('./paperTradingEngine.js')
      const results = await matchAllPendingOrders()
      await snapshotAllAccounts()
      const filled = results.filter((r: any) => r.status === 'FILLED').length
      const rejected = results.filter((r: any) => r.status === 'REJECTED').length
      console.log(`[Scheduler] Paper trading: ${filled} filled, ${rejected} rejected`)
    } catch (e: any) {
      console.error('[Scheduler] Paper trading matching failed:', e.message)
    }

    // 每日复盘（撮合完成后，对每个 Agent 生成复盘分析）
    console.log('[Scheduler] Running daily review for AI agents...')
    try {
      const { runDailyReview } = await import('./paperTradingAgent.js')
      const reviews = await runDailyReview()
      const ok = reviews.filter((r: any) => r.success).length
      console.log(`[Scheduler] Daily review: ${ok}/${reviews.length} agents reviewed`)
      for (const r of reviews) {
        if (r.success) {
          console.log(`[Scheduler]   ${r.agentName}: ${r.review.slice(0, 80).replace(/\n/g, ' ')}`)
        } else {
          console.log(`[Scheduler]   ${r.agentName}: FAILED - ${r.error}`)
        }
      }
    } catch (e: any) {
      console.error('[Scheduler] Daily review failed:', e.message)
    }
  })

  // Paper Trading: 每日 14:50 让 AI Agent 做一次决策，15:05 按收盘价撮合。
  // 原来每 5 分钟决策一次（一天 60 次 × 5 个策略 = 300 次 LLM 调用），
  // 但订单统一在 15:05 按收盘价成交 —— 前面 59 次思考毫无意义，
  // 既烧钱又让业绩无法归因（不知道是哪次决策带来的收益）。
  cron.schedule('50 14 * * 1-5', async () => {
    console.log('[Scheduler] Running paper trading AI agents (daily decision)...')
    try {
      const { runAllAgents } = await import('./paperTradingAgent.js')
      const results = await runAllAgents()
      const ok = results.filter((r: any) => r.success).length
      console.log(`[Scheduler] AI agents: ${ok}/${results.length} succeeded`)
      for (const r of results) {
        if (r.trades?.length) {
          console.log(`[Scheduler]   ${r.agentName}: ${r.trades.map((t: any) => `${t.direction} ${t.code}x${t.shares}[${t.result}]`).join(', ')}`)
        }
      }
    } catch (e: any) {
      console.error('[Scheduler] Paper trading agents failed:', e.message)
    }
  })

  console.log('[Scheduler] Cron jobs registered.')
}
