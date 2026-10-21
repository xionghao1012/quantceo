/**
 * routes/watchlist.ts coverage gap tests.
 * Covers: lines 238-249 (DELETE /batch endpoint).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: () => void) => {
    _req.user = { userId: 1, email: 'test@test.com', role: 'user' }
    next()
  },
}))

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([]),
  delete: vi.fn().mockReturnThis(),
}

vi.mock('../../db/db.js', () => ({
  db: mockDb,
}))

const watchlistRoutes = (await import('../../routes/watchlist.js')).default

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/watchlist', watchlistRoutes)
  return app
}

function makeChain(rows: any[]) {
  const chain: any = { then: (resolve: (v: any) => void) => resolve(rows) }
  chain.from = vi.fn().mockReturnValue(chain)
  chain.where = vi.fn().mockReturnValue(chain)
  chain.orderBy = vi.fn().mockReturnValue(chain)
  chain.limit = vi.fn().mockReturnValue(chain)
  chain.set = vi.fn().mockReturnValue(chain)
  chain.update = vi.fn().mockReturnValue(chain)
  chain.insert = vi.fn().mockReturnValue(chain)
  chain.values = vi.fn().mockReturnValue(chain)
  chain.returning = vi.fn().mockResolvedValue([])
  chain.delete = vi.fn().mockReturnValue(chain)
  chain.and = vi.fn().mockReturnValue(chain)
  return chain
}

// ── DELETE /batch ─────────────────────────────────────────────────────────────

describe('DELETE /api/watchlist/batch — lines 238-249', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.select = vi.fn().mockReturnThis()
    mockDb.from = vi.fn().mockReturnThis()
    mockDb.where = vi.fn().mockReturnThis()
    mockDb.orderBy = vi.fn().mockReturnThis()
    mockDb.limit = vi.fn().mockReturnThis()
    mockDb.insert = vi.fn().mockReturnThis()
    mockDb.update = vi.fn().mockReturnThis()
    mockDb.set = vi.fn().mockReturnThis()
    mockDb.values = vi.fn().mockReturnThis()
    mockDb.returning = vi.fn().mockResolvedValue([])
    mockDb.delete = vi.fn().mockReturnThis()
  })

  it('returns 400 when codes is missing', async () => {
    const res = await request(createApp()).delete('/api/watchlist/batch').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/股票代码/)
  })

  it('returns 400 when codes is not an array', async () => {
    const res = await request(createApp()).delete('/api/watchlist/batch').send({ codes: 'not-an-array' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when codes is empty array', async () => {
    const res = await request(createApp()).delete('/api/watchlist/batch').send({ codes: [] })
    expect(res.status).toBe(400)
  })

  it('returns 400 when codes length exceeds 100', async () => {
    const res = await request(createApp()).delete('/api/watchlist/batch').send({ codes: Array(101).fill('600000') })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/100/)
  })

  it('returns 200 and deletes valid codes', async () => {
    const { db } = await import('../../db/db.js')
    ;(db.delete as any).mockReturnValueOnce({
      where: vi.fn().mockResolvedValue({ rowCount: 2 }),
    })

    const res = await request(createApp())
      .delete('/api/watchlist/batch')
      .send({ codes: ['600000', '600001'] })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('deleted')
  })

  it('filters out non-string codes before deletion', async () => {
    const { db } = await import('../../db/db.js')
    ;(db.delete as any).mockReturnValueOnce({
      where: vi.fn().mockResolvedValue({ rowCount: 1 }),
    })

    const res = await request(createApp())
      .delete('/api/watchlist/batch')
      .send({ codes: ['600000', null, undefined, 123, '600001'] })
    expect(res.status).toBe(200)
  })
})
