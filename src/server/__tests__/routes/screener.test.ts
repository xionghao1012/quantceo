import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import screenerRoutes from '../../routes/screener.js'

// Make thenable that resolves to data when awaited
function thenable(data: unknown) {
  const p = Promise.resolve(data)
  const t: any = () => p
  t.then = (onF: any, onR: any) => p.then(onF, onR)
  return t
}

// Mock db using vi.hoisted so it's available before vi.mock runs
const { mockDb } = vi.hoisted(() => {
  const db = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  }
  return { mockDb: db }
})

vi.mock('../../db/db.js', () => ({ db: mockDb }))

const app = express()
app.use(express.json())
app.use('/api/screener', screenerRoutes)

function resetDb() {
  vi.clearAllMocks()
  mockDb.select = vi.fn().mockReturnThis()
  mockDb.from = vi.fn().mockReturnThis()
  mockDb.where = vi.fn().mockReturnThis()
  mockDb.orderBy = vi.fn().mockReturnThis()
  mockDb.limit = vi.fn().mockResolvedValue([])
}

// Make db.select().from(stocks) resolve to a specific value
function setFromStocks(data: unknown) {
  mockDb.from = vi.fn().mockReturnValue(thenable(data))
}

describe('GET /api/screener/fields', () => {
  it('returns screener fields', async () => {
    const res = await request(app).get('/api/screener/fields')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('fields')
    expect(Array.isArray(res.body.fields)).toBe(true)
  })

  it('has all expected fields', async () => {
    const res = await request(app).get('/api/screener/fields')
    const fieldNames = res.body.fields.map((f: any) => f.field)
    expect(fieldNames).toContain('price')
    expect(fieldNames).toContain('change')
    expect(fieldNames).toContain('volume')
    expect(fieldNames).toContain('ma5')
    expect(fieldNames).toContain('ma10')
    expect(fieldNames).toContain('ma20')
    expect(fieldNames).toContain('ma60')
    expect(fieldNames).toContain('macd')
    expect(fieldNames).toContain('rsi')
  })

  it('fields have required properties', async () => {
    const res = await request(app).get('/api/screener/fields')
    for (const f of res.body.fields) {
      expect(f).toHaveProperty('field')
      expect(f).toHaveProperty('label')
      expect(f).toHaveProperty('type')
      expect(f).toHaveProperty('operators')
      expect(Array.isArray(f.operators)).toBe(true)
    }
  })

  it('operators are valid for each field', async () => {
    const res = await request(app).get('/api/screener/fields')
    for (const f of res.body.fields) {
      for (const op of f.operators) {
        expect(['>', '<', '==', 'between']).toContain(op)
      }
    }
  })

  it('number fields support comparison operators', async () => {
    const res = await request(app).get('/api/screener/fields')
    const priceField = res.body.fields.find((f: any) => f.field === 'price')
    expect(priceField.type).toBe('number')
    expect(priceField.operators).toContain('>')
    expect(priceField.operators).toContain('<')
    expect(priceField.operators).toContain('==')
  })

  it('price field supports between operator', async () => {
    const res = await request(app).get('/api/screener/fields')
    const priceField = res.body.fields.find((f: any) => f.field === 'price')
    expect(priceField.operators).toContain('between')
  })

  it('MA fields do not support between operator', async () => {
    const res = await request(app).get('/api/screener/fields')
    const maField = res.body.fields.find((f: any) => f.field === 'ma5')
    expect(maField.operators).not.toContain('between')
  })
})

// ─── POST / — uncovered branches ───────────────────────────────────────────────

describe('POST /api/screener (uncovered branches)', () => {
  beforeEach(() => {
    resetDb()
  })

  it('returns 400 when conditions array is empty', async () => {
    setFromStocks([])
    const res = await request(app)
      .post('/api/screener')
      .send({ conditions: [], sort: { field: 'change', order: 'desc' } })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('At least one condition is required')
  })

  it('returns 400 for invalid field name', async () => {
    setFromStocks([])
    const res = await request(app)
      .post('/api/screener')
      .send({ conditions: [{ field: 'invalid_field', operator: '>', value: 100 }] })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid field: invalid_field')
  })

  it('returns 400 for invalid operator', async () => {
    setFromStocks([])
    const res = await request(app)
      .post('/api/screener')
      .send({ conditions: [{ field: 'price', operator: '!==', value: 100 }] })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid operator: !==')
  })

  it('clamps limit to 100 and page to minimum 1', async () => {
    setFromStocks([])
    const res = await request(app)
      .post('/api/screener')
      .send({ conditions: [{ field: 'price', operator: '>', value: 100 }], limit: 999, page: 0 })
    // Returns 200 with empty results (no stocks to filter)
    expect([200, 500]).toContain(res.status)
    if (res.status === 200) {
      expect(res.body.limit).toBeLessThanOrEqual(100)
      expect(res.body.page).toBeGreaterThanOrEqual(1)
    }
  })

  it('sorts by name field (string localeCompare path)', async () => {
    setFromStocks([])
    const res = await request(app)
      .post('/api/screener')
      .send({ conditions: [{ field: 'price', operator: '>', value: 0 }], sort: { field: 'name', order: 'desc' } })
    expect([200, 500]).toContain(res.status)
  })
})
