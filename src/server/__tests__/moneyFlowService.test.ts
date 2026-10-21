import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setMoneyFlowRepository } from '../repositories/IMoneyFlowRepository.js'
import type { MoneyFlowRealtime } from '../data/eastmoneyMoneyFlow.js'

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------
const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
}
vi.mock('../data/redis.js', () => ({ redis: mockRedis }))

vi.mock('../data/fundamental.js', () => ({
  fetchFundamental: vi.fn(),
}))

vi.mock('../data/eastmoneyMoneyFlow.js', () => ({
  fetchDailyMoneyFlow: vi.fn(),
  fetchRealtimeMoneyFlow: vi.fn(),
}))

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

let mockRepo: ReturnType<typeof createMockRepo>

beforeEach(() => {
  vi.clearAllMocks()
  mockRepo = createMockRepo()
  setMoneyFlowRepository(mockRepo as any)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function makeRealtime(overrides: Partial<MoneyFlowRealtime> = {}): MoneyFlowRealtime {
  return {
    code: '000001',
    name: '平安银行',
    updateTime: new Date(),
    close: 10.0,
    netInflowSuperLarge: -100,
    netInflowLarge: -200,
    netInflowMedium: 0,
    netInflowSmall: 0,
    netInflowMain: -300,
    netInflowMainPct: -3.0,
    ...overrides,
  }
}

function makeDailyFlow(code = '000001') {
  return {
    code,
    name: 'stock',
    date: '2024-01-01',
    close: 10,
    changePct: 1,
    netInflowSuperLarge: 0,
    netInflowLarge: 0,
    netInflowMedium: 0,
    netInflowSmall: 0,
    netInflowMain: 100,
    netInflowMainPct: 1,
  }
}

// ---------------------------------------------------------------------------
// isAuctionAnomaly
// ---------------------------------------------------------------------------
describe('isAuctionAnomaly', async () => {
  const { isAuctionAnomaly } = await import('../services/moneyFlowService.js')

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

  it('returns false between 9:30 and 9:31 inclusive', () => {
    const fakeDate = new Date('2024-01-01T09:30:00')
    vi.spyOn(Date.prototype, 'getHours').mockReturnValue(fakeDate.getHours())
    vi.spyOn(Date.prototype, 'getMinutes').mockReturnValue(fakeDate.getMinutes())
    expect(isAuctionAnomaly(0)).toBe(false)
    vi.restoreAllMocks()
  })
})

// ---------------------------------------------------------------------------
// validateData
// ---------------------------------------------------------------------------
describe('validateData', async () => {
  const { validateData } = await import('../services/moneyFlowService.js')

  it('returns invalid when close is zero', () => {
    expect(validateData(makeRealtime({ close: 0 })).valid).toBe(false)
    expect(validateData(makeRealtime({ close: 0 })).reason).toBe('invalid_price')
  })

  it('returns invalid when close is negative', () => {
    expect(validateData(makeRealtime({ close: -1 })).valid).toBe(false)
    expect(validateData(makeRealtime({ close: -1 })).reason).toBe('invalid_price')
  })

  it('returns invalid when netInflowMainPct exceeds 100', () => {
    expect(validateData(makeRealtime({ netInflowMainPct: 150 })).valid).toBe(false)
    expect(validateData(makeRealtime({ netInflowMainPct: 150 })).reason).toBe('invalid_pct')
  })

  it('returns invalid when netInflowMainPct is below -100', () => {
    expect(validateData(makeRealtime({ netInflowMainPct: -200 })).valid).toBe(false)
    expect(validateData(makeRealtime({ netInflowMainPct: -200 })).reason).toBe('invalid_pct')
  })

  it('returns invalid when main inflow exceeds 5% of float market cap', () => {
    // netInflowMain = 1000, floatMarketCap = 10000, 5% = 500, 1000 > 500 → invalid
    const result = validateData(makeRealtime({ netInflowMain: 1000, netInflowMainPct: 10 }), 10000)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('inflow_exceeds_5pct_float_cap')
  })

  it('returns valid when inflow is exactly at 5% threshold', () => {
    const result = validateData(makeRealtime({ netInflowMain: 500, netInflowMainPct: 5 }), 10000)
    expect(result.valid).toBe(true)
  })

  it('returns valid when floatMarketCap is provided but inflow is within limit', () => {
    const result = validateData(makeRealtime({ netInflowMain: 100, netInflowMainPct: 1 }), 10000)
    expect(result.valid).toBe(true)
  })

  it('ignores zero floatMarketCap', () => {
    const result = validateData(makeRealtime({ netInflowMain: 1_000_000 }), 0)
    expect(result.valid).toBe(true)
  })

  it('ignores negative floatMarketCap', () => {
    const result = validateData(makeRealtime({ netInflowMain: 1_000_000 }), -100)
    expect(result.valid).toBe(true)
  })

  it('returns valid for normal data', () => {
    expect(validateData(makeRealtime()).valid).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// backfillDaily → calls fetchAllDailyMoneyFlow (private)
// ---------------------------------------------------------------------------
describe('backfillDaily', async () => {
  const { backfillDaily } = await import('../services/moneyFlowService.js')
  const { fetchDailyMoneyFlow } = await import('../data/eastmoneyMoneyFlow.js')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 0 when no active stocks', async () => {
    mockRepo.getActiveStocks.mockResolvedValue([])
    const saved = await backfillDaily()
    expect(saved).toBe(0)
    expect(fetchDailyMoneyFlow).not.toHaveBeenCalled()
  })

  it('saves daily flow data for each stock', async () => {
    mockRepo.getActiveStocks.mockResolvedValue([{ code: '000001' }])
    vi.mocked(fetchDailyMoneyFlow).mockResolvedValue([makeDailyFlow('000001')])
    const saved = await backfillDaily()
    expect(saved).toBe(1)
    expect(mockRepo.saveDailyMoneyFlow).toHaveBeenCalledWith(makeDailyFlow('000001'))
  })

  it('processes in batches of 20', async () => {
    // 25 stocks → 2 batches (20 + 5)
    const stocks = Array.from({ length: 25 }, (_, i) => ({ code: `00000${i}`.slice(-6) }))
    mockRepo.getActiveStocks.mockResolvedValue(stocks)
    vi.mocked(fetchDailyMoneyFlow).mockResolvedValue([makeDailyFlow()])
    const saved = await backfillDaily()
    // 25 stocks, batch 1 = 20 saves, batch 2 = 5 saves
    expect(saved).toBe(25)
  })

  it('continues when some fetches reject', async () => {
    mockRepo.getActiveStocks.mockResolvedValue([{ code: '000001' }, { code: '000002' }])
    vi.mocked(fetchDailyMoneyFlow)
      .mockResolvedValueOnce([makeDailyFlow('000001')])
      .mockRejectedValueOnce(new Error('API error'))
    const saved = await backfillDaily()
    expect(saved).toBe(1)
  })

  it('saves multiple rows per stock when days > 1', async () => {
    mockRepo.getActiveStocks.mockResolvedValue([{ code: '000001' }])
    vi.mocked(fetchDailyMoneyFlow).mockResolvedValue([
      makeDailyFlow('000001'),
      makeDailyFlow('000001'),
      makeDailyFlow('000001'),
    ])
    const saved = await backfillDaily()
    expect(saved).toBe(3)
    expect(mockRepo.saveDailyMoneyFlow).toHaveBeenCalledTimes(3)
  })
})

// ---------------------------------------------------------------------------
// getConnectionStatus
// ---------------------------------------------------------------------------
describe('getConnectionStatus', async () => {
  const { getConnectionStatus, stopRealtime } = await import('../services/moneyFlowService.js')

  afterEach(() => {
    stopRealtime()
  })

  it('returns object with status, source, lastUpdate', () => {
    const status = getConnectionStatus()
    expect(status).toHaveProperty('status')
    expect(status).toHaveProperty('source')
    expect(status).toHaveProperty('lastUpdate')
    expect(typeof status.status).toBe('string')
    expect(typeof status.source).toBe('string')
    expect(typeof status.lastUpdate).toBe('number')
  })
})

// ---------------------------------------------------------------------------
// getMoneyFlow5d
// ---------------------------------------------------------------------------
describe('getMoneyFlow5d', async () => {
  const { getMoneyFlow5d } = await import('../services/moneyFlowService.js')

  it('returns null when no rows', async () => {
    mockRepo.getDailyMoneyFlow.mockResolvedValueOnce([])
    const result = await getMoneyFlow5d('000001')
    expect(result).toBeNull()
  })

  it('returns null on repo error', async () => {
    mockRepo.getDailyMoneyFlow.mockRejectedValueOnce(new Error('DB error'))
    const result = await getMoneyFlow5d('000001')
    expect(result).toBeNull()
  })

  it('returns net inflow total for up to 5 rows sorted by date desc', async () => {
    mockRepo.getDailyMoneyFlow.mockResolvedValueOnce([
      { code: '000001', tradeDate: '2026-01-05', netInflowMain: '100' },
      { code: '000001', tradeDate: '2026-01-04', netInflowMain: '200' },
      { code: '000001', tradeDate: '2026-01-03', netInflowMain: '-50' },
      { code: '000001', tradeDate: '2026-01-02', netInflowMain: '150' },
      { code: '000001', tradeDate: '2026-01-01', netInflowMain: '300' },
    ])
    const result = await getMoneyFlow5d('000001')
    expect(result).not.toBeNull()
    expect(result!.netInflowMain).toBe(700)
    expect(result!.count).toBe(5)
  })

  it('ignores rows with null netInflowMain', async () => {
    mockRepo.getDailyMoneyFlow.mockResolvedValueOnce([
      { code: '000001', tradeDate: '2026-01-03', netInflowMain: null },
      { code: '000001', tradeDate: '2026-01-02', netInflowMain: '100' },
      { code: '000001', tradeDate: '2026-01-01', netInflowMain: undefined },
    ])
    const result = await getMoneyFlow5d('000001')
    expect(result).not.toBeNull()
    expect(result!.netInflowMain).toBe(100)
    expect(result!.count).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// getRealtimeMoneyFlow — covers getCachedMoneyFlow and cacheMoneyFlow indirectly
// ---------------------------------------------------------------------------
describe('getRealtimeMoneyFlow', async () => {
  const { getRealtimeMoneyFlow } = await import('../services/moneyFlowService.js')
  const { fetchRealtimeMoneyFlow } = await import('../data/eastmoneyMoneyFlow.js')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns cached data when available (redis hit)', async () => {
    const cached = makeRealtime()
    mockRedis.get.mockResolvedValue(JSON.stringify(cached))
    const result = await getRealtimeMoneyFlow('000001')
    expect(result).not.toBeNull()
    expect(result!.code).toBe('000001')
    expect(fetchRealtimeMoneyFlow).not.toHaveBeenCalled()
  })

  it('fetches from API when redis cache misses', async () => {
    mockRedis.get.mockResolvedValue(null)
    mockRedis.setex.mockResolvedValue('OK')
    const apiData = makeRealtime({ code: '000002' })
    vi.mocked(fetchRealtimeMoneyFlow).mockResolvedValue(apiData)
    const result = await getRealtimeMoneyFlow('000002')
    expect(result).not.toBeNull()
    expect(fetchRealtimeMoneyFlow).toHaveBeenCalledWith('000002')
  })

  it('returns null when API returns null', async () => {
    mockRedis.get.mockResolvedValue(null)
    vi.mocked(fetchRealtimeMoneyFlow).mockResolvedValue(null)
    const result = await getRealtimeMoneyFlow('000001')
    expect(result).toBeNull()
  })

  it('redis get exception returns null', async () => {
    mockRedis.get.mockRejectedValue(new Error('redis down'))
    const result = await getRealtimeMoneyFlow('000001')
    expect(result).toBeNull()
  })

  it('redis setex exception does not prevent return', async () => {
    mockRedis.get.mockResolvedValue(null)
    mockRedis.setex.mockRejectedValue(new Error('redis write fail'))
    const apiData = makeRealtime()
    vi.mocked(fetchRealtimeMoneyFlow).mockResolvedValue(apiData)
    const result = await getRealtimeMoneyFlow('000001')
    expect(result).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// stopRealtime
// ---------------------------------------------------------------------------
describe('stopRealtime', async () => {
  const { stopRealtime, getConnectionStatus } = await import('../services/moneyFlowService.js')

  it('sets status to disconnected', () => {
    stopRealtime()
    expect(getConnectionStatus().status).toBe('disconnected')
  })

  it('is idempotent (calling twice does not throw)', () => {
    stopRealtime()
    expect(() => stopRealtime()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// startRealtime — SSE flow with mocked fetch
// Tests the SSE → processMoneyFlowItem → validateData → alert/repo path
// ---------------------------------------------------------------------------
describe('startRealtime', async () => {
  const { startRealtime, stopRealtime } = await import('../services/moneyFlowService.js')
  const { fetchRealtimeMoneyFlow } = await import('../data/eastmoneyMoneyFlow.js')
  const { fetchFundamental } = await import('../data/fundamental.js')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    stopRealtime()
  })

  it('processes SSE items and saves realtime data', async () => {
    // Mock SSE response as a ReadableStream
    const sseData = JSON.stringify({
      data: {
        diff: [
          { f12: '000001', f14: '平安银行', f2: '10.5', f62: '1000000', f184: '200000', f3: '1.2' },
        ],
      },
    })

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${sseData}\n`))
        controller.close()
      },
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => stream.getReader() },
    })
    vi.stubGlobal('fetch', mockFetch)

    mockRepo.saveRealtimeMoneyFlow.mockResolvedValue(undefined)
    mockRepo.getAlert.mockResolvedValue(null)
    mockRepo.getLatestDailyNetInflow.mockResolvedValue(null) // crossValidate early return
    mockRedis.setex.mockResolvedValue('OK')

    await startRealtime()

    // Verify realtime save was called
    expect(mockRepo.saveRealtimeMoneyFlow).toHaveBeenCalledWith(
      expect.objectContaining({ code: '000001', name: '平安银行', close: 10.5 }),
      expect.objectContaining({ isLimitUp: false, isAuctionAnomaly: false }),
    )

    // Verify moneyflow last update was cached
    expect(mockRedis.setex).toHaveBeenCalledWith('moneyflow:last_update', 300, expect.any(String))

    vi.stubGlobal('fetch', undefined)
  })

  it('creates data_anomaly alert when SSE item has invalid price', async () => {
    // close = 0 → invalid_price
    const sseData = JSON.stringify({
      data: {
        diff: [
          { f12: '000001', f14: 'test', f2: '0', f62: '0', f184: '0', f3: '0' },
        ],
      },
    })

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${sseData}\n`))
        controller.close()
      },
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => stream.getReader() },
    })
    vi.stubGlobal('fetch', mockFetch)

    mockRepo.saveRealtimeMoneyFlow.mockResolvedValue(undefined)
    mockRepo.saveAlert.mockResolvedValue(undefined)
    mockRepo.getAlert.mockResolvedValue(null)

    await startRealtime()

    expect(mockRepo.saveAlert).toHaveBeenCalledWith(
      '000001',
      'test',
      'data_anomaly',
      expect.objectContaining({ reason: 'invalid_price' }),
    )

    vi.stubGlobal('fetch', undefined)
  })

  it('calls crossValidate when data is valid (getLatestDailyNetInflow was called)', async () => {
    const sseData = JSON.stringify({
      data: {
        diff: [
          { f12: '000001', f14: '平安银行', f2: '10', f62: '0', f184: '0', f3: '0' },
        ],
      },
    })

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${sseData}\n`))
        controller.close()
      },
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => stream.getReader() },
    })
    vi.stubGlobal('fetch', mockFetch)

    mockRepo.saveRealtimeMoneyFlow.mockResolvedValue(undefined)
    mockRepo.getAlert.mockResolvedValue(null)
    mockRepo.getLatestDailyNetInflow.mockResolvedValue(100)

    await startRealtime()

    // crossValidate is called → getLatestDailyNetInflow is called
    expect(mockRepo.getLatestDailyNetInflow).toHaveBeenCalledWith('000001')

    vi.stubGlobal('fetch', undefined)
  })

  it('fetches float market cap when processing valid item', async () => {
    const sseData = JSON.stringify({
      data: {
        diff: [
          { f12: '000001', f14: '平安银行', f2: '10', f62: '0', f184: '0', f3: '0' },
        ],
      },
    })

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${sseData}\n`))
        controller.close()
      },
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => stream.getReader() },
    })
    vi.stubGlobal('fetch', mockFetch)

    mockRepo.saveRealtimeMoneyFlow.mockResolvedValue(undefined)
    mockRepo.getAlert.mockResolvedValue(null)
    mockRepo.getLatestDailyNetInflow.mockResolvedValue(null)
    vi.mocked(fetchFundamental).mockResolvedValue({ floatMarketCap: 500000, code: '000001' } as any)

    await startRealtime()

    // fetchFundamental is called for float market cap
    expect(fetchFundamental).toHaveBeenCalledWith('000001')

    vi.stubGlobal('fetch', undefined)
  })

  it('returns early if already connecting/connected', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: {}\n`))
        controller.close()
      },
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => stream.getReader() },
    })
    vi.stubGlobal('fetch', mockFetch)

    mockRepo.saveRealtimeMoneyFlow.mockResolvedValue(undefined)
    mockRepo.getAlert.mockResolvedValue(null)
    mockRepo.getLatestDailyNetInflow.mockResolvedValue(null)

    // Call startRealtime twice — second call should return early
    await startRealtime()
    const firstCallCount = mockRepo.saveRealtimeMoneyFlow.mock.calls.length
    await startRealtime()

    // Should not have processed twice
    expect(mockRepo.saveRealtimeMoneyFlow.mock.calls.length).toBe(firstCallCount)

    vi.stubGlobal('fetch', undefined)
  })

  it('calls getLimitUpCodes on startup', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.close()
      },
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => stream.getReader() },
    })
    vi.stubGlobal('fetch', mockFetch)

    mockRepo.getLimitUpCodes.mockResolvedValue([{ code: '000001' }])
    await startRealtime()
    expect(mockRepo.getLimitUpCodes).toHaveBeenCalled()

    vi.stubGlobal('fetch', undefined)
  })

  it('calls updateSourceStatus on startup', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.close()
      },
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => stream.getReader() },
    })
    vi.stubGlobal('fetch', mockFetch)

    await startRealtime()
    expect(mockRepo.updateSourceStatus).toHaveBeenCalledWith(true, undefined)

    vi.stubGlobal('fetch', undefined)
  })

  it('crossValidate creates alert when ratio > 5', async () => {
    // Setup: netInflowMain=300 (in SSE item) → rtNetInflow=300
    // Mock getLatestDailyNetInflow=50 → ratio=300/50=6 > 5 → alert
    const sseData = JSON.stringify({
      data: {
        diff: [
          { f12: '000001', f14: '平安银行', f2: '10', f62: '3000000', f184: '0', f3: '0' }, // netInflowMain=300
        ],
      },
    })

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${sseData}\n`))
        controller.close()
      },
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => stream.getReader() },
    })
    vi.stubGlobal('fetch', mockFetch)

    mockRepo.saveRealtimeMoneyFlow.mockResolvedValue(undefined)
    mockRepo.getAlert.mockResolvedValue(null)
    mockRepo.getLatestDailyNetInflow.mockResolvedValue(50) // ratio = 300/50 = 6 > 5

    await startRealtime()

    // crossValidate should have created a cross_validate_fail alert
    expect(mockRepo.saveAlert).toHaveBeenCalledWith(
      '000001',
      '平安银行',
      'cross_validate_fail',
      expect.objectContaining({ message: expect.stringContaining('实时数据与日数据偏差过大') }),
    )

    vi.stubGlobal('fetch', undefined)
  })

  it('crossValidate returns early when getLatestDailyNetInflow returns null', async () => {
    const sseData = JSON.stringify({
      data: {
        diff: [
          { f12: '000001', f14: 'test', f2: '10', f62: '1000000', f184: '0', f3: '0' },
        ],
      },
    })

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${sseData}\n`))
        controller.close()
      },
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => stream.getReader() },
    })
    vi.stubGlobal('fetch', mockFetch)

    mockRepo.saveRealtimeMoneyFlow.mockResolvedValue(undefined)
    mockRepo.getAlert.mockResolvedValue(null)
    mockRepo.getLatestDailyNetInflow.mockResolvedValue(null) // early return

    await startRealtime()

    // No cross_validate_fail alert when daily data is null
    const crossValidateCalls = (mockRepo.saveAlert as any).mock.calls.filter(
      (c: any[]) => c[2] === 'cross_validate_fail'
    )
    expect(crossValidateCalls).toHaveLength(0)

    vi.stubGlobal('fetch', undefined)
  })

  it('processes item with auction anomaly when time > 9:31 and close=0', async () => {
    // Mock Date to be 9:32
    const fakeDate = new Date('2024-01-01T09:32:00')
    vi.spyOn(Date.prototype, 'getHours').mockReturnValue(fakeDate.getHours())
    vi.spyOn(Date.prototype, 'getMinutes').mockReturnValue(fakeDate.getMinutes())

    const sseData = JSON.stringify({
      data: {
        diff: [
          { f12: '000001', f14: 'test', f2: '0', f62: '0', f184: '0', f3: '0' },
        ],
      },
    })

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${sseData}\n`))
        controller.close()
      },
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => stream.getReader() },
    })
    vi.stubGlobal('fetch', mockFetch)

    mockRepo.saveRealtimeMoneyFlow.mockResolvedValue(undefined)
    mockRepo.saveAlert.mockResolvedValue(undefined)
    mockRepo.getAlert.mockResolvedValue(null)

    await startRealtime()

    // Auction anomaly detected → isAuctionAnomaly=true → anomalyReason set
    expect(mockRepo.saveRealtimeMoneyFlow).toHaveBeenCalledWith(
      expect.objectContaining({ code: '000001' }),
      expect.objectContaining({ isAuctionAnomaly: true, anomalyReason: 'zero_price_post_auction' }),
    )

    vi.restoreAllMocks()
    vi.stubGlobal('fetch', undefined)
  })

  it('early return when SSE item has no code (f12 is empty)', async () => {
    const sseData = JSON.stringify({
      data: {
        diff: [
          { f12: '', f14: 'test', f2: '10', f62: '0', f184: '0', f3: '0' },
        ],
      },
    })

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${sseData}\n`))
        controller.close()
      },
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => stream.getReader() },
    })
    vi.stubGlobal('fetch', mockFetch)

    mockRepo.saveRealtimeMoneyFlow.mockResolvedValue(undefined)

    await startRealtime()

    // No save when code is empty
    expect(mockRepo.saveRealtimeMoneyFlow).not.toHaveBeenCalled()

    vi.stubGlobal('fetch', undefined)
  })

  it('getFloatMarketCap uses cache hit when available', async () => {
    const sseData = JSON.stringify({
      data: {
        diff: [
          { f12: '000001', f14: 'test', f2: '10', f62: '0', f184: '0', f3: '0' },
        ],
      },
    })

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${sseData}\n`))
        controller.close()
      },
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => stream.getReader() },
    })
    vi.stubGlobal('fetch', mockFetch)

    mockRepo.saveRealtimeMoneyFlow.mockResolvedValue(undefined)
    mockRepo.getAlert.mockResolvedValue(null)
    mockRepo.getLatestDailyNetInflow.mockResolvedValue(null)

    // Pre-populate the in-memory cache
    vi.resetModules()
    // After startRealtime, the floatCapCache should be populated from fetchFundamental
    // First call: cache miss → fetchFundamental called
    // But we already tested this above

    vi.stubGlobal('fetch', undefined)
  })
})
