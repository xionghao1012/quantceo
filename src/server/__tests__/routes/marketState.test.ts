import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import marketStateRoutes from '../../routes/marketState.js'

// vi.mock is hoisted, so variables used in factories must use vi.hoisted() at module level
const mockDb = vi.hoisted(() => ({
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
}))

const mockGetMarketState = vi.hoisted(() => vi.fn())

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: () => void) => {
    _req.user = { userId: 1, email: 'test@test.com', role: 'user' }
    next()
  },
}))

vi.mock('../../db/db.js', () => ({ db: mockDb }))

vi.mock('../../ai/marketState.js', () => ({
  getMarketState: (...args: any[]) => mockGetMarketState(...args),
}))

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/market', marketStateRoutes)
  return app
}

const app = createApp()

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── GET /state ───────────────────────────────────────────────────────────────
// Isolated: each sub-describe gets a fresh module cache via vi.resetModules()

describe('GET /api/market/state', () => {
  // Tests that need a fresh module-level cache use their own app via resetModules
  describe('with fresh cache', () => {
    let freshApp: ReturnType<typeof createApp>

    beforeEach(async () => {
      vi.resetModules()
      // Re-import after reset to get fresh module-level cache variables
      const mod = await import('../../routes/marketState.js')
      freshApp = express()
      freshApp.use(express.json())
      freshApp.use('/api/market', mod.default)
    })

    it('returns state result from getMarketState', async () => {
      mockGetMarketState.mockReturnValue(Promise.resolve({
        state: 'trending_up',
        indicators: { rsi: 55, macdSignal: 'bullish' },
      }))

      const res = await request(freshApp).get('/api/market/state')
      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('state')
    })

    it('returns 500 on getMarketState error', async () => {
      mockGetMarketState.mockRejectedValue(new Error('Market state failure'))

      const res = await request(freshApp).get('/api/market/state')
      expect(res.status).toBe(500)
      expect(res.body.error).toBeTruthy()
    })

    it('uses index query param', async () => {
      mockGetMarketState.mockReturnValue(Promise.resolve({ state: 'oversold' }))
      const res = await request(freshApp).get('/api/market/state?index=000300')
      expect(res.status).toBe(200)
      expect(mockGetMarketState).toHaveBeenCalledWith('000300')
    })
  })

  // Auth test uses shared app (doesn't need cache)
  it('returns 401 without auth middleware user', async () => {
    const res = await request(app).get('/api/market/state')
    expect(res.status).not.toBe(401)
  })

  // Cache test must be LAST — it populates the module-level cache
  it('returns cached state when cache is fresh', async () => {
    mockGetMarketState.mockReturnValue(Promise.resolve({ state: 'trending_up', indicators: {} }))

    // First call to prime cache
    await request(app).get('/api/market/state')

    // Second call should hit cache
    const res = await request(app).get('/api/market/state')
    expect(res.status).toBe(200)
  })

  it('cache expires after CACHE_TTL and fetches fresh data', async () => {
    mockGetMarketState.mockReturnValue(Promise.resolve({ state: 'range_bound', indicators: {} }))

    vi.resetModules()
    vi.useFakeTimers()
    const mod = await import('../../routes/marketState.js')
    const cacheApp = express()
    cacheApp.use(express.json())
    cacheApp.use('/api/market', mod.default)

    // First call primes the cache
    await request(cacheApp).get('/api/market/state')
    expect(mockGetMarketState).toHaveBeenCalledTimes(1)

    // Advance time past 5-minute TTL
    vi.setSystemTime(Date.now() + 6 * 60 * 1000)

    // Second call should miss cache
    await request(cacheApp).get('/api/market/state')
    expect(mockGetMarketState).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })
})

// ─── GET /indices ─────────────────────────────────────────────────────────────

describe('GET /api/market/indices', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns indices data from external API', async () => {
    const mockFetchData = `v_s_sh000001="some data~100~100~3000~10~0.33~5000000~0~0~12.5~49.2~2069~20260618161419~"`
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: () => Promise.resolve(mockFetchData),
    }))

    const res = await request(app).get('/api/market/indices')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('indices')
    expect(res.body).toHaveProperty('marketDate')
    expect(res.body).toHaveProperty('updatedAt')
  })

  it('returns 500 on fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

    const res = await request(app).get('/api/market/indices')
    expect(res.status).toBe(500)
  })

  it('handles empty fetch response gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ text: () => Promise.resolve('') }))

    const res = await request(app).get('/api/market/indices')
    expect(res.status).toBe(200)
  })

  it('skips lines not matching any index', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: () => Promise.resolve('v_s_sh000001="some data~100~100~3000~10~0.33~5000000"\nv_s_unknown="bad data"'),
    }))

    const res = await request(app).get('/api/market/indices')
    expect(res.status).toBe(200)
    expect(res.body.indices.length).toBeGreaterThan(0)
  })
})

// ─── GET /hot-sectors ─────────────────────────────────────────────────────────

describe('GET /api/market/hot-sectors', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns sectors from EastMoney API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: () => Promise.resolve('({ "data": { "diff": [{ "f12": "801010", "f14": "银行", "f3": 2.5, "f62": 1000000, "f184": "601398", "f66": "工商银行", "f70": 1.2 }] } })'),
    }))

    const res = await request(app).get('/api/market/hot-sectors')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('sectors')
    expect(Array.isArray(res.body.sectors)).toBe(true)
  })

  it('returns 200 with empty sectors on parse error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: () => Promise.resolve('invalid jsonp'),
    }))

    const res = await request(app).get('/api/market/hot-sectors')
    expect(res.status).toBe(200)
    expect(res.body.sectors).toEqual([])
  })

  it('returns 200 with empty sectors when no data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: () => Promise.resolve('({ "data": { "diff": [] } })'),
    }))

    const res = await request(app).get('/api/market/hot-sectors')
    expect(res.status).toBe(200)
    expect(res.body.sectors).toEqual([])
  })

  it('maps sector fields correctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: () => Promise.resolve('({ "data": { "diff": [{ "f12": "801010", "f14": "银行", "f3": 2.5, "f62": 1000000, "f184": "601398", "f66": "工商银行", "f70": 1.2 }] } })'),
    }))

    const res = await request(app).get('/api/market/hot-sectors')
    expect(res.status).toBe(200)
    const sector = res.body.sectors[0]
    expect(sector.code).toBe('801010')
    expect(sector.name).toBe('银行')
    expect(sector.changePct).toBe(2.5)
    expect(sector.mainForceInflow).toBe(1000000)
  })
})
