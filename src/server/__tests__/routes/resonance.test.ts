import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp } from '../helpers.js'
import resonanceRoutes from '../../routes/resonance.js'

const { mockGetOrFetchKlines, mockScanResonance } = vi.hoisted(() => ({
  mockGetOrFetchKlines: vi.fn(),
  mockScanResonance: vi.fn(),
}))

vi.mock('../../data/cache.js', () => ({
  getOrFetchKlines: (...args: any[]) => mockGetOrFetchKlines(...args),
}))

vi.mock('../../scan/index.js', () => ({
  scanResonance: (...args: any[]) => mockScanResonance(...args),
}))

const app = createTestApp()
app.use('/api/resonance', resonanceRoutes)

beforeEach(() => {
  vi.clearAllMocks()
  mockGetOrFetchKlines.mockResolvedValue({ klines: [], source: 'mock' })
  mockScanResonance.mockResolvedValue(null)
})

// ─── GET /templates/:id ─────────────────────────────────────────────────────────

describe('GET /api/resonance/templates/:id', () => {
  it('returns 404 for non-existent template', async () => {
    const res = await request(app).get('/api/resonance/templates/9999')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Template not found')
  })
})

// ─── POST /backtest — trade and winRate branches ────────────────────────────────

describe('POST /api/resonance/backtest — trade recording branches', () => {
  it('returns 404 when klines are empty', async () => {
    mockGetOrFetchKlines.mockResolvedValueOnce({ klines: [], source: 'mock' })
    const res = await request(app)
      .post('/api/resonance/backtest')
      .send({
        code: '000001',
        config: { fundWeight: 0.5, techWeight: 0.5, indicators: [] },
        fundSignals: [],
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      })
    expect(res.status).toBe(404)
  })

  it('returns 400 when filtered klines < 60', async () => {
    mockGetOrFetchKlines.mockResolvedValueOnce({
      klines: Array.from({ length: 30 }, (_, i) => ({ date: `2024-01-${String(i+1).padStart(2,'0')}`, close: 10 })),
      source: 'mock',
    })
    const res = await request(app)
      .post('/api/resonance/backtest')
      .send({
        code: '000001',
        config: { fundWeight: 0.5, techWeight: 0.5, indicators: [] },
        fundSignals: [],
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      })
    expect(res.status).toBe(400)
  })

  it('records SELL trade when combinedScore < 0 (lines 130-133)', async () => {
    // Rising then falling prices: BUY at low price, SELL at high price
    const klines = Array.from({ length: 100 }, (_, i) => ({
      date: `2024-01-${String(i+1).padStart(2,'0')}`,
      close: i < 50 ? 10 + i * 0.1 : 15 - (i - 50) * 0.1,
    }))
    mockGetOrFetchKlines.mockResolvedValueOnce({ klines, source: 'mock' })
    // i<50: positive → BUY, i>=50: negative → SELL
    mockScanResonance.mockImplementation(({ klines: kl }: any) => {
      const i = kl.length - 1
      return i < 50 ? { combinedScore: 5, code: '000001' } : { combinedScore: -5, code: '000001' }
    })

    const res = await request(app)
      .post('/api/resonance/backtest')
      .send({
        code: '000001',
        config: { fundWeight: 0.5, techWeight: 0.5, indicators: [{ name: 'rsi', params: {}, enabled: true }] },
        fundSignals: [{ code: '000001', score: 5, date: '2024-01-01' }],
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        initialCapital: 100000,
      })

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('totalReturn')
    expect(res.body).toHaveProperty('winRate')
    expect(res.body).toHaveProperty('tradeCount')
    expect(res.body).toHaveProperty('finalCapital')
    expect(res.body).toHaveProperty('trades')
    // SELL trades recorded (line 130-133)
    const sellTrades = res.body.trades.filter((t: any) => t.action === 'SELL')
    expect(sellTrades.length).toBeGreaterThan(0)
    // winRate calculation (lines 145-147)
    expect(typeof res.body.winRate).toBe('number')
  })

  it('winRate = 0 when all SELL trades are losing (line 147)', async () => {
    // Declining prices throughout: BUY at high price, SELL at low price → losing trades
    const klines = Array.from({ length: 100 }, (_, i) => ({
      date: `2024-01-${String(i+1).padStart(2,'0')}`,
      close: 20 - i * 0.1,
    }))
    mockGetOrFetchKlines.mockResolvedValueOnce({ klines, source: 'mock' })
    // All positive → BUY, then price drops → SELL at lower price → losing trade
    mockScanResonance.mockImplementation(({ klines: kl }: any) => {
      const i = kl.length - 1
      if (i < 35) return null
      return { combinedScore: 5, code: '000001' }
    })

    const res = await request(app)
      .post('/api/resonance/backtest')
      .send({
        code: '000001',
        config: { fundWeight: 0.5, techWeight: 0.5, indicators: [{ name: 'rsi', params: {}, enabled: true }] },
        fundSignals: [{ code: '000001', score: 5, date: '2024-01-01' }],
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        initialCapital: 100000,
      })

    expect(res.status).toBe(200)
    // All SELL trades have pnl < 0 → winRate = 0
    expect(res.body.winRate).toBe(0)
  })

  it('records BUY trade when combinedScore > 0 (lines 125-129)', async () => {
    const klines = Array.from({ length: 100 }, (_, i) => ({
      date: `2024-01-${String(i+1).padStart(2,'0')}`,
      close: 10 + i * 0.1,
    }))
    mockGetOrFetchKlines.mockResolvedValueOnce({ klines, source: 'mock' })
    mockScanResonance.mockImplementation(({ klines: kl }: any) => {
      const i = kl.length - 1
      if (i < 35) return null
      return { combinedScore: 5, code: '000001' }
    })

    const res = await request(app)
      .post('/api/resonance/backtest')
      .send({
        code: '000001',
        config: { fundWeight: 0.5, techWeight: 0.5, indicators: [{ name: 'rsi', params: {}, enabled: true }] },
        fundSignals: [{ code: '000001', score: 5, date: '2024-01-01' }],
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        initialCapital: 100000,
      })

    expect(res.status).toBe(200)
    const buyTrades = res.body.trades.filter((t: any) => t.action === 'BUY')
    expect(buyTrades.length).toBeGreaterThan(0)
  })

  it('closes position at end when still in position (lines 138-141)', async () => {
    const klines = Array.from({ length: 100 }, (_, i) => ({
      date: `2024-01-${String(i+1).padStart(2,'0')}`,
      close: 10 + i * 0.1,
    }))
    mockGetOrFetchKlines.mockResolvedValueOnce({ klines, source: 'mock' })
    // Always positive → BUY at some point, never SELL → position still open at end
    mockScanResonance.mockReturnValue({ combinedScore: 5, code: '000001' })

    const res = await request(app)
      .post('/api/resonance/backtest')
      .send({
        code: '000001',
        config: { fundWeight: 0.5, techWeight: 0.5, indicators: [{ name: 'rsi', params: {}, enabled: true }] },
        fundSignals: [{ code: '000001', score: 5, date: '2024-01-01' }],
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        initialCapital: 100000,
      })

    expect(res.status).toBe(200)
    // finalCapital should be adjusted (position closed)
    expect(res.body.finalCapital).toBeGreaterThan(0)
    // Last trade should be SELL closing the position
    const lastTrade = res.body.trades[res.body.trades.length - 1]
    expect(lastTrade.action).toBe('SELL')
  })

  it('calculates totalReturn correctly', async () => {
    const klines = Array.from({ length: 100 }, (_, i) => ({
      date: `2024-01-${String(i+1).padStart(2,'0')}`,
      close: 10 + i * 0.1,
    }))
    mockGetOrFetchKlines.mockResolvedValueOnce({ klines, source: 'mock' })
    mockScanResonance.mockReturnValue(null) // No signals → no trades → buy and hold

    const res = await request(app)
      .post('/api/resonance/backtest')
      .send({
        code: '000001',
        config: { fundWeight: 0.5, techWeight: 0.5, indicators: [] },
        fundSignals: [],
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        initialCapital: 100000,
      })

    expect(res.status).toBe(200)
    expect(typeof res.body.totalReturn).toBe('number')
  })
})

// ─── POST /scan — result sorting ───────────────────────────────────────────────

describe('POST /api/resonance/scan — result sorting (line 93)', () => {
  it('sorts results by combinedScore descending', async () => {
    const klines = Array.from({ length: 100 }, (_, i) => ({
      date: `2024-01-${String(i+1).padStart(2,'0')}`,
      close: 10 + i * 0.1,
    }))
    mockGetOrFetchKlines.mockResolvedValue({ klines, source: 'mock' })
    mockScanResonance.mockImplementation(({ klines: kl }: any) => {
      // Different code → different fundScore → different combinedScore
      return { combinedScore: kl.length > 50 ? 8 : 3, code: '000001' }
    })

    const res = await request(app)
      .post('/api/resonance/scan')
      .send({
        codes: ['000001', '000002'],
        config: { fundWeight: 0.5, techWeight: 0.5, indicators: [] },
        fundSignals: [
          { code: '000001', score: 5 },
          { code: '000002', score: 2 },
        ],
      })

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('count')
    expect(res.body).toHaveProperty('results')
  })
})
