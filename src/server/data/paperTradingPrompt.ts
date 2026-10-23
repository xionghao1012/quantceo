/**
 * Paper Trading Agent — AI 提示词模板
 *
 * 用于 AI Agent 决策时的上下文注入和数据格式化
 */

export interface AgentContext {
  agentId: string
  agentName: string
  cash: number
  totalValue: number
  nav: number
  totalReturn: number
  todayNewPositions: number
  dailyLimit: number
  positions: Array<{
    code: string
    name: string
    shares: number
    avgCost: number
    currentPrice: number
    pnl: number
    pnlPct: number
  }>
}

export interface StockData {
  code: string
  name: string
  close: number
  changePct: number
  moneyFlowMain: number
  moneyFlowMainPct: number
}

/**
 * 生成 Agent 系统提示词
 */
export function buildSystemPrompt(strategy: { name: string; tagline: string; playbook: string[] }): string {
  const rules = strategy.playbook.map((r, i) => `${i + 1}. ${r}`).join('\n')
  return `你是「策略擂台」中的「${strategy.name}」策略，风格：${strategy.tagline}。

【你的策略规则（必须严格执行）】
${rules}

【通用交易规则（与上面冲突时，以上面的策略规则为准）】
- 初始资金：100 万元（每个策略独立虚拟账户）
- 最小交易单位：100 股
- 禁止买入：ST 股、当日跌停股
- 撮合规则：当日 15:05 收盘后，所有 PENDING 订单按当日收盘价成交
- 手续费：买入 0.03%，卖出 0.03% + 印花税 0.1%

【你必须诚实的地方】
- 候选股已经按你的策略口径筛过，不要买候选之外的票
- 不符合你的买入条件时，就输出 hold，不要为了交易而交易
- 你只操作自己的账户

不要输出思考过程、不要解释、不要 markdown，直接输出 JSON 对象。`
}

/**
 * 生成每日复盘提示词
 */
export function buildDailyReviewPrompt(ctx: AgentContext, marketSummary: string): string {
  const positionsList = ctx.positions.length
    ? ctx.positions.map(p =>
      `  - ${p.name}(${p.code}): ${p.shares}股, 成本${p.avgCost}, 当前${p.currentPrice}, 盈亏${p.pnlPct > 0 ? '+' : ''}${p.pnlPct.toFixed(2)}%`
    ).join('\n')
    : '  （空仓）'

  return `【每日复盘】${new Date().toLocaleDateString('zh-CN')}

大盘概况：${marketSummary}

账户状态：
  现金：${ctx.cash.toFixed(2)} 元
  总资产：${ctx.totalValue.toFixed(2)} 元
  净值：${ctx.nav.toFixed(4)}
  累计收益：${ctx.totalReturn > 0 ? '+' : ''}${ctx.totalReturn.toFixed(2)}%
  今日新开仓：${ctx.todayNewPositions}/${ctx.dailyLimit} 次

当前持仓：
${positionsList}

请分析今日操作是否合理，提出明日交易计划。`
}

/**
 * 格式化股票数据给 Agent 阅读
 */
export function formatStockBrief(stock: StockData): string {
  const flowDir = stock.moneyFlowMain >= 0 ? '📈 净流入' : '📉 净流出'
  const changeDir = stock.changePct >= 0 ? '+' : ''
  return `${stock.name}(${stock.code}): 现价${stock.close} ${changeDir}${stock.changePct.toFixed(2)}% | ${flowDir} ${Math.abs(stock.moneyFlowMain).toFixed(0)}万 (${stock.moneyFlowMainPct.toFixed(1)}%)`
}
