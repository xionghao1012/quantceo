import { Router } from 'express'
import { db } from '../db/db.js'
import { stocks, klines, moneyFlowDaily } from '../db/schema.js'
import { cacheGetJson, cacheSetJson } from '../data/redis.js'
import { eq, desc, sql, and, gte, inArray } from 'drizzle-orm'
import { calcMA, calcMACD, calcRSI } from '../indicators/index.js'

const router = Router()

export const SCREENER_FIELDS = [
  { field: 'price', label: '最新价', type: 'number', operators: ['>', '<', '==', 'between'] },
  { field: 'change', label: '涨跌幅%', type: 'number', operators: ['>', '<', '==', 'between'] },
  { field: 'volume', label: '成交量', type: 'number', operators: ['>', '<', '==', 'between'] },
  { field: 'amount', label: '成交额', type: 'number', operators: ['>', '<', '==', 'between'] },
  { field: 'amplitude', label: '振幅%', type: 'number', operators: ['>', '<', '==', 'between'] },
  { field: 'ma5', label: 'MA5', type: 'number', operators: ['>', '<', '=='] },
  { field: 'ma10', label: 'MA10', type: 'number', operators: ['>', '<', '=='] },
  { field: 'ma20', label: 'MA20', type: 'number', operators: ['>', '<', '=='] },
  { field: 'ma60', label: 'MA60', type: 'number', operators: ['>', '<', '=='] },
  { field: 'macd', label: 'MACD', type: 'number', operators: ['>', '<', '=='] },
  { field: 'macdSignal', label: 'MACD信号', type: 'number', operators: ['>', '<', '=='] },
  { field: 'macdHistogram', label: 'MACD柱', type: 'number', operators: ['>', '<', '=='] },
  { field: 'rsi', label: 'RSI', type: 'number', operators: ['>', '<', '=='] },
  // 资金流字段
  { field: 'moneyInflowSum', label: '近N日净流入总额', type: 'money_flow', operators: ['>', '<', '=='] },
  { field: 'moneyInflowPctAvg', label: '近N日净流入率均值', type: 'money_flow', operators: ['>', '<', '=='] },
]

const MONEY_FLOW_FIELDS = new Set(['moneyInflowSum', 'moneyInflowPctAvg'])

const ALLOWED_FIELDS = new Set(SCREENER_FIELDS.map(f => f.field))

router.get('/fields', (_req, res) => {
  res.json({ fields: SCREENER_FIELDS })
})

interface Condition {
  field: string
  operator: string
  value: number | string | [number, number]
}

interface MoneyFlowCondition {
  field: 'moneyInflowSum' | 'moneyInflowPctAvg'
  operator: '>' | '<' | '=='
  value: number
  window: 5 | 10 | 20
}

/**
 * 统一出口：排序 + 分页 + 响应。
 * 缓存命中与现算走同一条路，保证两种路径行为一致。
 */
function respondWith(rows: any[], body: any) {
  const { sort = { field: 'change', order: 'desc' }, page = 1, limit = 50 } = body || {}
  const effectiveLimit = Math.min(Number(limit) || 50, 100)
  const effectivePage = Math.max(Number(page) || 1, 1)

  const sortField = sort?.field || 'change'
  const sortOrder = sort?.order === 'asc' ? 1 : -1
  const valOf = (r: any) => {
    if (sortField === 'name' || sortField === 'code') return r[sortField]
    const v = r[sortField] ?? r.indicators?.[sortField]
    return v ?? 0
  }
  const sorted = [...rows].sort((a, b) => {
    const aVal = valOf(a)
    const bVal = valOf(b)
    if (typeof aVal === 'string') return aVal.localeCompare(bVal as string) * sortOrder
    return ((aVal as number) - (bVal as number)) * sortOrder
  })

  const start = (effectivePage - 1) * effectiveLimit
  return {
    total: sorted.length,
    page: effectivePage,
    limit: effectiveLimit,
    stocks: sorted.slice(start, start + effectiveLimit),
  }
}

