/**
 * Paper Trading Agent Runner
 *
 * 每个 Agent 的决策循环：
 * 1. 获取账户状态 + 持仓
 * 2. 获取市场数据（大盘 + 候选股）
 * 3. 调用 LLM（DeepSeek / MiniMax）获取交易决策
 * 4. 执行 buy/sell
 *
 * 模型映射：
 *   deepseek  → deepseek-chat
 *   gpt4o    → openai/gpt-4o (可扩展)
 *   qwen     → qwen-plus (可扩展)
 *   minimax  → MiniMax-M2.7
 */

import { db } from '../db/db.js'
import {
  paperCompetitions, paperAccounts, paperOrders,
  moneyFlowRealtime,
} from '../db/schema.js'
import { eq, desc, and, sql } from 'drizzle-orm'
import { llmComplete } from '../ai/llm.js'
import { submitOrder, getAccountPortfolio, getPriceFromDB, AGENT_MODEL_MAP } from './paperTradingEngine.js'
import { buildSystemPrompt, buildDailyReviewPrompt, type AgentContext } from '../data/paperTradingPrompt.js'

export interface AgentRunResult {
  agentId: string
  agentName: string
  model: string
  success: boolean
  decision: string
  trades: Array<{ direction: string; code: string; shares: number; result: string }>
  error?: string
}

/**
 * 运行单个 Agent 的决策循环
 */
export async function runAgent(accountId: number): Promise<AgentRunResult> {
  const accountRows = await db.select().from(paperAccounts).where(eq(paperAccounts.id, accountId)).limit(1)
  if (!accountRows.length) throw new Error(`Account ${accountId} not found`)
  const account = accountRows[0]

  const compRows = await db.select().from(paperCompetitions).where(eq(paperCompetitions.id, account.competitionId!)).limit(1)
  if (!compRows.length || compRows[0].status !== 'running') {
    return { agentId: account.agentId, agentName: account.agentName, model: '', success: false, decision: 'Competition not running', trades: [] }
  }

  const model = AGENT_MODEL_MAP[account.agentId] || 'deepseek-chat'
  const portfolio = await getAccountPortfolio(accountId)
  if (!portfolio) throw new Error(`Portfolio not found for account ${accountId}`)

  // 获取市场数据
  const marketData = await fetchMarketData()

  // 构建 Prompt
  const ctx: AgentContext = {
    agentId: account.agentId,
    agentName: account.agentName,
    cash: portfolio.cash,
    totalValue: portfolio.totalValue,
    nav: portfolio.nav,
    totalReturn: portfolio.totalReturn,
    todayNewPositions: portfolio.todayNewPositions,
    dailyLimit: portfolio.dailyLimit,
    positions: portfolio.positions.map(p => ({
      code: p.code,
      name: p.name || p.code,
      shares: p.shares,
      avgCost: Number(p.avgCost),
      currentPrice: p.currentPrice,
      pnl: p.pnl,
      pnlPct: p.pnlPct,
    })),
  }

  const systemPrompt = buildSystemPrompt(account.agentName)
  const userPrompt = buildAgentDecisionPrompt(ctx, marketData)

  let decision: string
  try {
    decision = await llmComplete(
      `${systemPrompt}\n\n${userPrompt}`,
      { model, temperature: 0.3, maxTokens: 1500, timeoutMs: 60000 }
    )
  } catch (e: any) {
    return { agentId: account.agentId, agentName: account.agentName, model, success: false, decision: '', trades: [], error: e.message }
  }

  // 解析 LLM 决策并执行交易
  const trades = await executeAgentDecision(accountId, decision, model)

  return { agentId: account.agentId, agentName: account.agentName, model, success: true, decision, trades }
}

/**
 * 为所有 running 比赛的所有 Agent 运行一次决策循环
 */
export async function runAllAgents(): Promise<AgentRunResult[]> {
  const competitions = await db.select().from(paperCompetitions).where(eq(paperCompetitions.status, 'running'))
  const results: AgentRunResult[] = []

  for (const comp of competitions) {
    const accounts = await db.select().from(paperAccounts).where(eq(paperAccounts.competitionId, comp.id))
    for (const account of accounts) {
      try {
        const result = await runAgent(account.id)
        results.push(result)
      } catch (e: any) {
        results.push({ agentId: account.agentId, agentName: account.agentName, model: '', success: false, decision: '', trades: [], error: e.message })
      }
    }
  }
  return results
}

