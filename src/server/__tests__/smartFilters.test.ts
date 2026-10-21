import { describe, it, expect, vi, beforeEach } from 'vitest'
import { analyzeSmartFilters, shouldBlockAlert } from '../services/smartFilters.js'
import type { WashTradingSignal, GoodNewsDumpSignal, ChipDistributionSignal, VolumeAnomalySignal } from '../services/smartFilters.js'
import type { MinuteKlineRow, MoneyFlowRow } from '../repositories/ISmartFiltersRepository.js'


// Mock data for redis — use object to allow mutation by reference
// MUST be declared at top level so vi.mock (which is hoisted) can reference it
const redisState: { getFn: () => any; setexFn: () => any } = {
  getFn: () => null,
  setexFn: () => Promise.resolve('OK'),
}

// Mock the redis module
vi.mock('../data/redis.js', () => ({
  redis: {
    get: vi.fn(() => redisState.getFn()),
    setex: vi.fn(() => redisState.setexFn()),
  },
}))

// Mock the db module - return empty arrays to trigger null signals
vi.mock('../db/db.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn().mockReturnValue([]),
          })),
        })),
      })),
    })),
  },
}))

// Mock drizzle-orm operators
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm')
  return {
    ...actual,
    eq: vi.fn((col: any, val: any) => ({ col, val, op: 'eq' })),
    and: vi.fn((...conds: any[]) => ({ conds, op: 'and' })),
    gte: vi.fn((col: any, val: any) => ({ col, val, op: 'gte' })),
    desc: vi.fn((col: any) => ({ col, op: 'desc' })),
  }
})

// Module-level mock repo
let mockRepo: Record<string, any> = {}
vi.mock('../repositories/ISmartFiltersRepository.js', () => ({
  getSmartFiltersRepository: () => mockRepo,
  setSmartFiltersRepository: (r: any) => { mockRepo = r },
}))

