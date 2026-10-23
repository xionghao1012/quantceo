/**
 * Paper Trading API — AI 模拟炒股比赛路由
 */
import { Router } from 'express'
import { db } from '../db/db.js'
import {
  paperCompetitions, paperAccounts, paperOrders, paperNavSnapshots,
} from '../db/schema.js'
import { eq, desc, and, sql } from 'drizzle-orm'
import {
  submitOrder, getAccountPortfolio, getCompetitionRanking,
  matchAllPendingOrders, snapshotAllAccounts,
  bootstrapCompetition,
} from '../services/paperTradingEngine.js'
import { runAllAgents, runAgent } from '../services/paperTradingAgent.js'
import { strategyCatalog } from '../services/paperStrategies.js'
import { generateWeeklyReport, listWeeklyReports } from '../services/paperWeeklyReport.js'
import { getOrFetchKlines } from '../data/cache.js'
import { runBacktest } from '../backtest/index.js'
import type { BacktestResult } from '../../shared/types.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { optionalAuth } from '../middleware/auth.js'
import crypto from 'crypto'

const router = Router()

function requireAgentApiKey(req: any, res: any, next: any) {
  const key = req.headers['x-agent-key'] as string
  if (!key) return res.status(401).json({ error: 'Missing X-Agent-Key header' })
  next()
}

// ----------------------------------------------------------
// 公开接口
// ----------------------------------------------------------

router.get('/competitions', async (_req, res) => {
  const competitions = await db.select().from(paperCompetitions).orderBy(desc(paperCompetitions.createdAt))
  res.json(competitions)
})

// 历史比赛列表（只显示已结束的比赛）
// 策略目录：规则、说明、能否一键回测（前端策略卡片与回测按钮都读它）
router.get('/strategies', (_req, res) => {
  res.json(strategyCatalog())
})

router.get('/competitions/history/all', async (_req, res) => {
  const history = await db.select().from(paperCompetitions)
    .where(eq(paperCompetitions.status, 'finished'))
    .orderBy(desc(paperCompetitions.finishedAt))
  res.json(history)
})

// 某历史比赛的完整数据（包含所有账户的净值历史）
router.get('/competitions/history/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const [comp] = await db.select().from(paperCompetitions).where(eq(paperCompetitions.id, id)).limit(1)
  if (!comp) return res.status(404).json({ error: 'Competition not found' })

  // 获取所有账户
  const accounts = await db.select().from(paperAccounts).where(eq(paperAccounts.competitionId, id))

  // 获取每个账户的净值历史
  const accountHistories = await Promise.all(accounts.map(async (acc) => {
    const snapshots = await db.select({
      date: paperNavSnapshots.snapshotDate,
      nav: paperNavSnapshots.nav,
      totalValue: paperNavSnapshots.totalValue,
    }).from(paperNavSnapshots)
      .where(eq(paperNavSnapshots.accountId, acc.id))
      .orderBy(paperNavSnapshots.snapshotDate)
    return { agentId: acc.agentId, agentName: acc.agentName, snapshots }
  }))

  // 获取最终排名
  const finalRanking = await getCompetitionRanking(id)

  res.json({ competition: comp, accountHistories, finalRanking })
})

router.get('/competitions/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const [comp] = await db.select().from(paperCompetitions).where(eq(paperCompetitions.id, id)).limit(1)
  if (!comp) return res.status(404).json({ error: 'Competition not found' })
  res.json(comp)
})

router.get('/competitions/:id/ranking', async (req, res) => {
  const id = parseInt(req.params.id)
  const ranking = await getCompetitionRanking(id)

  // 净值曲线：每个账户最近 30 个快照（没有快照就返回空数组，前端不画线）
  const snaps = await db.execute(sql`
    SELECT account_id, snapshot_date::text AS d, nav::float8 AS nav
    FROM paper_nav_snapshots
    WHERE competition_id = ${id}
    ORDER BY snapshot_date
  `) as any
  const series = new Map<number, Array<{ d: string; nav: number }>>()
  for (const row of snaps?.rows || []) {
    const list = series.get(row.account_id) || []
    list.push({ d: row.d, nav: Number(row.nav) })
    series.set(row.account_id, list)
  }

  res.json({
    competitionId: id,
    ranking: ranking.map((r: any) => ({
      ...r,
      navSeries: (series.get(r.accountId) || []).slice(-30),
    })),
  })
})

