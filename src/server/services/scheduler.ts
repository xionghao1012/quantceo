import cron from 'node-cron'
import { db } from '../db/db.js'
import { stocks, signals, priceAlerts, dailyPicks, positions, dailyMetrics, recTracking } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { getOrFetchKlines, getOrFetchMinuteKlines } from '../data/cache.js'
import { scanStock } from '../scan/index.js'
// Pro modules — loaded via require() for OSS compatibility
import { sql } from 'drizzle-orm'
import { calcRSI, calcMACD, calcMA, calcBollinger } from '../indicators/index.js'
import type { KLine, MinutePeriod } from '../../shared/types.js'

function loadProModules(): any {
  const mod = { __esModule: true } as any
  // Dynamic imports — gracefully fail in OSS where Pro modules don't exist
  async function load(name: string, fnName: string) {
    try { const m = await import(name); mod[fnName] = m[fnName] } catch {}
  }
  // Deferred loading — called when a cron job needs a Pro module
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

export async function computeDailyMetrics() {
  const metricDate = new Date().toISOString().split('T')[0]

  const allStocks = await db.select().from(stocks)
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

        await db.insert(dailyMetrics).values({
          metricDate,
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
        }).onConflictDoUpdate({
          target: [dailyMetrics.metricDate, dailyMetrics.code],
          set: {
            rsi: String(Math.round(lastRSI * 10) / 10),
            changePct: String(Math.round(changePct * 100) / 100),
            volRatio: String(Math.round(volRatio * 100) / 100),
            macdSignal: String(Math.round(macdSignal * 100) / 100),
            bbPosition: String(Math.round(bbPos * 10) / 10),
            maAlignment: maAlign,
            volatility: String(Math.round(volatility * 1000000) / 1000000),
            momentum: String(Math.round(mom10 * 100) / 100),
            computedAt: new Date(),
          },
        })
        computed++
      } catch {}
    }))
    console.log(`[Metrics] ${Math.min(i + BATCH, allStocks.length)}/${allStocks.length}...`)
  }
  console.log(`[Scheduler] Daily metrics computed: ${computed}/${allStocks.length} stocks`)
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

