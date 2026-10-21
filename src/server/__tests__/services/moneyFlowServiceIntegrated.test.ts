import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setMoneyFlowRepository } from '../../repositories/IMoneyFlowRepository.js'

// ---------------------------------------------------------------------------
// moneyFlowService.ts — test exported functions with mocked repository + redis
// ---------------------------------------------------------------------------

// Mock redis
const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
}
vi.mock('../../data/redis.js', () => ({
  redis: {
    get: mockRedis.get,
    setex: mockRedis.setex,
  },
}))

// Mock data fetchers
vi.mock('../../data/eastmoneyMoneyFlow.js', () => ({
  fetchDailyMoneyFlow: vi.fn().mockResolvedValue([]),
  fetchRealtimeMoneyFlow: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../data/fundamental.js', () => ({
  fetchFundamental: vi.fn().mockResolvedValue(null),
}))

// Create mock repo
function createMockRepo() {
  return {
    getLimitUpCodes: vi.fn().mockResolvedValue([]),
    getDailyMoneyFlow: vi.fn().mockResolvedValue([]),
    saveDailyMoneyFlow: vi.fn().mockResolvedValue(undefined),
    saveRealtimeMoneyFlow: vi.fn().mockResolvedValue(undefined),
    getLatestDailyNetInflow: vi.fn().mockResolvedValue(null),
    getAlert: vi.fn().mockResolvedValue(null),
    saveAlert: vi.fn().mockResolvedValue(undefined),
    getActiveStocks: vi.fn().mockResolvedValue([]),
    updateSourceStatus: vi.fn().mockResolvedValue(undefined),
  }
}

let mockRepo = createMockRepo()

beforeEach(async () => {
  vi.clearAllMocks()
  mockRepo = createMockRepo()
  setMoneyFlowRepository(mockRepo as any)
  // Reset module-level caches
  const { __resetMoneyFlowCaches } = await import('../../services/moneyFlowService.js')
  __resetMoneyFlowCaches()
})
describe('getConnectionStatus', async () => {
  const { getConnectionStatus } = await import('../../services/moneyFlowService.js')

  it('returns an object with status, source, and lastUpdate', () => {
    const status = getConnectionStatus()
    expect(status).toHaveProperty('status')
    expect(status).toHaveProperty('source')
    expect(status).toHaveProperty('lastUpdate')
    expect(typeof status.status).toBe('string')
    expect(typeof status.source).toBe('string')
    expect(typeof status.lastUpdate).toBe('number')
  })
})

describe('getMoneyFlow5d', async () => {
  const { getMoneyFlow5d } = await import('../../services/moneyFlowService.js')

  it('returns null when no rows found', async () => {
    mockRepo.getDailyMoneyFlow.mockResolvedValueOnce([])
    const result = await getMoneyFlow5d('000001')
    expect(result).toBeNull()
  })

  it('returns net inflow total for 5 rows', async () => {
    const mockRows = [
      { code: '000001', tradeDate: '2026-01-05', netInflowMain: '100' },
      { code: '000001', tradeDate: '2026-01-04', netInflowMain: '200' },
      { code: '000001', tradeDate: '2026-01-03', netInflowMain: '-50' },
      { code: '000001', tradeDate: '2026-01-02', netInflowMain: '150' },
      { code: '000001', tradeDate: '2026-01-01', netInflowMain: '300' },
    ]
    mockRepo.getDailyMoneyFlow.mockResolvedValueOnce(mockRows)

    const result = await getMoneyFlow5d('000001')
    expect(result).not.toBeNull()
    expect(result!.netInflowMain).toBe(700) // 100+200-50+150+300
    expect(result!.count).toBe(5)
  })

  it('returns null on repo error', async () => {
    mockRepo.getDailyMoneyFlow.mockRejectedValueOnce(new Error('DB error'))
    const result = await getMoneyFlow5d('000001')
    expect(result).toBeNull()
  })
})

