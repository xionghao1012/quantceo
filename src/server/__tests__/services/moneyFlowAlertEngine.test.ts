import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  startAlertEngine,
  stopAlertEngine,
  createAlertConfig,
  listAlertConfigs,
  deleteAlertConfig,
  toggleAlertConfig,
} from '../../services/moneyFlowAlertEngine.js'

// ---------------------------------------------------------------------------
// Fake timers must be installed inside a test hook, and with an explicit
// toFake list: vitest 5's default set also fakes queueMicrotask/nextTick,
// which deadlocks the runner (hooks never settle).
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// vi.hoisted captures refs at the same hoisting level as vi.mock —
// this is the ONLY way to share live vi.fn() refs with vi.mock factories.
// ---------------------------------------------------------------------------
const { broadcastFn, redisExistsFn, redisSetexFn, shouldBlockAlertFn, LazyIndicatorsFn, mockAlertRepo } = vi.hoisted(() => ({
  broadcastFn: vi.fn(),
  redisExistsFn: vi.fn().mockResolvedValue(0),
  redisSetexFn: vi.fn().mockResolvedValue('OK'),
  shouldBlockAlertFn: vi.fn().mockResolvedValue({ blocked: false, reasons: [] }),
  // Mock indicators: MACD values chosen so cross check returns false
  // (no prevMacd <= prevSignal with currMacd > currSignal)
  // MA values also chosen so no golden cross
  LazyIndicatorsFn: vi.fn().mockImplementation(() => ({
    macd: { macd: [3, 2, 1.5], signal: [2, 1.8, 1.5], histogram: [1, 0.2, 0] },
    mas: { MA5: [11, 10.9, 10.8], MA20: [10.5, 10.6, 10.7] },
  })),
  // Stable object reference — never reassigned, only mutated by resetMockRepo
  mockAlertRepo: {
    getEnabledConfigs: vi.fn().mockResolvedValue([]),
    createAlertConfig: vi.fn().mockResolvedValue(1),
    listAlertConfigs: vi.fn().mockResolvedValue([]),
    deleteAlertConfig: vi.fn().mockResolvedValue(true),
    toggleAlertConfig: vi.fn().mockResolvedValue(true),
    getRecentRealtimeData: vi.fn().mockResolvedValue([]),
    isST: vi.fn().mockResolvedValue(false),
    isLimitUp: vi.fn().mockResolvedValue(false),
    getKlinesForTech: vi.fn().mockResolvedValue([]),
    saveAlert: vi.fn().mockResolvedValue(undefined),
  },
}))

function resetMockRepo(overrides: Record<string, any> = {}) {
  mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue(overrides.getEnabledConfigs ?? [])
  mockAlertRepo.createAlertConfig = vi.fn().mockResolvedValue(1)
  mockAlertRepo.listAlertConfigs = vi.fn().mockResolvedValue(overrides.listAlertConfigs ?? [])
  mockAlertRepo.deleteAlertConfig = vi.fn().mockResolvedValue(true)
  mockAlertRepo.toggleAlertConfig = vi.fn().mockResolvedValue(true)
  mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue(overrides.getRecentRealtimeData ?? [])
  mockAlertRepo.isST = vi.fn().mockResolvedValue(overrides.isST ?? false)
  mockAlertRepo.isLimitUp = vi.fn().mockResolvedValue(overrides.isLimitUp ?? false)
  mockAlertRepo.getKlinesForTech = vi.fn().mockResolvedValue(overrides.getKlinesForTech ?? [])
  mockAlertRepo.saveAlert = vi.fn().mockResolvedValue(undefined)
}

vi.mock('../../services/wsServer.js', () => ({ broadcast: broadcastFn }))
vi.mock('../../data/redis.js', () => ({ redis: { exists: redisExistsFn, setex: redisSetexFn } }))
vi.mock('../../services/smartFilters.js', () => ({ shouldBlockAlert: shouldBlockAlertFn }))
vi.mock('../../indicators/index.js', () => ({ LazyIndicators: LazyIndicatorsFn }))
vi.mock('../../repositories/IMoneyFlowAlertRepository.js', () => ({
  getMoneyFlowAlertRepository: () => mockAlertRepo,
  setMoneyFlowAlertRepository: () => {},
}))

