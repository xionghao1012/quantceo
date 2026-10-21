/**
 * Paper Trading — 回测对比接口（GET /competitions/:id/compare）边界测试
 *
 * 直接调用 router 里的真实 handler，mock 只覆盖数据库与行情源，
 * 因此 runBenchmark / 曲线对齐 / 统计计算都是真实逻辑。
 *
 * 覆盖：比赛不存在、无 code、无行情、行情不在比赛期、无快照、单快照、
 *       多账户日期不齐时的曲线对齐。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------
const state = vi.hoisted(() => ({
  competition: null as any,
  accounts: [] as any[],
  snapshotsByAccount: {} as Record<number, any[]>,
  snapshotCursor: 0,
  klines: [] as any[],
}))

const TABLE_NAME = Symbol.for('drizzle:Name')
const nameOf = (t: any) => (t?.[TABLE_NAME] as string) || ''

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------
vi.mock('../../db/db.js', () => {
  const chain = (data: any[]) => ({
    where: () => chain(data),
    orderBy: () => chain(data),
    limit: async (n: number) => data.slice(0, n),
    then: (res: any, rej: any) => Promise.resolve(data).then(res, rej),
  })

  const filter = (table: any, _cond: any) => {
    switch (nameOf(table)) {
      case 'paper_competitions':
        return state.competition ? [state.competition] : []
      case 'paper_accounts':
        return state.accounts
      case 'paper_nav_snapshots': {
        // 路由按 accounts 顺序逐个查询快照，用游标保证一一对应
        const acc = state.accounts[state.snapshotCursor++]
        return acc ? (state.snapshotsByAccount[acc.id] ?? []) : []
      }
      default:
        return []
    }
  }

  return {
    db: {
      select: () => ({
        from: (table: any) => ({
          where: (cond: any) => chain(filter(table, cond)),
          // 无 where 的查询直接返回全表
          orderBy: () => chain([]),
          limit: async (n: number) => filter(table, null).slice(0, n),
          then: (res: any, rej: any) => Promise.resolve(filter(table, null)).then(res, rej),
        }),
      }),
      insert: () => ({ values: () => ({ onConflictDoNothing: async () => [], returning: async () => [] }) }),
      update: () => ({ set: () => ({ where: async () => [] }) }),
      delete: () => ({ where: async () => [] }),
    },
  }
})

vi.mock('../../data/cache.js', () => ({
  getOrFetchKlines: vi.fn(async () => ({ klines: state.klines, source: 'cache' })),
  batchGetKlines: vi.fn().mockResolvedValue({}),
}))

vi.mock('../../services/moneyFlowService.js', () => ({
  getRealtimeMoneyFlow: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../services/paperTradingAgent.js', () => ({
  runAllAgents: vi.fn().mockResolvedValue([]),
  runAgent: vi.fn().mockResolvedValue({ success: false, trades: [] }),
  runDailyReview: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../middleware/requireAdmin.js', () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}))

import router from '../../routes/paperTrading.js'

// ---------------------------------------------------------------------------
// 从 router 取出真实 handler
// ---------------------------------------------------------------------------
function handlerFor(method: string, path: string) {
  const stack = (router as any).stack ?? []
  const layer = stack.find((l: any) => l.route?.path === path)
  const h = layer?.route?.stack?.find((s: any) => s.method === method)
  if (!h) throw new Error(`未找到路由 ${method.toUpperCase()} ${path}`)
  return h.handle as (req: any, res: any) => Promise<any>
}

function mockRes() {
  const res: any = { _status: 200, _body: undefined }
  res.status = (c: number) => { res._status = c; return res }
  res.json = (b: any) => { res._body = b; return res }
  return res
}

const compare = handlerFor('get', '/competitions/:id/compare')

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function reset() {
  state.competition = {
    id: 1,
    name: '测试比赛',
    status: 'running',
    initialCash: '1000000',
    maxPositionRatio: '0.3',
    dailyTradeLimit: 3,
    startedAt: new Date('2026-10-19T09:30:00+08:00'),
  }
  state.accounts = [{ id: 11, competitionId: 1, agentId: 'deepseek', agentName: '趋势猎手' }]
  state.snapshotsByAccount = {}
  state.snapshotCursor = 0
  state.klines = []
}

const kline = (date: string, close: number) =>
  ({ code: '600519', date, open: close, high: close, low: close, close, volume: 1000, amount: 0 })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('GET /competitions/:id/compare', () => {
  beforeEach(reset)

  it('比赛不存在 → 404', async () => {
    state.competition = null
    const res = mockRes()
    await compare({ params: { id: '99' }, query: {} }, res)

    expect(res._status).toBe(404)
    expect(res._body).toEqual({ error: 'Competition not found' })
  })

  it('不传 code → 不跑基准，仍返回账户曲线与初始资金', async () => {
    state.snapshotsByAccount[11] = [
      { date: '2026-10-19', nav: '1.0000', totalValue: '1000000' },
      { date: '2026-10-20', nav: '0.9980', totalValue: '998000' },
    ]
    const res = mockRes()
    await compare({ params: { id: '1' }, query: {} }, res)

    expect(res._status).toBe(200)
    expect(res._body.benchmarks).toEqual([])
    expect(res._body.benchmarkCode).toBeNull()
    expect(res._body.initialCash).toBe(1000000)
    expect(res._body.dates).toEqual(['2026-10-19', '2026-10-20'])
    expect(res._body.agentCurves).toHaveLength(1)
  })

  it('传了 code 但拿不到行情 → 不报错，基准为空', async () => {
    state.klines = []
    const res = mockRes()
    await compare({ params: { id: '1' }, query: { code: '600519' } }, res)

    expect(res._status).toBe(200)
    expect(res._body.benchmarks).toEqual([])
    expect(res._body.benchmarkCode).toBe('600519')
  })

  it('行情全部早于比赛开始 → buy_hold 无数据，收益率为 0（不跨期回测）', async () => {
    state.klines = [kline('2024-01-02', 1600), kline('2024-01-03', 1640)]
    const res = mockRes()
    await compare({ params: { id: '1' }, query: { code: '600519' } }, res)

    const bh = res._body.benchmarks.find((b: any) => b.id === 'buy_hold')
    const ma = res._body.benchmarks.find((b: any) => b.id === 'ma_cross')
    expect(bh.equity).toEqual([])
    expect(bh.stats.totalReturn).toBe(0)
    expect(ma.equity).toEqual([])
  })

  it('行情落在比赛期内 → 基准曲线从比赛首日开始，首日归一化基准为初始资金', async () => {
    state.klines = [
      kline('2026-10-19', 100),
      kline('2026-10-20', 110),
    ]
    const res = mockRes()
    await compare({ params: { id: '1' }, query: { code: '600519' } }, res)

    const bh = res._body.benchmarks.find((b: any) => b.id === 'buy_hold')
    expect(bh.equity).toHaveLength(2)
    expect(bh.equity[0].value).toBeCloseTo(1000000, 2)  // 起点 = 初始资金
    expect(bh.equity[1].value).toBeCloseTo(1100000, 2)  // +10%
    expect(bh.stats.totalReturn).toBeCloseTo(10, 6)
  })

  it('完全没有快照 → 曲线和日期都为空，但仍 200', async () => {
    const res = mockRes()
    await compare({ params: { id: '1' }, query: {} }, res)

    expect(res._status).toBe(200)
    expect(res._body.agentCurves).toEqual([])
    expect(res._body.dates).toEqual([])
  })

  it('只有 1 个快照也要算出收益率（以初始资金为基准，不是恒为 0）', async () => {
    // 账户从 100 万亏到 99.5 万
    state.snapshotsByAccount[11] = [
      { date: '2026-10-20', nav: '0.9950', totalValue: '995000' },
    ]
    const res = mockRes()
    await compare({ params: { id: '1' }, query: {} }, res)

    const agent = res._body.agentCurves[0]
    expect(agent.stats.totalReturn).toBeCloseTo(-0.5, 6)
    expect(agent.stats.maxDrawdown).toBeCloseTo(0.5, 6)
  })

  it('多账户日期不齐 → 对齐到同一日期轴，缺失点为 null', async () => {
    state.accounts = [
      { id: 11, competitionId: 1, agentId: 'a', agentName: 'A' },
      { id: 12, competitionId: 1, agentId: 'b', agentName: 'B' },
    ]
    state.snapshotsByAccount[11] = [
      { date: '2026-10-19', nav: '1.0000', totalValue: '1000000' },
      { date: '2026-10-20', nav: '1.0100', totalValue: '1010000' },
    ]
    state.snapshotsByAccount[12] = [
      // B 只有第二天有快照
      { date: '2026-10-20', nav: '0.9900', totalValue: '990000' },
    ]

    const res = mockRes()
    await compare({ params: { id: '1' }, query: {} }, res)

    expect(res._body.dates).toEqual(['2026-10-19', '2026-10-20'])
    for (const c of res._body.agentCurves) {
      expect(c.equity).toHaveLength(res._body.dates.length)
    }
    const b = res._body.agentCurves.find((c: any) => c.agentId === 'b')
    expect(b.equity[0]).toEqual({ date: '2026-10-19', value: null })
    expect(b.equity[1].value).toBeCloseTo(990000, 2)
  })

  it('对齐后 benchmark 与 agent 曲线长度一致（ECharts 按 index 映射不会错位）', async () => {
    state.accounts = [
      { id: 11, competitionId: 1, agentId: 'a', agentName: 'A' },
      { id: 12, competitionId: 1, agentId: 'b', agentName: 'B' },
    ]
    state.snapshotsByAccount[11] = [{ date: '2026-10-19', nav: '1.0000', totalValue: '1000000' }]
    state.snapshotsByAccount[12] = [{ date: '2026-10-20', nav: '1.0000', totalValue: '1000000' }]
    state.klines = [kline('2026-10-19', 100), kline('2026-10-20', 105)]

    const res = mockRes()
    await compare({ params: { id: '1' }, query: { code: '600519' } }, res)

    const n = res._body.dates.length
    expect(n).toBe(2)
    for (const s of [...res._body.agentCurves, ...res._body.benchmarks]) {
      expect(s.equity).toHaveLength(n)
    }
  })

  it('比赛未设置开始时间 → 退化为全区间（不回退成脏日期字符串）', async () => {
    state.competition.startedAt = null
    state.klines = [kline('2024-01-02', 100), kline('2024-01-03', 110)]
    const res = mockRes()
    await compare({ params: { id: '1' }, query: { code: '600519' } }, res)

    const bh = res._body.benchmarks.find((b: any) => b.id === 'buy_hold')
    expect(bh.equity[0].date).toBe('2024-01-02')
    expect(bh.stats.totalReturn).toBeCloseTo(10, 6)
  })
})
