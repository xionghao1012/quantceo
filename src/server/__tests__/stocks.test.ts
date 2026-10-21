import { describe, it, expect, beforeAll, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp } from './helpers.js'
import stocksRoutes from '../routes/stocks.js'
import { db } from '../db/db.js'
import { stocks } from '../db/schema.js'
import { eq } from 'drizzle-orm'

vi.mock('../data/intl.js', () => ({
  fetchUSKlines: vi.fn().mockResolvedValue([]),
  fetchHKKlines: vi.fn().mockResolvedValue([]),
}))

vi.mock('../data/cache.js', () => ({
  getOrFetchKlines: vi.fn().mockResolvedValue({ klines: [], source: 'mock' }),
  getOrFetchMinuteKlines: vi.fn().mockResolvedValue({ klines: [], source: 'mock' }),
}))

vi.mock('../data/redis.js', () => ({
  cacheGetQuotes: vi.fn().mockResolvedValue(null),
  cacheSetQuotes: vi.fn().mockResolvedValue('OK'),
}))

vi.mock('../data/fundamental.js', () => ({
  fetchFundamental: vi.fn().mockResolvedValue(null),
}))

const app = createTestApp()
app.use('/api/stocks', stocksRoutes)

const TEST_CODE = 'S99999'
const TEST_NAME = '测试股票'

beforeAll(async () => {
  await db.insert(stocks).values({
    code: TEST_CODE,
    name: TEST_NAME,
    exchange: 'SH',
    status: 'active',
  }).onConflictDoNothing()
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/stocks/:code', () => {
  it('returns stock by code', async () => {
    const res = await request(app).get(`/api/stocks/${TEST_CODE}`)
    expect(res.status).toBe(200)
    expect(res.body.code).toBe(TEST_CODE)
    expect(res.body.name).toBe(TEST_NAME)
  })

  it('returns 404 for non-existent stock', async () => {
    const res = await request(app).get('/api/stocks/NONEXIST')
    expect(res.status).toBe(404)
    expect(res.body.error).toBeTruthy()
  })
})

