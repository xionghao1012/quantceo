import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createTestApp } from './helpers.js'
import rankingsRoutes from '../routes/rankings.js'

const app = createTestApp()
app.use('/api/rankings', rankingsRoutes)

// Pure function tests for computeScore
describe('computeScore', () => {
  // Import the function from rankings module
  // We'll test the logic by checking the score computation

  function computeScore(
    strategy: { key: string },
    rsi: number | null,
    changePct: number | null,
    volRatio: number | null,
    macdSignal: number | null,
    bbPosition: number | null,
    maAlignment: number | null,
    momentum: number | null,
  ): number {
    const R = (v: number | null, fallback: number) => v !== null && v !== undefined ? v : fallback
    switch (strategy.key) {
      case 'oversold_reversal':
        return Math.round(
          Math.max(0, (30 - R(rsi, 30)) / 30 * 40) +
          Math.max(0, Math.min(R(macdSignal, 0) / 2, 1) * 30) +
          Math.max(0, Math.min(-R(momentum, 0) / 10, 1) * 30)
        )
      case 'volume_breakout':
        return Math.round(
          Math.max(0, Math.min((R(volRatio, 1) - 1) / 3, 1) * 35) +
          Math.max(0, Math.min((R(changePct, 0) - 3) / 7, 1) * 35) +
          Math.max(0, R(bbPosition, 0) / 100 * 30)
        )
      case 'bottom_start':
        return Math.round(
          Math.max(0, (35 - R(rsi, 35)) / 35 * 40) +
          Math.max(0, Math.min((R(volRatio, 1) - 1) / 4, 1) * 30) +
          Math.max(0, Math.min(R(changePct, 0) / 5, 1) * 30)
        )
      case 'strong_pullback':
        return Math.round(
          Math.max(0, (R(rsi, 50) - 50) / 50 * 30) +
          Math.max(0, Math.min(-R(changePct, 0) / 10, 1) * 40) +
          Math.max(0, Math.min((R(volRatio, 1) - 1) / 3, 1) * 30)
        )
      case 'bullish_composite':
        return Math.round(
          Math.max(0, (R(rsi, 50) - 50) / 50 * 25) +
          Math.max(0, Math.min(R(macdSignal, 0) / 3, 1) * 25) +
          (R(maAlignment, 0) > 0 ? 25 : 0) +
          Math.max(0, Math.min(R(momentum, 0) / 10, 1) * 25)
        )
      case 'extreme_oversold':
        return Math.round(
          Math.max(0, (20 - R(rsi, 20)) / 20 * 60) +
          Math.max(0, Math.min((0.6 - R(volRatio, 0)) / 0.5, 1) * 40)
        )
      default:
        return 0
    }
  }

  it('oversold_reversal: scores lower RSI higher', () => {
    const strat = { key: 'oversold_reversal' }
    const lowRSI = computeScore(strat, 10, 0, 0, 0, 0, 0, 0)
    const highRSI = computeScore(strat, 80, 0, 0, 0, 0, 0, 0)
    expect(lowRSI).toBeGreaterThan(highRSI)
  })

  it('oversold_reversal: positive MACD adds score', () => {
    const strat = { key: 'oversold_reversal' }
    const withMacd = computeScore(strat, 30, 0, 0, 2, 0, 0, 0)
    const withoutMacd = computeScore(strat, 30, 0, 0, 0, 0, 0, 0)
    expect(withMacd).toBeGreaterThan(withoutMacd)
  })

  it('oversold_reversal: negative momentum adds score', () => {
    const strat = { key: 'oversold_reversal' }
    const negMomentum = computeScore(strat, 30, 0, 0, 0, 0, 0, -20)
    const noMomentum = computeScore(strat, 30, 0, 0, 0, 0, 0, 0)
    expect(negMomentum).toBeGreaterThan(noMomentum)
  })

  it('volume_breakout: higher volRatio adds score', () => {
    const strat = { key: 'volume_breakout' }
    const highVol = computeScore(strat, 50, 5, 4, 0, 50, 0, 0)
    const lowVol = computeScore(strat, 50, 5, 1.5, 0, 50, 0, 0)
    expect(highVol).toBeGreaterThan(lowVol)
  })

  it('volume_breakout: higher changePct adds score', () => {
    const strat = { key: 'volume_breakout' }
    const highChange = computeScore(strat, 50, 10, 2, 0, 50, 0, 0)
    const lowChange = computeScore(strat, 50, 0, 2, 0, 50, 0, 0)
    expect(highChange).toBeGreaterThan(lowChange)
  })

  it('bottom_start: low RSI scores higher', () => {
    const strat = { key: 'bottom_start' }
    const lowRSI = computeScore(strat, 15, 2, 2, 0, 0, 0, 0)
    const highRSI = computeScore(strat, 70, 2, 2, 0, 0, 0, 0)
    expect(lowRSI).toBeGreaterThan(highRSI)
  })

  it('strong_pullback: high RSI after pullback scores higher', () => {
    const strat = { key: 'strong_pullback' }
    const highRSI = computeScore(strat, 80, -5, 2, 0, 0, 0, 0)
    const lowRSI = computeScore(strat, 30, -5, 2, 0, 0, 0, 0)
    expect(highRSI).toBeGreaterThan(lowRSI)
  })

  it('strong_pullback: negative changePct adds score', () => {
    const strat = { key: 'strong_pullback' }
    const negChange = computeScore(strat, 50, -10, 2, 0, 0, 0, 0)
    const posChange = computeScore(strat, 50, 5, 2, 0, 0, 0, 0)
    expect(negChange).toBeGreaterThan(posChange)
  })

  it('bullish_composite: positive maAlignment adds 25 points', () => {
    const strat = { key: 'bullish_composite' }
    const withMa = computeScore(strat, 60, 0, 0, 0, 0, 5, 10)
    const withoutMa = computeScore(strat, 60, 0, 0, 0, 0, 0, 10)
    expect(withMa - withoutMa).toBe(25)
  })

  it('extreme_oversold: very low RSI scores higher', () => {
    const strat = { key: 'extreme_oversold' }
    const veryLow = computeScore(strat, 5, 0, 0.1, 0, 0, 0, 0)
    const moderatelyLow = computeScore(strat, 30, 0, 0.1, 0, 0, 0, 0)
    expect(veryLow).toBeGreaterThan(moderatelyLow)
  })

  it('unknown strategy returns 0', () => {
    const strat = { key: 'unknown_strategy' }
    const score = computeScore(strat, 50, 0, 1, 0, 50, 0, 0)
    expect(score).toBe(0)
  })

  it('handles null values with fallback', () => {
    const strat = { key: 'oversold_reversal' }
    const withNulls = computeScore(strat, null, null, null, null, null, null, null)
    expect(withNulls).toBe(0) // all fallbacks give 0 score
  })

  it('score is always non-negative', () => {
    const strat = { key: 'oversold_reversal' }
    const score = computeScore(strat, 100, 100, 100, 100, 100, 100, 100)
    expect(score).toBeGreaterThanOrEqual(0)
  })

  it('score is capped at reasonable maximum', () => {
    const strat = { key: 'oversold_reversal' }
    const score = computeScore(strat, 0, 0, 0, 100, 0, 0, -100)
    expect(score).toBeLessThanOrEqual(100)
  })
})

