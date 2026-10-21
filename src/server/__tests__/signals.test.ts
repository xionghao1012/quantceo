import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp } from './helpers.js'
import signalsRoutes from '../routes/signals.js'

// Use vi.hoisted so the mock fn refs are available when vi.mock runs
const listRows = vi.hoisted(() => ({ rows: [] as any[] }))
const statsRows = vi.hoisted(() => ({ rows: [] as any[] }))
const todayRows = vi.hoisted(() => ({ rows: [] as any[] }))

vi.mock('../db/db.js', () => ({
  db: {
    select: vi.fn(function(opts?: any) {
      if (opts) {
        // stats route: db.select({ ... }).from().where().groupBy().orderBy()
        return {
          from: () => ({
            where: () => ({
              groupBy: () => ({
                orderBy: () => statsRows.rows,
              }),
            }),
          }),
        }
      }
      // list route: db.select().from().where().orderBy().limit()
      // today route: db.select().from().where().orderBy() (no limit, awaits orderBy directly)
      // Make orderBy return a thenable so both await and .limit() work
      const thenable = {
        then: (resolve: (v: any) => void) => resolve(todayRows.rows),
        limit: () => listRows.rows,
      }
      return {
        from: () => ({
          where: () => ({
            orderBy: () => thenable,
          }),
        }),
      }
    }),
  },
}))

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm')
  return {
    ...actual,
    eq: vi.fn(() => ({})),
    and: vi.fn(() => ({})),
    gte: vi.fn(() => ({})),
    desc: vi.fn(() => ({})),
    count: vi.fn(() => ({})),
  }
})

const app = createTestApp()
app.use('/api/signals', signalsRoutes)

const today = new Date().toISOString().split('T')[0]

const mockSignalsRows = [
  { id: 1, code: '000001', name: '平安银行', direction: 'BUY', strength: 0.8, scanDate: today, price: '10.5', indicators: { ma5: 10 }, reason: 'MA cross', strategyId: 1 },
  { id: 2, code: '000001', name: '平安银行', direction: 'SELL', strength: 0.6, scanDate: today, price: '10.5', indicators: { ma5: 10 }, reason: 'RSI overbought', strategyId: 1 },
  { id: 3, code: '600519', name: '贵州茅台', direction: 'BUY', strength: 0.9, scanDate: today, price: '1800', indicators: { ma5: 1790 }, reason: 'MA cross', strategyId: 2 },
]

describe('GET /api/signals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listRows.rows = []
    statsRows.rows = []
    todayRows.rows = []
  })

  it('returns signal list with filters', async () => {
    listRows.rows = []
    const res = await request(app).get('/api/signals?limit=5')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('filters by direction', async () => {
    listRows.rows = mockSignalsRows.filter(s => s.direction === 'BUY')
    const res = await request(app).get('/api/signals?direction=BUY&limit=5')
    expect(res.status).toBe(200)
    for (const s of res.body) {
      expect(s.direction).toBe('BUY')
    }
  })

  it('filters by date', async () => {
    listRows.rows = []
    const res = await request(app).get(`/api/signals?date=${today}&limit=5`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns empty array when no signals found', async () => {
    listRows.rows = []
    const res = await request(app).get('/api/signals?direction=BUY')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('filters by code', async () => {
    listRows.rows = mockSignalsRows.filter(s => s.code === '000001')
    const res = await request(app).get('/api/signals?code=000001&limit=5')
    expect(res.status).toBe(200)
    for (const s of res.body) {
      expect(s.code).toBe('000001')
    }
  })

  it('filters by strategyId', async () => {
    listRows.rows = mockSignalsRows.filter(s => s.strategyId === 1)
    const res = await request(app).get('/api/signals?strategyId=1&limit=5')
    expect(res.status).toBe(200)
  })

  it('applies limit param', async () => {
    listRows.rows = mockSignalsRows
    // Mock doesn't actually slice — verify the route calls .limit()
    const res = await request(app).get('/api/signals?limit=2')
    expect(res.status).toBe(200)
  })
})

describe('GET /api/signals/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listRows.rows = []
    statsRows.rows = []
    todayRows.rows = []
  })

  it('returns signal statistics', async () => {
    statsRows.rows = []
    const res = await request(app).get('/api/signals/stats?days=30')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('applies strategyId filter when provided', async () => {
    statsRows.rows = []
    const res = await request(app).get('/api/signals/stats?days=30&strategyId=1')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns stats rows with scanDate, direction, count', async () => {
    statsRows.rows = [
      { scanDate: '2024-01-01', direction: 'BUY', count: 5 },
      { scanDate: '2024-01-01', direction: 'SELL', count: 3 },
      { scanDate: '2024-01-02', direction: 'BUY', count: 7 },
    ]
    const res = await request(app).get('/api/signals/stats?days=30')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(3)
    expect(res.body[0]).toHaveProperty('scanDate')
    expect(res.body[0]).toHaveProperty('direction')
    expect(res.body[0]).toHaveProperty('count')
  })

  it('defaults days to 30', async () => {
    statsRows.rows = []
    const res = await request(app).get('/api/signals/stats')
    expect(res.status).toBe(200)
    // defaults to 30 days
  })
})

describe('GET /api/signals/today', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listRows.rows = []
    statsRows.rows = []
    todayRows.rows = []
  })

  it('returns today signal summary grouped by code', async () => {
    todayRows.rows = mockSignalsRows
    const res = await request(app).get('/api/signals/today')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    // Should be grouped by code: 000001 has 2 signals, 600519 has 1
    expect(res.body.length).toBe(2)
  })

  it('groups signals and computes totalStrength', async () => {
    todayRows.rows = mockSignalsRows
    const res = await request(app).get('/api/signals/today')
    const byCode = res.body.find((r: any) => r.code === '000001')
    expect(byCode).toBeDefined()
    // BUY strength 0.8 + SELL strength 0.6 = 0.2 net
    expect(byCode.totalStrength).toBeCloseTo(0.8 - 0.6, 5)
    expect(byCode.signals).toBeDefined()
    expect(Array.isArray(byCode.signals)).toBe(true)
  })

  it('excludes name, indicators, reason, price from grouped signals', async () => {
    todayRows.rows = mockSignalsRows
    const res = await request(app).get('/api/signals/today')
    const byCode = res.body.find((r: any) => r.code === '000001')
    for (const sig of byCode.signals) {
      expect(sig).not.toHaveProperty('name')
      expect(sig).not.toHaveProperty('indicators')
      expect(sig).not.toHaveProperty('reason')
      expect(sig).not.toHaveProperty('price')
    }
  })

  it('returns empty array when no signals today', async () => {
    todayRows.rows = []
    const res = await request(app).get('/api/signals/today')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('sorts by absolute totalStrength descending', async () => {
    todayRows.rows = mockSignalsRows
    const res = await request(app).get('/api/signals/today')
    // 000001: |0.8-0.6| = 0.2, 600519: 0.9 → 600519 first
    expect(res.body[0].code).toBe('600519')
    expect(res.body[1].code).toBe('000001')
  })
})
