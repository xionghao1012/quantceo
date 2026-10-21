import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setMoneyFlowRepository, getMoneyFlowRepository } from '../../repositories/IMoneyFlowRepository.js'
import type { MoneyFlowRealtime, MoneyFlowData } from '../../data/eastmoneyMoneyFlow.js'

// 清除模块缓存，确保每次测试用 fresh repo
vi.mock('../../repositories/DrizzleMoneyFlowRepository.js', () => ({
  DrizzleMoneyFlowRepository: vi.fn(),
}))

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

describe('moneyFlowService repository integration', () => {
  let mockRepo: ReturnType<typeof createMockRepo>

  beforeEach(() => {
    mockRepo = createMockRepo()
    setMoneyFlowRepository(mockRepo as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getMoneyFlowRepository', () => {
    it('returns the set mock repo', () => {
      const repo = getMoneyFlowRepository()
      expect(repo).toBe(mockRepo)
    })
  })
})
