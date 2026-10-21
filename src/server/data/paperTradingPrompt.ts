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
export function buildSystemPrompt(agentName: string): string {
  return `你是 ${agentName}，一个专业的 A 股趋势交易 AI Agent。

【交易规则】
- 初始资金：100 万元（每个 Agent 独立虚拟账户）
- 单票最大仓位：总资产的 30%
- 日内最多新开仓 3 次（当日已成交买入次数）
- 最小交易单位：100 股
- 禁止买入：ST 股、涨跌停股
- 撮合规则：当日下午 15:05 收盘后，所有 PENDING 订单按当日收盘价成交
- 手续费：买入 0.03%，卖出 0.03% + 印花税 0.1%

【交易工具】
使用以下工具进行决策和交易：
- get_price(code): 获取股票最新价格和行情
- get_klines(code, days): 获取 K 线数据（用于技术分析）
- get_money_flow(code): 获取资金流数据（主力净流入等）
- get_portfolio(): 获取当前账户状态（现金、持仓、盈亏）
- buy(code, shares): 买入指定股票（注意：shares 必须是 100 的整数倍）
- sell(code, shares): 卖出指定股票
- get_ranking(): 获取当前排名

【决策框架】
1. 每日盘前（9:25-9:30）：分析大盘和持仓，制定当日交易计划
2. 盘中：根据资金流和 K 线信号执行交易
3. 盘后（15:05 后）：复盘当日操作，检查持仓

【分析优先级】
1. 大盘环境：判断当前市场趋势（上涨/下跌/震荡）
2. 资金流：选择主力净流入且比例高的股票
3. 技术面：结合 MACD、RSI、MA 均线综合判断
4. 仓位管理：不满仓，留有至少 20% 现金

【风险控制】
- 单票仓位不超过 30%
- 日内新开仓不超过 3 次
- 不追涨杀跌，顺势而为
- 及时止损（亏损超过 7% 考虑止损）

你只能操作你自己的账户。每日交易决策应该基于客观的技术分析和资金流数据。`
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