router.post('/', async (req, res) => {
  const {
    conditions = [],
    moneyFlowConditions = [],
    sort = { field: 'change', order: 'desc' },
    page = 1,
    limit = 50,
  } = req.body as {
    conditions?: Condition[]
    moneyFlowConditions?: MoneyFlowCondition[]
    sort?: { field: string; order: 'asc' | 'desc' }
    page?: number
    limit?: number
  }

  if (!conditions.length && !moneyFlowConditions.length) {
    return res.status(400).json({ error: 'At least one condition is required' })
  }

  for (const c of conditions) {
    if (!ALLOWED_FIELDS.has(c.field)) {
      return res.status(400).json({ error: `Invalid field: ${c.field}` })
    }
    if (!['>', '<', '==', 'between', 'cross_above', 'cross_below'].includes(c.operator)) {
      return res.status(400).json({ error: `Invalid operator: ${c.operator}` })
    }
  }

  const effectiveLimit = Math.min(Number(limit) || 50, 100)
  const effectivePage = Math.max(Number(page) || 1, 1)

  // 预计算资金流聚合数据（取最长窗口）
  const maxWindow = moneyFlowConditions.length
    ? Math.max(...moneyFlowConditions.map(c => c.window)) : 0

  const moneyFlowMap: Record<string, { sum: number; pctAvg: number; days: number; dailyFlows: number[] }> = {}
  if (moneyFlowConditions.length > 0 && maxWindow > 0) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - maxWindow)
    const cutoffStr = cutoff.toISOString().split('T')[0]

    const rows = await db
      .select({
        code: moneyFlowDaily.code,
        netInflowMain: sql`sum(${moneyFlowDaily.netInflowMain}::numeric)`,
        netInflowMainPct: sql`avg(${moneyFlowDaily.netInflowMainPct}::numeric)`,
        count: sql`count(*)`,
        dailyFlows: sql`array_agg(${moneyFlowDaily.netInflowMain}::numeric ORDER BY ${moneyFlowDaily.tradeDate})`,
      })
      .from(moneyFlowDaily)
      .where(gte(moneyFlowDaily.tradeDate, cutoffStr))
      .groupBy(moneyFlowDaily.code)

    for (const r of rows) {
      moneyFlowMap[r.code] = {
        sum: Number(r.netInflowMain) || 0,
        pctAvg: Number(r.netInflowMainPct) || 0,
        days: Number(r.count) || 0,
        dailyFlows: (r.dailyFlows as number[]) || [],
      }
    }
  }

  const stockRows = await db.select().from(stocks)
  const stockMap: Record<string, string> = {}
  const allCodes: string[] = []
  for (const s of stockRows) {
    const name = s.name || ''
    // 退市整理（名称含「退」）、PT 股、ST 股不进筛选池：
    // 它们的 RSI/涨幅常年极端，会把「RSI 超跌」这类条件的第一屏占满
    if (name.includes('退') || name.startsWith('PT') || name.includes('ST')) continue
    stockMap[s.code] = name
    allCodes.push(s.code)
  }

  // 扫全市场（之前硬编码 500 只且无排序 —— 5300 只里 4800 只永远筛不到）。
  // 成本靠「只读最近 180 天」压下来：实测 5300 只 × 180 天 = 63 万行，
  // 比原来的 500 只 × 全量历史（244 万行）还便宜。
  // 180 天足够 MA60 / MACD(26) / RSI(14) 的预热。
  // 指标快照缓存：数据一天只变一次（18:40 指标任务），5 分钟 TTL 足够。
  // 第一次请求现算（~6s），之后每次筛选都是内存过滤（~100ms）。
  // key 必须带库名：dev 与 prod 共用同一个 Redis，否则会互相喂错数据
  const snapKey = `screener:snapshot:v1:${process.env.PG_DB || 'default'}`
  const cachedSnap = await cacheGetJson(snapKey)
  if (cachedSnap) {
    try {
      const { at, rows } = JSON.parse(cachedSnap)
      // 快照里带上生成时间，超过 5 分钟就当没有（Redis TTL 之外的兜底）
      // 形状校验：老版本快照没有 latest/prev，直接复用会让过滤抛错
      const okShape = Array.isArray(rows) && (!rows.length || rows[0].latest !== undefined)
      if (Date.now() - at < 5 * 60 * 1000 && okShape) {
        const matched = rows.filter(r => matchesConditions(r, conditions, moneyFlowConditions))
        return res.json(respondWith(matched.map(toPublic), req.body))
      }
    } catch { /* 快照损坏就当没有 */ }
  }

  // 最近交易日往前 10 天：停牌/退市的股票不参与（价格是陈的）
  const lastDateRes = await db.execute(sql`SELECT max(date)::text AS d FROM klines`) as any
  const marketLastDate = lastDateRes?.rows?.[0]?.d || ''
  const marketLastDate10 = marketLastDate
    ? new Date(new Date(marketLastDate + 'T00:00:00Z').getTime() - 10 * 86400000).toISOString().slice(0, 10)
    : ''

  const results: any[] = []
  const BATCH = 200
  const CONCURRENCY = 6
  // ponytail: 全市场单次约 63 万行；若将来股票数翻倍，先加 Redis 快照缓存再谈
  const limitedCodes = allCodes.slice(0, 8000)

  const batchChunks = []
  for (let i = 0; i < limitedCodes.length; i += BATCH) {
    batchChunks.push(limitedCodes.slice(i, i + BATCH))
  }

  // 4 路并发跑批次：之前 27+ 个批次同时打库，容易把连接池打满
  const runPool = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
    const out: R[] = new Array(items.length)
    let cursor = 0
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
          const idx = cursor++
          out[idx] = await fn(items[idx])
        }
      })
    )
    return out
  }

  const allBatchResults = await runPool(batchChunks, CONCURRENCY, async (batch) => {
    try {
      const klineRows = await db
        .select()
        .from(klines)
        .where(and(
          inArray(klines.code, batch),
          // 只读最近 180 天：够 MA60/MACD/RSI 预热，数据量比全量历史少 4 倍
          gte(klines.date, sql`(SELECT max(date) FROM klines) - INTERVAL '180 days'`),
        ))
        .orderBy(klines.code, klines.date)

      const byCode: Record<string, any[]> = {}
      for (const row of klineRows) {
        if (!byCode[row.code]) byCode[row.code] = []
        byCode[row.code].push({
          date: typeof row.date === 'string' ? row.date : new Date(row.date).toISOString().slice(0, 10),
          open: Number(row.open), high: Number(row.high),
          low: Number(row.low), close: Number(row.close),
          volume: row.volume, amount: Number(row.amount),
        })
      }

      const computed = await Promise.allSettled(
        batch.map(async (code: string) => {
          const klines_data = byCode[code] || []
          if (klines_data.length < 2) return null

          const last = klines_data[klines_data.length - 1]
          const prev = klines_data[klines_data.length - 2]

          const maMap = calcMA(klines_data, [5, 10, 20, 60])
          const macd = calcMACD(klines_data)
          const rsi = calcRSI(klines_data, 14)

          const latest = {
            price: last.close,
            change: prev.close > 0 ? ((last.close - prev.close) / prev.close * 100) : 0,
            volume: last.volume,
            amount: last.amount,
            amplitude: prev.close > 0 ? ((last.high - last.low) / prev.close * 100) : 0,
            ma5: maMap.MA5[maMap.MA5.length - 1],
            ma10: maMap.MA10[maMap.MA10.length - 1],
            ma20: maMap.MA20[maMap.MA20.length - 1],
            ma60: maMap.MA60[maMap.MA60.length - 1],
            macd: macd.macd[macd.macd.length - 1],
            macdSignal: macd.signal[macd.signal.length - 1],
            macdHistogram: macd.histogram[macd.histogram.length - 1],
            rsi: rsi[rsi.length - 1],
          }

          const prevIndicators = {
            price: prev.close,
            change: prev.close > 0 ? ((last.close - prev.close) / prev.close * 100) : 0,
            volume: prev.volume,
            amount: prev.amount,
            amplitude: prev.close > 0 ? ((last.high - last.low) / prev.close * 100) : 0,
            ma5: maMap.MA5[maMap.MA5.length - 2],
            ma10: maMap.MA10[maMap.MA10.length - 2],
            ma20: maMap.MA20[maMap.MA20.length - 2],
            ma60: maMap.MA60[maMap.MA60.length - 2],
            macd: macd.macd[macd.macd.length - 2],
            macdSignal: macd.signal[macd.signal.length - 2],
            macdHistogram: macd.histogram[macd.histogram.length - 2],
            rsi: rsi[rsi.length - 2],
          }

          // 不在计算阶段过滤：缓存的是「全市场原始快照」，过滤在每次请求时做，
          // 否则缓存会把第一个查询的结果当成所有人的结果（实测换条件仍返回 1994 只）
          // 停牌太久（最近 10 天没有 K 线）不参与筛选：价格是陈的，指标没有意义
          const lastDate = klines_data[klines_data.length - 1].date
          if (lastDate && lastDate < marketLastDate10) return null

          return {
            code,
            name: stockMap[code] || code,
            latest,
            prev: prevIndicators,
            mf: moneyFlowMap[code] || null,
          }
        })
      )

      return computed
    } catch (e: any) {
      console.error('[screener] 批次失败:', e.message)
      return []
    }
  })

  const universe: any[] = []
  for (const batchResult of allBatchResults) {
    for (const r of batchResult) {
      if (r.status === 'fulfilled' && r.value) {
        universe.push(r.value)
      }
    }
  }

  // 写缓存（失败不影响返回）
  cacheSetJson(snapKey, JSON.stringify({ at: Date.now(), rows: universe }), 300).catch(() => {})

  const matched = universe.filter(r => matchesConditions(r, conditions, moneyFlowConditions))
  res.json(respondWith(matched.map(toPublic), req.body))
})