// 周报：最新几期（markdown，可直接复制发公众号）
router.get('/competitions/:id/reports', async (req, res) => {
  const id = parseInt(req.params.id)
  const limit = Math.min(Number(req.query.limit) || 4, 12)
  const reports = await listWeeklyReports(id, limit)
  res.json(reports)
})

// 手动生成一期周报（管理员；cron 每周五也会自动生成）
router.post('/admin/reports/generate', requireAdmin, async (req, res) => {
  const report = await generateWeeklyReport({ competitionId: req.body?.competitionId, weekEnd: req.body?.weekEnd })
  if (!report) return res.status(404).json({ error: '没有进行中的比赛' })
  res.json(report)
})

// ----------------------------------------------------------
// Agent 接口（需 API Key）
// ----------------------------------------------------------

router.get('/agent/portfolio', requireAgentApiKey, async (req: any, res: any) => {
  const key = req.headers['x-agent-key'] as string
  const accountRows = await db.select().from(paperAccounts).where(eq(paperAccounts.apiKey, key)).limit(1)
  if (!accountRows.length) return res.status(401).json({ error: 'Invalid API key' })
  const portfolio = await getAccountPortfolio(accountRows[0].id)
  res.json(portfolio)
})

router.get('/agent/positions', requireAgentApiKey, async (req: any, res: any) => {
  const key = req.headers['x-agent-key'] as string
  const accountRows = await db.select().from(paperAccounts).where(eq(paperAccounts.apiKey, key)).limit(1)
  if (!accountRows.length) return res.status(401).json({ error: 'Invalid API key' })
  const portfolio = await getAccountPortfolio(accountRows[0].id)
  res.json(portfolio?.positions ?? [])
})

router.get('/agent/orders', requireAgentApiKey, async (req: any, res: any) => {
  const key = req.headers['x-agent-key'] as string
  const accountRows = await db.select().from(paperAccounts).where(eq(paperAccounts.apiKey, key)).limit(1)
  if (!accountRows.length) return res.status(401).json({ error: 'Invalid API key' })
  const orders = await db.select().from(paperOrders)
    .where(eq(paperOrders.accountId, accountRows[0].id))
    .orderBy(desc(paperOrders.createdAt))
    .limit(50)
  res.json(orders)
})

router.get('/agent/ranking', requireAgentApiKey, async (req: any, res: any) => {
  const key = req.headers['x-agent-key'] as string
  const accountRows = await db.select().from(paperAccounts).where(eq(paperAccounts.apiKey, key)).limit(1)
  if (!accountRows.length) return res.status(401).json({ error: 'Invalid API key' })
  const ranking = await getCompetitionRanking(accountRows[0].competitionId ?? 0)
  res.json({ ranking })
})

router.get('/agent/nav-history', requireAgentApiKey, async (req: any, res: any) => {
  const key = req.headers['x-agent-key'] as string
  const accountRows = await db.select().from(paperAccounts).where(eq(paperAccounts.apiKey, key)).limit(1)
  if (!accountRows.length) return res.status(401).json({ error: 'Invalid API key' })
  const snapshots = await db.select({
    date: paperNavSnapshots.snapshotDate,
    nav: paperNavSnapshots.nav,
    totalValue: paperNavSnapshots.totalValue,
  }).from(paperNavSnapshots)
    .where(eq(paperNavSnapshots.accountId, accountRows[0].id))
    .orderBy(paperNavSnapshots.snapshotDate)
  res.json(snapshots)
})

router.post('/agent/buy', requireAgentApiKey, async (req: any, res: any) => {
  const { code, name, shares, price } = req.body
  if (!code || !shares || !price) return res.status(400).json({ error: 'Missing required fields: code, shares, price' })
  if (shares % 100 !== 0) return res.status(400).json({ error: 'Shares must be a multiple of 100' })
  const key = req.headers['x-agent-key'] as string
  const accountRows = await db.select().from(paperAccounts).where(eq(paperAccounts.apiKey, key)).limit(1)
  if (!accountRows.length) return res.status(401).json({ error: 'Invalid API key' })
  const result = await submitOrder(accountRows[0].id, 'BUY', code, name || code, shares, price)
  if (!result.ok) return res.status(400).json({ error: result.error, message: result.message })
  res.json({ success: true, order: result.order })
})

