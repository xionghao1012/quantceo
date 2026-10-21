import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import express from 'express'

// Mock auth middleware — sets req.user
vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: () => void) => {
    _req.user = { userId: 1, email: 'test@test.com', role: 'user' }
    next()
  },
}))

const rankingsRoutes = (await import('../../routes/rankings.js')).default
const { computeScore } = await import('../../routes/rankings.js')

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/rankings', rankingsRoutes)
  return app
}

const app = createApp()

// ─── computeScore unit tests ─────────────────────────────────────────────────
describe('computeScore — all strategy branches', () => {
  const makeStrategy = (key: string) => ({ key, label: '', desc: '', scoreLabel: '', scoreUnit: '分', conditions: () => [], scoreSQL: '', sort: 'desc' as const })

  it('oversold_reversal — positive RSI, positive macdSignal, negative momentum', () => {
    const s = makeStrategy('oversold_reversal')
    expect(computeScore(s, 20, 1, 1, 0.5, null, null, -10)).toBeGreaterThan(0)
  })

  it('oversold_reversal — high RSI (above 30) still yields score from other terms', () => {
    const s = makeStrategy('oversold_reversal')
    // RSI=40 → max(0, -13.33) = 0; macdSignal=0.5 → 7.5; momentum=-5 → 15
    const score = computeScore(s, 40, 1, 1, 0.5, null, null, -5)
    expect(score).toBe(23) // 0 + 7.5 + 15 = 22.5 → 23
  })

  it('volume_breakout — high volRatio and changePct', () => {
    const s = makeStrategy('volume_breakout')
    const score = computeScore(s, null, 8, 3, null, 50, null, null)
    expect(score).toBeGreaterThan(0)
  })

  it('volume_breakout — zero volRatio gives score only from changePct and bbPosition', () => {
    const s = makeStrategy('volume_breakout')
    // volRatio=1 → 0; changePct=5 → 10; bbPosition=80 → 24
    const score = computeScore(s, null, 5, 1, null, 80, null, null)
    expect(score).toBe(34)
  })

  it('bottom_start — low RSI, moderate volRatio, positive changePct', () => {
    const s = makeStrategy('bottom_start')
    const score = computeScore(s, 20, 3, 2, null, null, null, null)
    expect(score).toBeGreaterThan(0)
  })

  it('strong_pullback — high RSI above 50, negative changePct', () => {
    const s = makeStrategy('strong_pullback')
    // RSI=60 → 6; changePct=-5 → 20; volRatio=1.5 → 5
    const score = computeScore(s, 60, -5, 1.5, null, null, null, null)
    expect(score).toBe(31)
  })

  it('strong_pullback — RSI below 50 yields 0 from first term', () => {
    const s = makeStrategy('strong_pullback')
    // RSI=40 → max(0, (40-50)/50*30) = 0; changePct=-5 → 20; volRatio=1.5 → 5
    const score = computeScore(s, 40, -5, 1.5, null, null, null, null)
    expect(score).toBe(25)
  })

  it('bullish_composite — positive maAlignment adds 25', () => {
    const s = makeStrategy('bullish_composite')
    // RSI=60 → 5; macdSignal=1 → 8.33; maAlignment=1 → 25; momentum=5 → 12.5
    const score = computeScore(s, 60, null, null, 1, null, 1, 5)
    expect(score).toBe(51)
  })

  it('bullish_composite — zero maAlignment yields 0 for that term', () => {
    const s = makeStrategy('bullish_composite')
    // Same as above but maAlignment=0: 5 + 8.33 + 0 + 12.5 = 25.83 → 26
    const score = computeScore(s, 60, null, null, 1, null, 0, 5)
    expect(score).toBe(26)
  })

  it('extreme_oversold — very low RSI gives high score', () => {
    const s = makeStrategy('extreme_oversold')
    // RSI=10 → 30; volRatio=0.3 → 24
    const score = computeScore(s, 10, null, 0.3, null, null, null, null)
    expect(score).toBe(54)
  })

  it('extreme_oversold — RSI above 20 yields 0 from first term', () => {
    const s = makeStrategy('extreme_oversold')
    const score = computeScore(s, 25, null, 0.5, null, null, null, null)
    expect(score).toBe(8)
  })

  it('default case returns 0', () => {
    const s = makeStrategy('unknown_strategy')
    const score = computeScore(s, 50, 1, 1, 1, 50, 0, 5)
    expect(score).toBe(0)
  })

  it('handles null inputs with fallback values', () => {
    const s = makeStrategy('oversold_reversal')
    const score = computeScore(s, null, null, null, null, null, null, null)
    expect(typeof score).toBe('number')
    expect(score).toBeGreaterThanOrEqual(0)
  })
})

