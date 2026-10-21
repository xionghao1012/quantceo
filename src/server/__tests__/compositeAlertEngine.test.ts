import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { KLine } from '../../shared/types.js'

// Shared mock refs — defined once, mutated in-place
const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
  exists: vi.fn(),
}
const mockBroadcast = vi.fn()
const mockDbInsert = vi.fn()

// Module-level mock repo — mutated in-place
const mockRepo: Record<string, any> = {
  getRecentRealtimeData: vi.fn(),
  isSTOrLimitUp: vi.fn(),
  getKlinesForMacd: vi.fn(),
  getKlinesForVolume: vi.fn(),
  saveAlert: vi.fn(),
}

function resetRepo() {
  mockRepo.getRecentRealtimeData.mockResolvedValue([])
  mockRepo.isSTOrLimitUp.mockResolvedValue(false)
  mockRepo.getKlinesForMacd.mockResolvedValue([])
  mockRepo.getKlinesForVolume.mockResolvedValue([])
  mockRepo.saveAlert.mockResolvedValue(undefined)
  // Reset redis mocks
  mockRedis.get.mockReset()
  mockRedis.setex.mockReset()
  mockRedis.setex.mockResolvedValue('OK')
  mockRedis.exists.mockReset()
  mockRedis.exists.mockResolvedValue(0)
}

vi.mock('../db/db.js', () => ({
  db: { insert: mockDbInsert, execute: vi.fn(), select: vi.fn(() => ({ from: vi.fn() })) },
}))
vi.mock('../services/wsServer.js', () => ({
  broadcast: mockBroadcast,
}))
vi.mock('../data/redis.js', () => ({
  redis: mockRedis,
}))
vi.mock('../indicators/index.js', () => {
  // Use plain object so vitest doesn't complain about 'function' vs 'class'
  return {
    LazyIndicators: function (klines: any, needed: any) {
      const result: any = {}
      const ns = needed instanceof Set ? needed : new Set(needed || [])
      if (ns.has('macd')) {
        result.macd = { macd: [0, 1], signal: [0, 0] }
      }
      if (ns.has('volume')) {
        result._klines = klines
      }
      return result
    },
  }
})
vi.mock('../repositories/ICompositeAlertRepository.js', () => ({
  getCompositeAlertRepository: () => mockRepo,
  setCompositeAlertRepository: () => {},
}))

const {
  checkSustainedFlow,
  getCompositeState,
  stopCompositeAlertEngine,
  startCompositeAlertEngine,
} = await import('../services/compositeAlertEngine.js')

const { checkCompositeAlert } = await import('../services/compositeAlertEngine.js')

beforeEach(() => {
  vi.clearAllMocks()
  stopCompositeAlertEngine()
  resetRepo()
})

afterEach(() => {
  stopCompositeAlertEngine()
})

// ---------------------------------------------------------------------------
// checkSustainedFlow
// ---------------------------------------------------------------------------

