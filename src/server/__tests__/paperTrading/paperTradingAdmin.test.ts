/**
 * Paper Trading — 管理员接口业务流测试
 *
 * 覆盖完整链路：建比赛 → 加 Agent → 开赛 → 结束比赛，以及越权/参数校验。
 * 走真实 express 路由 + 真实 requireAdmin，只 mock 数据库与撮合引擎，
 * 因为数据库 mock 比 HTTP mock 更容易暴露「路由里少校验」这类问题。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const TABLE_NAME = Symbol.for('drizzle:Name')
const nameOf = (t: any) => (t?.[TABLE_NAME] as string) || ''

const state = vi.hoisted(() => ({
  competitions: [] as any[],
  accounts: [] as any[],
  positions: [] as any[],
  orders: [] as any[],
  snapshots: [] as any[],
  seq: { comp: 1, acc: 1 },
}))

// ---------------------------------------------------------------------------
// 极简 drizzle mock：够路由用即可（select/insert/update/delete + where/limit）
// ---------------------------------------------------------------------------
vi.mock('../../db/db.js', () => {
  const store = (t: any) =>
    nameOf(t) === 'paper_competitions' ? state.competitions
      : nameOf(t) === 'paper_accounts' ? state.accounts
        : nameOf(t) === 'paper_positions' ? state.positions
          : nameOf(t) === 'paper_orders' ? state.orders
            : nameOf(t) === 'paper_nav_snapshots' ? state.snapshots
              : []

  const collect = <T>(v: any, type: 'number' | 'string', out: T[] = [], seen = new Set<any>(), depth = 0): T[] => {
    if (depth > 8 || v == null || typeof v !== 'object' || seen.has(v)) return out
    seen.add(v)
    for (const k of Object.keys(v)) {
      const x = v[k]
      if (typeof x === type) out.push(x as T)
      else collect(x, type, out, seen, depth + 1)
    }
    return out
  }

  const filter = (rows: any[], cond?: any) => {
    if (!cond) return rows
    const strs = collect<string>(cond, 'string')
    const nums = collect<number>(cond, 'number')
    const status = strs.find((s) => rows.some((r) => r.status === s))
    if (status) return rows.filter((r) => r.status === status)
    const id = nums.find((n) => rows.some((r) => r.id === n))
    if (id != null) return rows.filter((r) => r.id === id)
    const comp = nums.find((n) => rows.some((r) => r.competitionId === n))
    if (comp != null) return rows.filter((r) => r.competitionId === comp)
    return rows
  }

  const chain = (rows: any[]): any => ({
    where: (cond?: any) => chain(filter(rows, cond)),
    orderBy: () => chain(rows),
    limit: async (n: number) => rows.slice(0, n),
    then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
  })

  const nextId = (t: any) =>
    nameOf(t) === 'paper_competitions' ? state.seq.comp++ : state.seq.acc++

  return {
    db: {
      select: () => ({ from: (t: any) => chain(store(t)) }),
      insert: (t: any) => ({
        values: (v: any) => {
          // 模拟 schema 上的唯一约束
          if (nameOf(t) === 'paper_accounts' && store(t).some((r) => r.agentId === v.agentId)) {
            throw new Error('duplicate key value violates unique constraint "paper_accounts_agent_id_unique"')
          }
          const row = { id: nextId(t), ...v }
          store(t).push(row)
          return { returning: async () => [row] }
        },
      }),
      update: (t: any) => ({
        set: (v: any) => ({
          where: (cond?: any) => {
            const rows = filter(store(t), cond)
            rows.forEach((r) => Object.assign(r, v))
            return {
              returning: async () => rows,
              then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
            }
          },
        }),
      }),
      delete: (t: any) => ({
        where: async (cond?: any) => {
          const rows = filter(store(t), cond)
          for (const r of rows) {
            const arr = store(t)
            const i = arr.indexOf(r)
            if (i >= 0) arr.splice(i, 1)
          }
          return []
        },
      }),
    },
  }
})

vi.mock('../../services/paperTradingEngine.js', () => ({
  submitOrder: vi.fn(),
  validateOrder: vi.fn(),
  matchSingleOrder: vi.fn(),
  matchAllPendingOrders: vi.fn(async () => []),
  snapshotAllAccounts: vi.fn(async () => undefined),
  getAccountPortfolio: vi.fn(async () => ({ nav: 1, totalReturn: 0, totalValue: 0, positionValue: 0, cash: 0 })),
  getCompetitionRanking: vi.fn(async () => [{ agentId: 'deepseek', rank: 1 }]),
  getPriceFromDB: vi.fn(async () => 100),
  AGENT_MODEL_MAP: {},
}))

vi.mock('../../services/paperTradingAgent.js', () => ({
  runAllAgents: vi.fn(async () => []),
  runAgent: vi.fn(),
  runDailyReview: vi.fn(async () => []),
}))

vi.mock('../../data/cache.js', () => ({
  getOrFetchKlines: vi.fn(async () => []),
  getOrFetchMinuteKlines: vi.fn(async () => ({})),
}))

vi.mock('../../backtest/index.js', () => ({
  runBacktest: vi.fn(() => ({ totalReturn: 0, equity: [], tradeCount: 0 })),
}))

import paperTradingRouter from '../../routes/paperTrading.js'

const ADMIN_KEY = 'test-admin-key'
const app = express()
app.use(express.json())
app.use('/api/paper', paperTradingRouter)

const asAdmin = (r: request.Test) => r.set('x-admin-key', ADMIN_KEY)

beforeEach(() => {
  process.env.ADMIN_UPGRADE_KEY = ADMIN_KEY
  state.competitions = []
  state.accounts = []
  state.positions = []
  state.orders = []
  state.snapshots = []
  state.seq = { comp: 1, acc: 1 }
})

afterEach(() => {
  delete process.env.ADMIN_UPGRADE_KEY
})

async function createCompetition(over: Record<string, any> = {}) {
  const res = await asAdmin(request(app).post('/api/paper/admin/competitions'))
    .send({ name: '秋季赛', initialCash: '1000000', maxPositionRatio: '0.30', dailyTradeLimit: 3, ...over })
  return res
}

describe('管理员接口 — 鉴权', () => {
  it('不带 x-admin-key 时返回 401', async () => {
    const res = await request(app).post('/api/paper/admin/competitions').send({ name: 'x' })
    expect(res.status).toBe(401)
    expect(state.competitions).toHaveLength(0)
  })

  it('key 错误时返回 401，且不落库', async () => {
    const res = await request(app).post('/api/paper/admin/competitions')
      .set('x-admin-key', 'wrong')
      .send({ name: 'x' })
    expect(res.status).toBe(401)
    expect(state.competitions).toHaveLength(0)
  })

  it('PATCH 结束比赛同样需要管理员权限', async () => {
    await createCompetition()
    const res = await request(app).patch('/api/paper/admin/competitions/1').send({ status: 'finished' })
    expect(res.status).toBe(401)
    expect(state.competitions[0].status).toBe('pending')
  })
})

describe('管理员接口 — 建比赛', () => {
  it('创建后状态为 pending，参数按传入值保存', async () => {
    const res = await createCompetition({ maxPositionRatio: '0.25', dailyTradeLimit: 5 })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('pending')
    expect(res.body.maxPositionRatio).toBe('0.25')
    expect(res.body.dailyTradeLimit).toBe(5)
    expect(state.competitions).toHaveLength(1)
  })

  it('不传参数时使用默认值', async () => {
    const res = await asAdmin(request(app).post('/api/paper/admin/competitions')).send({})

    expect(res.body.name).toBe('AI模拟炒股大赛')
    expect(res.body.initialCash).toBe('1000000')
    expect(res.body.maxPositionRatio).toBe('0.30')
    expect(res.body.dailyTradeLimit).toBe(3)
  })
})

describe('管理员接口 — 加 Agent', () => {
  it('加 Agent 返回一次性 apiKey，初始现金等于比赛本金', async () => {
    await createCompetition({ initialCash: '2000000' })

    const res = await asAdmin(request(app).post('/api/paper/admin/accounts'))
      .send({ competitionId: 1, agentId: 'deepseek', agentName: 'DeepSeek' })

    expect(res.status).toBe(200)
    expect(res.body.apiKey).toMatch(/^[0-9a-f]{64}$/)
    expect(res.body.cash).toBe('2000000')
    expect(state.accounts).toHaveLength(1)
  })

  it('重复 agentId 返回 409 而不是 500', async () => {
    await createCompetition()
    await asAdmin(request(app).post('/api/paper/admin/accounts'))
      .send({ competitionId: 1, agentId: 'deepseek', agentName: 'DeepSeek' })

    const duplicate = await asAdmin(request(app).post('/api/paper/admin/accounts'))
      .send({ competitionId: 1, agentId: 'deepseek', agentName: 'DeepSeek' })

    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error).toContain('deepseek')
    expect(state.accounts).toHaveLength(1)
  })

  it('缺字段返回 400', async () => {
    const res = await asAdmin(request(app).post('/api/paper/admin/accounts'))
      .send({ competitionId: 1, agentName: 'DeepSeek' })
    expect(res.status).toBe(400)
    expect(state.accounts).toHaveLength(0)
  })

  it('比赛不存在返回 404', async () => {
    const res = await asAdmin(request(app).post('/api/paper/admin/accounts'))
      .send({ competitionId: 999, agentId: 'deepseek', agentName: 'DeepSeek' })
    expect(res.status).toBe(404)
    expect(state.accounts).toHaveLength(0)
  })
})

describe('管理员接口 — 比赛生命周期', () => {
  it('开赛写入 startedAt', async () => {
    await createCompetition()
    const res = await asAdmin(request(app).patch('/api/paper/admin/competitions/1'))
      .send({ status: 'running' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('running')
    expect(res.body.startedAt).toBeTruthy()
  })

  it('结束比赛写入 finishedAt 并进入历史列表', async () => {
    await createCompetition()
    await asAdmin(request(app).patch('/api/paper/admin/competitions/1')).send({ status: 'running' })
    const res = await asAdmin(request(app).patch('/api/paper/admin/competitions/1'))
      .send({ status: 'finished' })

    expect(res.body.status).toBe('finished')
    expect(res.body.finishedAt).toBeTruthy()

    const history = await request(app).get('/api/paper/competitions/history/all')
    expect(history.body).toHaveLength(1)
    expect(history.body[0].id).toBe(1)
  })

  it('比赛不存在返回 404', async () => {
    const res = await asAdmin(request(app).patch('/api/paper/admin/competitions/999'))
      .send({ status: 'finished' })
    expect(res.status).toBe(404)
  })
})

describe('管理员接口 — 删除 Agent 与全量排名', () => {
  it('删除账户后列表为空', async () => {
    await createCompetition()
    await asAdmin(request(app).post('/api/paper/admin/accounts'))
      .send({ competitionId: 1, agentId: 'deepseek', agentName: 'DeepSeek' })

    const del = await asAdmin(request(app).delete('/api/paper/admin/accounts/1'))
    expect(del.status).toBe(200)
    expect(state.accounts).toHaveLength(0)
  })

  it('full-ranking 同时返回比赛与排名', async () => {
    await createCompetition()
    const res = await asAdmin(request(app).get('/api/paper/admin/competitions/1/full-ranking'))

    expect(res.status).toBe(200)
    expect(res.body.competition.id).toBe(1)
    expect(res.body.ranking[0].agentId).toBe('deepseek')
  })
})
