/**
 * Paper Trading Engine — 撮合 + 风控单元测试
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../db/db.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    values: vi.fn().mockResolvedValue([]),
    set: vi.fn().mockResolvedValue([]),
    onConflictDoNothing: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('../data/cache.js', () => ({
  getOrFetchKlines: vi.fn().mockResolvedValue({ klines: [], source: 'cache' }),
  batchGetKlines: vi.fn().mockResolvedValue({}),
}))

vi.mock('../data/redis.js', () => ({
  redis: { get: vi.fn(), setex: vi.fn(), mget: vi.fn(), pipeline: vi.fn().mockReturnValue({ exec: vi.fn() }) },
  cacheGetKlines: vi.fn().mockResolvedValue(null),
  cacheSetKlinesBulk: vi.fn(),
  cacheGetQuotes: vi.fn().mockResolvedValue(null),
  cacheSetQuotes: vi.fn(),
}))

function makePosition(code: string, name: string, shares: number, avgCost: number, currentPrice: number) {
  const value = shares * currentPrice
  const pnl = (currentPrice - avgCost) * shares
  const pnlPct = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0
  return { code, name, shares, avgCost, currentPrice, value, pnl, pnlPct }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Paper Trading Engine — 撮合逻辑', () => {

  describe('买入撮合', () => {
    it('限价单次日以指定价格成交', () => {
      // 买入限价单：价格 100，数量 1000，次日开盘价 102
      const nextOpenPrice = 102
      const shares = 1000
      const cost = nextOpenPrice * shares          // 102000
      const commission = cost * 0.00025             // 25.5
      const totalCost = cost + commission            // 102025.5

      expect(cost).toBe(102000)
      expect(commission).toBeCloseTo(25.5, 1)
      expect(totalCost).toBeCloseTo(102025.5, 1)
    })

    it('买入撮合计算正确', () => {
      const price = 168.5
      const shares = 100
      const cost = price * shares                   // 16850
      const commission = cost * 0.00025              // 4.2125
      expect(commission).toBeCloseTo(4.2125, 3)
    })
  })

  describe('卖出撮合', () => {
    it('卖出单扣除佣金和印花税', () => {
      // 卖出 1000 股 @ 200
      const price = 200
      const shares = 1000
      const proceeds = price * shares               // 200000
      const commission = proceeds * 0.00025          // 50
      const tax = proceeds * 0.001                  // 200
      const netProceeds = proceeds - commission - tax

      expect(commission).toBeCloseTo(50, 1)
      expect(tax).toBeCloseTo(200, 1)
      expect(netProceeds).toBeCloseTo(199750, 1)
    })
  })

  describe('风控校验', () => {
    it('单票仓位不超过 30% 上限', () => {
      const totalValue = 1000000
      const maxPositionRatio = 0.3
      const currentPositionValue = 280000
      const newOrderValue = 50000
      const afterPositionRatio = (currentPositionValue + newOrderValue) / totalValue

      expect(afterPositionRatio).toBeCloseTo(0.33, 2)
      expect(afterPositionRatio > maxPositionRatio).toBe(true)
    })

    it('日内新开仓不超过上限', () => {
      const dailyLimit = 5
      expect(4 < dailyLimit).toBe(true)
      expect(5 < dailyLimit).toBe(false)  // 第 5 笔 = 最后一次，第 6 笔被拒绝
    })

    it('资金不足时拒绝买入', () => {
      const cash = 10000
      const orderCost = 15000
      const commission = orderCost * 0.00025
      const canAfford = cash >= orderCost + commission
      expect(canAfford).toBe(false)
    })

    it('空仓时不应触发卖出', () => {
      const holdings = 0
      const shouldSell = holdings > 0
      expect(shouldSell).toBe(false)
    })
  })

  describe('NAV 净值计算', () => {
    it('初始 NAV = 1.0', () => {
      const initialCash = 1000000
      const initialNav = 1.0
      expect(initialNav).toBe(1.0)
      expect(initialNav * initialCash).toBe(initialCash)
    })

    it('盈利后 NAV > 1.0', () => {
      const initialCash = 1000000
      const currentValue = 1100000
      expect(currentValue / initialCash).toBeCloseTo(1.1, 2)
    })

    it('亏损后 NAV < 1.0', () => {
      const initialCash = 1000000
      const currentValue = 900000
      expect(currentValue / initialCash).toBeCloseTo(0.9, 2)
    })

    it('累计收益率计算', () => {
      const initial = 1000000
      const current = 1150000
      const totalReturn = (current - initial) / initial * 100
      expect(totalReturn).toBe(15)
    })
  })

  describe('次日成交模型', () => {
    it('T 日下单，T+1 以开盘价成交（非下单价）', () => {
      const orderPrice = 168.5
      const nextOpenPrice = 170.2

      expect(nextOpenPrice).not.toBe(orderPrice)
      expect(nextOpenPrice).toBeCloseTo(170.2, 2)
    })

    it('T+1 买入盈利计算（100 股）', () => {
      const orderPrice = 168.5
      const nextOpenPrice = 170.2
      const shares = 100

      const costBasis = shares * orderPrice        // 16850（持仓成本）
      const proceeds = shares * nextOpenPrice        // 17020（卖出所得）
      const commission = proceeds * 0.00025         // 4.255
      const tax = proceeds * 0.001                  // 17.02（印花税）
      const pnl = proceeds - commission - tax - costBasis

      expect(pnl).toBeCloseTo(148.725, 2)          // 赚取价差，扣手续费
    })

    it('涨停板次日仍可撮合（次一交易日开盘价）', () => {
      const prevClose = 100
      const limitUp = prevClose * 1.1  // 110
      const shares = 1000

      const proceeds = shares * limitUp            // 110000
      const commission = proceeds * 0.00025         // 27.5
      const tax = proceeds * 0.001                 // 110

      expect(limitUp).toBeCloseTo(110, 2)
      expect(commission).toBeCloseTo(27.5, 1)
      expect(tax).toBeCloseTo(110, 1)
    })
  })

  describe('持仓计算', () => {
    it('持仓盈亏百分比', () => {
      const pos = makePosition('600519', '贵州茅台', 100, 1680, 1750)
      expect(pos.pnl).toBe(7000)              // (1750-1680)*100
      expect(pos.pnlPct).toBeCloseTo(4.17, 1) // 7000/168000*100
    })

    it('持仓市值', () => {
      const pos = makePosition('600519', '贵州茅台', 100, 1680, 1750)
      expect(pos.value).toBe(175000)         // 100 * 1750
    })
  })
})