router.post('/agent/sell', requireAgentApiKey, async (req: any, res: any) => {
  const { code, name, shares, price } = req.body
  if (!code || !shares || !price) return res.status(400).json({ error: 'Missing required fields: code, shares, price' })
  if (shares % 100 !== 0) return res.status(400).json({ error: 'Shares must be a multiple of 100' })
  const key = req.headers['x-agent-key'] as string
  const accountRows = await db.select().from(paperAccounts).where(eq(paperAccounts.apiKey, key)).limit(1)
  if (!accountRows.length) return res.status(401).json({ error: 'Invalid API key' })
  const result = await submitOrder(accountRows[0].id, 'SELL', code, name || code, shares, price)
  if (!result.ok) return res.status(400).json({ error: result.error, message: result.message })
  res.json({ success: true, order: result.order })
})

// 触发 Agent 决策循环（手动调用）
router.post('/agent/run', requireAgentApiKey, async (req: any, res: any) => {
  const key = req.headers['x-agent-key'] as string
  const accountRows = await db.select().from(paperAccounts).where(eq(paperAccounts.apiKey, key)).limit(1)
  if (!accountRows.length) return res.status(401).json({ error: 'Invalid API key' })
  const result = await runAgent(accountRows[0].id)
  res.json(result)
})

// 获取每日复盘（最后一次生成的复盘）
router.get('/agent/daily-review', requireAgentApiKey, async (req: any, res: any) => {
  const key = req.headers['x-agent-key'] as string
  const accountRows = await db.select().from(paperAccounts).where(eq(paperAccounts.apiKey, key)).limit(1)
  if (!accountRows.length) return res.status(401).json({ error: 'Invalid API key' })
  // 复盘内容暂存为 last_review 字段（通过 agent 的账户记录）
  const [account] = accountRows
  // 返回今日的订单作为复盘参考（后续可扩展为存储复盘文本）
  const orders = await db.select().from(paperOrders)
    .where(and(eq(paperOrders.accountId, account.id)))
    .orderBy(desc(paperOrders.createdAt))
    .limit(10)
  res.json({ agentId: account.agentId, agentName: account.agentName, recentOrders: orders })
})

// ----------------------------------------------------------
// 回测实盘对比
// ----------------------------------------------------------

/** 运行单个基准策略回测 */
function runBenchmark(klines: any[], code: string, startDate: string, endDate: string, initialCash: number, strategy: 'ma_cross' | 'buy_hold'): BacktestResult {
  // 限定在比赛区间内，与模拟盘同一时间窗口对比
  const window = klines.filter((k: any) => k.date >= startDate && k.date <= endDate)
  if (window.length < 2) {
    return { totalReturn: 0, annualReturn: 0, sharpe: 0, maxDrawdown: 0, winRate: 0, tradeCount: 0, trades: [], equity: [] }
  }

  if (strategy === 'buy_hold') {
    const first = window[0]
    const last = window[window.length - 1]
    const entryPrice = first.close
    const shares = Math.floor(initialCash / entryPrice / 100) * 100
    const cost = shares * entryPrice
    const commission = cost * 0.00025
    // equity 以 initialCash 为基准起点，归一化图表时首日统一为 1.0
    // 佣金在实际成交日扣除，不在 equity 起点体现（次日成交模型）
    const equity = window.map((k: any) => {
      const val = initialCash * (k.close / first.close)
      return { date: k.date, value: val }
    })
    const finalValue = initialCash * (last.close / first.close)
    const totalReturn = (finalValue - initialCash) / initialCash * 100
    const peak = Math.max(...equity.map(e => e.value))
    let maxDrawdown = 0
    for (const e of equity) {
      const dd = (peak - e.value) / peak * 100
      if (dd > maxDrawdown) maxDrawdown = dd
    }
    const proceeds = shares * last.close
    const pnl = proceeds - cost - commission - (proceeds * 0.001)
    return {
      totalReturn, annualReturn: 0, sharpe: 0, maxDrawdown,
      winRate: totalReturn > 0 ? 100 : 0, tradeCount: 1,
      trades: [{
        entryDate: first.date, exitDate: last.date, direction: 'BUY',
        entryPrice, exitPrice: last.close, shares, pnl,
        returnPct: totalReturn,
      }],
      equity,
    }
  }

  // MA5/20 金叉策略
  const maCrossRules = [
    {
      type: 'cross' as const,
      conditions: [{ indicator: 'ma5', operator: 'cross_above' as const, value: 'ma20' }],
      action: 'BUY' as const,
    },
    {
      type: 'cross' as const,
      conditions: [{ indicator: 'ma5', operator: 'cross_below' as const, value: 'ma20' }],
      action: 'SELL' as const,
    },
  ]
  return runBacktest(klines, { code, strategyId: 'ma_cross', startDate, endDate, initialCapital: initialCash }, maCrossRules)
}