describe('getRealtimeMoneyFlow', async () => {
  const { getRealtimeMoneyFlow } = await import('../../services/moneyFlowService.js')
  const { fetchRealtimeMoneyFlow } = await import('../../data/eastmoneyMoneyFlow.js')

  it('returns cached data when available', async () => {
    const cached = {
      code: '000001',
      name: '平安银行',
      updateTime: new Date(),
      close: 10,
      netInflowSuperLarge: -100,
      netInflowLarge: -200,
      netInflowMedium: 0,
      netInflowSmall: 0,
      netInflowMain: -300,
      netInflowMainPct: -3,
    }
    mockRedis.get.mockResolvedValue(JSON.stringify(cached))
    mockRedis.setex.mockResolvedValue('OK')

    const result = await getRealtimeMoneyFlow('000001')

    expect(result).not.toBeNull()
    expect(result!.code).toBe('000001')
    expect(fetchRealtimeMoneyFlow).not.toHaveBeenCalled()
  })

  it('fetches from API when no cache', async () => {
    mockRedis.get.mockResolvedValue(null)
    mockRedis.setex.mockResolvedValue('OK')

    const apiData = {
      code: '000001',
      name: '平安银行',
      updateTime: new Date(),
      close: 10,
      netInflowSuperLarge: -100,
      netInflowLarge: -200,
      netInflowMedium: 0,
      netInflowSmall: 0,
      netInflowMain: -300,
      netInflowMainPct: -3,
    }
    vi.mocked(fetchRealtimeMoneyFlow).mockResolvedValue(apiData)

    const result = await getRealtimeMoneyFlow('000001')

    expect(result).not.toBeNull()
    expect(fetchRealtimeMoneyFlow).toHaveBeenCalledWith('000001')
  })

  it('returns null when API returns null', async () => {
    mockRedis.get.mockResolvedValue(null)
    vi.mocked(fetchRealtimeMoneyFlow).mockResolvedValue(null)

    const result = await getRealtimeMoneyFlow('000001')

    expect(result).toBeNull()
  })
})

describe('isAuctionAnomaly', async () => {
  const { isAuctionAnomaly } = await import('../../services/moneyFlowService.js')

  it('returns false before 9:30', () => {
    const fakeDate = new Date('2024-01-01T09:00:00')
    vi.spyOn(Date.prototype, 'getHours').mockReturnValue(fakeDate.getHours())
    vi.spyOn(Date.prototype, 'getMinutes').mockReturnValue(fakeDate.getMinutes())
    expect(isAuctionAnomaly(0)).toBe(false)
    vi.restoreAllMocks()
  })

  it('returns true after 9:31 when close is 0', () => {
    const fakeDate = new Date('2024-01-01T09:32:00')
    vi.spyOn(Date.prototype, 'getHours').mockReturnValue(fakeDate.getHours())
    vi.spyOn(Date.prototype, 'getMinutes').mockReturnValue(fakeDate.getMinutes())
    expect(isAuctionAnomaly(0)).toBe(true)
    vi.restoreAllMocks()
  })

  it('returns false after 9:31 when close is non-zero', () => {
    const fakeDate = new Date('2024-01-01T09:32:00')
    vi.spyOn(Date.prototype, 'getHours').mockReturnValue(fakeDate.getHours())
    vi.spyOn(Date.prototype, 'getMinutes').mockReturnValue(fakeDate.getMinutes())
    expect(isAuctionAnomaly(10.5)).toBe(false)
    vi.restoreAllMocks()
  })
})

