import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createTestApp } from '../helpers.js'
import signalsRoutes from '../../routes/signals.js'

const app = createTestApp()
app.use('/api/signals', signalsRoutes)

vi.mock('../../data/cache.js', () => ({
  getOrFetchKlines: vi.fn().mockResolvedValue({ klines: [], source: 'mock' }),
}))

describe('GET /api/signals', () => {
  it('returns signals array', async () => {
    const res = await request(app).get('/api/signals')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('accepts code filter', async () => {
    const res = await request(app).get('/api/signals?code=600519')
    expect(res.status).toBe(200)
  })

  it('accepts direction filter', async () => {
    const res = await request(app).get('/api/signals?direction=BUY')
    expect(res.status).toBe(200)
  })

  it('accepts strategyId filter', async () => {
    const res = await request(app).get('/api/signals?strategyId=1')
    expect(res.status).toBe(200)
  })

  it('accepts date filter', async () => {
    const res = await request(app).get('/api/signals?date=2024-01-15')
    expect(res.status).toBe(200)
  })

  it('accepts limit param', async () => {
    const res = await request(app).get('/api/signals?limit=10')
    expect(res.status).toBe(200)
  })
})