/** 回测实盘对比：AI 模拟炒股 vs 基准策略 */
router.get('/competitions/:id/compare', async (req, res) => {
  const id = parseInt(req.params.id)
  const { code } = req.query as { code?: string }

  const [comp] = await db.select().from(paperCompetitions).where(eq(paperCompetitions.id, id)).limit(1)
  if (!comp) return res.status(404).json({ error: 'Competition not found' })

  // 获取所有账户的 NAV 历史
  const accounts = await db.select().from(paperAccounts).where(eq(paperAccounts.competitionId, id))
  const agentCurves: any[] = []

  for (const acc of accounts) {
    const snapshots = await db.select({
      date: paperNavSnapshots.snapshotDate,
      nav: paperNavSnapshots.nav,
      totalValue: paperNavSnapshots.totalValue,
    }).from(paperNavSnapshots)
      .where(eq(paperNavSnapshots.accountId, acc.id))
      .orderBy(paperNavSnapshots.snapshotDate)

    if (snapshots.length > 0) {
      agentCurves.push({
        agentId: acc.agentId,
        agentName: acc.agentName,
        type: 'agent',
        equity: snapshots.map((s: any) => ({ date: s.date, value: Number(s.totalValue) })),
        nav: snapshots.map((s: any) => ({ date: s.date, value: Number(s.nav) })),
      })
    }
  }

  // 获取行情数据并运行基准策略回测
  const benchmarks: any[] = []
  if (code) {
    const { klines } = await getOrFetchKlines(code)
    if (klines.length > 0) {
      const startDate = comp.startedAt ? new Date(comp.startedAt).toISOString().split('T')[0] : klines[0].date
      const endDate = klines[klines.length - 1].date
      const initialCash = Number(comp.initialCash)

      const maResult = runBenchmark(klines, code, startDate, endDate, initialCash, 'ma_cross')
      const bhResult = runBenchmark(klines, code, startDate, endDate, initialCash, 'buy_hold')

      benchmarks.push({
        id: 'ma_cross',
        name: 'MA5/20金叉策略',
        description: 'MA5上穿MA20买入，下穿卖出',
        equity: maResult.equity,
        stats: {
          totalReturn: maResult.totalReturn,
          annualReturn: maResult.annualReturn,
          sharpe: maResult.sharpe,
          maxDrawdown: maResult.maxDrawdown,
          tradeCount: maResult.tradeCount,
          winRate: maResult.winRate,
        },
      })

      benchmarks.push({
        id: 'buy_hold',
        name: '买入持有策略',
        description: '首日开盘全仓买入，持有至最后一天',
        equity: bhResult.equity,
        stats: {
          totalReturn: bhResult.totalReturn,
          annualReturn: bhResult.annualReturn,
          sharpe: bhResult.sharpe,
          maxDrawdown: bhResult.maxDrawdown,
          tradeCount: bhResult.tradeCount,
          winRate: bhResult.winRate,
        },
      })
    }
  }

  // 计算每个 agent 的统计指标（以初始资金为基准，与基准策略口径一致）
  const agentInitialCash = Number(comp.initialCash)
  for (const agent of agentCurves) {
    const eq = agent.equity.filter((e: any) => e.value != null)
    if (!eq.length) continue
    const last = Number(eq[eq.length - 1].value)
    const totalReturn = (last - agentInitialCash) / agentInitialCash * 100
    // 峰值从初始资金起算，只有单个快照也能算出回撤
    const peak = Math.max(agentInitialCash, ...eq.map((e: any) => Number(e.value)))
    let maxDrawdown = 0
    for (const e of eq) {
      const dd = (peak - Number(e.value)) / peak * 100
      if (dd > maxDrawdown) maxDrawdown = dd
    }
    agent.stats = { totalReturn, maxDrawdown }
    agent.statsText = `累计收益 ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}% | 最大回撤 ${maxDrawdown.toFixed(2)}%`
  }

  // 对齐所有曲线到同一日期轴：ECharts category 轴按 index 映射，
  // 点数不一致会导致曲线错位。缺失日期填 null（ECharts 断线）
  const allDates = [...new Set([
    ...benchmarks.flatMap((b: any) => b.equity.map((e: any) => e.date)),
    ...agentCurves.flatMap((a: any) => a.equity.map((e: any) => e.date)),
  ])].sort()

  const align = (equity: any[]) => {
    const map = new Map(equity.map((e: any) => [e.date, e.value]))
    return allDates.map((d: string) => ({ date: d, value: map.get(d) ?? null }))
  }
  for (const b of benchmarks) b.equity = align(b.equity)
  for (const a of agentCurves) a.equity = align(a.equity)

  res.json({
    competitionId: id,
    competitionName: comp.name,
    benchmarkCode: code || null,
    // 归一化基准：Agent 与基准策略统一以初始资金为 1.0
    initialCash: Number(comp.initialCash),
    dates: allDates,
    agentCurves,
    benchmarks,
    stats: {
      agents: agentCurves.length,
      benchmarks: benchmarks.length,
    },
  })
})


