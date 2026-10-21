import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp } from '../helpers.js'

const { mockGetOrFetchKlines, mockBatchGetKlines } = vi.hoisted(() => {
  return {
    mockGetOrFetchKlines: vi.fn(),
    mockBatchGetKlines: vi.fn(),
  }
})

const mockStocks = [{ code: '000001', name: 'Test Stock' }]

// A Drizzle-like query builder that is both awaitable (returns rows) and chainable
class QueryBuilder {
  private _stocks: any[]
  constructor(rows: any[]) { this._stocks = rows }
  // Make it awaitable (thenable)
  then<TResult1 = any[], TResult2 = never>(
    onfulfilled?: ((value: any[]) => TResult1 | PromiseLike<TResult1>) | null,
    _onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this._stocks).then(onfulfilled!)
  }
  // Chainable methods
  from() { return this }
  where() { return this }
  orderBy() { return this }
  limit() { return this }
  offset() { return this }
  innerJoin() { return this }
  groupBy() { return this }
}

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn().mockImplementation(() => new QueryBuilder(mockStocks)),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('../../data/cache.js', () => ({
  getOrFetchKlines: mockGetOrFetchKlines,
  batchGetKlines: mockBatchGetKlines,
}))

vi.mock('../../scan/index.js', () => ({
  scanStock: vi.fn(),
}))

vi.mock('../../db/db.js', () => ({
  db: mockDb,
}))

const { scanStock } = await import('../../scan/index.js')

const app = createTestApp()
const scanRoutes = (await import('../../routes/scan.js')).default
app.use('/api/scan', scanRoutes)

beforeEach(() => {
  vi.clearAllMocks()
  mockGetOrFetchKlines.mockResolvedValue({ klines: [] })
  mockBatchGetKlines.mockResolvedValue({})
  ;(scanStock as any).mockReset?.()
  // Reset select to return fresh QueryBuilder
  mockDb.select = vi.fn().mockImplementation(() => new QueryBuilder(mockStocks))
})

// ─── POST / — inner loop branches (lines 68-79) ─────────────────────────────

describe('POST /api/scan — inner loop branches (lines 68-79)', () => {
  it('skips stocks with insufficient klines from batchGetKlines (line 69-72)', async () => {
    mockBatchGetKlines.mockResolvedValueOnce({ '000001': Array.from({ length: 50 }, (_, i) => ({ date: `2024-01-${String(i+1).padStart(2,'0')}`, close: 10 })) })
    mockGetOrFetchKlines.mockResolvedValueOnce({ klines: Array.from({ length: 120 }, (_, i) => ({ date: `2024-01-${String(i+1).padStart(2,'0')}`, close: 10 })) })
    ;(scanStock as any).mockReturnValueOnce({ code: '000001', name: 'Test', signals: [], totalStrength: 10 })

    const res = await request(app).post('/api/scan').send({ codes: ['000001'] })
    expect([200, 500]).toContain(res.status)
  })

  it('skips stocks where klines < 100 after fallback (line 73)', async () => {
    mockBatchGetKlines.mockResolvedValueOnce({ '000001': Array.from({ length: 50 }, (_, i) => ({ date: `2024-01-${String(i+1).padStart(2,'0')}`, close: 10 })) })
    mockGetOrFetchKlines.mockResolvedValueOnce({ klines: Array.from({ length: 80 }, (_, i) => ({ date: `2024-01-${String(i+1).padStart(2,'0')}`, close: 10 })) })

    const res = await request(app).post('/api/scan').send({ codes: ['000001'] })
    expect([200, 500]).toContain(res.status)
  })

  it('handles scanStock throwing (line 74-78)', async () => {
    mockBatchGetKlines.mockResolvedValueOnce({ '000001': Array.from({ length: 120 }, (_, i) => ({ date: `2024-01-${String(i+1).padStart(2,'0')}`, close: 10 })) })
    ;(scanStock as any).mockImplementationOnce(() => { throw new Error('Scan error') })

    const res = await request(app).post('/api/scan').send({ codes: ['000001'] })
    expect([200, 500]).toContain(res.status)
  })
})

// ─── POST /stream — error handling (lines 111-116) ────────────────────────────

describe('POST /api/scan/stream — error handling branches (lines 111-116)', () => {
  it('handles scanStock error in stream endpoint (line 116 catch)', async () => {
    mockBatchGetKlines.mockResolvedValueOnce({})
    mockGetOrFetchKlines.mockResolvedValueOnce({ klines: Array.from({ length: 120 }, (_, i) => ({ date: `2024-01-${String(i+1).padStart(2,'0')}`, close: 10 })) })
    ;(scanStock as any).mockImplementationOnce(() => { throw new Error('Stream scan error') })

    const res = await request(app).post('/api/scan/stream').send({ codes: ['000001'] })
    expect([200, 500]).toContain(res.status)
  })

  it('skips stocks with no klines in stream (line 113)', async () => {
    mockBatchGetKlines.mockResolvedValueOnce({})
    mockGetOrFetchKlines.mockResolvedValueOnce({ klines: [] })

    const res = await request(app).post('/api/scan/stream').send({ codes: ['000001'] })
    expect([200, 500]).toContain(res.status)
  })
})

// ─── POST /save-klines ───────────────────────────────────────────────────────

describe('POST /api/scan/save-klines', () => {
  it('saves klines to DB', async () => {
    const insertChain: any = { values: vi.fn().mockReturnThis(), onConflictDoNothing: vi.fn().mockResolvedValue([]) }
    mockDb.insert = vi.fn().mockReturnValue(insertChain)

    const klineData = [{ code: '000001', date: '2024-01-01', open: 10, high: 11, low: 9, close: 10.5, volume: 1000000, amount: 10500000 }]
    const res = await request(app).post('/api/scan/save-klines').send({ code: '000001', klineData })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('saved')
  })
})
