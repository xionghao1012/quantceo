/**
 * routes/rankings.ts coverage gap tests — round 2.
 * Covers: line 66 (strategiesCache.map), lines 247-248 (strategies catch),
 * line 327 (available-dates catch).
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
  limit: vi.fn().mockResolvedValue([]),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([]),
  delete: vi.fn().mockReturnThis(),
  execute: vi.fn().mockResolvedValue({ rows: [] }),
}

vi.mock('../../db/db.js', () => ({ db: mockDb }))

const rankingsRoutes = (await import('../../routes/rankings.js')).default

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/rankings', rankingsRoutes)
  return app
}

// ── Lines 247-248: GET /strategies catch ────────────────────────────────────

describe('GET /api/rankings/strategies — lines 247-248 (catch)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the module-level strategiesCache by invalidating via the exported function
    // (if available) or by patching the module
    vi.resetModules()
  })

  it('returns 500 when db throws in strategies endpoint', async () => {
    // After vi.resetModules(), the module is re-imported with fresh state
    // But we need to make the select throw - let's use a different approach
    // by mocking db.select to throw only for this specific call
    mockDb.select = vi.fn().mockImplementation(() => {
      throw new Error('DB error')
    })

    // Re-import routes after reset
    const rankingsRoutes2 = (await import('../../routes/rankings.js')).default
    const app2 = express()
    app2.use(express.json())
    app2.use('/api/rankings', rankingsRoutes2)

    const res = await request(app2)
      .get('/api/rankings/strategies')
      .query({ strategy: 'oversold_reversal' })
    expect(res.status).toBe(500)
    expect(res.body).toHaveProperty('error')
  })
})

// ── Line 327: GET /available-dates catch ───────────────────────────────────

describe('GET /api/rankings/available-dates — line 327 (catch)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.select = vi.fn().mockReturnThis()
    mockDb.from = vi.fn().mockReturnThis()
    mockDb.where = vi.fn().mockReturnThis()
    mockDb.orderBy = vi.fn().mockReturnThis()
    mockDb.limit = vi.fn().mockResolvedValue([])
    mockDb.insert = vi.fn().mockReturnThis()
    mockDb.update = vi.fn().mockReturnThis()
    mockDb.set = vi.fn().mockReturnThis()
    mockDb.values = vi.fn().mockReturnThis()
    mockDb.returning = vi.fn().mockResolvedValue([])
    mockDb.delete = vi.fn().mockReturnThis()
    mockDb.execute = vi.fn().mockResolvedValue({ rows: [] })
  })

  it('returns 500 when db.execute throws', async () => {
    const { db } = await import('../../db/db.js')
    ;(db.execute as any).mockRejectedValueOnce(new Error('DB error'))

    const res = await request(createApp()).get('/api/rankings/available-dates')
    expect(res.status).toBe(500)
    expect(res.body).toHaveProperty('error')
  })
})
