/**
 * Paper Trading Engine — 风控回归测试
 *
 * 覆盖真实引擎逻辑（validateOrder / matchSingleOrder），
 * 而非内联算术。回归场景：
 *   下单时风控通过 → 成交前现金/持仓变化 → 撮合必须重新校验并拒绝，
 *   否则现金变负、仓位突破上限。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Test state（用 vi.hoisted 让 mock 工厂能访问）
// ---------------------------------------------------------------------------
const state = vi.hoisted(() => ({
  accounts: [] as any[],
  competitions: [] as any[],
  positions: [] as any[],
  orders: [] as any[],
  filledBuyCount: 0,
  updates: [] as any[],
  inserts: [] as any[],
  nextId: 1000,
}))

const TABLE_NAME = Symbol.for('drizzle:Name')
const nameOf = (t: any) => (t?.[TABLE_NAME] as string) || ''

// ---------------------------------------------------------------------------
// Mock DB — 按表名分发数据
// ---------------------------------------------------------------------------
vi.mock('../../db/db.js', () => {
  // 从 drizzle 条件里收集数字（条件里可能混着列元数据里的数字）
  const numsOf = (v: any, out: number[] = [], seen = new Set<any>(), depth = 0): number[] => {
    if (depth > 6 || v == null || typeof v !== 'object' || seen.has(v)) return out
    seen.add(v)
    for (const k of Object.keys(v)) {
      const x = v[k]
      if (typeof x === 'number' && Number.isFinite(x)) out.push(x)
      else numsOf(x, out, seen, depth + 1)
    }
    return out
  }
  const idIn = (cond: any, data: any[]) => {
    const ids = new Set(data.map((r: any) => r.id))
    return numsOf(cond).find((n) => ids.has(n)) ?? null
  }
  const chain = (data: any[]) => {
    const obj: any = {
      limit: async (n: number) => data.slice(0, n),
      orderBy: async () => data,
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
      default: return []
    }
  }
  const api: any = {
      select: (fields?: any) => ({
        from: (table: any) => ({
          where: (cond?: any) => {
            if (fields && 'cnt' in fields) return chain([{ cnt: state.filledBuyCount }])
            const data = pick(table)
            const id = idIn(cond, data)
            return chain(id != null ? data.filter((r: any) => r.id === id) : data)
          },
        }),
      }),
      insert: (table: any) => ({
        values: (v: any) => {
          const row = { id: state.nextId++, ...v }
          state.inserts.push({ table: nameOf(table), row })
          return { returning: async () => [row] }
        },
      }),
      update: (table: any) => ({
        set: (values: any) => ({
          where: async (cond?: any) => {
            state.updates.push({ table: nameOf(table), values })
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

// 行情价格：固定 100 元
vi.mock('../../services/moneyFlowService.js', () => ({
  getRealtimeMoneyFlow: vi.fn().mockResolvedValue({ close: 100 }),
}))

import { validateOrder, matchSingleOrder, AGENT_MODEL_MAP } from '../../services/paperTradingEngine.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const COMPETITION = {
  id: 1,
  name: '测试比赛',
  status: 'running',
  initialCash: '1000000',
  maxPositionRatio: '0.3',
  dailyTradeLimit: 3,
}

function resetState(overrides: Partial<typeof state> = {}) {
  state.accounts = [{ id: 1, competitionId: 1, agentId: 'deepseek', agentName: 'DeepSeek', cash: 1000000 }]
  state.competitions = [{ ...COMPETITION }]
  state.positions = []
  state.orders = []
  state.filledBuyCount = 0
  state.updates = []
  state.inserts = []
  state.nextId = 1000
  Object.assign(state, overrides)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('风控 — validateOrder（下单时）', () => {
  beforeEach(() => resetState())

  it('单票仓位超过 30% 应拒绝', async () => {
    state.positions = [{ id: 1, accountId: 1, code: '600519', name: '贵州茅台', shares: 100, avgCost: '1680' }]
    // 已持 168000，再买 200 股 @1680 = 336000，合计 504000 > 30万（现金充足）
    const r = await validateOrder(1, 'BUY', '600519', 200, 1680)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('POSITION_LIMIT_EXCEEDED')
  })

  it('单票仓位在 30% 内应通过', async () => {
    const r = await validateOrder(1, 'BUY', '600519', 100, 1680) // 168000 < 30万
    expect(r.ok).toBe(true)
  })

  it('不同股票的仓位各自独立计算（单票口径）', async () => {
    state.positions = [{ id: 1, accountId: 1, code: '600519', name: '贵州茅台', shares: 100, avgCost: '1680' }]
    // 另一只股票 1000 股 @45.6 = 45600，未超单票上限
    const r = await validateOrder(1, 'BUY', '601318', 1000, 45.6)
    expect(r.ok).toBe(true)
  })

  it('现金不足应拒绝', async () => {
    state.accounts = [{ id: 1, competitionId: 1, agentId: 'deepseek', agentName: 'DeepSeek', cash: 1000 }]
    const r = await validateOrder(1, 'BUY', '600519', 100, 1680)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('INSUFFICIENT_CASH')
  })

  it('日内新开仓次数达上限应拒绝', async () => {
    state.filledBuyCount = 3
    const r = await validateOrder(1, 'BUY', '600519', 100, 1680)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('DAILY_TRADE_LIMIT_EXCEEDED')
  })

  it('同代码的未成交挂单也占用仓位额度', async () => {
    state.orders = [{
      id: 1, accountId: 1, code: '600519', direction: 'BUY',
      price: '1680', shares: 150, status: 'PENDING',
    }]
    // 挂单 150 股 = 252000，再买 100 股 = 168000，合计 420000 > 30万
    const r = await validateOrder(1, 'BUY', '600519', 100, 1680)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('POSITION_LIMIT_EXCEEDED')
  })

  it('卖出超过持仓应拒绝', async () => {
    state.positions = [{ id: 1, accountId: 1, code: '600519', name: '贵州茅台', shares: 100, avgCost: '1680' }]
    const r = await validateOrder(1, 'SELL', '600519', 200, 1680)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('INSUFFICIENT_POSITION')
  })

  it('比赛未开始应拒绝', async () => {
    state.competitions = [{ ...COMPETITION, status: 'pending' }]
    const r = await validateOrder(1, 'BUY', '600519', 100, 1680)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('COMPETITION_NOT_RUNNING')
  })
})

describe('风控 — matchSingleOrder（撮合时重新校验）', () => {
  beforeEach(() => resetState())

  it('成交时现金已不足应拒绝，且不得扣减现金', async () => {
    // 下单时现金充足，但成交前现金已被其他成交消耗
    state.accounts = [{ id: 1, competitionId: 1, agentId: 'deepseek', agentName: 'DeepSeek', cash: 100 }]
    const order = {
      id: 50, accountId: 1, code: '600519', name: '贵州茅台',
      direction: 'BUY', price: 100, shares: 1000, status: 'PENDING',
    }
    state.orders = [{ ...order }]

    const r = await matchSingleOrder(order)
    expect(r.status).toBe('REJECTED')
    expect(r.rejectReason).toBe('INSUFFICIENT_CASH')
    // 关键：不能有扣现金的 update
    const cashUpdates = state.updates.filter((u: any) => u.table === 'paper_accounts')
    expect(cashUpdates).toHaveLength(0)
    // 也不能建仓
    expect(state.inserts.filter((i: any) => i.table === 'paper_positions')).toHaveLength(0)
  })

  it('成交时单票仓位已超限应拒绝，且不得扣减现金', async () => {
    state.positions = [{ id: 1, accountId: 1, code: '600519', name: '贵州茅台', shares: 100, avgCost: '1680' }]
    // 成交价 100，2000 股 = 200000；已持 168000，合计 368000 > 30万
    const order = {
      id: 51, accountId: 1, code: '600519', name: '贵州茅台',
      direction: 'BUY', price: 100, shares: 2000, status: 'PENDING',
    }
    state.orders = [{ ...order }]

    const r = await matchSingleOrder(order)
    expect(r.status).toBe('REJECTED')
    expect(r.rejectReason).toBe('POSITION_LIMIT_EXCEEDED')
    expect(state.updates.filter((u: any) => u.table === 'paper_accounts')).toHaveLength(0)
  })

  it('风控通过时应正常成交：扣现金 + 建仓', async () => {
    const order = {
      id: 52, accountId: 1, code: '600519', name: '贵州茅台',
      direction: 'BUY', price: 100, shares: 100, status: 'PENDING',
    }
    state.orders = [{ ...order }]

    const r = await matchSingleOrder(order)
    expect(r.status).toBe('FILLED')
    expect(r.filledPrice).toBe(100)

    const cashUpdates = state.updates.filter((u: any) => u.table === 'paper_accounts')
    expect(cashUpdates).toHaveLength(1)
    expect(state.inserts.filter((i: any) => i.table === 'paper_positions')).toHaveLength(1)
  })

  it('自身订单不重复计入挂单额度（excludeOrderId）', async () => {
    // 自身 PENDING 单占 100 股额度；撮合复核时应排除自身，否则重复计算
    state.orders = [{
      id: 53, accountId: 1, code: '600519', direction: 'BUY',
      price: '100', shares: 100, status: 'PENDING',
    }]
    const order = {
      id: 53, accountId: 1, code: '600519', name: '贵州茅台',
      direction: 'BUY', price: 100, shares: 100, status: 'PENDING',
    }

    const r = await matchSingleOrder(order)
    expect(r.status).toBe('FILLED')
  })

  it('无行情数据应拒绝', async () => {
    const { getRealtimeMoneyFlow } = await import('../../services/moneyFlowService.js')
    ;(getRealtimeMoneyFlow as any).mockResolvedValueOnce(null)

    const order = {
      id: 54, accountId: 1, code: '600519', name: '贵州茅台',
      direction: 'BUY', price: 100, shares: 100, status: 'PENDING',
    }
    state.orders = [{ ...order }]
    const r = await matchSingleOrder(order)
    expect(r.status).toBe('REJECTED')
    expect(r.rejectReason).toBe('NO_PRICE_DATA')
  })
})

describe('模型映射', () => {
  it('deepseek 映射到 deepseek-chat', () => {
    expect(AGENT_MODEL_MAP['deepseek']).toBe('deepseek-chat')
  })

  it('gpt4o / qwen 映射到 MiniMax-M2.7', () => {
    expect(AGENT_MODEL_MAP['gpt4o']).toBe('MiniMax-M2.7')
    expect(AGENT_MODEL_MAP['qwen']).toBe('MiniMax-M2.7')
  })
})