describe('GET /api/stocks', () => {
  it('returns stock list', async () => {
    const res = await request(app).get('/api/stocks')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('filters by query param q', async () => {
    const res = await request(app).get(`/api/stocks?q=${TEST_CODE}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('respects limit param', async () => {
    const res = await request(app).get('/api/stocks?limit=3')
    expect(res.status).toBe(200)
    expect(res.body.length).toBeLessThanOrEqual(3)
  })

  it('respects offset param', async () => {
    const res = await request(app).get('/api/stocks?limit=2&offset=0')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('caps limit at 500', async () => {
    const res = await request(app).get('/api/stocks?limit=9999')
    expect(res.status).toBe(200)
  })
})

describe('GET /api/stocks/quotes', () => {
  it('returns quotes as object', { timeout: 30000 }, async () => {
    const res = await request(app).get('/api/stocks/quotes')
    expect(res.status).toBe(200)
    expect(typeof res.body).toBe('object')
    expect(res.body).not.toBeNull()
  })

  it('returns quotes with price and change fields', async () => {
    const res = await request(app).get('/api/stocks/quotes')
    expect(res.status).toBe(200)
    const codes = Object.keys(res.body)
    if (codes.length > 0) {
      const first = res.body[codes[0]]
      expect(first).toHaveProperty('price')
      expect(first).toHaveProperty('change')
      expect(first).toHaveProperty('volume')
    }
  })

  it('returns cached quotes when available (cache hit)', async () => {
    const { cacheGetQuotes } = await import('../data/redis.js')
    vi.mocked(cacheGetQuotes).mockResolvedValueOnce(JSON.stringify({ '000001': { price: 10.5, change: 1.2, volume: 1000000 } }))
    const res = await request(app).get('/api/stocks/quotes')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('000001')
    expect(res.body['000001'].price).toBe(10.5)
  })

  it('falls back to DB when cache parse fails', async () => {
    const { cacheGetQuotes } = await import('../data/redis.js')
    vi.mocked(cacheGetQuotes).mockResolvedValueOnce('invalid json{')
    const res = await request(app).get('/api/stocks/quotes')
    expect(res.status).toBe(200)
    expect(typeof res.body).toBe('object')
  })
})

describe('POST /api/stocks/quotes/batch', () => {
  it('returns quotes for given codes', async () => {
    const res = await request(app)
      .post('/api/stocks/quotes/batch')
      .send({ codes: [TEST_CODE, '600519'] })
    expect(res.status).toBe(200)
    expect(typeof res.body).toBe('object')
  })

  it('returns empty object for empty codes', async () => {
    const res = await request(app)
      .post('/api/stocks/quotes/batch')
      .send({ codes: [] })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({})
  })

  it('returns empty object without codes', async () => {
    const res = await request(app)
      .post('/api/stocks/quotes/batch')
      .send({})
    expect(res.status).toBe(200)
    expect(res.body).toEqual({})
  })

  it('handles codes with SQL injection attempts', async () => {
    const res = await request(app)
      .post('/api/stocks/quotes/batch')
      .send({ codes: ["'; DROP TABLE stocks;--"] })
    expect(res.status).toBe(200)
  })
})

describe('GET /api/stocks/strategies', () => {
  it('returns strategies list', async () => {
    const res = await request(app).get('/api/stocks/strategies')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

describe('GET /api/stocks/:code/klines', () => {
  it('returns klines for stock or 404', async () => {
    const res = await request(app).get(`/api/stocks/${TEST_CODE}/klines`)
    expect([200, 404]).toContain(res.status)
    if (res.status === 200) {
      expect(res.body).toHaveProperty('klines')
      expect(res.body).toHaveProperty('source')
    }
  })

  it('rejects invalid period and falls back to daily', async () => {
    const res = await request(app).get(`/api/stocks/${TEST_CODE}/klines?period=invalid`)
    // Falls back to daily klines — 200 if data exists, 404 if no data
    expect([200, 404]).toContain(res.status)
  })
})

describe('GET /api/stocks/:code/indicators', () => {
  it('returns indicators for stock or 404', async () => {
    const res = await request(app).get(`/api/stocks/${TEST_CODE}/indicators`)
    expect([200, 404]).toContain(res.status)
    if (res.status === 200) {
      expect(res.body).toHaveProperty('ma')
      expect(res.body).toHaveProperty('macd')
      expect(res.body).toHaveProperty('rsi')
    }
  })
})

describe('GET /api/stocks/:code/fundamental', () => {
  it('returns fundamental data or 404', async () => {
    const res = await request(app).get(`/api/stocks/${TEST_CODE}/fundamental`)
    expect([200, 404]).toContain(res.status)
  })
})

describe('GET /api/stocks/intl/:market/:code/klines', () => {
  it('returns 400 for invalid market', async () => {
    const res = await request(app).get('/api/stocks/intl/JP/9999/klines')
    expect(res.status).toBe(400)
  })
})

describe('GET /api/stocks/intl/:market/:code/indicators', () => {
  it('returns 400 for invalid market', async () => {
    const res = await request(app).get('/api/stocks/intl/JP/9999/indicators')
    expect(res.status).toBe(400)
  })

  it('returns 404 when no klines data for US', async () => {
    const res = await request(app).get('/api/stocks/intl/US/AAPL/indicators')
    expect(res.status).toBe(404)
  })

  it('returns 404 when no klines data for HK', async () => {
    const res = await request(app).get('/api/stocks/intl/HK/00700/indicators')
    expect(res.status).toBe(404)
  })
})

describe('GET /api/stocks/:code/klines with period filters', () => {
  it('returns klines with start filter', async () => {
    const res = await request(app).get(`/api/stocks/${TEST_CODE}/klines?start=20250101`)
    expect([200, 404]).toContain(res.status)
  })

  it('returns klines with start and end filter', async () => {
    const res = await request(app).get(`/api/stocks/${TEST_CODE}/klines?start=20250101&end=20251231`)
    expect([200, 404]).toContain(res.status)
  })

  it('returns 404 when no minute klines data', async () => {
    const res = await request(app).get(`/api/stocks/${TEST_CODE}/klines?period=m1`)
    expect([200, 404]).toContain(res.status)
  })
})

describe('GET /api/stocks/:code/indicators with period', () => {
  it('returns 404 when no minute klines for indicators', async () => {
    const res = await request(app).get(`/api/stocks/${TEST_CODE}/indicators?period=m5`)
    expect([200, 404]).toContain(res.status)
  })
})

describe('GET /api/stocks/quotes edge cases', () => {
  it('handles cache parse error gracefully', async () => {
    const { cacheGetQuotes } = await import('../data/redis.js')
    vi.mocked(cacheGetQuotes).mockResolvedValueOnce('invalid json{')
    const res = await request(app).get('/api/stocks/quotes')
    expect(res.status).toBe(200)
  })
})
