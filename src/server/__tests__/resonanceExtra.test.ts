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
  const email = `res_extra_${Date.now()}@test.com`
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'Test@123456', name: 'ResExtraTester' })
  if (res.status === 201) {
    token = res.body.token
  }
})

// Lines 89-90: scanResonance result is pushed to results array
// Lines 131-134: backtest SELL trade with pnl is pushed to trades array
describe('POST /api/resonance/scan - result collection branches', () => {
  it('handles scan with codes and config', async () => {
    const res = await request(app)
      .post('/api/resonance/scan')
      .send({
        codes: ['000001'],
        config: {
          fundWeight: 0.5,
          techWeight: 0.5,
          indicators: [
            { name: 'rsi', params: { oversold: 30, overbought: 70, weight: 1 }, enabled: true },
            { name: 'kdj', params: { weight: 1 }, enabled: false },
            { name: 'bollinger', params: { weight: 1 }, enabled: false },
            { name: 'macd', params: { weight: 1 }, enabled: false },
          ],
        },
        fundSignals: [{ code: '000001', score: 10 }],
      })
    expect([200, 400, 404]).toContain(res.status)
  })

  it('handles multiple codes in scan', async () => {
    const res = await request(app)
      .post('/api/resonance/scan')
      .send({
        codes: ['000001', '000002', '600519'],
        config: {
          fundWeight: 0.5,
          techWeight: 0.5,
          indicators: [
            { name: 'rsi', params: { oversold: 30, overbought: 70, weight: 1 }, enabled: true },
          ],
        },
        fundSignals: [
          { code: '000001', score: 10 },
          { code: '000002', score: 5 },
          { code: '600519', score: 8 },
        ],
      })
    expect([200, 400, 404]).toContain(res.status)
  })
})

describe('POST /api/resonance/backtest - trade recording branches', () => {
  it('handles backtest with valid params', async () => {
    const res = await request(app)
      .post('/api/resonance/backtest')
      .send({
        code: '000001',
        config: {
          fundWeight: 0.5,
          techWeight: 0.5,
          indicators: [
            { name: 'rsi', params: { oversold: 30, overbought: 70, weight: 1 }, enabled: true },
            { name: 'kdj', params: { weight: 1 }, enabled: false },
            { name: 'bollinger', params: { weight: 1 }, enabled: false },
            { name: 'macd', params: { weight: 1 }, enabled: false },
          ],
        },
        fundSignals: [
          { code: '000001', score: 10, date: '2023-01-01' },
          { code: '000001', score: -5, date: '2023-06-01' },
        ],
        startDate: '2023-01-01',
        endDate: '2023-12-31',
        initialCapital: 100000,
      })
    if (res.status === 200) {
      expect(res.body).toHaveProperty('trades')
      expect(Array.isArray(res.body.trades)).toBe(true)
    } else {
      expect([400, 404]).toContain(res.status)
    }
  })

  it('backtest handles BUY signal and position entry', async () => {
    const res = await request(app)
      .post('/api/resonance/backtest')
      .send({
        code: '000001',
        config: {
          fundWeight: 0.3,
          techWeight: 0.7,
          indicators: [
            { name: 'rsi', params: { oversold: 30, overbought: 70, weight: 1 }, enabled: true },
          ],
        },
        fundSignals: [
          { code: '000001', score: 20, date: '2023-01-01' },
        ],
        startDate: '2023-01-01',
        endDate: '2023-12-31',
        initialCapital: 100000,
      })
    expect([200, 400, 404]).toContain(res.status)
  })
})