// ----------------------------------------------------------
// 管理员接口
// ----------------------------------------------------------

// 管理员接口：先 optionalAuth（认登录态里的 isAdmin 管理员），
// 再 requireAdmin（服务端脚本仍可用 x-admin-key 兜底）
router.use('/admin', optionalAuth)

router.post('/admin/competitions', requireAdmin, async (req, res) => {
  const { name, initialCash, maxPositionRatio, dailyTradeLimit } = req.body
  const [comp] = await db.insert(paperCompetitions).values({
    name: name || 'AI模拟炒股大赛',
    initialCash: initialCash ?? '1000000',
    maxPositionRatio: maxPositionRatio ?? '0.30',
    dailyTradeLimit: dailyTradeLimit ?? 3,
    status: 'pending',
  }).returning()
  res.json(comp)
})

router.patch('/admin/competitions/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id)
  const { status, name } = req.body
  const updates: any = {}
  if (status) updates.status = status
  if (name) updates.name = name
  if (status === 'running') updates.startedAt = new Date()
  if (status === 'finished') updates.finishedAt = new Date()
  const [comp] = await db.update(paperCompetitions).set(updates).where(eq(paperCompetitions.id, id)).returning()
  if (!comp) return res.status(404).json({ error: 'Competition not found' })
  res.json(comp)
})

/**
 * 一键建赛（幂等）：没有进行中的比赛就建一场，并补齐 5 个策略账户。
 * 命令行也能跑：npm run paper:start
 */
router.post('/admin/bootstrap', requireAdmin, async (_req, res) => {
  try {
    const result = await bootstrapCompetition()
    res.json(result)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/admin/accounts', requireAdmin, async (req, res) => {
  res.json(await db.select().from(paperAccounts))
})

router.post('/admin/accounts', requireAdmin, async (req, res) => {
  const { competitionId, agentId, agentName } = req.body
  if (!competitionId || !agentId || !agentName) return res.status(400).json({ error: 'Missing required fields' })
  const [comp] = await db.select().from(paperCompetitions).where(eq(paperCompetitions.id, competitionId)).limit(1)
  if (!comp) return res.status(404).json({ error: 'Competition not found' })
  const apiKey = crypto.randomBytes(32).toString('hex')
  let account: any
  try {
    [account] = await db.insert(paperAccounts).values({
      competitionId,
      agentId,
      agentName,
      apiKey,
      cash: comp.initialCash,
    }).returning()
  } catch {
    // agentId / apiKey 有唯一约束，重复添加时给明确提示而不是 500
    return res.status(409).json({ error: `Agent ${agentId} 已存在` })
  }
  res.json({ ...account, apiKey }) // 仅此处返回一次
})

router.delete('/admin/accounts/:id', requireAdmin, async (req, res) => {
  await db.delete(paperAccounts).where(eq(paperAccounts.id, parseInt(req.params.id)))
  res.json({ success: true })
})

router.post('/admin/run-matching', requireAdmin, async (req, res) => {
  const results = await matchAllPendingOrders()
  await snapshotAllAccounts()
  res.json({ matched: results.length, results })
})

// 触发所有 Agent 决策循环
router.post('/admin/run-agents', requireAdmin, async (req, res) => {
  const results = await runAllAgents()
  res.json({ agents: results.length, results })
})

// 手动触发每日复盘
router.post('/admin/run-daily-review', requireAdmin, async (req, res) => {
  const { runDailyReview } = await import('../services/paperTradingAgent.js')
  const results = await runDailyReview()
  res.json({ agents: results.length, results })
})

router.get('/admin/competitions/:id/full-ranking', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id)
  const ranking = await getCompetitionRanking(id)
  const [comp] = await db.select().from(paperCompetitions).where(eq(paperCompetitions.id, id)).limit(1)
  res.json({ competition: comp, ranking })
})

export default router