/**
 * 过滤：条件语义与之前逐只判断完全一致，只是从「计算时过滤」搬到「请求时过滤」，
 * 这样缓存的快照可以跨条件复用。
 */
export function matchesConditions(row: any, conditions: Condition[], mfConditions: MoneyFlowCondition[]): boolean {
  const latest = row.latest
  const prev = row.prev
  for (const cond of conditions) {
    if (cond.operator === 'cross_above' || cond.operator === 'cross_below') {
      const curVal = latest[cond.field]
      const curOther = latest[cond.value as string]
      const prevVal = prev[cond.field]
      const prevOther = prev[cond.value as string]
      if ([curVal, curOther, prevVal, prevOther].some(v => v == null || isNaN(v))) return false
      if (cond.operator === 'cross_above') {
        if (!(curVal > curOther && prevVal <= prevOther)) return false
      } else if (!(curVal < curOther && prevVal >= prevOther)) return false
      continue
    }
    const val = latest[cond.field]
    if (val == null || isNaN(val)) return false
    const target = cond.value as number
    if (cond.operator === '>') { if (!(val > target)) return false }
    else if (cond.operator === '<') { if (!(val < target)) return false }
    else if (cond.operator === '==') { if (Math.abs(val - target) > 0.001) return false }
    else if (cond.operator === 'between') {
      const [min, max] = cond.value as [number, number]
      if (val < min || val > max) return false
    }
  }

  for (const mc of mfConditions) {
    const mf = row.mf
    if (!mf) return false
    const windowFlows: number[] = mf.dailyFlows.slice(-mc.window)
    const mfVal = mc.field === 'moneyInflowSum'
      ? windowFlows.reduce((s, v) => s + v, 0)
      : (windowFlows.length ? windowFlows.reduce((s, v) => s + v, 0) / windowFlows.length : 0)
    if (mc.operator === '>' && !(mfVal > mc.value)) return false
    if (mc.operator === '<' && !(mfVal < mc.value)) return false
    if (mc.operator === '==' && Math.abs(mfVal - mc.value) > 0.001) return false
  }
  return true
}

/** 对外形状：与改造前一致（前端读 s.price / s.change / s.indicators.*） */
function toPublic(row: any) {
  const l = row.latest
  return {
    code: row.code,
    name: row.name,
    price: l.price,
    change: l.change,
    volume: l.volume,
    amount: l.amount,
    amplitude: l.amplitude,
    indicators: {
      ma5: l.ma5, ma10: l.ma10, ma20: l.ma20, ma60: l.ma60,
      macd: l.macd, macdSignal: l.macdSignal, macdHistogram: l.macdHistogram, rsi: l.rsi,
    },
  }
}

export default router