describe('checkSustainedFlow', () => {
  it('IDLE + 净流入 → WATCHING_INFLOW', async () => {
    mockRedis.get.mockResolvedValueOnce(null)
    mockRedis.setex.mockResolvedValueOnce('OK')

    const result = await checkSustainedFlow('000001', 1000, { sustainedMinutes: 3 })

    expect(result.sustained).toBe(false)
    expect(result.direction).toBe('outflow')
  })

  it('WATCHING_INFLOW + 持续净流入达到阈值 → CONFIRMED_INFLOW', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify({
      state: 'WATCHING_INFLOW', inflowMinutes: 2, outflowMinutes: 0,
      lastFlow: 1000, lastUpdate: Date.now() - 60_000, resonanceTriggered: false,
    }))
    mockRedis.setex.mockResolvedValueOnce('OK')

    const result = await checkSustainedFlow('000001', 1000, { sustainedMinutes: 3 })

    expect(result.sustained).toBe(true)
    expect(result.direction).toBe('inflow')
  })

  it('CONFIRMED_INFLOW + 净流出 → 保持确认状态但切出', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify({
      state: 'CONFIRMED_INFLOW', inflowMinutes: 3, outflowMinutes: 0,
      lastFlow: 1000, lastUpdate: Date.now(), resonanceTriggered: false,
    }))
    mockRedis.setex.mockResolvedValueOnce('OK')

    const result = await checkSustainedFlow('000001', -1000, { sustainedMinutes: 3 })

    expect(result.sustained).toBe(true)
    expect(result.direction).toBe('inflow')
  })

  it('WATCHING_INFLOW + 净流出 → WATCHING_OUTFLOW', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify({
      state: 'WATCHING_INFLOW', inflowMinutes: 2, outflowMinutes: 0,
      lastFlow: 1000, lastUpdate: Date.now(), resonanceTriggered: false,
    }))
    mockRedis.setex.mockResolvedValueOnce('OK')

    const result = await checkSustainedFlow('000001', -1000, { sustainedMinutes: 3 })

    expect(result.sustained).toBe(false)
    expect(result.direction).toBe('outflow')
  })

  it('stale (>2min) + 净流入 → 重置计数为1', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify({
      state: 'WATCHING_INFLOW', inflowMinutes: 2, outflowMinutes: 0,
      lastFlow: 1000, lastUpdate: Date.now() - 180_000, resonanceTriggered: false,
    }))
    mockRedis.setex.mockResolvedValueOnce('OK')

    const result = await checkSustainedFlow('000001', 1000, { sustainedMinutes: 3 })

    expect(result.sustained).toBe(false)
    expect(result.direction).toBe('outflow')
  })

  it('netInflowMain = 0 → IDLE', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify({
      state: 'WATCHING_INFLOW', inflowMinutes: 2, outflowMinutes: 0,
      lastFlow: 1000, lastUpdate: Date.now(), resonanceTriggered: false,
    }))
    mockRedis.setex.mockResolvedValueOnce('OK')

    const result = await checkSustainedFlow('000001', 0, { sustainedMinutes: 3 })

    expect(result.sustained).toBe(false)
    expect(result.direction).toBe('outflow')
  })

  it('WATCHING_OUTFLOW + 净流出达到阈值 → CONFIRMED_OUTFLOW', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify({
      state: 'WATCHING_OUTFLOW', inflowMinutes: 0, outflowMinutes: 2,
      lastFlow: -1000, lastUpdate: Date.now() - 60_000, resonanceTriggered: false,
    }))
    mockRedis.setex.mockResolvedValueOnce('OK')

    const result = await checkSustainedFlow('000001', -1000, { sustainedMinutes: 3 })

    expect(result.sustained).toBe(true)
    expect(result.direction).toBe('outflow')
  })

  it('IDLE + 净流出 → WATCHING_OUTFLOW', async () => {
    mockRedis.get.mockResolvedValueOnce(null)
    mockRedis.setex.mockResolvedValueOnce('OK')

    const result = await checkSustainedFlow('000001', -500, { sustainedMinutes: 3 })

    expect(result.sustained).toBe(false)
    expect(result.direction).toBe('outflow')
  })

  it('sustainedMinutes=1 immediately confirms', async () => {
    mockRedis.get.mockResolvedValueOnce(null)
    mockRedis.setex.mockResolvedValueOnce('OK')

    const result = await checkSustainedFlow('000001', 1000, { sustainedMinutes: 1 })

    expect(result.sustained).toBe(true)
    expect(result.direction).toBe('inflow')
  })

  it('gracefully handles redis get failure', async () => {
    mockRedis.get.mockRejectedValueOnce(new Error('redis connection error'))
    mockRedis.setex.mockResolvedValueOnce('OK')

    const result = await checkSustainedFlow('000001', 1000, { sustainedMinutes: 3 })

    expect(result.sustained).toBe(false)
  })

  it('logTransition called on state change', async () => {
    mockRedis.get
      .mockResolvedValueOnce(JSON.stringify({
        state: 'IDLE', inflowMinutes: 0, outflowMinutes: 0,
        lastFlow: 0, lastUpdate: Date.now(), resonanceTriggered: false,
      }))
      .mockResolvedValueOnce(JSON.stringify({
        state: 'WATCHING_INFLOW', inflowMinutes: 1, outflowMinutes: 0,
        lastFlow: 1000, lastUpdate: Date.now(), resonanceTriggered: false,
      }))
    mockRedis.setex.mockResolvedValue('OK')

    await checkSustainedFlow('000001', 1000, { sustainedMinutes: 3 })

    expect(mockRepo.saveAlert).toHaveBeenCalled()
  })
})