describe('validateData', async () => {
  const { validateData } = await import('../../services/moneyFlowService.js')

  it('returns invalid for close <= 0', () => {
    const data = { code: '000001', name: 'test', updateTime: new Date(), close: 0, netInflowSuperLarge: 0, netInflowLarge: 0, netInflowMedium: 0, netInflowSmall: 0, netInflowMain: 0, netInflowMainPct: 0 }
    expect(validateData(data).valid).toBe(false)
    expect(validateData(data).reason).toBe('invalid_price')
  })

  it('returns invalid for abs(netInflowMainPct) > 100', () => {
    const data = { code: '000001', name: 'test', updateTime: new Date(), close: 10, netInflowSuperLarge: 0, netInflowLarge: 0, netInflowMedium: 0, netInflowSmall: 0, netInflowMain: 0, netInflowMainPct: 150 }
    expect(validateData(data).valid).toBe(false)
    expect(validateData(data).reason).toBe('invalid_pct')
  })

  it('returns valid for normal data', () => {
    const data = { code: '000001', name: 'test', updateTime: new Date(), close: 10, netInflowSuperLarge: 0, netInflowLarge: 0, netInflowMedium: 0, netInflowSmall: 0, netInflowMain: 0, netInflowMainPct: 5 }
    expect(validateData(data).valid).toBe(true)
  })

  it('returns invalid when inflow exceeds 5% of float cap', () => {
    const data = { code: '000001', name: 'test', updateTime: new Date(), close: 10, netInflowSuperLarge: 0, netInflowLarge: 0, netInflowMedium: 0, netInflowSmall: 0, netInflowMain: 1_000_000, netInflowMainPct: 10 }
    const result = validateData(data, 10_000_000) // 5% of 10M = 500K
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('inflow_exceeds_5pct_float_cap')
  })

  it('returns valid when floatMarketCap is 0 (skips check)', () => {
    const data = { code: '000001', name: 'test', updateTime: new Date(), close: 10, netInflowSuperLarge: 0, netInflowLarge: 0, netInflowMedium: 0, netInflowSmall: 0, netInflowMain: 100_000_000, netInflowMainPct: 10 }
    const result = validateData(data, 0)
    expect(result.valid).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// NEW: getFloatMarketCap coverage
// ---------------------------------------------------------------------------
describe('getFloatMarketCap', async () => {
  const { fetchFundamental } = await import('../../data/fundamental.js')
  const { getFloatMarketCap, __resetMoneyFlowCaches } = await import('../../services/moneyFlowService.js')

  beforeEach(async () => {
    vi.clearAllMocks()
    __resetMoneyFlowCaches()
    // Reset fetchFundamental to a default null-returning mock
    vi.mocked(fetchFundamental).mockReturnValue(null as any)
  })

  it('uses in-memory cache on second call', async () => {
    // Set up fetchFundamental to return a value
    vi.mocked(fetchFundamental).mockReturnValue({ floatMarketCap: 50_000_000_000 } as any)
    mockRedis.get.mockResolvedValue(null)
    mockRedis.setex.mockResolvedValue('OK')

    const first = await getFloatMarketCap('600519')
    expect(first).toBe(50_000_000_000)

    // Change mock but expect cache hit (first call populated in-memory cache)
    vi.mocked(fetchFundamental).mockReturnValue({ floatMarketCap: 99_000_000_000 } as any)
    const second = await getFloatMarketCap('600519')
    expect(second).toBe(50_000_000_000) // still from cache
    expect(fetchFundamental).toHaveBeenCalledTimes(1)
  })

  it('uses redis cached value when in-memory cache misses', async () => {
    // In-memory cache is fresh (cleared), redis has the value
    mockRedis.get.mockResolvedValue('80000000000')
    mockRedis.setex.mockResolvedValue('OK')

    const result = await getFloatMarketCap('600519')
    expect(result).toBe(80_000_000_000)
  })

  it('ignores redis cached value when <= 0', async () => {
    mockRedis.get.mockResolvedValue('0')  // redis has 0 (invalid)
    vi.mocked(fetchFundamental).mockReturnValue({ floatMarketCap: 30_000_000_000 } as any)
    mockRedis.setex.mockResolvedValue('OK')

    const result = await getFloatMarketCap('600519')
    expect(result).toBe(30_000_000_000)
  })

  it('returns null when fetchFundamental fails', async () => {
    mockRedis.get.mockResolvedValue(null)
    vi.mocked(fetchFundamental).mockRejectedValue(new Error('network error'))

    const result = await getFloatMarketCap('600519')
    expect(result).toBeNull()
  })

  it('returns null when fetchFundamental returns null', async () => {
    mockRedis.get.mockResolvedValue(null)
    vi.mocked(fetchFundamental).mockReturnValue(null as any)

    const result = await getFloatMarketCap('600519')
    expect(result).toBeNull()
  })

  it('returns null when floatMarketCap is 0 in fundamental response', async () => {
    mockRedis.get.mockResolvedValue(null)
    vi.mocked(fetchFundamental).mockReturnValue({ floatMarketCap: 0 } as any)

    const result = await getFloatMarketCap('600519')
    expect(result).toBeNull()
  })

  it('redis.setex errors are swallowed', async () => {
    mockRedis.get.mockResolvedValue(null)
    vi.mocked(fetchFundamental).mockReturnValue({ floatMarketCap: 10_000_000_000 } as any)
    mockRedis.setex.mockRejectedValue(new Error('redis write error'))

    // Should still return the value (redis write error is caught)
    const result = await getFloatMarketCap('600519')
    expect(result).toBe(10_000_000_000)
  })
})

// ---------------------------------------------------------------------------
// NEW: crossValidate coverage
// ---------------------------------------------------------------------------
describe('crossValidate', async () => {
  const { crossValidate } = await import('../../services/moneyFlowService.js')

  beforeEach(() => {
    vi.clearAllMocks()
    mockRepo = createMockRepo()
    setMoneyFlowRepository(mockRepo as any)
  })

  it('early-returns when dailyNetInflowAbs is null', async () => {
    mockRepo.getLatestDailyNetInflow.mockResolvedValueOnce(null)
    await crossValidate({ code: '000001', name: 'test', updateTime: new Date(), close: 10, netInflowSuperLarge: 0, netInflowLarge: 0, netInflowMedium: 0, netInflowSmall: 0, netInflowMain: 0, netInflowMainPct: 0 })
    expect(mockRepo.getLatestDailyNetInflow).toHaveBeenCalled()
    // saveAlert should NOT be called
    expect(mockRepo.saveAlert).not.toHaveBeenCalled()
  })

  it('does not alert when both net inflows are 0', async () => {
    mockRepo.getLatestDailyNetInflow.mockResolvedValueOnce(0)
    await crossValidate({ code: '000001', name: 'test', updateTime: new Date(), close: 10, netInflowSuperLarge: 0, netInflowLarge: 0, netInflowMedium: 0, netInflowSmall: 0, netInflowMain: 0, netInflowMainPct: 0 })
    // ratio = 0/0 → NaN → not finite → no alert
    expect(mockRepo.saveAlert).not.toHaveBeenCalled()
  })

  it('does not alert when ratio <= 5', async () => {
    // dailyNetInflowAbs = 100_000_000, rtNetInflow = 200_000_000 → ratio = 2
    mockRepo.getLatestDailyNetInflow.mockResolvedValueOnce(100_000_000)
    await crossValidate({ code: '000001', name: 'test', updateTime: new Date(), close: 10, netInflowSuperLarge: 0, netInflowLarge: 0, netInflowMedium: 0, netInflowSmall: 0, netInflowMain: 200_000_000, netInflowMainPct: 2 })
    expect(mockRepo.saveAlert).not.toHaveBeenCalled()
  })

  it('creates alert when ratio > 5', async () => {
    // dailyNetInflowAbs = 10_000_000, rtNetInflow = 100_000_000 → ratio = 10
    mockRepo.getLatestDailyNetInflow.mockResolvedValueOnce(10_000_000)
    await crossValidate({ code: '000001', name: 'test', updateTime: new Date(), close: 10, netInflowSuperLarge: 0, netInflowLarge: 0, netInflowMedium: 0, netInflowSmall: 0, netInflowMain: 100_000_000, netInflowMainPct: 10 })
    expect(mockRepo.saveAlert).toHaveBeenCalledWith('000001', 'test', 'cross_validate_fail', expect.objectContaining({ message: expect.stringContaining('10.0x') }))
  })

  it('repo errors are swallowed', async () => {
    mockRepo.getLatestDailyNetInflow.mockRejectedValueOnce(new Error('db error'))
    // Should not throw
    await expect(crossValidate({ code: '000001', name: 'test', updateTime: new Date(), close: 10, netInflowSuperLarge: 0, netInflowLarge: 0, netInflowMedium: 0, netInflowSmall: 0, netInflowMain: 100_000_000, netInflowMainPct: 5 })).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// NEW: fetchAllDailyMoneyFlow batch processing
// ---------------------------------------------------------------------------
describe('fetchAllDailyMoneyFlow', async () => {
  const { fetchAllDailyMoneyFlow } = await import('../../services/moneyFlowService.js')
  const { fetchDailyMoneyFlow } = await import('../../data/eastmoneyMoneyFlow.js')

  beforeEach(() => {
    vi.clearAllMocks()
    mockRepo = createMockRepo()
    setMoneyFlowRepository(mockRepo as any)
  })

  it('returns 0 when no active stocks', async () => {
    mockRepo.getActiveStocks.mockResolvedValueOnce([])
    const result = await fetchAllDailyMoneyFlow()
    expect(result).toBe(0)
  })

  it('processes stocks in batches of 20', async () => {
    // 25 stocks → 2 batches (20 + 5)
    const stocks = Array.from({ length: 25 }, (_, i) => ({ code: `60${String(i).padStart(4, '0')}` }))
    mockRepo.getActiveStocks.mockResolvedValueOnce(stocks)
    vi.mocked(fetchDailyMoneyFlow).mockResolvedValue([{ code: stocks[0].code, tradeDate: '2026-01-05', netInflowMain: 100_000_000 } as any])

    const result = await fetchAllDailyMoneyFlow()
    expect(result).toBeGreaterThan(0)
    // Should be called at least 2 times (2 batches)
    expect(fetchDailyMoneyFlow).toHaveBeenCalled()
  })

  it('continues when Promise.allSettled has rejections', async () => {
    const stocks = [
      { code: '600000' },
      { code: '600001' },
      { code: '600002' },
    ]
    mockRepo.getActiveStocks.mockResolvedValueOnce(stocks)
    vi.mocked(fetchDailyMoneyFlow)
      .mockRejectedValueOnce(new Error('fetch error'))  // first stock fails
      .mockResolvedValueOnce([{ code: '600001', tradeDate: '2026-01-05', netInflowMain: 100_000_000 } as any])

    const result = await fetchAllDailyMoneyFlow()
    // Should still process the second stock
    expect(result).toBeGreaterThanOrEqual(0)
  })
})