export function startScheduler() {
  const useExternal = process.env.USE_EXTERNAL_SCHEDULER === 'true'

  if (useExternal) {
    console.log('[Scheduler] Using external scheduler — skipping cross-service cron jobs')
    // Keep only intraday jobs (price alerts, anomaly checks)
    cron.schedule('*/5 9-15 * * 1-5', async () => { await checkPriceAlerts() })
    cron.schedule('*/5 9,10,11,13,14 * * 1-5', async () => {
      console.log('[Scheduler] Checking intraday anomalies...')
      try {
        const { checkIntradayAnomalies } = await import('../ai/intradayAlert.js')
        const { db } = await import('../db/db.js')
        const { users } = await import('../db/schema.js')
        const { eq } = await import('drizzle-orm')
        const proUsers = await db.select().from(users).where(eq(users.role, 'premium'))
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
    const allStocks = await db.select().from(stocks)
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
    console.log(`[Scheduler] Data update complete. Updated: ${updated}/${allStocks.length}`)
  })

  cron.schedule('30 18 * * 1-5', async () => {
    console.log('[Scheduler] Starting daily signal scan...')
    const allStocks = await db.select().from(stocks)
    const scanDate = new Date().toISOString().split('T')[0]
    let signalsWritten = 0
    let stocksScanned = 0
    const BATCH_SIZE = 50

    const stockChunks = []
    for (let i = 0; i < allStocks.length; i += BATCH_SIZE) {
      stockChunks.push(allStocks.slice(i, i + BATCH_SIZE))
    }

    for (const chunk of stockChunks) {
      const results = await Promise.allSettled(
        chunk.map(async (s) => {
          try {
            const cache = await getOrFetchKlines(s.code)
            const scanned = scanStock(s.code, s.name, cache.klines)
            if (!scanned) return null
            return { s, scanned }
          } catch {
            return null
          }
        })
      )

      for (const result of results) {
        if (result.status !== 'fulfilled' || !result.value) continue
        const { s, scanned } = result.value
        stocksScanned++

        for (const sig of scanned.signals) {
          try {
            await db.insert(signals).values({
              code: s.code,
              name: s.name,
              scanDate,
              strategyId: sig.strategyId,
              strategyName: sig.strategyName,
              direction: sig.direction,
              strength: sig.strength,
              price: String(scanned.price),
              indicators: {},
              reason: `${sig.strategyName} ${sig.direction}`,
            }).onConflictDoNothing()
            signalsWritten++
          } catch {}
        }
      }

      console.log(`[Scheduler] Scanned ${stocksScanned}/${allStocks.length} stocks...`)
    }
    console.log(`[Scheduler] Signal scan complete. Scanned: ${stocksScanned}, Signals written: ${signalsWritten}`)

    if (signalsWritten > 0) {
      const latestSignals = await db.select().from(signals)
        .where(eq(signals.scanDate, scanDate))
        .limit(100)
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

      pro.dispatchPush && await pro.dispatchPush({ type: 'dailyDigest', signals: signalItems, digestText: `今日共扫描 ${stocksScanned} 只股票，产生 ${signalsWritten} 个信号` })
      console.log(`[Scheduler] Daily digest dispatched`)
    }
  })

  cron.schedule('0 18 * * 5', async () => {
    console.log('[Scheduler] Starting weekly report...')
    const scanDate = new Date().toISOString().slice(0, 10)
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)

    const weekSignals = await db.select().from(signals)
      .where(sql`${signals.scanDate} >= ${weekAgo} AND ${signals.scanDate} <= ${scanDate}`)
      .limit(50)

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
    try {
      const picks = pro.generateDailyPicks ? await pro.generateDailyPicks() : (console.log("[Scheduler] generateDailyPicks not available"), [])
      if (picks.length === 0) {
        console.log('[Scheduler] No AI picks today.')
        return
      }
      console.log(`[Scheduler] AI daily picks generated: ${picks.length} stocks`)

      const today = new Date().toISOString().slice(0, 10)
      for (const p of picks) {
        const existing = await db.select({ id: recTracking.id }).from(recTracking)
          .where(and(eq(recTracking.code, p.code), eq(recTracking.pickDate, today)))
          .limit(1)
        if (existing.length === 0) {
          await db.insert(recTracking).values({
            code: p.code,
            name: p.name,
            pickDate: today,
            status: 'pending',
          })
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
      console.log('[Scheduler] Daily picks push dispatched')
    } catch (e) {
      console.error('[Scheduler] AI daily picks failed:', e)
    }
  })

  cron.schedule('30 15 * * 1-5', async () => {
    console.log('[Scheduler] Computing daily metrics...')
    try {
      await computeDailyMetrics()
    } catch (e) {
      console.error('[Scheduler] Daily metrics failed:', e)
    }
  })

  cron.schedule('35 15 * * 1-5', async () => {
    console.log('[Scheduler] Computing strategy backtests...')
    try {
      const { runStrategyBacktestAllPeriods } = await import('./backtestStrategyService.js')

      const { rows } = await db.execute(sql`
        SELECT config FROM strategies WHERE config->>'type' = 'scoring_strategy'
      `)

      const today = new Date().toISOString().split('T')[0]

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

  cron.schedule('35 15 * * 1-5', async () => {
    console.log('[Scheduler] Generating AI predictions for top stocks...')
    try {
      const { selectDailyPicks, getHoldings, loadKlines, predictOne, savePrediction } = await import('../ai/predict.js')
      const { db } = await import('../db/db.js')
      const { users } = await import('../db/schema.js')
      const { eq } = await import('drizzle-orm')

      const picks = pro.selectDailyPicks ? await pro.selectDailyPicks(30) : []
      const proUsers = await db.select().from(users).where(eq(users.role, 'premium'))
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
          const result = await predictOne({
            code,
            name: picks.find((p: any) => p.code === code)?.name || code,
            klines,
            daysAhead: 1,
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
      const { db } = await import('../db/db.js')
      const { aiPredictions } = await import('../db/schema.js')
      const { eq, and, desc } = await import('drizzle-orm')
      const { dispatchPush } = await import('./push/dispatcher.js')

      const today = new Date().toISOString().slice(0, 10)
      const preds = await db.select()
        .from(aiPredictions)
        .where(eq(aiPredictions.predictDate, today))
        .orderBy(desc(aiPredictions.confidence))
        .limit(10)

      if (preds.length === 0) return

      const signals = preds.map(p => ({
        code: p.stockCode,
        name: p.stockName || p.stockCode,
        direction: p.direction === 'up' ? '📈' : p.direction === 'down' ? '📉' : '➡️',
        strength: Math.round(p.confidence / 20),
        strategyName: `AI预测: ${p.direction === 'up' ? '看涨' : p.direction === 'down' ? '看跌' : '震荡'} 置信${p.confidence}%`,
        price: p.targetPrice ? String(Number(p.targetPrice).toFixed(2)) : undefined,
      }))

      let text = `🤖 AI预测 ${today}\n`
      for (const p of preds) {
        const dir = p.direction === 'up' ? '📈看涨' : p.direction === 'down' ? '📉看跌' : '➡️震荡'
        text += `\n${p.stockCode} ${p.stockName || p.stockCode}: ${dir} 置信${p.confidence}%`
        if (p.targetPrice) text += ` 目标${Number(p.targetPrice).toFixed(2)}`
        if (p.stopLoss) text += ` 止损${Number(p.stopLoss).toFixed(2)}`
      }
      text += '\n\n⚠️ 不构成投资建议'

      pro.dispatchPush && await pro.dispatchPush({ type: 'dailyDigest', signals, digestText: text })
      console.log(`[Scheduler] Pushed AI predictions to ${preds.length} stocks`)
    } catch (e: any) {
      console.error('[Scheduler] Push AI predictions failed:', e.message)
    }
  })

  cron.schedule('30 8 * * 1-5', async () => {
    console.log('[Scheduler] Analyzing position alerts...')
    try {
      const { db } = await import('../db/db.js')
      const { users } = await import('../db/schema.js')
      const { eq } = await import('drizzle-orm')
      const { analyzeAllPositions } = await import('../ai/positionAlert.js')
      const { dispatchPush } = await import('./push/dispatcher.js')

      const proUsers = await db.select().from(users).where(eq(users.role, 'premium'))
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
      const { db } = await import('../db/db.js')
      const { users } = await import('../db/schema.js')
      const { eq } = await import('drizzle-orm')
      const proUsers = await db.select().from(users).where(eq(users.role, 'premium'))
      for (const user of proUsers) {
        try {
          await checkIntradayAnomalies(user.id)
        } catch { /* skip user */ }
      }
    } catch (e: any) {
      console.error('[Scheduler] Intraday anomaly check failed:', e.message)
    }
  })

  console.log('[Scheduler] Cron jobs registered.')
}