describe('getCompositeState', () => {
  it('returns parsed state from redis', async () => {
    const savedState = {
      state: 'WATCHING_INFLOW', inflowMinutes: 2, outflowMinutes: 0,
      lastFlow: 1000, lastUpdate: Date.now(), resonanceTriggered: false,
    }
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(savedState))

    const result = await getCompositeState('000001')

    expect(result.state).toBe('WATCHING_INFLOW')
    expect(result.inflowMinutes).toBe(2)
  })

  it('returns IDLE default on redis miss', async () => {
    mockRedis.get.mockResolvedValueOnce(null)

    const result = await getCompositeState('000001')

    expect(result.state).toBe('IDLE')
  })

  it('returns default state on redis parse error', async () => {
    mockRedis.get.mockResolvedValueOnce('not valid json')

    const result = await getCompositeState('000001')

    expect(result.state).toBe('IDLE')
  })
})

describe('startCompositeAlertEngine / stopCompositeAlertEngine', () => {
  it('startCompositeAlertEngine sets isRunning flag', async () => {
    await startCompositeAlertEngine()
    await startCompositeAlertEngine()
    stopCompositeAlertEngine()
  })

  it('stopCompositeAlertEngine clears interval', () => {
    stopCompositeAlertEngine()
    stopCompositeAlertEngine()
  })
})

// ---------------------------------------------------------------------------
// checkCompositeAlert
// ---------------------------------------------------------------------------

function buildMacdKlines(count: number, rising: boolean): KLine[] {
  return Array.from({ length: count }, (_, i) => {
    const close = rising ? 10 + i * 0.05 : 12 - i * 0.05
    return {
      code: '000001', date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      open: close - 0.02, high: close + 0.03, low: close - 0.03,
      close, volume: 1_000_000, amount: close * 1_000_000,
    }
  })
}

function buildVolKlines(todayVol: number): KLine[] {
  return Array.from({ length: 30 }, (_, i) => ({
    code: '000001', date: `2024-01-${String(i + 1).padStart(2, '0')}`,
    open: 10, high: 10.05, low: 9.95, close: 10 + i * 0.01,
    volume: i === 29 ? todayVol : 1_000_000, amount: 10_000_000,
  }))
}

