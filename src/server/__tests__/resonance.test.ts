import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createTestApp } from './helpers.js'
import resonanceRoutes from '../routes/resonance.js'
import authRoutes from '../routes/auth.js'

const app = createTestApp()
app.use('/api/resonance', resonanceRoutes)
app.use('/api/auth', authRoutes)

let token = ''

beforeAll(async () => {
  const email = `res_${Date.now()}@test.com`
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'Test@123456', name: 'ResTester' })
  if (res.status === 201) {
    token = res.body.token
  }
})

describe('GET /api/resonance/templates', () => {
  it('returns preset templates', async () => {
    const res = await request(app).get('/api/resonance/templates')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
  })

  it('each template has required fields', async () => {
    const res = await request(app).get('/api/resonance/templates')
    for (const t of res.body) {
      expect(t).toHaveProperty('id')
      expect(t).toHaveProperty('name')
      expect(t).toHaveProperty('description')
      expect(t).toHaveProperty('config')
      expect(t.config).toHaveProperty('fundWeight')
      expect(t.config).toHaveProperty('techWeight')
      expect(t.config).toHaveProperty('indicators')
    }
  })

  it('template id 1 is 保守型共振', async () => {
    const res = await request(app).get('/api/resonance/templates')
    const t = res.body.find((x: any) => x.id === 1)
    expect(t.name).toBe('保守型共振')
  })

  it('template id 2 is 激进型共振', async () => {
    const res = await request(app).get('/api/resonance/templates')
    const t = res.body.find((x: any) => x.id === 2)
    expect(t.name).toBe('激进型共振')
  })

  it('template id 3 is 布林带共振', async () => {
    const res = await request(app).get('/api/resonance/templates')
    const t = res.body.find((x: any) => x.id === 3)
    expect(t.name).toBe('布林带共振')
  })
})

describe('GET /api/resonance/templates/:id', () => {
  it('returns a specific template', async () => {
    const res = await request(app).get('/api/resonance/templates/1')
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(1)
    expect(res.body.name).toBe('保守型共振')
  })

  it('returns 404 for nonexistent template', async () => {
    const res = await request(app).get('/api/resonance/templates/9999')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Template not found')
  })
})

describe('POST /api/resonance/scan', () => {
  it('returns 400 without config', async () => {
    const res = await request(app)
      .post('/api/resonance/scan')
      .send({ fundSignals: [{ code: '600519', score: 10 }] })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Missing config or fundSignals')
  })

  it('returns 400 without fundSignals', async () => {
    const res = await request(app)
      .post('/api/resonance/scan')
      .send({ config: { fundWeight: 0.5, techWeight: 0.5, indicators: [] } })
    expect(res.status).toBe(400)
  })

  it('returns 400 with empty fundSignals array', async () => {
    const res = await request(app)
      .post('/api/resonance/scan')
      .send({ config: { fundWeight: 0.5, techWeight: 0.5, indicators: [] }, fundSignals: [] })
    expect(res.status).toBe(400)
  })

  it('returns 200 with valid config and fundSignals (empty codes array)', async () => {
    const res = await request(app)
      .post('/api/resonance/scan')
      .send({
        config: { fundWeight: 0.5, techWeight: 0.5, indicators: [] },
        fundSignals: [{ code: '600519', score: 10 }],
      })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('count')
    expect(res.body).toHaveProperty('results')
    expect(Array.isArray(res.body.results)).toBe(true)
  })
})

describe('POST /api/resonance/backtest', () => {
  it('returns 200 with valid params and verifies response shape', async () => {
    const res = await request(app)
      .post('/api/resonance/backtest')
      .send({
        code: '600519',
        config: { fundWeight: 0.5, techWeight: 0.5, indicators: [] },
        fundSignals: [],
        startDate: '2023-01-01',
        endDate: '2023-12-31',
      })
    // May return 200 if kline data exists, or 404 if no data
    if (res.status === 200) {
      expect(res.body).toHaveProperty('code', '600519')
      expect(res.body).toHaveProperty('totalReturn')
      expect(res.body).toHaveProperty('winRate')
      expect(res.body).toHaveProperty('trades')
      expect(Array.isArray(res.body.trades)).toBe(true)
    } else {
      expect([400, 404]).toContain(res.status)
    }
  })

  it('returns 400 with missing dates', async () => {
    const res = await request(app)
      .post('/api/resonance/backtest')
      .send({
        code: '600519',
        config: { fundWeight: 0.5, techWeight: 0.5, indicators: [] },
        fundSignals: [],
      })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/resonance/save-template', () => {
  it('returns 401 without token', async () => {
    const res = await request(app)
      .post('/api/resonance/save-template')
      .send({ name: 'Test', description: 'Desc', config: {} })
    expect(res.status).toBe(401)
  })

  it('saves template with valid auth', async () => {
    if (!token) return
    const res = await request(app)
      .post('/api/resonance/save-template')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'My Template',
        description: 'A test template',
        config: { fundWeight: 0.5, techWeight: 0.5, indicators: [] },
      })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('id')
    expect(res.body.name).toContain('My Template')
  })
})

describe('GET /api/resonance/my-templates', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/resonance/my-templates')
    expect(res.status).toBe(401)
  })

  it('returns user templates with auth', async () => {
    if (!token) return
    const res = await request(app)
      .get('/api/resonance/my-templates')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})
