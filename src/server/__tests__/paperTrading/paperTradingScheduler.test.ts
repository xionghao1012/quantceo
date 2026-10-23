/**
 * Paper Trading — 定时结算路径测试
 *
 * scheduler.ts 在 15:05 调用 matchAllPendingOrders() + snapshotAllAccounts()。
 * 这是唯一会自动改现金/持仓的路径，出错会直接污染比赛数据（曾导致现金 -1287 万）。
 *
 * 覆盖：
 *  - 批量撮合：顺序、单笔被拒不中断整批、无行情拒单
 *  - 日终快照：NAV 计算、同日幂等（upsert）、无价格持仓按 0 计
 *  - 定时任务接线：15:05 cron 必须同时调用撮合与快照
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------
const state = vi.hoisted(() => ({
  accounts: [] as any[],
  competitions: [] as any[],
  positions: [] as any[],
  orders: [] as any[],
  prices: {} as Record<string, number>,
  filledBuyCount: 0,
  snapshots: [] as any[],
  updates: [] as any[],
  inserts: [] as any[],
  onConflictSets: [] as any[],
}))

const TABLE_NAME = Symbol.for('drizzle:Name')
const nameOf = (t: any) => (t?.[TABLE_NAME] as string) || ''

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------
vi.mock('../../db/db.js', () => {
  // 从 drizzle 条件/SQL 片段里提取查询参数（避免依赖 DB 行顺序）
  const walk = <T>(v: any, pick: (x: any) => T | null, seen = new Set<any>(), depth = 0): T | null => {
    if (depth > 8) return null
    const hit = pick(v)
    if (hit != null) return hit
    if (v == null || typeof v !== 'object' || seen.has(v)) return null
    seen.add(v)
    for (const k of Object.keys(v)) {
      const r = walk(v[k], pick, seen, depth + 1)
      if (r != null) return r
    }
    return null
  }
  const extractCode = (cond: any) =>
    walk(cond, (x) => (typeof x === 'string' && /^\d{6}$/.test(x) ? x : null))
  const extractNumber = (v: any) =>
    walk(v, (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null))
  // 条件里可能混着列元数据里的数字，只认真正命中行 id 的那个
  const collectNumbers = (v: any, out: number[] = [], seen = new Set<any>(), depth = 0): number[] => {
    if (depth > 8 || v == null || typeof v !== 'object' || seen.has(v)) return out
    seen.add(v)
    for (const k of Object.keys(v)) {
      const x = v[k]
      if (typeof x === 'number' && Number.isFinite(x)) out.push(x)
      else collectNumbers(x, out, seen, depth + 1)
    }
    return out
  }
  const idIn = (cond: any, data: any[]) => {
    const ids = new Set(data.map((r) => r.id))
    return collectNumbers(cond).find((n) => ids.has(n))
  }

  const chain = (data: any[]) => {
    const obj: any = {
      where: (cond?: any) => {
        const code = extractCode(cond)
        if (code) return chain(data.filter((r) => r.code === code))
        const id = idIn(cond, data)
        if (id != null) return chain(data.filter((r) => r.id === id))
        return chain(data)
      },
      orderBy: () => chain(data),
      limit: async (n: number) => data.slice(0, n),
      for: () => chain(data), // SELECT ... FOR UPDATE，mock 里直接返回数据
      then: (res: any, rej: any) => Promise.resolve(data).then(res, rej),
    }
    return obj
  }
  const pick = (table: any) => {
    switch (nameOf(table)) {
      case 'paper_accounts': return state.accounts
      case 'paper_competitions': return state.competitions
      case 'paper_positions': return state.positions
      case 'paper_orders': return state.orders
      case 'money_flow_realtime':
        return Object.entries(state.prices).map(([code, close]) => ({ code, close }))
      case 'paper_nav_snapshots': return state.snapshots
      default: return []
    }
  }
  const api: any = {
      select: (fields?: any) => ({
        from: (table: any) =>
          fields && 'cnt' in fields
            ? chain([{ cnt: state.filledBuyCount }])
            : chain(pick(table)),
      }),
      insert: (table: any) => ({
        values: (v: any) => {
          const row = { ...v }
          if (nameOf(table) === 'paper_nav_snapshots') state.snapshots.push(row)
          if (nameOf(table) === 'paper_positions') state.positions.push({ id: 100 + state.positions.length, ...row })
          state.inserts.push({ table: nameOf(table), row })
          return {
            onConflictDoUpdate: (opts: any) => {
              state.onConflictSets.push(opts)
              return Promise.resolve([])
            },
            onConflictDoNothing: () => Promise.resolve([]),
            returning: async () => [row],
            then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
          }
        },
      }),
      update: (table: any) => ({
        set: (values: any) => ({
          where: async (cond?: any) => {
            state.updates.push({ table: nameOf(table), values })
            // 让现金扣减真实生效，才能验证「批量撮合时后续单按剩余现金复检」
            if (nameOf(table) === 'paper_accounts' && values.cash != null) {
              const delta = extractNumber(values.cash)
              if (delta != null) state.accounts[0].cash = Number(state.accounts[0].cash) - delta
            }
            // 让订单状态变更真实生效，才能验证「同一单不会被重复成交」
            if (nameOf(table) === 'paper_orders' && values.status) {
              const id = idIn(cond, state.orders)
              const target = state.orders.find((o) => o.id === id)
              if (target) Object.assign(target, values)
            }
            return []
          },
        }),
      }),
      delete: () => ({ where: async () => [] }),
  }
  return {
    db: { ...api, transaction: async (fn: any) => fn(api) },
  }
})

// 实时行情按 code 返回，价格完全由 state.prices 控制
vi.mock('../../services/moneyFlowService.js', () => ({
  getRealtimeMoneyFlow: vi.fn(async (code: string) => {
    const p = state.prices[code]
    return p == null ? null : { close: p }
  }),
}))

import { matchAllPendingOrders, matchSingleOrder, snapshotAllAccounts } from '../../services/paperTradingEngine.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const COMP = {
  id: 1,
  name: '测试比赛',
  status: 'running',
  initialCash: '1000000',
  maxPositionRatio: '0.3',
  dailyTradeLimit: 100,
}

function reset() {
  state.accounts = [{ id: 1, competitionId: 1, agentId: 'deepseek', agentName: 'DeepSeek', cash: 1000000 }]
  state.competitions = [{ ...COMP }]
  state.positions = []
  state.orders = []
  state.prices = { '600519': 100, '601318': 50, '600036': 40 }
  state.filledBuyCount = 0
  state.snapshots = []
  state.updates = []
  state.inserts = []
  state.onConflictSets = []
}

function makeOrder(over: Partial<any> = {}) {
  return {
    id: 1, accountId: 1, code: '600519', name: '贵州茅台',
    direction: 'BUY', price: 100, shares: 100, status: 'PENDING',
    createdAt: new Date('2026-10-19T09:30:00'),
    ...over,
  }
}

// ---------------------------------------------------------------------------
// 并发/重复触发
// ---------------------------------------------------------------------------
describe('并发防护 — 同一笔单只能成交一次', () => {
  beforeEach(reset)

  it('已成交订单再次撮合返回 SKIPPED，现金不再变化', async () => {
    state.orders = [makeOrder({ id: 1 })]

    const first = await matchSingleOrder(state.orders[0])
    expect(first.status).toBe('FILLED')
    const cashAfterFill = Number(state.accounts[0].cash)
    const updatesAfterFill = state.updates.length

    // 模拟 cron 与管理端手动触发撞车时，后到的一方读到订单已被处理
    const again = await matchSingleOrder(state.orders[0])

    expect(again.status).toBe('SKIPPED')
    expect(Number(state.accounts[0].cash)).toBe(cashAfterFill)
    expect(state.updates.length).toBe(updatesAfterFill)
  })

  it('非 PENDING 状态（已撤回）不参与撮合', async () => {
    state.orders = [makeOrder({ id: 1, status: 'CANCELLED' })]

    const r = await matchSingleOrder(state.orders[0])

    expect(r.status).toBe('SKIPPED')
    expect(state.updates.filter((u: any) => u.table === 'paper_accounts')).toHaveLength(0)
  })

  it('撮合必须包在事务内并使用行锁（回归守卫）', () => {
    const src = readFileSync(new URL('../../services/paperTradingEngine.ts', import.meta.url), 'utf8')
    expect(src).toMatch(/return db\.transaction\(async \(tx\) =>/)
    expect(src).toMatch(/for\('update'\)/)
  })
})

// ---------------------------------------------------------------------------
// 批量撮合
// ---------------------------------------------------------------------------
describe('定时撮合 — matchAllPendingOrders', () => {
  beforeEach(reset)

  it('每笔 PENDING 单都返回结果', async () => {
    state.orders = [makeOrder({ id: 1 }), makeOrder({ id: 2, code: '601318', price: 50 })]
    const results = await matchAllPendingOrders()
    expect(results).toHaveLength(2)
    expect(results.map(r => r.orderId).sort()).toEqual([1, 2])
    expect(results.every(r => r.status === 'FILLED')).toBe(true)
  })

  it('单笔被拒不会中断整批', async () => {
    // 第 2 笔价格缺失 → REJECTED，第 3 笔仍应继续成交
    state.orders = [
      makeOrder({ id: 1 }),
      makeOrder({ id: 2, code: '999999' }),
      makeOrder({ id: 3, code: '601318', price: 50 }),
    ]
    const results = await matchAllPendingOrders()

    expect(results).toHaveLength(3)
    expect(results[1].status).toBe('REJECTED')
    expect(results[1].rejectReason).toBe('NO_PRICE_DATA')
    expect(results[2].status).toBe('FILLED')
  })

  it('无行情时不扣现金、不建仓', async () => {
    state.orders = [makeOrder({ code: '999999' })]
    const r = await matchAllPendingOrders()

    expect(r[0].status).toBe('REJECTED')
    expect(state.updates.filter(u => u.table === 'paper_accounts')).toHaveLength(0)
    expect(state.inserts.filter(i => i.table === 'paper_positions')).toHaveLength(0)
  })

  it('现金不足时后续订单被拒，现金不会为负', async () => {
    // 现金 15000；第 1 笔 100 股 @100 ≈ 10000，剩 ~5000；
    // 第 2 笔 100 股 @50 ≈ 5000.15 > 剩余现金 → 必须拒单，而不是扣成负数
    state.accounts = [{ id: 1, competitionId: 1, agentId: 'deepseek', agentName: 'DeepSeek', cash: 15000 }]
    state.orders = [
      makeOrder({ id: 1, shares: 100 }),
      makeOrder({ id: 2, code: '601318', price: 50, shares: 100 }),
    ]
    const results = await matchAllPendingOrders()

    expect(results[0].status).toBe('FILLED')
    expect(results[1].status).toBe('REJECTED')
    expect(results[1].rejectReason).toBe('INSUFFICIENT_CASH')
  })

  it('没有任何 PENDING 单时返回空数组', async () => {
    state.orders = []
    expect(await matchAllPendingOrders()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 日终快照
// ---------------------------------------------------------------------------
describe('日终快照 — snapshotAllAccounts', () => {
  beforeEach(reset)

  it('NAV = (现金 + 持仓市值) / 初始资金', async () => {
    state.accounts = [{ id: 1, competitionId: 1, agentId: 'deepseek', agentName: 'DeepSeek', cash: 500000 }]
    state.positions = [{ id: 1, accountId: 1, code: '600519', name: '贵州茅台', shares: 5000, avgCost: '100' }]
    // 500000 + 5000*100 = 1,000,000 → nav 1.0
    await snapshotAllAccounts()

    expect(state.snapshots).toHaveLength(1)
    expect(state.snapshots[0].nav).toBeCloseTo(1.0, 6)
    expect(state.snapshots[0].totalValue).toBeCloseTo(1000000, 2)
  })

  it('盈利时 NAV > 1', async () => {
    state.accounts = [{ id: 1, competitionId: 1, agentId: 'deepseek', agentName: 'DeepSeek', cash: 500000 }]
    state.positions = [{ id: 1, accountId: 1, code: '600519', name: '贵州茅台', shares: 6000, avgCost: '100' }]
    // 500000 + 600000 = 1,100,000 → nav 1.1
    await snapshotAllAccounts()
    expect(state.snapshots[0].nav).toBeCloseTo(1.1, 6)
  })

  it('同日重复执行走 upsert（幂等，不会插入重复快照）', async () => {
    state.accounts = [{ id: 1, competitionId: 1, agentId: 'deepseek', agentName: 'DeepSeek', cash: 1000000 }]

    await snapshotAllAccounts()
    await snapshotAllAccounts()

    // 两次 insert 都应带 onConflictDoUpdate（accountId + snapshotDate 唯一）
    expect(state.onConflictSets).toHaveLength(2)
    expect(state.onConflictSets[0].target).toBeDefined()
    expect(state.onConflictSets[0].set).toHaveProperty('nav')
    expect(state.onConflictSets[0].set).toHaveProperty('totalValue')
  })

  it('无行情价的持仓按成本估值，不按 0（否则净值曲线是假的）', async () => {
    state.accounts = [{ id: 1, competitionId: 1, agentId: 'deepseek', agentName: 'DeepSeek', cash: 500000 }]
    state.positions = [{ id: 1, accountId: 1, code: '999999', name: '未知', shares: 1000, avgCost: '100' }]
    state.prices = {} // 无任何行情

    await snapshotAllAccounts()
    // 500000 + 1000×100（成本） = 600000 → nav 0.6
    // 之前按 0 算会得到 0.5，把「没有行情」写成「亏 50%」——
    // 生产首日净值 0.70/0.77/0.80/0.85 就是这个 bug 造成的
    expect(state.snapshots[0].nav).toBeCloseTo(0.6, 6)
  })

  it('多个账户各写一条快照', async () => {
    state.accounts = [
      { id: 1, competitionId: 1, agentId: 'a', agentName: 'A', cash: 1000000 },
      { id: 2, competitionId: 1, agentId: 'b', agentName: 'B', cash: 1000000 },
    ]
    await snapshotAllAccounts()
    expect(state.snapshots).toHaveLength(2)
  })

  it('无账户时不写入任何快照', async () => {
    state.accounts = []
    await snapshotAllAccounts()
    expect(state.snapshots).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 定时任务接线守卫
// ---------------------------------------------------------------------------
describe('scheduler 接线', () => {
  const src = readFileSync(new URL('../../services/scheduler.ts', import.meta.url), 'utf8')

  it('15:05 交易日 cron 存在', () => {
    expect(src).toMatch(/cron\.schedule\(\s*'5 15 \* \* 1-5'/)
  })

  it('该 cron 同时调用撮合与快照', () => {
    expect(src).toContain('matchAllPendingOrders()')
    expect(src).toContain('snapshotAllAccounts()')
  })

  it('撮合失败不会阻断后续复盘（独立 try/catch）', () => {
    // 撮合块与复盘块各自 try/catch，撮合抛错时复盘仍执行
    const matchIdx = src.indexOf("console.log('[Scheduler] Running paper trading matching...')")
    const reviewIdx = src.indexOf("console.log('[Scheduler] Running daily review for AI agents...')")
    expect(matchIdx).toBeGreaterThan(0)
    expect(reviewIdx).toBeGreaterThan(matchIdx)

    const between = src.slice(matchIdx, reviewIdx)
    // 撮合块必须以 catch 收尾，而不是让异常冒泡到复盘之前
    expect(between).toContain('catch')
  })
})
