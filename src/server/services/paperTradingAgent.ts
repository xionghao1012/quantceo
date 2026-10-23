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
import { submitOrder, getAccountPortfolio, getPrice, AGENT_MODEL_MAP } from './paperTradingEngine.js'
import { buildSystemPrompt, buildDailyReviewPrompt, type AgentContext } from '../data/paperTradingPrompt.js'
import { getPaperStrategy, type PaperCandidate, type PaperStrategy } from './paperStrategies.js'

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

  // 统一用配置好的模型（之前 4 个 agentId 里只有 MiniMax 真的可用，
  // DeepSeek 没 key，Qwen/GPT-4o 都是回退 —— 名字却写在页面上，等于骗人）
  const strategy = getPaperStrategy(account.agentId)
  // ai/llm.js 在 OSS 版是 stub（AI 属 Pro）—— 动态加载，缺能力时明确报错而不是崩
  const llm: any = await import('../ai/llm.js')
  if (typeof llm.llmComplete !== 'function') {
    return { agentId: account.agentId, agentName: account.agentName, model: '', success: false, decision: '', trades: [], error: '当前版本未启用 AI 智能体（Pro 功能）' }
  }
  const model = llm.LLM_MODEL || 'MiniMax-M3'
  const portfolio = await getAccountPortfolio(accountId)
  if (!portfolio) throw new Error(`Portfolio not found for account ${accountId}`)

  // 获取市场数据
  // 候选股按策略口径筛（这是五个策略真正的差异所在），
  // 原来所有 agent 都只看「主力资金 TOP5」，等于同一个策略跑五遍
  const marketData = await fetchStrategyCandidates(strategy)

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

  const systemPrompt = buildSystemPrompt(strategy)
  const userPrompt = buildAgentDecisionPrompt(ctx, marketData, strategy)

  let decision: string
  try {
    decision = await llm.llmComplete(
      `${systemPrompt}\n\n${userPrompt}`,
      { model, temperature: 0.3, maxTokens: 3000, timeoutMs: 90000 }
    )
  } catch (e: any) {
    return { agentId: account.agentId, agentName: account.agentName, model, success: false, decision: '', trades: [], error: e.message }
  }

  // 解析 LLM 决策并执行交易
  const candidateReasons: Record<string, string> = {}
  for (const c of marketData.topFlow) candidateReasons[c.code] = c.reason
  const decisionReason = (() => {
    try {
      const cleaned = decision.replace(/<think[\s\S]*?<\/think>/gi, '')
      const a = cleaned.indexOf('{'), b = cleaned.lastIndexOf('}')
      return a >= 0 && b > a ? String(JSON.parse(cleaned.slice(a, b + 1))?.reason || '') : ''
    } catch { return '' }
  })()
  const trades = await executeAgentDecision(accountId, decision, model, candidateReasons, decisionReason)

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
  topFlow: PaperCandidate[]
  marketTrend: string
}

/** 按策略口径取候选股（策略之间唯一的实质差异就在这一步） */
async function fetchStrategyCandidates(strategy: PaperStrategy): Promise<MarketData> {
  let topFlow: PaperCandidate[] = []
  try {
    topFlow = await strategy.candidates()
  } catch (e: any) {
    console.warn(`[PaperTrading] ${strategy.id} 取候选失败: ${e.message}`)
  }
  return { topFlow, marketTrend: await marketTrendText() }
}

/** 大盘环境：用当日全市场涨跌家数描述，而不是写死「震荡偏强」 */
async function marketTrendText(): Promise<string> {
  try {
    const r = await db.execute(sql`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE change_pct > 0)::int AS up,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY change_pct)::float8 AS median
      FROM daily_metrics WHERE metric_date = (SELECT max(metric_date) FROM daily_metrics)
    `) as any
    const row = r?.rows?.[0]
    if (!row || !row.n) return '未知'
    const upPct = Math.round(100 * row.up / row.n)
    const median = Number(row.median).toFixed(2)
    const tone = upPct >= 60 ? '偏强' : upPct <= 40 ? '偏弱' : '震荡'
    return `${tone}（${upPct}% 上涨，中位涨跌 ${median}%）`
  } catch {
    return '未知'
  }
}

// ----------------------------------------------------------
// 决策 Prompt 构建
// ----------------------------------------------------------