// ---------------------------------------------------------------------------
// CRUD tests
// ---------------------------------------------------------------------------
describe('Alert config CRUD', () => {
  beforeEach(() => {
    resetMockRepo()
    vi.clearAllMocks()
    broadcastFn.mockReset()
    redisExistsFn.mockResolvedValue(0)
    redisSetexFn.mockResolvedValue('OK')
    shouldBlockAlertFn.mockResolvedValue({ blocked: false, reasons: [] })
  })

  afterEach(() => {
    stopAlertEngine()
  })

  describe('createAlertConfig', () => {
    it('creates a config and returns its id', async () => {
      mockAlertRepo.createAlertConfig = vi.fn().mockResolvedValue(42)
      const id = await createAlertConfig(1, {
        thresholdType: 'absolute',
        thresholdValue: 1_000_000,
        direction: 'inflow',
      })
      expect(id).toBe(42)
      expect(mockAlertRepo.createAlertConfig).toHaveBeenCalledWith(1, expect.objectContaining({
        thresholdType: 'absolute',
        thresholdValue: 1_000_000,
      }))
    })

    it('passes optional fields through', async () => {
      mockAlertRepo.createAlertConfig = vi.fn().mockResolvedValue(7)
      await createAlertConfig(1, {
        code: '600000',
        name: '浦发银行',
        thresholdType: 'relative',
        thresholdValue: 5.0,
        direction: 'outflow',
        techResonanceEnabled: true,
        techResonanceMacd: true,
        basicFilterEnabled: false,
      })
      expect(mockAlertRepo.createAlertConfig).toHaveBeenCalledWith(1, expect.objectContaining({
        code: '600000',
        techResonanceMacd: true,
        basicFilterEnabled: false,
      }))
    })
  })

  describe('listAlertConfigs', () => {
    it('returns configs from repo', async () => {
      const configs = [
        { id: 1, userId: 1, code: null as any, name: null as any, enabled: true, thresholdType: 'absolute', thresholdValue: '1000000', direction: 'inflow', techResonanceEnabled: false, techResonanceMacd: false, techResonanceMa: false, basicFilterEnabled: true, smartFilterEnabled: false, createdAt: new Date() },
      ]
      mockAlertRepo.listAlertConfigs = vi.fn().mockResolvedValue(configs)
      const result = await listAlertConfigs(1)
      expect(result).toBe(configs)
      expect(mockAlertRepo.listAlertConfigs).toHaveBeenCalledWith(1)
    })
  })

  describe('deleteAlertConfig', () => {
    it('returns true when deleted', async () => {
      mockAlertRepo.deleteAlertConfig = vi.fn().mockResolvedValue(true)
      const result = await deleteAlertConfig(1, 5)
      expect(result).toBe(true)
      expect(mockAlertRepo.deleteAlertConfig).toHaveBeenCalledWith(1, 5)
    })

    it('returns false when not found', async () => {
      mockAlertRepo.deleteAlertConfig = vi.fn().mockResolvedValue(false)
      const result = await deleteAlertConfig(1, 999)
      expect(result).toBe(false)
    })
  })

  describe('toggleAlertConfig', () => {
    it('calls repo toggle and returns result', async () => {
      mockAlertRepo.toggleAlertConfig = vi.fn().mockResolvedValue(true)
      const result = await toggleAlertConfig(1, 3, false)
      expect(result).toBe(true)
      expect(mockAlertRepo.toggleAlertConfig).toHaveBeenCalledWith(1, 3, false)
    })
  })
})