// ----------------------------------------------------------
// 市场数据获取
// ----------------------------------------------------------

interface MarketData {
  topFlow: Array<{ code: string; name: string; close: number; changePct: number; netInflowMain: number; netInflowMainPct: number }>
  marketTrend: string
}

async function fetchMarketData(): Promise<MarketData> {
  // 从 money_flow_realtime 获取主力资金净流入最多的 10 只
  const rows = await db.select({
    code: moneyFlowRealtime.code,
    name: moneyFlowRealtime.name,
    close: moneyFlowRealtime.closePrice,
    changePct: sql<number>`0`,
    netInflowMain: moneyFlowRealtime.netInflowMain,
    netInflowMainPct: moneyFlowRealtime.netInflowMainPct,
  }).from(moneyFlowRealtime)
    .orderBy(desc(moneyFlowRealtime.netInflowMain))
    .limit(10)

  return {
    topFlow: rows.map(r => ({
      code: r.code,
      name: r.name || r.code,
      close: Number(r.close) || 0,
      changePct: Number(r.changePct) || 0,
      netInflowMain: Number(r.netInflowMain) || 0,
      netInflowMainPct: Number(r.netInflowMainPct) || 0,
    })),
    marketTrend: '震荡偏强',
  }
}

// ----------------------------------------------------------
// 决策 Prompt 构建
// ----------------------------------------------------------

function buildAgentDecisionPrompt(ctx: AgentContext, market: MarketData): string {
  const positions = ctx.positions.length
    ? ctx.positions.map(p =>
      `  ${p.name}(${p.code}): ${p.shares}股, 成本${p.avgCost}, 当前${p.currentPrice}, 盈亏${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(2)}%`
    ).join('\n')
    : '  （空仓）'

  const candidates = market.topFlow
    .filter(s => !ctx.positions.some(p => p.code === s.code))
    .slice(0, 5)
    .map(s => `  ${s.name}(${s.code}): 现价${s.close}, 主力净流入${s.netInflowMain >= 0 ? '+' : ''}${(s.netInflowMain / 10000).toFixed(0)}万 (${s.netInflowMainPct.toFixed(1)}%)`)
    .join('\n')

  return `【当前账户状态】
  现金：${ctx.cash.toFixed(2)} 元
  总资产：${ctx.totalValue.toFixed(2)} 元
  净值：${ctx.nav.toFixed(4)}
  累计收益：${ctx.totalReturn >= 0 ? '+' : ''}${ctx.totalReturn.toFixed(2)}%
  今日新开仓：${ctx.todayNewPositions}/${ctx.dailyLimit} 次

【当前持仓】
${positions}

【候选股票（主力资金净流入排名）】
${candidates}

【大盘】${market.marketTrend}

请分析以上信息，决定是否需要买入或卖出。

重要规则：
- 买入时 shares 必须是 100 的整数倍
- 单票仓位不超过总资产的 30%
- 日内新开仓不超过 ${ctx.dailyLimit} 次
- 已有持仓的股票不要重复加仓（若要加仓请卖出后再买）

你的回答格式（只输出 JSON，不要其他文字）：
{
  "action": "buy" | "sell" | "hold",
  "reason": "简短决策理由（20字内）",
  "trades": [
    {
      "code": "股票代码，如 600519",
      "name": "股票名称，如 贵州茅台",
      "direction": "BUY" | "SELL",
      "shares": 100的整数倍数量
    }
  ]
}

只输出 JSON。`
}

// ----------------------------------------------------------
// 决策执行
// ----------------------------------------------------------