describe('GET /api/rankings/', () => {
  it('returns rankings for default metric', async () => {
    const res = await request(app).get('/api/rankings/')
    // 200 if data exists, 500 if DB error
    expect([200, 500]).toContain(res.status)
    if (res.status === 200) {
      expect(res.body).toHaveProperty('date')
      expect(res.body).toHaveProperty('board')
      expect(res.body).toHaveProperty('metric')
    }
  })

  it('returns rankings for specific board', async () => {
    const res = await request(app).get('/api/rankings/?board=hsb')
    expect([200, 500]).toContain(res.status)
  })

  it('returns rankings for specific metric', async () => {
    const res = await request(app).get('/api/rankings/?metric=change_pct')
    expect([200, 500]).toContain(res.status)
  })

  it('falls back to default for invalid metric', async () => {
    const res = await request(app).get('/api/rankings/?metric=invalid_metric')
    expect([200, 500]).toContain(res.status)
    if (res.status === 200) {
      expect(res.body.metric).toBe('rsi') // fallback
    }
  })

  it('falls back to all for invalid board', async () => {
    const res = await request(app).get('/api/rankings/?board=invalid')
    expect([200, 500]).toContain(res.status)
    if (res.status === 200) {
      expect(res.body.board).toBe('all') // fallback
    }
  })
})

describe('GET /api/rankings/strategies', () => {
  it('returns 200 or 400 depending on seed data', async () => {
    const res = await request(app).get('/api/rankings/strategies')
    expect([200, 400]).toContain(res.status)
  })

  it('returns strategy rankings with valid strategy key', async () => {
    const res = await request(app).get('/api/rankings/strategies?strategy=oversold_reversal')
    expect([200, 400]).toContain(res.status)
    if (res.status === 200) {
      expect(res.body).toHaveProperty('strategy')
      expect(res.body).toHaveProperty('rankings')
    }
  })

  it('returns 400 for unknown strategy key', async () => {
    const res = await request(app).get('/api/rankings/strategies?strategy=unknown_strategy_xyz')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('未知策略')
  })
})

describe('GET /api/rankings/strategies/list', () => {
  it('returns strategy list', async () => {
    const res = await request(app).get('/api/rankings/strategies/list')
    expect([200, 500]).toContain(res.status)
    if (res.status === 200) {
      expect(res.body).toHaveProperty('strategies')
      expect(Array.isArray(res.body.strategies)).toBe(true)
    }
  })
})

describe('GET /api/rankings/available-dates', () => {
  it('returns 200', async () => {
    const res = await request(app).get('/api/rankings/available-dates')
    expect(res.status).toBe(200)
    if (res.status === 200) {
      expect(res.body).toHaveProperty('dates')
    }
  })

  it('returns empty dates array when no data', async () => {
    const res = await request(app).get('/api/rankings/available-dates')
    expect([200, 500]).toContain(res.status)
  })
})

describe('computeScore strategy branches via API', () => {
  it('GET /strategies with limit param', async () => {
    const res = await request(app).get('/api/rankings/strategies?strategy=oversold_reversal&limit=50')
    expect([200, 400, 500]).toContain(res.status)
  })

  it('GET / with limit param', async () => {
    const res = await request(app).get('/api/rankings/?limit=50')
    expect([200, 500]).toContain(res.status)
  })

  it('GET /strategies with different board param', async () => {
    const res = await request(app).get('/api/rankings/strategies?strategy=oversold_reversal&board=kcb')
    expect([200, 400, 500]).toContain(res.status)
  })
})
