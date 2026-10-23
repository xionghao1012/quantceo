import crypto from 'crypto'
/**
 * Paper Trading Engine — 模拟撮合引擎
 *
 * 撮合规则：
 * - 订单在次日开盘价成交（非交易时间挂单，下一交易日开盘成交）
 * - 成交价 = 实时收盘价（作为开盘价近似）
 * - 手续费：买入 0.03%，卖出 0.03% + 印花税 0.1%
 * - 卖出 FIFO 消耗持仓
 */

import { db } from '../db/db.js'
import {
  paperCompetitions, paperAccounts, paperPositions, paperOrders, paperNavSnapshots,
  moneyFlowRealtime,
} from '../db/schema.js'
import { eq, and, gte, sql, desc } from 'drizzle-orm'
import { getRealtimeMoneyFlow } from './moneyFlowService.js'
import { ymdCN } from '../utils/date.js'
import { PAPER_STRATEGIES } from './paperStrategies.js'

// 获取价格：实时资金流 → 资金流表 → K 线最新收盘（最后兜底）
export async function getPrice(code: string): Promise<number | null> {
  try {
    const rt = await getRealtimeMoneyFlow(code)
    if (rt && rt.close > 0) return Number(rt.close)
  } catch { /* fall through */ }
  const fromFlow = await getPriceFromDB(code)
  if (fromFlow && fromFlow > 0) return fromFlow
  // 兜底必须查 K 线：money_flow_realtime 生产是空表（0 行），
  // 只靠它会让所有持仓估值为 0 —— 比赛页面因此显示 -59%~-82% 的假亏损。
  // K 线是全站价格的权威来源，也一定有数据。
  try {
    const r = await db.execute(sql`
      SELECT close FROM klines WHERE code = ${code} ORDER BY date DESC LIMIT 1
    `) as any
    const v = Number(r?.rows?.[0]?.close)
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

// 撮合后快照时直接查 DB（绕缓存）
export async function getPriceFromDB(code: string): Promise<number | null> {
  const rows = await db.select({ close: moneyFlowRealtime.closePrice })
    .from(moneyFlowRealtime)
    .where(eq(moneyFlowRealtime.code, code))
    .orderBy(desc(moneyFlowRealtime.updateTime))
    .limit(1)
  return rows[0]?.close ? Number(rows[0].close) : null
}

// 手续费率
const FEE_BUY = 0.0003   // 0.03%（含规费）
const FEE_SELL = 0.001   // 0.03% + 0.1% 印花税

// Agent → 模型映射（只用已配置好 API key 的模型）
export const AGENT_MODEL_MAP: Record<string, string> = {
  deepseek: 'deepseek-chat',   // 需 DEEPSEEK_API_KEY
  gpt4o: 'MiniMax-M2.7',       // 回退到 MiniMax
  qwen: 'MiniMax-M2.7',        // 回退到 MiniMax
  minimax: 'MiniMax-M2.7',
}

export interface OrderResult {
  ok: boolean
  error?: string
  message?: string
  order?: any
}

export interface MatchResult {
  orderId: number
  status: 'FILLED' | 'REJECTED' | 'SKIPPED'
  filledPrice?: number
  rejectReason?: string
}

export function calcBuyCost(price: number, shares: number): number {
  return price * shares * (1 + FEE_BUY)
}

export function calcSellProceed(price: number, shares: number): number {
  return price * shares * (1 - FEE_SELL)
}

export function formatMoney(v: number | string): string {
  const n = Number(v)
  if (isNaN(n)) return '0'
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + '亿'
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(2) + '万'
  return n.toFixed(2)
}

// -----------------------------------------------------------
// 风控检查
// -----------------------------------------------------------

// exec 用于撮合时把校验放进同一事务，默认走全局 db
export async function validateOrder(
  accountId: number,
  direction: 'BUY' | 'SELL',
  code: string,
  shares: number,
  orderPrice: number,
  excludeOrderId?: number,
  exec: any = db,
): Promise<{ ok: boolean; reason?: string; message?: string }> {
  // 获取账户
  const accountRows = await exec.select().from(paperAccounts).where(eq(paperAccounts.id, accountId)).limit(1)
  if (!accountRows.length) return { ok: false, reason: 'ACCOUNT_NOT_FOUND', message: '账户不存在' }
  const account = accountRows[0]

  // 获取比赛
  const compRows = await exec.select().from(paperCompetitions).where(eq(paperCompetitions.id, account.competitionId!)).limit(1)
  if (!compRows.length) return { ok: false, reason: 'COMPETITION_NOT_FOUND', message: '比赛不存在' }
  const competition = compRows[0]
  if (competition.status !== 'running') {
    return { ok: false, reason: 'COMPETITION_NOT_RUNNING', message: '比赛未进行' }
  }

  if (direction === 'BUY') {
    const cost = calcBuyCost(orderPrice, shares)
    if (Number(account.cash) < cost) {
      return {
        ok: false,
        reason: 'INSUFFICIENT_CASH',
        message: `现金不足，需要 ${formatMoney(cost)} 元，当前 ${formatMoney(Number(account.cash))} 元`,
      }
    }

    // 单票仓位检查：该股票已持仓 + 本次挂单（挂单也占用额度）+ 本次成交
    const positions = await exec.select().from(paperPositions).where(eq(paperPositions.accountId, accountId))
    const pos = positions.find((p: any) => p.code === code)
    const heldValue = pos ? Number(pos.avgCost) * pos.shares : 0

    // 同一代码的未成交挂单同样占用仓位额度，避免多笔挂单叠加突破上限
    const pendingRows = await exec.select().from(paperOrders)
      .where(and(
        eq(paperOrders.accountId, accountId),
        eq(paperOrders.code, code),
        eq(paperOrders.direction, 'BUY'),
        eq(paperOrders.status, 'PENDING'),
      ))
    // excludeOrderId：撮合复核时排除当前单，避免自身额度被重复计算
    const pendingValue = pendingRows
      .filter((o: any) => o.id !== excludeOrderId)
      .reduce((s: number, o: any) => s + calcBuyCost(Number(o.price), o.shares), 0)

    const maxRatio = Number(competition.maxPositionRatio)
    const limitValue = Number(competition.initialCash) * maxRatio
    if (heldValue + pendingValue + cost > limitValue) {
      return {
        ok: false,
        reason: 'POSITION_LIMIT_EXCEEDED',
        message: `单票仓位超限，最大 ${(maxRatio * 100).toFixed(0)}%（${formatMoney(limitValue)} 元）`,
      }
    }

    // ST / 涨跌停检查（简化：暂不限制，实际需对接东财数据）
    // const stockInfo = await getStockBasicInfo(code)
    // if (stockInfo.isST) return { ok: false, reason: 'ST_NOT_ALLOWED', message: '禁止买入 ST 股' }

    // 日内新开仓次数（仅统计当天已成交的买单）
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayOrders = await exec.select({ cnt: sql<number>`count(*)` }).from(paperOrders)
      .where(and(
        eq(paperOrders.accountId, accountId),
        eq(paperOrders.direction, 'BUY'),
        eq(paperOrders.status, 'FILLED'),
        gte(paperOrders.filledAt, todayStart),
      ))
    const filledToday = Number(todayOrders[0]?.cnt ?? 0)
    if (filledToday >= competition.dailyTradeLimit) {
      return {
        ok: false,
        reason: 'DAILY_TRADE_LIMIT_EXCEEDED',
        message: `日内新开仓次数已达上限（${competition.dailyTradeLimit}次/日）`,
      }
    }
  }

  if (direction === 'SELL') {
    const posRows = await exec.select().from(paperPositions)
      .where(and(eq(paperPositions.accountId, accountId), eq(paperPositions.code, code))).limit(1)
    const position = posRows[0]
    if (!position || position.shares < shares) {
      return {
        ok: false,
        reason: 'INSUFFICIENT_POSITION',
        message: `持仓不足，需要 ${shares} 股，持有 ${position?.shares ?? 0} 股`,
      }
    }
  }

  return { ok: true }
}

// -----------------------------------------------------------
// 提交订单
// -----------------------------------------------------------

export async function submitOrder(
  accountId: number,
  direction: 'BUY' | 'SELL',
  code: string,
  name: string,
  shares: number,
  orderPrice: number,
): Promise<OrderResult> {
  const validation = await validateOrder(accountId, direction, code, shares, orderPrice)

  // 获取 competitionId
  const accountRows = await db.select().from(paperAccounts).where(eq(paperAccounts.id, accountId)).limit(1)
  const competitionId = accountRows[0]?.competitionId ?? 0

  if (!validation.ok) {
    const [order] = await db.insert(paperOrders).values({
      accountId,
      competitionId,
      code,
      name,
      direction,
      price: String(orderPrice),
      shares,
      status: 'REJECTED',
      rejectReason: validation.reason,
    }).returning()
    return { ok: false, error: validation.reason!, message: validation.message!, order }
  }

  // PENDING 订单，等待下一个交易日成交
  const [order] = await db.insert(paperOrders).values({
    accountId,
    competitionId,
    code,
    name,
    direction,
    price: String(orderPrice),
    shares,
    status: 'PENDING',
  }).returning()

  return { ok: true, order }
}

// -----------------------------------------------------------
// 成交执行（每日定时任务）
// -----------------------------------------------------------

export async function matchAllPendingOrders(): Promise<MatchResult[]> {
  const pending = await db.select().from(paperOrders)
    .where(eq(paperOrders.status, 'PENDING'))
    .orderBy(paperOrders.createdAt)

  const results: MatchResult[] = []
  for (const order of pending) {
    const result = await matchSingleOrder(order)
    results.push(result)
  }
  return results
}

export async function matchSingleOrder(order: any): Promise<MatchResult> {
  // 行情在事务外取，避免网络调用长时间占用行锁
  let filledPrice: number | null = null
  try {
    filledPrice = await getPrice(order.code)
  } catch {}

  // 撮合涉及现金、持仓、订单状态三处写入，必须在一个事务里完成；
  // 先锁账户再锁订单（固定顺序，避免死锁）：
  //  - 账户行锁让同一账户的撮合串行化，防止并发时两笔单都通过现金校验
  //  - 订单行锁 + 状态复核让同一笔单只能被一个实例/manual 触发成交
  return db.transaction(async (tx) => {
    await tx.select().from(paperAccounts)
      .where(eq(paperAccounts.id, order.accountId)).for('update')

    const [current] = await tx.select().from(paperOrders)
      .where(eq(paperOrders.id, order.id)).for('update')
    if (!current || current.status !== 'PENDING') {
      return { orderId: order.id, status: 'SKIPPED' } as MatchResult
    }

    if (!filledPrice || filledPrice <= 0) {
      await tx.update(paperOrders)
        .set({ status: 'REJECTED', rejectReason: 'NO_PRICE_DATA', filledAt: new Date() })
        .where(eq(paperOrders.id, current.id))
      return { orderId: current.id, status: 'REJECTED', rejectReason: 'NO_PRICE_DATA' }
    }

    if (current.direction === 'BUY') {
      // 撮合时重新校验风控：下单后到成交前，现金/持仓可能已变化
      // 不校验会导致现金为负、仓位远超上限
      const recheck = await validateOrder(current.accountId, 'BUY', current.code, current.shares, filledPrice, current.id, tx)
      if (!recheck.ok) {
        await tx.update(paperOrders)
          .set({ status: 'REJECTED', rejectReason: recheck.reason, filledAt: new Date() })
          .where(eq(paperOrders.id, current.id))
        return { orderId: current.id, status: 'REJECTED', rejectReason: recheck.reason }
      }

      const cost = calcBuyCost(filledPrice, current.shares)

      // 扣减现金
      await tx.update(paperAccounts)
        .set({ cash: sql`cash - ${cost}` })
        .where(eq(paperAccounts.id, current.accountId))

      // 更新持仓
      const existingPos = await tx.select().from(paperPositions)
        .where(and(eq(paperPositions.accountId, current.accountId), eq(paperPositions.code, current.code))).limit(1)

      if (existingPos.length > 0) {
        const pos = existingPos[0]
        const totalShares = pos.shares + current.shares
        const newAvgCost = (Number(pos.avgCost) * pos.shares + filledPrice * current.shares) / totalShares
        await tx.update(paperPositions)
          .set({ shares: totalShares, avgCost: String(newAvgCost), updatedAt: new Date() })
          .where(eq(paperPositions.id, pos.id))
      } else {
        await tx.insert(paperPositions).values({
          accountId: current.accountId,
          code: current.code,
          name: current.name,
          shares: current.shares,
          avgCost: String(filledPrice),
        })
      }
    } else {
      // 卖出 — FIFO 消耗
      let remaining = current.shares
      const positions = await tx.select().from(paperPositions)
        .where(and(eq(paperPositions.accountId, current.accountId), eq(paperPositions.code, current.code)))
        .orderBy(paperPositions.createdAt)

      for (const pos of positions) {
        if (remaining <= 0) break
        const consume = Math.min(pos.shares, remaining)
        const proceed = calcSellProceed(filledPrice, consume)

        await tx.update(paperAccounts)
          .set({ cash: sql`cash + ${proceed}` })
          .where(eq(paperAccounts.id, current.accountId))

        if (consume === pos.shares) {
          await tx.delete(paperPositions).where(eq(paperPositions.id, pos.id))
        } else {
          await tx.update(paperPositions)
            .set({ shares: pos.shares - consume, updatedAt: new Date() })
            .where(eq(paperPositions.id, pos.id))
        }
        remaining -= consume
      }
    }

    await tx.update(paperOrders)
      .set({ status: 'FILLED', filledPrice: String(filledPrice), filledAt: new Date() })
      .where(eq(paperOrders.id, current.id))

    return { orderId: current.id, status: 'FILLED', filledPrice } as MatchResult
  })
}

// -----------------------------------------------------------
// 日终净值快照
// -----------------------------------------------------------

export async function snapshotAllAccounts(): Promise<void> {
  const accounts = await db.select().from(paperAccounts)
  const today = ymdCN()

  for (const account of accounts) {
    const positions = await db.select().from(paperPositions)
      .where(eq(paperPositions.accountId, account.id))

    let totalValue = Number(account.cash)
    for (const pos of positions) {
      // 必须走 getPrice（实时 → 资金流表 → K 线兜底）：getPriceFromDB 只查
      // money_flow_realtime，生产是空表，会把持仓算成 0 —— 净值曲线第一天就是假的。
      const quoted = await getPrice(pos.code)
      totalValue += (quoted ?? Number(pos.avgCost)) * pos.shares
    }

    const compRows = await db.select().from(paperCompetitions)
      .where(eq(paperCompetitions.id, account.competitionId!)).limit(1)
    const initialCash = Number(compRows[0]?.initialCash ?? 1000000)
    const nav = totalValue / initialCash

    await db.insert(paperNavSnapshots).values({
      accountId: account.id,
      competitionId: account.competitionId ?? 0,
      nav: String(nav),
      totalValue: String(totalValue),
      snapshotDate: today,
    }).onConflictDoUpdate({
      target: [paperNavSnapshots.accountId, paperNavSnapshots.snapshotDate],
      set: { nav: String(nav), totalValue: String(totalValue) },
    })
  }
}

// -----------------------------------------------------------
// 账户组合查询
// -----------------------------------------------------------

export async function getAccountPortfolio(accountId: number) {
  const accountRows = await db.select().from(paperAccounts).where(eq(paperAccounts.id, accountId)).limit(1)
  if (!accountRows.length) return null
  const account = accountRows[0]

  const positions = await db.select().from(paperPositions)
    .where(eq(paperPositions.accountId, accountId))

  const positionsWithValue = await Promise.all(positions.map(async (pos) => {
    const quoted = await getPrice(pos.code)
    // 取不到价格时按成本估值，并把 priceStale 标出来。
    // 之前 `?? 0` 会把「没行情」显示成「亏光」，比赛排行榜直接变成假数据。
    const currentPrice = quoted ?? Number(pos.avgCost)
    const value = currentPrice * pos.shares
    const cost = Number(pos.avgCost) * pos.shares
    return {
      ...pos,
      currentPrice,
      priceStale: quoted === null,
      value,
      pnl: value - cost,
      pnlPct: cost > 0 ? ((value - cost) / cost) * 100 : 0,
    }
  }))

  const cash = Number(account.cash)
  const positionValue = positionsWithValue.reduce((s, p) => s + p.value, 0)
  const totalValue = cash + positionValue

  const compRows = await db.select().from(paperCompetitions)
    .where(eq(paperCompetitions.id, account.competitionId!)).limit(1)
  const initialCash = Number(compRows[0]?.initialCash ?? 1000000)
  const nav = totalValue / initialCash
  const totalReturn = (nav - 1) * 100

  // 当日新开仓次数（仅当天已成交的买单）
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayOrders = await db.select({ cnt: sql<number>`count(*)` }).from(paperOrders)
    .where(and(
      eq(paperOrders.accountId, accountId),
      eq(paperOrders.direction, 'BUY'),
      eq(paperOrders.status, 'FILLED'),
      gte(paperOrders.filledAt, todayStart),
    ))

  return {
    agentId: account.agentId,
    agentName: account.agentName,
    cash,
    positionValue,
    totalValue,
    nav,
    totalReturn,
    todayNewPositions: Number(todayOrders[0]?.cnt ?? 0),
    dailyLimit: compRows[0]?.dailyTradeLimit ?? 3,
    positions: positionsWithValue,
  }
}

// -----------------------------------------------------------
// 一键建赛（幂等）
// -----------------------------------------------------------

/**
 * 建一场比赛并补齐 5 个策略账户。
 * 幂等：已有进行中的比赛就复用它，只补缺的策略账户。
 * agentId 全局唯一，所以第 2 届会自动用 trend-2 / reversion-2 …
 */
export async function bootstrapCompetition(opts: {
  name?: string
  initialCash?: string
} = {}) {
  const running = await db.select().from(paperCompetitions)
    .where(eq(paperCompetitions.status, 'running'))
    .orderBy(desc(paperCompetitions.id))
    .limit(1)

  let comp = running[0]
  let created = false
  if (!comp) {
    const initialCash = opts.initialCash || '1000000'
    ;[comp] = await db.insert(paperCompetitions).values({
      name: opts.name || `${new Date().getFullYear()} 策略擂台`,
      initialCash,
      maxPositionRatio: '0.30',
      dailyTradeLimit: 3,
      status: 'running',
      startedAt: new Date(),
    }).returning()
    created = true
  }

  const existing = await db.select().from(paperAccounts).where(eq(paperAccounts.competitionId, comp.id))
  const taken = new Set(existing.map(a => a.agentId))
  const added: string[] = []

  for (const strategy of PAPER_STRATEGIES) {
    if (taken.has(strategy.id)) continue
    // 找一个没被占用的 agentId（跨比赛全局唯一）
    let agentId = strategy.id
    let n = 1
    while (true) {
      const clash = await db.select({ id: paperAccounts.id }).from(paperAccounts)
        .where(eq(paperAccounts.agentId, agentId)).limit(1)
      if (!clash.length) break
      n += 1
      agentId = `${strategy.id}-${n}`
    }
    await db.insert(paperAccounts).values({
      competitionId: comp.id,
      agentId,
      agentName: strategy.name,
      apiKey: crypto.randomBytes(32).toString('hex'),
      cash: comp.initialCash,
    })
    added.push(agentId)
  }

  return {
    competitionId: comp.id,
    name: comp.name,
    status: comp.status,
    created,
    accountsAdded: added,
  }
}

// -----------------------------------------------------------
// 排名
// -----------------------------------------------------------

export async function getCompetitionRanking(competitionId: number) {
  const accounts = await db.select().from(paperAccounts)
    .where(eq(paperAccounts.competitionId, competitionId))

  const ranked = await Promise.all(accounts.map(async (account) => {
    const portfolio = await getAccountPortfolio(account.id)
    return {
      agentId: account.agentId,
      agentName: account.agentName,
      model: AGENT_MODEL_MAP[account.agentId] || 'MiniMax-M2.7',
      nav: portfolio?.nav ?? 1,
      totalReturn: portfolio?.totalReturn ?? 0,
      totalValue: portfolio?.totalValue ?? 0,
      positionValue: portfolio?.positionValue ?? 0,
      cash: portfolio?.cash ?? 0,
      rank: 0,
    }
  }))

  ranked.sort((a, b) => b.totalReturn - a.totalReturn)
  ranked.forEach((r, i) => { r.rank = i + 1 })

  return ranked
}