async function executeAgentDecision(
  accountId: number,
  decision: string,
  model: string,
): Promise<AgentRunResult['trades']> {
  const trades: AgentRunResult['trades'] = []

  // 解析 JSON
  let parsed: any
  try {
    const firstBrace = decision.indexOf('{')
    const lastBrace = decision.lastIndexOf('}')
    const jsonStr = decision.slice(firstBrace, lastBrace + 1)
    parsed = JSON.parse(jsonStr)
  } catch {
    console.warn(`[Agent] Failed to parse LLM decision: ${decision.slice(0, 200)}`)
    return trades
  }

  if (!parsed.trades || !Array.isArray(parsed.trades) || parsed.trades.length === 0) {
    // hold 或无交易
    return trades
  }

  for (const trade of parsed.trades) {
    if (!trade.code || !trade.direction || !trade.shares) continue
    if (trade.direction !== 'BUY' && trade.direction !== 'SELL') continue

    // 获取当前价格
    let price: number
    try {
      price = (await getPriceFromDB(trade.code)) || 0
      if (price <= 0) {
        // 从 market data 中找
        const rtData = await db.select({ close: moneyFlowRealtime.closePrice })
          .from(moneyFlowRealtime).where(eq(moneyFlowRealtime.code, trade.code)).limit(1)
        price = Number(rtData[0]?.close) || 0
      }
    } catch { price = 0 }

    if (price <= 0) {
      trades.push({ direction: trade.direction, code: trade.code, shares: trade.shares, result: 'PRICE_UNAVAILABLE' })
      continue
    }

    // 下单
    const result = await submitOrder(accountId, trade.direction, trade.code, trade.name || trade.code, trade.shares, price)
    const orderResult = result.ok ? 'FILLED(PENDING)' : `REJECTED:${result.error}`
    trades.push({ direction: trade.direction, code: trade.code, shares: trade.shares, result: orderResult })
    console.log(`[Agent ${model}] ${trade.direction} ${trade.code} x${trade.shares} @${price} → ${orderResult}`)
  }

  return trades
}

// ----------------------------------------------------------
// 每日复盘（15:05 撮合后执行，不下单，只生成分析）
// ----------------------------------------------------------

export interface DailyReviewResult {
  agentId: string
  agentName: string
  model: string
  success: boolean
  review: string
  error?: string
}

/**
 * 为所有 running 比赛的 Agent 生成每日复盘
 */
export async function runDailyReview(): Promise<DailyReviewResult[]> {
  const competitions = await db.select().from(paperCompetitions).where(eq(paperCompetitions.status, 'running'))
  const results: DailyReviewResult[] = []

  for (const comp of competitions) {
    const accounts = await db.select().from(paperAccounts).where(eq(paperAccounts.competitionId, comp.id))
    for (const account of accounts) {
      try {
        const result = await reviewAgent(account)
        results.push(result)
      } catch (e: any) {
        results.push({ agentId: account.agentId, agentName: account.agentName, model: '', success: false, review: '', error: e.message })
      }
    }
  }
  return results
}

async function reviewAgent(account: any): Promise<DailyReviewResult> {
  const model = AGENT_MODEL_MAP[account.agentId] || 'MiniMax-M2.7'
  const portfolio = await getAccountPortfolio(account.id)
  if (!portfolio) throw new Error('Portfolio not found')

  const ctx: AgentContext = {
    agentId: account.agentId,
    agentName: account.agentName,
    cash: portfolio.cash,
    totalValue: portfolio.totalValue,
    nav: portfolio.nav,
    totalReturn: portfolio.totalReturn,
    todayNewPositions: portfolio.todayNewPositions,
    dailyLimit: portfolio.dailyLimit,
    positions: portfolio.positions.map(p => ({
      code: p.code,
      name: p.name || p.code,
      shares: p.shares,
      avgCost: Number(p.avgCost),
      currentPrice: p.currentPrice,
      pnl: p.pnl,
      pnlPct: p.pnlPct,
    })),
  }

  // 获取今日成交的订单
  const today = new Date().toISOString().split('T')[0]
  const todayOrders = await db.select().from(paperOrders)
    .where(and(
      eq(paperOrders.accountId, account.id),
      eq(paperOrders.status, 'FILLED'),
    ))

  const todayTrades = todayOrders
    .filter(o => o.filledAt && o.filledAt.toISOString().startsWith(today))
    .map(o => `${o.direction === 'BUY' ? '买入' : '卖出'} ${o.name || o.code} ${o.shares}股 @ ${o.filledPrice}`)
    .join('\n') || '今日无成交'

  const systemPrompt = buildSystemPrompt(account.agentName)
  const userPrompt = buildDailyReviewPrompt(ctx, todayTrades)

  let review: string
  try {
    review = await llmComplete(
      `${systemPrompt}\n\n${userPrompt}`,
      { model, temperature: 0.5, maxTokens: 1000, timeoutMs: 60000 }
    )
    console.log(`[DailyReview] ${account.agentName}: ${review.slice(0, 100)}`)
  } catch (e: any) {
    return { agentId: account.agentId, agentName: account.agentName, model, success: false, review: '', error: e.message }
  }

  return { agentId: account.agentId, agentName: account.agentName, model, success: true, review }
}
