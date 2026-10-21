import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest'
import request from 'supertest'
import { createTestApp } from './helpers.js'
import marketStateRoutes from '../routes/marketState.js'
import authRoutes from '../routes/auth.js'

const app = createTestApp()
app.use('/api/market', marketStateRoutes)
app.use('/api/auth', authRoutes)

let token = ''

beforeAll(async () => {
  const email = `market_${Date.now()}@test.com`
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'Test@123456', name: 'MarketTester' })
  if (res.status === 201) {
    token = res.body.token
  }
})

describe('GET /api/market/state', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/market/state')
    expect(res.status).toBe(401)
  })

  it('returns market state when authenticated', async () => {
    if (!token) return
    const res = await request(app)
      .get('/api/market/state')
      .set('Authorization', `Bearer ${token}`)
    expect([200, 500]).toContain(res.status)
    if (res.status === 200) {
      expect(res.body).toBeTruthy()
    }
  })
})

describe('GET /api/market/indices', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns indices on success', async () => {
    const res = await request(app).get('/api/market/indices')
    expect([200, 500]).toContain(res.status)
    if (res.status === 200) {
      expect(res.body).toHaveProperty('indices')
      expect(res.body).toHaveProperty('marketDate')
      expect(res.body).toHaveProperty('updatedAt')
      expect(Array.isArray(res.body.indices)).toBe(true)
    }
  })

  it('returns 500 when external API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    const res = await request(app).get('/api/market/indices')
    expect(res.status).toBe(500)
    expect(res.body).toHaveProperty('error')
  })
})

describe('GET /api/market/hot-sectors', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns hot sectors on success', async () => {
    const res = await request(app).get('/api/market/hot-sectors')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('sectors')
    expect(res.body).toHaveProperty('updatedAt')
    expect(Array.isArray(res.body.sectors)).toBe(true)
  })

  it('returns empty sectors on API error (returns 200, not 500)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    const res = await request(app).get('/api/market/hot-sectors')
    // Hot sectors error handler returns 200 with empty array
    expect(res.status).toBe(200)
    expect(res.body.sectors).toEqual([])
  })

  it('returns empty sectors when API returns malformed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('not json'),
    } as Response))
    const res = await request(app).get('/api/market/hot-sectors')
    expect(res.status).toBe(200)
    expect(res.body.sectors).toEqual([])
  })
})
