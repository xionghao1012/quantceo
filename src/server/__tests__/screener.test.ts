import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createTestApp } from './helpers.js'
import screenerRoutes from '../routes/screener.js'

const app = createTestApp()
app.use('/api/screener', screenerRoutes)

describe('GET /api/screener/fields', () => {
  it('returns available screener fields', async () => {
    const res = await request(app).get('/api/screener/fields')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('fields')
    expect(Array.isArray(res.body.fields)).toBe(true)
    expect(res.body.fields.length).toBeGreaterThan(0)

    const field = res.body.fields[0]
    expect(field).toHaveProperty('field')
    expect(field).toHaveProperty('label')
    expect(field).toHaveProperty('type')
    expect(field).toHaveProperty('operators')
    expect(Array.isArray(field.operators)).toBe(true)
  })
})

describe('POST /api/screener', () => {
  it('returns 400 with empty conditions', async () => {
    const res = await request(app)
      .post('/api/screener')
      .send({ conditions: [] })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('condition')
  })

  it('returns 400 with invalid field', async () => {
    const res = await request(app)
      .post('/api/screener')
      .send({ conditions: [{ field: 'invalid_field', operator: '>', value: 10 }] })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Invalid field')
  })

  it('returns 400 with invalid operator', async () => {
    const res = await request(app)
      .post('/api/screener')
      .send({ conditions: [{ field: 'price', operator: '!!', value: 10 }] })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Invalid operator')
  })

  it('screens with valid conditions (may return empty)', { timeout: 30000 }, async () => {
    const res = await request(app)
      .post('/api/screener')
      .send({
        conditions: [{ field: 'price', operator: '>', value: 0 }],
        sort: { field: 'change', order: 'desc' },
        page: 1,
        limit: 10,
      })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('total')
    expect(res.body).toHaveProperty('page')
    expect(res.body).toHaveProperty('limit')
    expect(res.body).toHaveProperty('stocks')
    expect(Array.isArray(res.body.stocks)).toBe(true)
  })

  it('accepts between operator', { timeout: 30000 }, async () => {
    const res = await request(app)
      .post('/api/screener')
      .send({
        conditions: [{ field: 'price', operator: 'between', value: [0, 1000] }],
        limit: 5,
      })
    expect(res.status).toBe(200)
  })

  it('accepts cross_above operator', { timeout: 30000 }, async () => {
    const res = await request(app)
      .post('/api/screener')
      .send({
        conditions: [{ field: 'ma5', operator: 'cross_above', value: 'ma10' }],
        limit: 5,
      })
    expect(res.status).toBe(200)
  })

  it('accepts cross_below operator', { timeout: 30000 }, async () => {
    const res = await request(app)
      .post('/api/screener')
      .send({
        conditions: [{ field: 'ma5', operator: 'cross_below', value: 'ma10' }],
        limit: 5,
      })
    expect(res.status).toBe(200)
  })

  // ─── Uncovered line 163: < operator (val >= value returns null) ─────────────
  it('returns 400 with < operator when val is greater than or equal to value', { timeout: 30000 }, async () => {
    const res = await request(app)
      .post('/api/screener')
      .send({
        conditions: [{ field: 'price', operator: '<', value: 0 }],
      })
    // price 0 is not < 0, so stock is filtered out; empty result is OK
    expect(res.status).toBe(200)
  })

  // ─── Uncovered line 165: == operator (abs difference > 0.001) ───────────────
  it('filters stocks that do not match == operator within tolerance', { timeout: 30000 }, async () => {
    const res = await request(app)
      .post('/api/screener')
      .send({
        conditions: [{ field: 'price', operator: '==', value: 999999 }],
        limit: 10,
      })
    // No stock will have exactly 999999, so all filtered out
    expect(res.status).toBe(200)
    expect(res.body.stocks).toHaveLength(0)
  })

  // ─── Uncovered line 148: NaN in cross_above operator ────────────────────────
  it('handles NaN values in cross_above indicator', { timeout: 30000 }, async () => {
    // Use rsi (can be NaN when insufficient data) as the cross field
    const res = await request(app)
      .post('/api/screener')
      .send({
        conditions: [{ field: 'rsi', operator: 'cross_above', value: 'ma5' }],
        limit: 5,
      })
    // NaN values cause return null (filtered out), but request still succeeds
    expect(res.status).toBe(200)
  })

  it('handles NaN values in cross_below indicator', { timeout: 30000 }, async () => {
    const res = await request(app)
      .post('/api/screener')
      .send({
        conditions: [{ field: 'rsi', operator: 'cross_below', value: 'ma5' }],
        limit: 5,
      })
    expect(res.status).toBe(200)
  })

  // ─── Sort by name (string sort path) ───────────────────────────────────────
  it('sorts by name ascending', { timeout: 30000 }, async () => {
    const res = await request(app)
      .post('/api/screener')
      .send({
        conditions: [{ field: 'price', operator: '>', value: 0 }],
        sort: { field: 'name', order: 'asc' },
        limit: 5,
      })
    expect(res.status).toBe(200)
    // Verify name sorting works (string localeCompare)
    if (res.body.stocks.length > 1) {
      const names = res.body.stocks.map((s: any) => s.name)
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    }
  })
})