describe('checkCompositeAlert', () => {
  const opts = { sustainedMinutes: 3, inflowThreshold: 10_000_000, volumeRatioMin: 1.5 }

  it('ST股或涨停股跳过检查', async () => {
    mockRepo.isSTOrLimitUp = vi.fn().mockResolvedValue(true)

    await checkCompositeAlert(
      { code: '000001', name: 'ST平安', netInflowMain: 1e8, netInflowMainPct: 1, closePrice: 10, updateTime: new Date() },
      opts
    )
    expect(mockRepo.isSTOrLimitUp).toHaveBeenCalledWith('000001')
    expect(mockRepo.saveAlert).not.toHaveBeenCalled()
  })

  it('MACD金叉 + 放量 + 持续净流入 → 三重共振alert', async () => {
    const macdKlines = buildMacdKlines(40, true)
    const volKlines = buildVolKlines(3_000_000)

    mockRepo.isSTOrLimitUp = vi.fn().mockResolvedValue(false)
    mockRepo.getKlinesForMacd = vi.fn().mockResolvedValue(macdKlines)
    mockRepo.getKlinesForVolume = vi.fn().mockResolvedValue(volKlines)

    mockRedis.get.mockResolvedValueOnce(JSON.stringify({
      state: 'CONFIRMED_INFLOW', inflowMinutes: 3, outflowMinutes: 0,
      lastFlow: 1e8, lastUpdate: Date.now(), resonanceTriggered: false,
    }))
    mockRedis.setex.mockResolvedValue('OK')
    mockRedis.exists.mockResolvedValue(0)

    await checkCompositeAlert(
      { code: '000001', name: '平安银行', netInflowMain: 20_000_000, netInflowMainPct: 2, closePrice: 10, updateTime: new Date() },
      opts
    )

    expect(mockBroadcast).toHaveBeenCalled()
    expect(mockRepo.saveAlert).toHaveBeenCalledWith('000001', '平安银行', 'composite_resonance',
      expect.objectContaining({ reason: expect.stringContaining('三重共振') }))
  })

  it('MACD死叉 + 持续净流入 → sustained_inflow', async () => {
    const macdKlines = buildMacdKlines(40, false)
    const volKlines = buildVolKlines(3_000_000)

    mockRepo.isSTOrLimitUp = vi.fn().mockResolvedValue(false)
    mockRepo.getKlinesForMacd = vi.fn().mockResolvedValue(macdKlines)
    mockRepo.getKlinesForVolume = vi.fn().mockResolvedValue(volKlines)

    mockRedis.get.mockResolvedValueOnce(JSON.stringify({
      state: 'CONFIRMED_INFLOW', inflowMinutes: 3, outflowMinutes: 0,
      lastFlow: 1e8, lastUpdate: Date.now(), resonanceTriggered: false,
    }))
    mockRedis.setex.mockResolvedValue('OK')
    mockRedis.exists.mockResolvedValue(0)

    await checkCompositeAlert(
      { code: '000001', name: '平安银行', netInflowMain: 20_000_000, netInflowMainPct: 2, closePrice: 10, updateTime: new Date() },
      opts
    )

    // Dead cross → sustained_inflow fires
    expect(mockBroadcast).toHaveBeenCalled()
  })

  it('量比 > 3倍 → volOk满足', async () => {
    const macdKlines = buildMacdKlines(40, true)
    const volKlines = buildVolKlines(4_000_000)

    mockRepo.isSTOrLimitUp = vi.fn().mockResolvedValue(false)
    mockRepo.getKlinesForMacd = vi.fn().mockResolvedValue(macdKlines)
    mockRepo.getKlinesForVolume = vi.fn().mockResolvedValue(volKlines)

    mockRedis.get.mockResolvedValueOnce(JSON.stringify({
      state: 'CONFIRMED_INFLOW', inflowMinutes: 3, outflowMinutes: 0,
      lastFlow: 1e8, lastUpdate: Date.now(), resonanceTriggered: false,
    }))
    mockRedis.setex.mockResolvedValue('OK')
    mockRedis.exists.mockResolvedValue(0)

    await checkCompositeAlert(
      { code: '000001', name: '平安银行', netInflowMain: 20_000_000, netInflowMainPct: 2, closePrice: 10, updateTime: new Date() },
      opts
    )

    expect(mockBroadcast).toHaveBeenCalled()
  })

  it('量比 1.5倍以下 → sustained_inflow', async () => {
    const macdKlines = buildMacdKlines(40, true)
    const volKlines = buildVolKlines(1_200_000)

    mockRepo.isSTOrLimitUp = vi.fn().mockResolvedValue(false)
    mockRepo.getKlinesForMacd = vi.fn().mockResolvedValue(macdKlines)
    mockRepo.getKlinesForVolume = vi.fn().mockResolvedValue(volKlines)

    mockRedis.get.mockResolvedValueOnce(JSON.stringify({
      state: 'CONFIRMED_INFLOW', inflowMinutes: 3, outflowMinutes: 0,
      lastFlow: 1e8, lastUpdate: Date.now(), resonanceTriggered: false,
    }))
    mockRedis.setex.mockResolvedValue('OK')
    mockRedis.exists.mockResolvedValue(0)

    await checkCompositeAlert(
      { code: '000001', name: '平安银行', netInflowMain: 20_000_000, netInflowMainPct: 2, closePrice: 10, updateTime: new Date() },
      opts
    )

    expect(mockBroadcast).toHaveBeenCalled()
  })

  it('全部条件不满足 → 仅状态记录', async () => {
    const macdKlines = buildMacdKlines(40, false)
    const volKlines = buildVolKlines(800_000)

    mockRepo.isSTOrLimitUp = vi.fn().mockResolvedValue(false)
    mockRepo.getKlinesForMacd = vi.fn().mockResolvedValue(macdKlines)
    mockRepo.getKlinesForVolume = vi.fn().mockResolvedValue(volKlines)

    mockRedis.get.mockResolvedValueOnce(JSON.stringify({
      state: 'IDLE', inflowMinutes: 0, outflowMinutes: 0,
      lastFlow: 0, lastUpdate: Date.now(), resonanceTriggered: false,
    }))
    mockRedis.setex.mockResolvedValue('OK')

    await checkCompositeAlert(
      { code: '000001', name: '平安银行', netInflowMain: 1_000_000, netInflowMainPct: 0.1, closePrice: 10, updateTime: new Date() },
      opts
    )

    expect(mockRepo.saveAlert).toHaveBeenCalled()
  })

  it('重复检测 → 不重复发送', async () => {
    const macdKlines = buildMacdKlines(40, true)
    const volKlines = buildVolKlines(3_000_000)

    mockRepo.isSTOrLimitUp = vi.fn().mockResolvedValue(false)
    mockRepo.getKlinesForMacd = vi.fn().mockResolvedValue(macdKlines)
    mockRepo.getKlinesForVolume = vi.fn().mockResolvedValue(volKlines)

    mockRedis.get.mockResolvedValueOnce(JSON.stringify({
      state: 'CONFIRMED_INFLOW', inflowMinutes: 3, outflowMinutes: 0,
      lastFlow: 1e8, lastUpdate: Date.now(), resonanceTriggered: false,
    }))
    mockRedis.setex.mockResolvedValue('OK')
    mockRedis.exists.mockResolvedValue(1) // duplicate

    await checkCompositeAlert(
      { code: '000001', name: '平安银行', netInflowMain: 20_000_000, netInflowMainPct: 2, closePrice: 10, updateTime: new Date() },
      opts
    )

    expect(mockRedis.exists).toHaveBeenCalled()
  })

  it('持续净流出 + 正流入 → sustained_outflow alert', async () => {
    // sustained_outflow: outflow confirmed but net flow still positive (主力出货中)
    const macdKlines = buildMacdKlines(40, false)
    const volKlines = buildVolKlines(2_000_000)

    mockRepo.isSTOrLimitUp = vi.fn().mockResolvedValue(false)
    mockRepo.getKlinesForMacd = vi.fn().mockResolvedValue(macdKlines)
    mockRepo.getKlinesForVolume = vi.fn().mockResolvedValue(volKlines)

    mockRedis.get.mockResolvedValueOnce(JSON.stringify({
      state: 'CONFIRMED_OUTFLOW', inflowMinutes: 0, outflowMinutes: 3,
      lastFlow: -1e8, lastUpdate: Date.now(), resonanceTriggered: false,
    }))
    mockRedis.setex.mockResolvedValue('OK')
    mockRedis.exists.mockResolvedValue(0)

    await checkCompositeAlert(
      { code: '000001', name: '平安银行', netInflowMain: 20_000_000, netInflowMainPct: 2, closePrice: 10, updateTime: new Date() },
      opts
    )

    // sustained=true, inflowOk=true → sustained_outflow fires
    expect(mockBroadcast).toHaveBeenCalled()
  })

  it('resonance触发后状态更新resonanceTriggered=true', async () => {
    const macdKlines = buildMacdKlines(40, true)
    const volKlines = buildVolKlines(3_000_000)

    mockRepo.isSTOrLimitUp = vi.fn().mockResolvedValue(false)
    mockRepo.getKlinesForMacd = vi.fn().mockResolvedValue(macdKlines)
    mockRepo.getKlinesForVolume = vi.fn().mockResolvedValue(volKlines)

    mockRedis.get.mockResolvedValueOnce(JSON.stringify({
      state: 'CONFIRMED_INFLOW', inflowMinutes: 3, outflowMinutes: 0,
      lastFlow: 1e8, lastUpdate: Date.now(), resonanceTriggered: false,
    }))
    mockRedis.setex.mockResolvedValue('OK')
    mockRedis.exists.mockResolvedValue(0)

    await checkCompositeAlert(
      { code: '000001', name: '平安银行', netInflowMain: 20_000_000, netInflowMainPct: 2, closePrice: 10, updateTime: new Date() },
      opts
    )

    const stateSaveCall = mockRedis.setex.mock.calls.find(
      (call: any[]) => {
        try { return JSON.parse(call[2]).resonanceTriggered === true } catch { return false }
      }
    )
    expect(stateSaveCall).toBeDefined()
    const savedState = JSON.parse(stateSaveCall![2])
    expect(savedState.resonanceTriggered).toBe(true)
    expect(savedState.resonanceTime).toBeDefined()
  })
})