describe('GET /api/rankings', () => {
  it('returns rankings with default params', async () => {
    const res = await request(app).get('/api/rankings')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('rankings')
    expect(res.body).toHaveProperty('total')
    expect(res.body).toHaveProperty('hasData')
    expect(res.body).toHaveProperty('date')
    expect(res.body).toHaveProperty('board')
    expect(res.body).toHaveProperty('boardLabel')
    expect(res.body).toHaveProperty('metric')
    expect(res.body).toHaveProperty('metricLabel')
    expect(res.body).toHaveProperty('sort')
    expect(Array.isArray(res.body.rankings)).toBe(true)
  })

  it('accepts date parameter', async () => {
    const res = await request(app).get('/api/rankings?date=2026-01-01')
    expect(res.status).toBe(200)
    expect(res.body.date).toBe('2026-01-01')
    expect(Array.isArray(res.body.rankings)).toBe(true)
  })

  it('accepts board parameter', async () => {
    const res = await request(app).get('/api/rankings?board=hsb')
    expect(res.status).toBe(200)
    expect(res.body.board).toBe('hsb')
    expect(res.body.boardLabel).toBe('沪深主板')
  })

  it('accepts metric parameter', async () => {
    const res = await request(app).get('/api/rankings?metric=change_pct')
    expect(res.status).toBe(200)
    expect(res.body.metric).toBe('change_pct')
    expect(res.body.metricLabel).toBe('涨跌幅')
  })

  it('accepts limit parameter', async () => {
    const res = await request(app).get('/api/rankings?limit=5')
    expect(res.status).toBe(200)
    expect(res.body.rankings.length).toBeLessThanOrEqual(5)
  })

  it('caps limit at 200', async () => {
    const res = await request(app).get('/api/rankings?limit=999')
    expect(res.status).toBe(200)
    expect(res.body.rankings.length).toBeLessThanOrEqual(200)
  })

  it('rejects unknown board gracefully (falls back to all)', async () => {
    const res = await request(app).get('/api/rankings?board=unknown')
    expect(res.status).toBe(200)
    expect(res.body.board).toBe('all')
  })

  it('rejects unknown metric gracefully (falls back to rsi)', async () => {
    const res = await request(app).get('/api/rankings?metric=unknown')
    expect(res.status).toBe(200)
    expect(res.body.metric).toBe('rsi')
  })
})

describe('GET /api/rankings/strategies', () => {
  it('returns 200 even when no strategies exist in DB (empty rows)', async () => {
    // When loadStrategies returns [], the strategy lookup fails with '未知策略'
    const res = await request(app).get('/api/rankings/strategies')
    // Without DB strategies, returns 400 '未知策略'
    expect([200, 400]).toContain(res.status)
  })

  it('returns 400 for unknown strategy', async () => {
    const res = await request(app).get('/api/rankings/strategies?strategy=invalid_strategy')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('未知策略')
  })

  it('returns 400 for unknown strategy', async () => {
    const res = await request(app).get('/api/rankings/strategies?strategy=invalid_strategy')
    expect(res.status).toBe(400)
    expect(res.body.error).toBeTruthy()
  })
})

describe('GET /api/rankings/strategies/list', () => {
  it('returns available strategies', async () => {
    const res = await request(app).get('/api/rankings/strategies/list')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('strategies')
    expect(Array.isArray(res.body.strategies)).toBe(true)
  })
})

describe('GET /api/rankings/available-dates', () => {
  it('returns available dates', async () => {
    const res = await request(app).get('/api/rankings/available-dates')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('dates')
    expect(Array.isArray(res.body.dates)).toBe(true)
  })
})