describe('smartFilters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisState.getFn = () => null
    redisState.setexFn = () => Promise.resolve('OK')
    mockRepo = {}
  })

  describe('SmartFilterResult type validation', () => {
    it('result has correct structure', async () => {
      const result = await analyzeSmartFilters('000001', '平安银行')
      
      expect(result).toHaveProperty('code')
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('signals')
      expect(result).toHaveProperty('filtered')
      expect(result).toHaveProperty('reasons')
      
      expect(result.code).toBe('000001')
      expect(result.name).toBe('平安银行')
      expect(typeof result.filtered).toBe('boolean')
      expect(Array.isArray(result.reasons)).toBe(true)
    })

    it('signals object has all signal types', async () => {
      const result = await analyzeSmartFilters('000001', '平安银行')
      
      expect(result.signals).toHaveProperty('washTrading')
      expect(result.signals).toHaveProperty('goodNewsDump')
      expect(result.signals).toHaveProperty('chipDistribution')
      expect(result.signals).toHaveProperty('volumeAnomaly')
    })
  })

  describe('SmartFilterConfig', () => {
    it('accepts partial config', async () => {
      const result = await analyzeSmartFilters('000001', '平安银行', {
        enableWashTrading: false,
      })
      // Should not throw and should return result
      expect(result).toBeDefined()
      expect(result.code).toBe('000001')
    })

    it('accepts empty config', async () => {
      const result = await analyzeSmartFilters('000001', '平安银行', {})
      expect(result).toBeDefined()
    })

    it('accepts undefined config', async () => {
      const result = await analyzeSmartFilters('000001', '平安银行', undefined)
      expect(result).toBeDefined()
    })
  })

  describe('analyzeSmartFilters edge cases', () => {
    it('handles special characters in stock name', async () => {
      const result = await analyzeSmartFilters('600000', '浦发银行(特殊)')
      expect(result.code).toBe('600000')
      expect(result.name).toBe('浦发银行(特殊)')
    })

    it('handles numeric stock code', async () => {
      const result = await analyzeSmartFilters('000001', '平安银行')
      expect(result.code).toBe('000001')
    })

    it('handles very long stock name', async () => {
      const longName = 'A'.repeat(100)
      const result = await analyzeSmartFilters('000001', longName)
      expect(result.name).toBe(longName)
    })
  })

  describe('shouldBlockAlert', () => {
    it('is a function', () => {
      expect(typeof shouldBlockAlert).toBe('function')
    })

    it('returns blocked and reasons properties', async () => {
      const result = await shouldBlockAlert('000001', '平安银行')
      expect(result).toHaveProperty('blocked')
      expect(result).toHaveProperty('reasons')
      expect(typeof result.blocked).toBe('boolean')
      expect(Array.isArray(result.reasons)).toBe(true)
    })

    it('respects config parameter', async () => {
      const result = await shouldBlockAlert('000001', '平安银行', {
        enableWashTrading: false,
        enableGoodNewsDump: false,
      })
      expect(result).toHaveProperty('blocked')
      expect(Array.isArray(result.reasons)).toBe(true)
    })

    it('redis.get error falls through to analyzeSmartFilters', async () => {
      let errorThrown = false
      const throwOnce = () => { errorThrown = true; throw new Error('redis connection refused') }
      redisState.getFn = throwOnce

      const result = await shouldBlockAlert('000001', '平安银行')
      expect(errorThrown).toBe(true) // verify mock was called and threw
      expect(result).toHaveProperty('blocked')
      expect(Array.isArray(result.reasons)).toBe(true)
    })

    it('redis.setex error still returns result', async () => {
      let setexCalled = false
      redisState.getFn = () => null
      redisState.setexFn = () => { setexCalled = true; throw new Error('redis write error') }

      const result = await shouldBlockAlert('000001', '平安银行')
      expect(setexCalled).toBe(true) // verify mock was called and threw
      expect(result).toHaveProperty('blocked')
      expect(Array.isArray(result.reasons)).toBe(true)
    })

    it('returns cached result when redis has data (cache hit)', async () => {
      const cachedData = JSON.stringify({ filtered: true, reasons: ['庄股对倒风险(high)'] })
      redisState.getFn = () => cachedData

      const result = await shouldBlockAlert('000001', '平安银行')
      expect(result.blocked).toBe(true)
      expect(result.reasons).toContain('庄股对倒风险(high)')
    })
  })

  describe('signal type definitions', () => {
    it('WashTradingSignal has correct shape', () => {
      const signal: WashTradingSignal = {
        score: 50,
        level: 'medium',
        description: 'test',
        evidence: {
          largeOrderCount: 10,
          samePriceTrades: 5,
          buySellRatio: 0.6,
        },
      }
      expect(signal.score).toBe(50)
      expect(['low', 'medium', 'high']).toContain(signal.level)
    })

    it('GoodNewsDumpSignal has correct shape', () => {
      const signal: GoodNewsDumpSignal = {
        score: 70,
        level: 'high',
        description: 'test',
        evidence: {
          openGapPct: 3.5,
          closeChangePct: -2.5,
          volumeRatio: 2.5,
          isHighOpen: true,
        },
      }
      expect(signal.evidence.isHighOpen).toBe(true)
    })

    it('ChipDistributionSignal has correct shape', () => {
      const signal: ChipDistributionSignal = {
        level: 'high_position',
        score: 85,
        description: 'test',
        evidence: {
          avgPosition: 0.85,
          volumeConcentration: 0.3,
        },
      }
      expect(['low_position', 'high_position']).toContain(signal.level)
    })

    it('VolumeAnomalySignal has correct shape', () => {
      const signal: VolumeAnomalySignal = {
        score: 80,
        level: 'high',
        description: 'test',
        evidence: {
          volumeRatio: 4.5,
          avgVolumeRatio: 1.0,
          trend: 'surge',
        },
      }
      expect(['surge', 'collapse']).toContain(signal.evidence.trend)
    })
  })

  // ---------------------------------------------------------------------------
  // detectWashTrading — chip concentration vs dispersion
  // ---------------------------------------------------------------------------
  describe('detectWashTrading', () => {
    it('筹码集中（主力吸筹）→ washScore > 60, level=high', async () => {
      // 大量相同价格成交 + 低价格方差 → 高度疑似对倒
      const klines: MinuteKlineRow[] = []
      for (let i = 0; i < 60; i++) {
        klines.push({
          code: '000001', id: i, datetime: new Date(Date.now() - (60 - i) * 60_000),
          period: 'm1', open: 10.0, high: 10.01, low: 9.99, close: 10.0,
          volume: 20_000, amount: 200_000,
        } as any)
      }
      mockRepo = {
        getMinuteKlinesByCode: vi.fn().mockResolvedValue(klines),
        getMinuteKlinesByCodeAndLimit: vi.fn().mockResolvedValue([]),
        getMoneyFlowByCode: vi.fn().mockResolvedValue([]),
      }

      const result = await analyzeSmartFilters('000001', '平安银行')

      expect(result.signals.washTrading).not.toBeNull()
      expect(result.signals.washTrading!.level).toBe('high')
      expect(result.signals.washTrading!.score).toBeGreaterThan(60)
    })

    it('筹码分散（出货）→ washScore低, level=low', async () => {
      // 价格变化大，无相同价格成交
      const klines: MinuteKlineRow[] = []
      for (let i = 0; i < 60; i++) {
        const price = 10 + (i % 5) * 0.05 // varied prices
        klines.push({
          code: '000001', id: i, datetime: new Date(Date.now() - (60 - i) * 60_000),
          period: 'm1', open: price, high: price + 0.01, low: price - 0.01, close: price,
          volume: 500_000, amount: price * 500_000,
        } as any)
      }
      mockRepo = {
        getMinuteKlinesByCode: vi.fn().mockResolvedValue(klines),
        getMinuteKlinesByCodeAndLimit: vi.fn().mockResolvedValue([]),
        getMoneyFlowByCode: vi.fn().mockResolvedValue([]),
      }

      const result = await analyzeSmartFilters('000001', '平安银行')

      expect(result.signals.washTrading).not.toBeNull()
      expect(result.signals.washTrading!.level).toBe('low')
    })

    it('中等风险（对倒迹象）→ washScore中等, level=medium', async () => {
      // 20 groups of 2 identical prices (10.0 to 29.0) → 20 same-price trades, high variance, no bonus
      // washScore = 20/40*100 = 50 → 30 < 50 <= 60 → medium
      const klines: MinuteKlineRow[] = []
      for (let g = 0; g < 20; g++) {
        const price = 10.0 + g
        klines.push({
          code: '000001', id: g * 2, datetime: new Date(Date.now() - (40 - g * 2) * 60_000),
          period: 'm1', open: price, high: price + 0.001, low: price - 0.001, close: price,
          volume: 5_000, amount: price * 5_000,
        } as any)
        klines.push({
          code: '000001', id: g * 2 + 1, datetime: new Date(Date.now() - (40 - (g * 2 + 1)) * 60_000),
          period: 'm1', open: price, high: price + 0.001, low: price - 0.001, close: price,
          volume: 5_000, amount: price * 5_000,
        } as any)
      }
      mockRepo = {
        getMinuteKlinesByCode: vi.fn().mockResolvedValue(klines),
        getMinuteKlinesByCodeAndLimit: vi.fn().mockResolvedValue([]),
        getMoneyFlowByCode: vi.fn().mockResolvedValue([]),
      }

      const result = await analyzeSmartFilters('000001', '平安银行')

      expect(result.signals.washTrading).not.toBeNull()
      expect(result.signals.washTrading!.level).toBe('medium')
    })

    it('数据不足（<30条）→ 返回null', async () => {
      mockRepo = {
        getMinuteKlinesByCode: vi.fn().mockResolvedValue(Array(20).fill(null).map((_, i) => ({
          code: '000001', id: i, datetime: new Date(),
          period: 'm1', open: 10, high: 10, low: 10, close: 10,
          volume: 1000, amount: 10000,
        }))),
        getMinuteKlinesByCodeAndLimit: vi.fn().mockResolvedValue([]),
        getMoneyFlowByCode: vi.fn().mockResolvedValue([]),
      }

      const result = await analyzeSmartFilters('000001', '平安银行')

      expect(result.signals.washTrading).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // detectGoodNewsDump — big sell + price not falling vs normal
  // ---------------------------------------------------------------------------
  describe('detectGoodNewsDump', () => {
    it('大单卖出 + 股价不跌 → dumpScore高, level=high', async () => {
      // isHighOpen (openGapPct > 2), todayChange < -1, volumeRatio > 2
      const rows: MoneyFlowRow[] = [
        { code: '000001', id: 1, tradeDate: '2024-01-02', closePrice: 10.5, changePct: -2.5,
          turnoverRate: 0.08, netInflowMain: -1e8, netInflowMainPct: -1, updateTime: new Date() } as any,
        { code: '000001', id: 2, tradeDate: '2024-01-01', closePrice: 10.0, changePct: 0,
          turnoverRate: 0.03, netInflowMain: 0, netInflowMainPct: 0, updateTime: new Date() } as any,
        { code: '000001', id: 3, tradeDate: '2023-12-29', closePrice: 10.0, changePct: 0,
          turnoverRate: 0.03, netInflowMain: 0, netInflowMainPct: 0, updateTime: new Date() } as any,
        { code: '000001', id: 4, tradeDate: '2023-12-28', closePrice: 10.0, changePct: 0,
          turnoverRate: 0.03, netInflowMain: 0, netInflowMainPct: 0, updateTime: new Date() } as any,
        { code: '000001', id: 5, tradeDate: '2023-12-27', closePrice: 10.0, changePct: 0,
          turnoverRate: 0.03, netInflowMain: 0, netInflowMainPct: 0, updateTime: new Date() } as any,
      ]
      mockRepo = {
        getMinuteKlinesByCode: vi.fn().mockResolvedValue([]),
        getMinuteKlinesByCodeAndLimit: vi.fn().mockResolvedValue([]),
        getMoneyFlowByCode: vi.fn().mockResolvedValue(rows),
      }

      const result = await analyzeSmartFilters('000001', '平安银行')

      expect(result.signals.goodNewsDump).not.toBeNull()
      expect(result.signals.goodNewsDump!.level).toBe('high')
      expect(result.signals.goodNewsDump!.score).toBeGreaterThan(60)
      expect(result.signals.goodNewsDump!.evidence.isHighOpen).toBe(true)
    })

    it('正常量能场景 → level=low, 不触发', async () => {
      // openGapPct=0, volumeRatio=1, changePct=0.5
      const rows: MoneyFlowRow[] = [
        { code: '000001', id: 1, tradeDate: '2024-01-02', closePrice: 10.05, changePct: 0.5,
          turnoverRate: 0.03, netInflowMain: 1e7, netInflowMainPct: 0.5, updateTime: new Date() } as any,
        { code: '000001', id: 2, tradeDate: '2024-01-01', closePrice: 10.0, changePct: 0,
          turnoverRate: 0.03, netInflowMain: 0, netInflowMainPct: 0, updateTime: new Date() } as any,
        { code: '000001', id: 3, tradeDate: '2023-12-29', closePrice: 10.0, changePct: 0,
          turnoverRate: 0.03, netInflowMain: 0, netInflowMainPct: 0, updateTime: new Date() } as any,
        { code: '000001', id: 4, tradeDate: '2023-12-28', closePrice: 10.0, changePct: 0,
          turnoverRate: 0.03, netInflowMain: 0, netInflowMainPct: 0, updateTime: new Date() } as any,
        { code: '000001', id: 5, tradeDate: '2023-12-27', closePrice: 10.0, changePct: 0,
          turnoverRate: 0.03, netInflowMain: 0, netInflowMainPct: 0, updateTime: new Date() } as any,
      ]
      mockRepo = {
        getMinuteKlinesByCode: vi.fn().mockResolvedValue([]),
        getMinuteKlinesByCodeAndLimit: vi.fn().mockResolvedValue([]),
        getMoneyFlowByCode: vi.fn().mockResolvedValue(rows),
      }

      const result = await analyzeSmartFilters('000001', '平安银行')

      expect(result.signals.goodNewsDump).not.toBeNull()
      expect(result.signals.goodNewsDump!.level).toBe('low')
    })

    it('数据不足（<2条）→ 返回null', async () => {
      mockRepo = {
        getMinuteKlinesByCode: vi.fn().mockResolvedValue([]),
        getMinuteKlinesByCodeAndLimit: vi.fn().mockResolvedValue([]),
        getMoneyFlowByCode: vi.fn().mockResolvedValue([{ code: '000001', id: 1, tradeDate: '2024-01-02',
          closePrice: 10, changePct: 0, turnoverRate: 0.03, netInflowMain: 0,
          netInflowMainPct: 0, updateTime: new Date() }] as any),
      }

      const result = await analyzeSmartFilters('000001', '平安银行')

      expect(result.signals.goodNewsDump).toBeNull()
    })

    it('中等风险（利好兑现嫌疑）→ dumpScore中等, level=medium', async () => {
      // isHighOpen (openGapPct > 2) && todayChange < -1 → 40 pts → medium
      // todayClose = 12.3, prevClose = 10.0 → openGapPct = 23% > 2 → isHighOpen=true
      // todayChange = -2 (< -1) → 40 pts → medium
      const rows: MoneyFlowRow[] = [
        { code: '000001', id: 1, tradeDate: '2024-01-02', closePrice: 12.3, changePct: -2,
          turnoverRate: 0.03, netInflowMain: 0, netInflowMainPct: 0, updateTime: new Date() } as any,
        { code: '000001', id: 2, tradeDate: '2024-01-01', closePrice: 10.0, changePct: 0,
          turnoverRate: 0.03, netInflowMain: 0, netInflowMainPct: 0, updateTime: new Date() } as any,
        { code: '000001', id: 3, tradeDate: '2023-12-29', closePrice: 10.0, changePct: 0,
          turnoverRate: 0.03, netInflowMain: 0, netInflowMainPct: 0, updateTime: new Date() } as any,
        { code: '000001', id: 4, tradeDate: '2023-12-28', closePrice: 10.0, changePct: 0,
          turnoverRate: 0.03, netInflowMain: 0, netInflowMainPct: 0, updateTime: new Date() } as any,
        { code: '000001', id: 5, tradeDate: '2023-12-27', closePrice: 10.0, changePct: 0,
          turnoverRate: 0.03, netInflowMain: 0, netInflowMainPct: 0, updateTime: new Date() } as any,
      ]
      mockRepo = {
        getMinuteKlinesByCode: vi.fn().mockResolvedValue([]),
        getMinuteKlinesByCodeAndLimit: vi.fn().mockResolvedValue([]),
        getMoneyFlowByCode: vi.fn().mockResolvedValue(rows),
      }

      const result = await analyzeSmartFilters('000001', '平安银行')

      expect(result.signals.goodNewsDump).not.toBeNull()
      expect(result.signals.goodNewsDump!.level).toBe('medium')
    })
  })

  // ---------------------------------------------------------------------------
  // analyzeChipDistribution — low_position vs high_position
  // ---------------------------------------------------------------------------
  describe('analyzeChipDistribution', () => {
    it('筹码高位集中（主力出货）→ level=high_position', async () => {
      // avgPrice near top of range → position > 0.7
      const klines: MinuteKlineRow[] = []
      // Most prices clustered at top: 400 rows at 11.9-12, 100 rows at 10-10.1
      for (let i = 0; i < 400; i++) {
        const price = 11.9 + (i / 400) * 0.1 // 11.9 → 12.0
        klines.push({
          code: '000001', id: i, datetime: new Date(Date.now() - (500 - i) * 60_000),
          period: 'm1', open: price, high: price + 0.01, low: price - 0.01, close: price,
          volume: 1000, amount: price * 1000,
        } as any)
      }
      for (let i = 400; i < 500; i++) {
        const price = 10 + ((i - 400) / 100) * 0.1 // 10 → 10.1
        klines.push({
          code: '000001', id: i, datetime: new Date(Date.now() - (500 - i) * 60_000),
          period: 'm1', open: price, high: price + 0.01, low: price - 0.01, close: price,
          volume: 1000, amount: price * 1000,
        } as any)
      }
      mockRepo = {
        getMinuteKlinesByCode: vi.fn().mockResolvedValue([]),
        getMinuteKlinesByCodeAndLimit: vi.fn().mockResolvedValue(klines),
        getMoneyFlowByCode: vi.fn().mockResolvedValue([]),
      }

      const result = await analyzeSmartFilters('000001', '平安银行')

      expect(result.signals.chipDistribution).not.toBeNull()
      expect(result.signals.chipDistribution!.level).toBe('high_position')
      expect(result.signals.chipDistribution!.score).toBeGreaterThan(70)
    })

    it('筹码低位集中（主力吸筹）→ level=low_position', async () => {
      // avgPrice near bottom of range → position <= 0.7
      const klines: MinuteKlineRow[] = []
      for (let i = 0; i < 500; i++) {
        // price range 10-12, avgPrice ~10.2 (near bottom), position <= 0.7
        const price = 10 + (i / 500) * 0.4 // 10 → 10.4
        klines.push({
          code: '000001', id: i, datetime: new Date(Date.now() - (500 - i) * 60_000),
          period: 'm1', open: price, high: price + 0.01, low: price - 0.01, close: price,
          volume: 1000, amount: price * 1000,
        } as any)
      }
      mockRepo = {
        getMinuteKlinesByCode: vi.fn().mockResolvedValue([]),
        getMinuteKlinesByCodeAndLimit: vi.fn().mockResolvedValue(klines),
        getMoneyFlowByCode: vi.fn().mockResolvedValue([]),
      }

      const result = await analyzeSmartFilters('000001', '平安银行')

      expect(result.signals.chipDistribution).not.toBeNull()
      expect(result.signals.chipDistribution!.level).toBe('low_position')
    })

    it('数据不足（<100条）→ 返回null', async () => {
      mockRepo = {
        getMinuteKlinesByCode: vi.fn().mockResolvedValue([]),
        getMinuteKlinesByCodeAndLimit: vi.fn().mockResolvedValue(Array(50).fill(null).map((_, i) => ({
          code: '000001', id: i, datetime: new Date(), period: 'm1',
          open: 10, high: 10, low: 10, close: 10, volume: 1000, amount: 10000,
        }))),
        getMoneyFlowByCode: vi.fn().mockResolvedValue([]),
      }

      const result = await analyzeSmartFilters('000001', '平安银行')

      expect(result.signals.chipDistribution).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // detectVolumeAnomaly — surge vs normal
  // ---------------------------------------------------------------------------
  describe('detectVolumeAnomaly', () => {
    it('成交量突增3倍以上 → level=high', async () => {
      // todayTurnover/avgTurnover > 4 → level=high (volumeRatio > 4)
      const rows: MoneyFlowRow[] = []
      for (let i = 0; i < 20; i++) {
        rows.push({
          code: '000001', id: i, tradeDate: `2024-01-${String(i + 1).padStart(2, '0')}`,
          closePrice: 10, changePct: 0, turnoverRate: i === 0 ? 0.13 : 0.03,
          netInflowMain: 0, netInflowMainPct: 0, updateTime: new Date(),
        } as any)
      }
      mockRepo = {
        getMinuteKlinesByCode: vi.fn().mockResolvedValue([]),
        getMinuteKlinesByCodeAndLimit: vi.fn().mockResolvedValue([]),
        getMoneyFlowByCode: vi.fn().mockResolvedValue(rows),
      }

      const result = await analyzeSmartFilters('000001', '平安银行')

      expect(result.signals.volumeAnomaly).not.toBeNull()
      expect(result.signals.volumeAnomaly!.level).toBe('high')
      expect(result.signals.volumeAnomaly!.evidence.volumeRatio).toBeGreaterThan(3)
    })

    it('成交量异常放大 → level=medium', async () => {
      // todayTurnover/avgTurnover = 0.08/0.03 = 2.67 → 2.5 < 2.67 <= 4 → medium
      const rows: MoneyFlowRow[] = []
      for (let i = 0; i < 20; i++) {
        rows.push({
          code: '000001', id: i, tradeDate: `2024-01-${String(i + 1).padStart(2, '0')}`,
          closePrice: 10, changePct: 0, turnoverRate: i === 0 ? 0.08 : 0.03,
          netInflowMain: 0, netInflowMainPct: 0, updateTime: new Date(),
        } as any)
      }
      mockRepo = {
        getMinuteKlinesByCode: vi.fn().mockResolvedValue([]),
        getMinuteKlinesByCodeAndLimit: vi.fn().mockResolvedValue([]),
        getMoneyFlowByCode: vi.fn().mockResolvedValue(rows),
      }

      const result = await analyzeSmartFilters('000001', '平安银行')

      expect(result.signals.volumeAnomaly).not.toBeNull()
      expect(result.signals.volumeAnomaly!.level).toBe('medium')
    })

    it('成交量正常 → level=low', async () => {
      const rows: MoneyFlowRow[] = []
      for (let i = 0; i < 20; i++) {
        rows.push({
          code: '000001', id: i, tradeDate: `2024-01-${String(i + 1).padStart(2, '0')}`,
          closePrice: 10, changePct: 0, turnoverRate: 0.03,
          netInflowMain: 0, netInflowMainPct: 0, updateTime: new Date(),
        } as any)
      }
      mockRepo = {
        getMinuteKlinesByCode: vi.fn().mockResolvedValue([]),
        getMinuteKlinesByCodeAndLimit: vi.fn().mockResolvedValue([]),
        getMoneyFlowByCode: vi.fn().mockResolvedValue(rows),
      }

      const result = await analyzeSmartFilters('000001', '平安银行')

      expect(result.signals.volumeAnomaly).not.toBeNull()
      expect(result.signals.volumeAnomaly!.level).toBe('low')
    })

    it('数据不足（<5条）→ 返回null', async () => {
      mockRepo = {
        getMinuteKlinesByCode: vi.fn().mockResolvedValue([]),
        getMinuteKlinesByCodeAndLimit: vi.fn().mockResolvedValue([]),
        getMoneyFlowByCode: vi.fn().mockResolvedValue(Array(3).fill(null).map((_, i) => ({
          code: '000001', id: i, tradeDate: '2024-01-01', closePrice: 10,
          changePct: 0, turnoverRate: 0.03, netInflowMain: 0,
          netInflowMainPct: 0, updateTime: new Date(),
        }))),
      }

      const result = await analyzeSmartFilters('000001', '平安银行')

      expect(result.signals.volumeAnomaly).toBeNull()
    })

    it('avgTurnover=0 → 返回null', async () => {
      const rows: MoneyFlowRow[] = []
      for (let i = 0; i < 20; i++) {
        rows.push({
          code: '000001', id: i, tradeDate: `2024-01-${String(i + 1).padStart(2, '0')}`,
          closePrice: 10, changePct: 0, turnoverRate: 0,
          netInflowMain: 0, netInflowMainPct: 0, updateTime: new Date(),
        } as any)
      }
      mockRepo = {
        getMinuteKlinesByCode: vi.fn().mockResolvedValue([]),
        getMinuteKlinesByCodeAndLimit: vi.fn().mockResolvedValue([]),
        getMoneyFlowByCode: vi.fn().mockResolvedValue(rows),
      }

      const result = await analyzeSmartFilters('000001', '平安银行')

      expect(result.signals.volumeAnomaly).toBeNull()
    })
  })
})