// ---------------------------------------------------------------------------
// startAlertEngine / stopAlertEngine
// ---------------------------------------------------------------------------
describe('startAlertEngine / stopAlertEngine', () => {
  beforeEach(() => {
    resetMockRepo()
    vi.clearAllMocks()
    broadcastFn.mockReset()
  })

  afterEach(() => {
    stopAlertEngine()
  })

  it('starts without error', async () => {
    await expect(startAlertEngine()).resolves.toBeUndefined()
  })

  it('is idempotent (calling start twice is no-op)', async () => {
    await startAlertEngine()
    await startAlertEngine()
  })

  it('stops without error', () => {
    stopAlertEngine()
  })

  it('does not call getEnabledConfigs before first interval', async () => {
    await startAlertEngine()
    expect(mockAlertRepo.getEnabledConfigs).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // NEW: time window coverage — outside 9:30–15:00
  // ---------------------------------------------------------------------------
  it('skip alert check outside trading hours (before 9:30)', async () => {
    resetMockRepo({ getEnabledConfigs: [], getRecentRealtimeData: [] })

    await startAlertEngine()
    // Advance to 09:29
    const fakeNow = new Date('2026-01-05T09:29:00')
    vi.setSystemTime(fakeNow)
    await vi.advanceTimersByTimeAsync(31_000)

    expect(mockAlertRepo.getEnabledConfigs).not.toHaveBeenCalled()
  })

  it('skip alert check outside trading hours (after 15:00)', async () => {
    resetMockRepo({ getEnabledConfigs: [], getRecentRealtimeData: [] })

    await startAlertEngine()
    // Advance to 15:01
    const fakeNow = new Date('2026-01-05T15:01:00')
    vi.setSystemTime(fakeNow)
    await vi.advanceTimersByTimeAsync(31_000)

    expect(mockAlertRepo.getEnabledConfigs).not.toHaveBeenCalled()
  })

  it('processes alerts during trading hours (10:00)', async () => {
    resetMockRepo({
      getEnabledConfigs: [
        {
          id: 1, userId: 1, code: null as any, name: null as any, enabled: true,
          thresholdType: 'absolute', thresholdValue: '5000000', direction: 'inflow',
          techResonanceEnabled: false, techResonanceMacd: false, techResonanceMa: false,
          basicFilterEnabled: false, smartFilterEnabled: false, createdAt: new Date(),
        },
      ],
      getRecentRealtimeData: [
        { code: '600000', name: '浦发', netInflowMain: 2_000_000, netInflowMainPct: 5, closePrice: 11.0, updateTime: new Date() },
      ],
    })

    await startAlertEngine()
    // Advance to 10:00 inside trading window
    const fakeNow = new Date('2026-01-05T10:00:00')
    vi.setSystemTime(fakeNow)
    await vi.advanceTimersByTimeAsync(31_000)

    // Below threshold (2M < 5M), no broadcast
    expect(broadcastFn).not.toHaveBeenCalled()
  })

  it('early return when no configs enabled', async () => {
    resetMockRepo({ getEnabledConfigs: [], getRecentRealtimeData: [] })

    await startAlertEngine()
    const fakeNow = new Date('2026-01-05T10:00:00')
    vi.setSystemTime(fakeNow)
    await vi.advanceTimersByTimeAsync(31_000)

    expect(mockAlertRepo.getRecentRealtimeData).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// basicFilter: isST / isLimitUp
// ---------------------------------------------------------------------------
describe('basicFilter: isST / isLimitUp', () => {
  beforeEach(() => {
    resetMockRepo()
    vi.clearAllMocks()
    broadcastFn.mockReset()
    redisExistsFn.mockResolvedValue(0)
    redisSetexFn.mockResolvedValue('OK')
  })

  afterEach(() => {
    stopAlertEngine()
  })

  const baseConfig = (overrides = {}): any => ({
    id: 1, userId: 1, code: null as any, name: null as any, enabled: true,
    thresholdType: 'absolute', thresholdValue: '1000000', direction: 'inflow',
    techResonanceEnabled: false, techResonanceMacd: false, techResonanceMa: false,
    basicFilterEnabled: true, smartFilterEnabled: false, createdAt: new Date(),
    ...overrides,
  })

  const realtimeRow = (): any => ({
    code: '600000',
    name: '浦发银行',
    netInflowMain: 2_000_000,
    netInflowMainPct: 5,
    closePrice: 11.0,
    updateTime: new Date(),
  })

  it('isST returning true → no broadcast (basicFilterEnabled=true)', async () => {
    mockAlertRepo.isST = vi.fn().mockResolvedValue(true)
    mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue([baseConfig()])
    mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue([realtimeRow()])

    await startAlertEngine()
    vi.setSystemTime(new Date('2026-01-05T10:00:00'))
    await vi.advanceTimersByTimeAsync(31_000)

    expect(broadcastFn).not.toHaveBeenCalled()
  })

  it('isLimitUp returning true → no broadcast (basicFilterEnabled=true)', async () => {
    mockAlertRepo.isST = vi.fn().mockResolvedValue(false)
    mockAlertRepo.isLimitUp = vi.fn().mockResolvedValue(true)
    mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue([baseConfig()])
    mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue([realtimeRow()])

    await startAlertEngine()
    vi.setSystemTime(new Date('2026-01-05T10:00:00'))
    await vi.advanceTimersByTimeAsync(31_000)

    expect(broadcastFn).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // NEW: basicFilterEnabled=false bypasses isST/isLimitUp
  // ---------------------------------------------------------------------------
  it('basicFilterEnabled=false bypasses isST/isLimitUp → broadcast fires when threshold met', async () => {
    mockAlertRepo.isST = vi.fn().mockResolvedValue(true)
    mockAlertRepo.isLimitUp = vi.fn().mockResolvedValue(true)
    mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue([baseConfig({ basicFilterEnabled: false })])
    mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue([realtimeRow()])
    redisExistsFn.mockResolvedValue(0)

    await startAlertEngine()
    vi.setSystemTime(new Date('2026-01-05T10:00:00'))
    await vi.advanceTimersByTimeAsync(31_000)

    // thresholdValue=1_000_000, rt=2_000_000 → triggers
    expect(broadcastFn).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// techResonance
// ---------------------------------------------------------------------------
describe('techResonance', () => {
  beforeEach(() => {
    resetMockRepo()
    vi.clearAllMocks()
    broadcastFn.mockReset()
    redisExistsFn.mockResolvedValue(0)
    redisSetexFn.mockResolvedValue('OK')
  })

  afterEach(() => {
    stopAlertEngine()
  })

  const baseConfig = (overrides = {}): any => ({
    id: 1, userId: 1, code: null as any, name: null as any, enabled: true,
    thresholdType: 'absolute', thresholdValue: '1000000', direction: 'inflow',
    techResonanceEnabled: false, techResonanceMacd: false, techResonanceMa: false,
    basicFilterEnabled: false, smartFilterEnabled: false, createdAt: new Date(),
    ...overrides,
  })

  const realtimeRow = (): any => ({
    code: '600000',
    name: '浦发银行',
    netInflowMain: 2_000_000,
    netInflowMainPct: 5,
    closePrice: 11.0,
    updateTime: new Date(),
  })

  it('techResonanceEnabled=false skips getKlinesForTech call', async () => {
    mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue([baseConfig({ techResonanceEnabled: false })])
    mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue([realtimeRow()])
    mockAlertRepo.getKlinesForTech = vi.fn().mockResolvedValue([])

    await startAlertEngine()
    vi.setSystemTime(new Date('2026-01-05T10:00:00'))
    await vi.advanceTimersByTimeAsync(31_000)

    expect(mockAlertRepo.getKlinesForTech).not.toHaveBeenCalled()
  })

  it('getKlinesForTech < 30 klines → tech check passes → broadcast fires', async () => {
    mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue([
      baseConfig({ techResonanceEnabled: true, techResonanceMacd: true }),
    ])
    mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue([realtimeRow()])
    mockAlertRepo.getKlinesForTech = vi.fn().mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        code: '600000', date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        open: 10, high: 11, low: 9, close: 10 + i * 0.1, volume: 1000, amount: 10000,
      }))
    )
    redisExistsFn.mockResolvedValue(0)

    await startAlertEngine()
    vi.setSystemTime(new Date('2026-01-05T10:00:00'))
    await vi.advanceTimersByTimeAsync(31_000)

    expect(broadcastFn).toHaveBeenCalled()
  })

  it('getKlinesForTech ≥ 30 klines → getKlinesForTech is called with correct args', async () => {
    mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue([
      baseConfig({ techResonanceEnabled: true, techResonanceMacd: true }),
    ])
    mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue([realtimeRow()])
    // Return empty → checkTechResonance returns true immediately (catch path)
    mockAlertRepo.getKlinesForTech = vi.fn().mockResolvedValue([])
    redisExistsFn.mockResolvedValue(0)

    await startAlertEngine()
    vi.setSystemTime(new Date('2026-01-05T10:00:00'))
    await vi.advanceTimersByTimeAsync(31_000)

    expect(mockAlertRepo.getKlinesForTech).toHaveBeenCalledWith('600000', 90)
    expect(broadcastFn).toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // NEW: techResonance MACD golden cross triggers
  // ---------------------------------------------------------------------------
  it('techResonance MACD golden cross → passes → broadcast fires', async () => {
    // Override LazyIndicators mock to return MACD values that trigger golden cross:
    // prevMacd(0) <= prevSignal(0) && currMacd(1) > currSignal(0.5)
    LazyIndicatorsFn.mockReturnValueOnce({
      macd: { macd: [0, 1], signal: [0, 0.5], histogram: [0, 0.5] },
      mas: { MA5: [10, 11], MA20: [10, 10] },
    })

    mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue([
      baseConfig({ techResonanceEnabled: true, techResonanceMacd: true }),
    ])
    mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue([realtimeRow()])
    mockAlertRepo.getKlinesForTech = vi.fn().mockResolvedValue(
      Array.from({ length: 35 }, (_, i) => ({
        code: '600000', date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        open: 10, high: 11, low: 9, close: 10 + i * 0.1, volume: 1000, amount: 10000,
      }))
    )
    redisExistsFn.mockResolvedValue(0)

    await startAlertEngine()
    vi.setSystemTime(new Date('2026-01-05T10:00:00'))
    await vi.advanceTimersByTimeAsync(31_000)

    expect(broadcastFn).toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // NEW: techResonance checkTechResonance catch → returns true (passes)
  // ---------------------------------------------------------------------------
  it('checkTechResonance throws → returns true (passes filter)', async () => {
    mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue([
      baseConfig({ techResonanceEnabled: true, techResonanceMacd: true }),
    ])
    mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue([realtimeRow()])
    mockAlertRepo.getKlinesForTech = vi.fn().mockRejectedValue(new Error('klines error'))
    redisExistsFn.mockResolvedValue(0)

    await startAlertEngine()
    vi.setSystemTime(new Date('2026-01-05T10:00:00'))
    await vi.advanceTimersByTimeAsync(31_000)

    // Error → returns true → continues to broadcast
    expect(broadcastFn).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// smartFilter blocking
// ---------------------------------------------------------------------------
describe('smartFilter blocking', () => {
  beforeEach(() => {
    resetMockRepo()
    vi.clearAllMocks()
    broadcastFn.mockReset()
    redisExistsFn.mockResolvedValue(0)
    redisSetexFn.mockResolvedValue('OK')
    shouldBlockAlertFn.mockResolvedValue({ blocked: false, reasons: [] })
  })

  afterEach(() => {
    stopAlertEngine()
  })

  it('smartFilter blocks → no broadcast', async () => {
    shouldBlockAlertFn.mockResolvedValue({ blocked: true, reasons: ['high_volatility'] })

    mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue([
      {
        id: 1, userId: 1, code: null as any, name: null as any, enabled: true,
        thresholdType: 'absolute', thresholdValue: '1000000', direction: 'inflow',
        techResonanceEnabled: false, techResonanceMacd: false, techResonanceMa: false,
        basicFilterEnabled: false, smartFilterEnabled: true, createdAt: new Date(),
      },
    ])
    mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue([
      {
        code: '600000', name: '浦发银行',
        netInflowMain: 2_000_000, netInflowMainPct: 5, closePrice: 11.0, updateTime: new Date(),
      },
    ])

    await startAlertEngine()
    vi.setSystemTime(new Date('2026-01-05T10:00:00'))
    await vi.advanceTimersByTimeAsync(31_000)

    expect(broadcastFn).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // NEW: smartFilter error → alert skipped (error propagates to interval catch)
  // ---------------------------------------------------------------------------
  it('smartFilter throws → alert not broadcast (error swallowed by interval catch)', async () => {
    shouldBlockAlertFn.mockRejectedValue(new Error('smart filter error'))
    redisExistsFn.mockResolvedValue(0)

    mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue([
      {
        id: 1, userId: 1, code: null as any, name: null as any, enabled: true,
        thresholdType: 'absolute', thresholdValue: '1000000', direction: 'inflow',
        techResonanceEnabled: false, techResonanceMacd: false, techResonanceMa: false,
        basicFilterEnabled: false, smartFilterEnabled: true, createdAt: new Date(),
      },
    ])
    mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue([
      { code: '600000', name: '浦发', netInflowMain: 2_000_000, netInflowMainPct: 5, closePrice: 11.0, updateTime: new Date() },
    ])

    await startAlertEngine()
    vi.setSystemTime(new Date('2026-01-05T10:00:00'))
    await vi.advanceTimersByTimeAsync(31_000)

    // shouldBlockAlert throws → error propagates to interval catch → no broadcast
    expect(broadcastFn).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// threshold type branches
// ---------------------------------------------------------------------------
describe('threshold type branches', () => {
  beforeEach(() => {
    resetMockRepo()
    vi.clearAllMocks()
    broadcastFn.mockReset()
    redisExistsFn.mockResolvedValue(0)
    redisSetexFn.mockResolvedValue('OK')
    shouldBlockAlertFn.mockResolvedValue({ blocked: false, reasons: [] })
  })

  afterEach(() => {
    stopAlertEngine()
  })

  it('absolute threshold triggers when effective >= thresholdValue', async () => {
    mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue([
      {
        id: 1, userId: 1, code: null as any, name: null as any, enabled: true,
        thresholdType: 'absolute', thresholdValue: '1000000', direction: 'inflow',
        techResonanceEnabled: false, techResonanceMacd: false, techResonanceMa: false,
        basicFilterEnabled: false, smartFilterEnabled: false, createdAt: new Date(),
      },
    ])
    mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue([
      { code: '600000', name: '浦发银行', netInflowMain: 2_000_000, netInflowMainPct: 5, closePrice: 11.0, updateTime: new Date() },
    ])

    await startAlertEngine()
    vi.setSystemTime(new Date('2026-01-05T10:00:00'))
    await vi.advanceTimersByTimeAsync(31_000)

    expect(broadcastFn).toHaveBeenCalled()
  })

  it('absolute threshold does NOT trigger below thresholdValue', async () => {
    mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue([
      {
        id: 1, userId: 1, code: null as any, name: null as any, enabled: true,
        thresholdType: 'absolute', thresholdValue: '5000000', direction: 'inflow',
        techResonanceEnabled: false, techResonanceMacd: false, techResonanceMa: false,
        basicFilterEnabled: false, smartFilterEnabled: false, createdAt: new Date(),
      },
    ])
    mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue([
      { code: '600000', name: '浦发银行', netInflowMain: 2_000_000, netInflowMainPct: 5, closePrice: 11.0, updateTime: new Date() },
    ])

    await startAlertEngine()
    vi.setSystemTime(new Date('2026-01-05T10:00:00'))
    await vi.advanceTimersByTimeAsync(31_000)

    expect(broadcastFn).not.toHaveBeenCalled()
  })

  it('relative threshold triggers when pct >= thresholdValue', async () => {
    mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue([
      {
        id: 1, userId: 1, code: null as any, name: null as any, enabled: true,
        thresholdType: 'relative', thresholdValue: '3.0', direction: 'inflow',
        techResonanceEnabled: false, techResonanceMacd: false, techResonanceMa: false,
        basicFilterEnabled: false, smartFilterEnabled: false, createdAt: new Date(),
      },
    ])
    mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue([
      { code: '600000', name: '浦发银行', netInflowMain: 1_000_000, netInflowMainPct: 5.0, closePrice: 11.0, updateTime: new Date() },
    ])

    await startAlertEngine()
    vi.setSystemTime(new Date('2026-01-05T10:00:00'))
    await vi.advanceTimersByTimeAsync(31_000)

    expect(broadcastFn).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// alert dedup (redis exists)
// ---------------------------------------------------------------------------
describe('alert dedup', () => {
  beforeEach(() => {
    resetMockRepo()
    vi.clearAllMocks()
    broadcastFn.mockReset()
  })

  afterEach(() => {
    stopAlertEngine()
  })

  it('duplicate alert (redis exists=1) → suppressed', async () => {
    redisExistsFn.mockResolvedValue(1)

    mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue([
      {
        id: 1, userId: 1, code: null as any, name: null as any, enabled: true,
        thresholdType: 'absolute', thresholdValue: '1000000', direction: 'inflow',
        techResonanceEnabled: false, techResonanceMacd: false, techResonanceMa: false,
        basicFilterEnabled: false, smartFilterEnabled: false, createdAt: new Date(),
      },
    ])
    mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue([
      { code: '600000', name: '浦发银行', netInflowMain: 2_000_000, netInflowMainPct: 5, closePrice: 11.0, updateTime: new Date() },
    ])

    await startAlertEngine()
    vi.setSystemTime(new Date('2026-01-05T10:00:00'))
    await vi.advanceTimersByTimeAsync(31_000)

    expect(broadcastFn).not.toHaveBeenCalled()
  })

  it('non-duplicate alert → broadcast fires + redis setex called', async () => {
    redisExistsFn.mockResolvedValue(0)

    mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue([
      {
        id: 1, userId: 1, code: null as any, name: null as any, enabled: true,
        thresholdType: 'absolute', thresholdValue: '1000000', direction: 'inflow',
        techResonanceEnabled: false, techResonanceMacd: false, techResonanceMa: false,
        basicFilterEnabled: false, smartFilterEnabled: false, createdAt: new Date(),
      },
    ])
    mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue([
      { code: '600000', name: '浦发银行', netInflowMain: 2_000_000, netInflowMainPct: 5, closePrice: 11.0, updateTime: new Date() },
    ])

    await startAlertEngine()
    vi.setSystemTime(new Date('2026-01-05T10:00:00'))
    await vi.advanceTimersByTimeAsync(31_000)

    expect(broadcastFn).toHaveBeenCalled()
    expect(redisSetexFn).toHaveBeenCalledWith(
      expect.stringContaining('mf_alert_dedup:600000:1'),
      300,
      '1',
    )
  })

  // ---------------------------------------------------------------------------
  // NEW: redis.exists throws → isDupulicated returns false → continues
  // ---------------------------------------------------------------------------
  it('redis.exists throws → isDupulicated returns false (error swallowed)', async () => {
    redisExistsFn.mockRejectedValue(new Error('redis error'))

    mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue([
      {
        id: 1, userId: 1, code: null as any, name: null as any, enabled: true,
        thresholdType: 'absolute', thresholdValue: '1000000', direction: 'inflow',
        techResonanceEnabled: false, techResonanceMacd: false, techResonanceMa: false,
        basicFilterEnabled: false, smartFilterEnabled: false, createdAt: new Date(),
      },
    ])
    mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue([
      { code: '600000', name: '浦发', netInflowMain: 2_000_000, netInflowMainPct: 5, closePrice: 11.0, updateTime: new Date() },
    ])

    await startAlertEngine()
    vi.setSystemTime(new Date('2026-01-05T10:00:00'))
    await vi.advanceTimersByTimeAsync(31_000)

    expect(broadcastFn).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// config.code filter
// ---------------------------------------------------------------------------
describe('config.code filter', () => {
  beforeEach(() => {
    resetMockRepo()
    vi.clearAllMocks()
    broadcastFn.mockReset()
    redisExistsFn.mockResolvedValue(0)
    redisSetexFn.mockResolvedValue('OK')
    shouldBlockAlertFn.mockResolvedValue({ blocked: false, reasons: [] })
  })

  afterEach(() => {
    stopAlertEngine()
  })

  it('config.code set → only matching code fires alert', async () => {
    mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue([
      {
        id: 1, userId: 1, code: '600000', name: null as any, enabled: true,
        thresholdType: 'absolute', thresholdValue: '1000000', direction: 'inflow',
        techResonanceEnabled: false, techResonanceMacd: false, techResonanceMa: false,
        basicFilterEnabled: false, smartFilterEnabled: false, createdAt: new Date(),
      },
    ])
    mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue([
      { code: '600001', name: '另一只股', netInflowMain: 2_000_000, netInflowMainPct: 5, closePrice: 11.0, updateTime: new Date() },
    ])

    await startAlertEngine()
    vi.setSystemTime(new Date('2026-01-05T10:00:00'))
    await vi.advanceTimersByTimeAsync(31_000)

    expect(broadcastFn).not.toHaveBeenCalled()
  })

  it('config.code=null → matches any code', async () => {
    mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue([
      {
        id: 1, userId: 1, code: null as any, name: null as any, enabled: true,
        thresholdType: 'absolute', thresholdValue: '1000000', direction: 'inflow',
        techResonanceEnabled: false, techResonanceMacd: false, techResonanceMa: false,
        basicFilterEnabled: false, smartFilterEnabled: false, createdAt: new Date(),
      },
    ])
    mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue([
      { code: '600001', name: '某股', netInflowMain: 2_000_000, netInflowMainPct: 5, closePrice: 11.0, updateTime: new Date() },
    ])
    redisExistsFn.mockResolvedValue(0)

    await startAlertEngine()
    vi.setSystemTime(new Date('2026-01-05T10:00:00'))
    await vi.advanceTimersByTimeAsync(31_000)

    expect(broadcastFn).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// pushAlert error handling (repo.saveAlert throws)
// ---------------------------------------------------------------------------
describe('pushAlert error handling', () => {
  beforeEach(() => {
    resetMockRepo()
    vi.clearAllMocks()
    broadcastFn.mockReset()
    redisExistsFn.mockResolvedValue(0)
    redisSetexFn.mockResolvedValue('OK')
    shouldBlockAlertFn.mockResolvedValue({ blocked: false, reasons: [] })
  })

  afterEach(() => {
    stopAlertEngine()
  })

  it('pushAlert saveAlert error is swallowed', async () => {
    mockAlertRepo.saveAlert = vi.fn().mockRejectedValue(new Error('save error'))

    mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue([
      {
        id: 1, userId: 1, code: null as any, name: null as any, enabled: true,
        thresholdType: 'absolute', thresholdValue: '1000000', direction: 'inflow',
        techResonanceEnabled: false, techResonanceMacd: false, techResonanceMa: false,
        basicFilterEnabled: false, smartFilterEnabled: false, createdAt: new Date(),
      },
    ])
    mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue([
      { code: '600000', name: '浦发', netInflowMain: 2_000_000, netInflowMainPct: 5, closePrice: 11.0, updateTime: new Date() },
    ])
    redisExistsFn.mockResolvedValue(0)

    await startAlertEngine()
    vi.setSystemTime(new Date('2026-01-05T10:00:00'))
    await vi.advanceTimersByTimeAsync(31_000)

    // broadcast still fires even if saveAlert fails
    expect(broadcastFn).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// config.enabled = false
// ---------------------------------------------------------------------------
describe('config.enabled=false', () => {
  beforeEach(() => {
    resetMockRepo()
    vi.clearAllMocks()
    broadcastFn.mockReset()
  })

  afterEach(() => {
    stopAlertEngine()
  })

  it('skips disabled configs', async () => {
    mockAlertRepo.getEnabledConfigs = vi.fn().mockResolvedValue([
      {
        id: 1, userId: 1, code: null as any, name: null as any, enabled: false,
        thresholdType: 'absolute', thresholdValue: '1000000', direction: 'inflow',
        techResonanceEnabled: false, techResonanceMacd: false, techResonanceMa: false,
        basicFilterEnabled: false, smartFilterEnabled: false, createdAt: new Date(),
      },
    ])
    mockAlertRepo.getRecentRealtimeData = vi.fn().mockResolvedValue([
      { code: '600000', name: '浦发', netInflowMain: 2_000_000, netInflowMainPct: 5, closePrice: 11.0, updateTime: new Date() },
    ])

    await startAlertEngine()
    vi.setSystemTime(new Date('2026-01-05T10:00:00'))
    await vi.advanceTimersByTimeAsync(31_000)

    expect(broadcastFn).not.toHaveBeenCalled()
  })
})