function buildAgentDecisionPrompt(ctx: AgentContext, market: MarketData, strategy: PaperStrategy): string {
  const positions = ctx.positions.length
    ? ctx.positions.map(p =>
      `  ${p.name}(${p.code}): ${p.shares}股, 成本${p.avgCost}, 当前${p.currentPrice}, 盈亏${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(2)}%`
    ).join('\n')
    : '  （空仓）'

  const candidates = market.topFlow
    .filter(s => !ctx.positions.some(p => p.code === s.code))
    .slice(0, 8)
    .map(s => `  ${s.name}(${s.code}): 现价${s.close}, 涨跌${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}%, ${s.reason}`)
    .join('\n') || '  （今日无符合策略条件的候选股）'

  const d = new Date()
  const tradingDayOfMonth = Math.floor((d.getDate() - 1) * 5 / 7) + 1  // 近似：周末不计，仅用于「是否月初」判断
  return `【策略】${strategy.name} —— ${strategy.tagline}
【日期】${d.toISOString().slice(0, 10)}（本月第 ${tradingDayOfMonth} 个交易日左右）

【当前账户状态】
  现金：${ctx.cash.toFixed(2)} 元
  总资产：${ctx.totalValue.toFixed(2)} 元
  净值：${ctx.nav.toFixed(4)}
  累计收益：${ctx.totalReturn >= 0 ? '+' : ''}${ctx.totalReturn.toFixed(2)}%
  今日新开仓：${ctx.todayNewPositions}/${ctx.dailyLimit} 次

【当前持仓】
${positions}

【候选股票（已按本策略口径筛选，只从这里选）】
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
  /** 候选股代码 → 入选理由（写进订单，页面上能回答「为什么买这只」） */
  candidateReasons: Record<string, string> = {},
  /** 模型给出的本次决策理由 */
  decisionReason = '',
): Promise<AgentRunResult['trades']> {
  const trades: AgentRunResult['trades'] = []

  // 解析 JSON：MiniMax-M3 会先输出  thinking...</think> 思考块，必须先剥掉，
  // 否则思考块里的花括号会让「取第一个 { 到最后一个 }」直接解析失败（实测 4/5 全挂）
  let parsed: any
  try {
    const cleaned = decision.replace(/<think[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?```(?:json)?/i, '')
    const firstBrace = cleaned.indexOf('{')
    const lastBrace = cleaned.lastIndexOf('}')
    if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error('no json object')
    parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1))
  } catch (e: any) {
    // 解析失败要抛出去让调度器记成 failed，不能静默当成 hold（否则又是「success/0 产出」）
    throw new Error(`决策解析失败: ${String(decision).slice(0, 120)}`)
  }

  if (!parsed.trades || !Array.isArray(parsed.trades) || parsed.trades.length === 0) {
    // hold 或无交易
    return trades
  }

  for (const trade of parsed.trades) {
    if (!trade.code || !trade.direction || !trade.shares) continue
    if (trade.direction !== 'BUY' && trade.direction !== 'SELL') continue

    // 获取当前价格：走 engine 的 getPrice（实时 → 资金流表 → K 线最新收盘）。
    // 之前这里直接查 money_flow_realtime（生产 0 行），价格取不到就整笔丢弃，
    // 于是「策略明明下了单却永远不成交」。
    let price = 0
    try {
      price = (await getPrice(trade.code)) || 0
    } catch { price = 0 }

    if (price <= 0) {
      trades.push({ direction: trade.direction, code: trade.code, shares: trade.shares, result: 'PRICE_UNAVAILABLE' })
      continue
    }

    // 下单
    const result = await submitOrder(accountId, trade.direction, trade.code, trade.name || trade.code, trade.shares, price, decisionReason, candidateReasons[trade.code])
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
  const strategy = getPaperStrategy(account.agentId)
  const llm: any = await import('../ai/llm.js')
  if (typeof llm.llmComplete !== 'function') {
    return { agentId: account.agentId, agentName: account.agentName, model: '', success: false, review: '', error: '当前版本未启用 AI 复盘（Pro 功能）' }
  }
  const model = llm.LLM_MODEL || 'MiniMax-M3'
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

  const systemPrompt = buildSystemPrompt(strategy)
  const userPrompt = buildDailyReviewPrompt(ctx, todayTrades)

  let review: string
  try {
    review = await llm.llmComplete(
      `${systemPrompt}\n\n${userPrompt}`,
      { model, temperature: 0.5, maxTokens: 1000, timeoutMs: 60000 }
    )
    console.log(`[DailyReview] ${account.agentName}: ${review.slice(0, 100)}`)
  } catch (e: any) {
    return { agentId: account.agentId, agentName: account.agentName, model, success: false, review: '', error: e.message }
  }

  return { agentId: account.agentId, agentName: account.agentName, model, success: true, review }
}
