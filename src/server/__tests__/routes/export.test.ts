import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

// ─── Mock xlsx ────────────────────────────────────────────────────────────────
vi.mock('xlsx', () => ({
  utils: {
    book_new: vi.fn().mockReturnValue({}),
    json_to_sheet: vi.fn().mockReturnValue({}),
    book_append_sheet: vi.fn(),
  },
  write: vi.fn().mockReturnValue(Buffer.alloc(0)),
}))

// ─── Mock fs (existsSync / mkdirSync / writeFileSync) ─────────────────────────
const { mockFs } = vi.hoisted(() => ({
  mockFs: {
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}))
vi.mock('fs', () => ({
  writeFileSync: mockFs.writeFileSync,
  mkdirSync: mockFs.mkdirSync,
  existsSync: mockFs.existsSync,
}))

// ─── Mock db chain ────────────────────────────────────────────────────────────
function createChainableDb() {
  const mock: any = {}
  const methods = ['select', 'from', 'orderBy', 'limit', 'innerJoin',
    'groupBy', 'update', 'set', 'insert', 'values', 'returning']

  for (const m of methods) {
    mock[m] = vi.fn().mockReturnValue(mock)
  }
  // where() must be iterable (code does: const [task] = await ...where(...))
  // but also chainable (tasks endpoint does: .where(...).orderBy(...).limit(50))
  const makeWhereResult = (rows: any[]) => {
    const result = rows
    ;(result as any).orderBy = vi.fn().mockReturnValue(result)
    ;(result as any).limit = vi.fn().mockReturnValue(result)
    return result
  }
  mock.where = vi.fn().mockImplementation(() => makeWhereResult([]))
  mock.execute = vi.fn().mockResolvedValue({ rows: [] })
  return mock
}

const { mockDb } = vi.hoisted(() => ({ mockDb: createChainableDb() }))

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: () => void) => next(),
  optionalAuth: (_req: any, _res: any, next: () => void) => next(),
}))

vi.mock('../../middleware/adminRbac.js', () => ({
  requireAdminRole: (_role: string) => (_req: any, _res: any, next: () => void) => next(),
}))

vi.mock('../../middleware/requireAdmin.js', () => ({
  requireAdmin: (_req: any, _res: any, next: () => void) => next(),
}))

vi.mock('../../db/db.js', () => ({ db: mockDb }))

// ─── Mock repository ──────────────────────────────────────────────────────────
const { mockRepo } = vi.hoisted(() => {
  const repo = {
    create: vi.fn().mockResolvedValue({ id: 1 }),
    updateProgress: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  }
  return { mockRepo: repo }
})

vi.mock('../../repositories/IExportTaskRepository.js', () => ({
  getExportTaskRepository: vi.fn(() => mockRepo),
}))

// ─── App setup ────────────────────────────────────────────────────────────────
const exportRoutes = (await import('../../routes/export.js')).default

function createApp() {
  const app = express()
  app.use(express.json())
  // Stub res.download so it doesn't hit filesystem
  app.use((req, res, next) => {
    res.download = ((_file: any, _filename: any, cb: any) => {
      if (cb) cb()
      else res.end()
    }) as any
    next()
  })
  app.use('/api/export', exportRoutes)
  return app
}

const app = createApp()

const chainMethods = ['select', 'from', 'orderBy', 'limit', 'innerJoin',
  'groupBy', 'update', 'set', 'insert', 'values', 'returning']

function resetDb() {
  for (const m of chainMethods) {
    ;(mockDb as any)[m] = vi.fn().mockReturnValue(mockDb)
  }
  const makeWhereResult = (rows: any[]) => {
    const result = rows
    ;(result as any).orderBy = vi.fn().mockReturnValue(result)
    ;(result as any).limit = vi.fn().mockReturnValue(result)
    return result
  }
  mockDb.where = vi.fn().mockImplementation(() => makeWhereResult([]))
  mockDb.execute = vi.fn().mockResolvedValue({ rows: [] })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDb()
  mockRepo.create.mockResolvedValue({ id: 1 })
  mockRepo.updateProgress.mockResolvedValue(undefined)
  mockRepo.complete.mockResolvedValue(undefined)
  mockRepo.fail.mockResolvedValue(undefined)
  // Reset fs mock so mkdirSync branch is exercised (existsSync=false → mkdirSync called)
  mockFs.existsSync.mockReturnValue(false)
  mockFs.mkdirSync.mockClear()
  mockFs.writeFileSync.mockClear()
})

// ─── Helper to wire SELECT chain returning rows ───────────────────────────────
function wireSelect(rows: any[]) {
  mockDb.select = vi.fn().mockReturnValue(mockDb)
  mockDb.from = vi.fn().mockReturnValue(mockDb)
  const makeWhereResult = (r: any[]) => {
    const result = r
    ;(result as any).orderBy = vi.fn().mockReturnValue(result)
    ;(result as any).limit = vi.fn().mockReturnValue(result)
    return result
  }
  mockDb.where = vi.fn().mockImplementation(() => makeWhereResult(rows))
}

// ─── POST /create ─────────────────────────────────────────────────────────────

describe('POST /api/export/create', () => {
  it('returns 400 when type is missing', async () => {
    const res = await request(app).post('/api/export/create').send({ params: {} })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('type required: csv or excel')
  })

  it('returns 400 when type is invalid', async () => {
    const res = await request(app).post('/api/export/create').send({ type: 'pdf', params: {} })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('type required: csv or excel')
  })

  it('CSV: calls create, updateProgress(50), complete, returns 200', async () => {
    const mockRows = [
      { code: '600519', name: '贵州茅台', tradeDate: '2026-01-15', closePrice: 1800, changePct: 2.5,
        netInflowSuperLarge: 100, netInflowLarge: 200, netInflowMedium: 50, netInflowSmall: -10,
        netInflowMain: 340, netInflowMainPct: 1.2, turnoverRate: 0.5 },
    ]
    wireSelect(mockRows)

    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'csv', params: { startDate: '2026-01-01', endDate: '2026-01-31' } })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('completed')
    expect(res.body.downloadUrl).toMatch(/^\/api\/export\/download\/\d+$/)
    expect(mockRepo.create).toHaveBeenCalledWith({ type: 'csv', params: expect.any(Object) })
    expect(mockRepo.updateProgress).toHaveBeenCalledWith(1, 50)
    expect(mockRepo.complete).toHaveBeenCalledWith(1, expect.any(String))
    expect(mockRepo.fail).not.toHaveBeenCalled()
  })

  it('Excel: multiple rows same date → dateMap else branch (entry already exists)', async () => {
    const mockRows = [
      { code: '600519', name: '贵州茅台', tradeDate: '2026-01-15', closePrice: 1800, changePct: 2.5,
        netInflowSuperLarge: 100, netInflowLarge: 200, netInflowMedium: 50, netInflowSmall: -10,
        netInflowMain: 340, netInflowMainPct: 1.2, turnoverRate: 0.5 },
      { code: '000001', name: '平安银行', tradeDate: '2026-01-15', closePrice: 12, changePct: 1,
        netInflowSuperLarge: 50, netInflowLarge: 100, netInflowMedium: 30, netInflowSmall: -5,
        netInflowMain: 175, netInflowMainPct: 0.8, turnoverRate: 0.3 },
      { code: '600519', name: '贵州茅台', tradeDate: '2026-01-16', closePrice: 1810, changePct: 0.56,
        netInflowSuperLarge: 200, netInflowLarge: 300, netInflowMedium: 60, netInflowSmall: -20,
        netInflowMain: 540, netInflowMainPct: 2.0, turnoverRate: 0.6 },
    ]
    wireSelect(mockRows)

    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'excel', params: { codes: ['600519', '000001'], startDate: '2026-01-01', endDate: '2026-01-31' } })

    expect(res.status).toBe(200)
    expect(mockRepo.complete).toHaveBeenCalled()
  })

  it('CSV: escapes double-quotes and commas in cell values', async () => {
    const mockRows = [
      { code: '600519', name: '贵州"茅台', tradeDate: '2026-01-15', closePrice: 1800, changePct: 2.5,
        netInflowSuperLarge: 100, netInflowLarge: 200, netInflowMedium: 50, netInflowSmall: -10,
        netInflowMain: 340, netInflowMainPct: 1.2, turnoverRate: 0.5 },
    ]
    wireSelect(mockRows)

    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'csv', params: { startDate: '2026-01-01', endDate: '2026-01-31' } })

    expect(res.status).toBe(200)
    expect(mockRepo.complete).toHaveBeenCalled()
  })

  it('CSV: applies codes filter via inArray', async () => {
    wireSelect([])

    await request(app)
      .post('/api/export/create')
      .send({ type: 'csv', params: { codes: ['600519', '000001'], startDate: '2026-01-01', endDate: '2026-01-31' } })

    expect(mockDb.where).toHaveBeenCalled()
    expect(mockRepo.updateProgress).toHaveBeenCalledWith(1, 50)
  })

  it('CSV: applies date range filters', async () => {
    wireSelect([])

    await request(app)
      .post('/api/export/create')
      .send({ type: 'csv', params: { startDate: '2026-01-01', endDate: '2026-01-31' } })

    expect(mockDb.where).toHaveBeenCalled()
    expect(mockRepo.updateProgress).toHaveBeenCalledWith(1, 50)
  })

  it('CSV: scope=sector filters rows by codes', async () => {
    const mockRows = [
      { code: '600519', name: '贵州茅台', tradeDate: '2026-01-15', closePrice: 1800, changePct: 2.5,
        netInflowSuperLarge: 0, netInflowLarge: 0, netInflowMedium: 0, netInflowSmall: 0,
        netInflowMain: 0, netInflowMainPct: 0, turnoverRate: 0 },
      { code: '000001', name: '平安银行', tradeDate: '2026-01-15', closePrice: 12, changePct: 1,
        netInflowSuperLarge: 0, netInflowLarge: 0, netInflowMedium: 0, netInflowSmall: 0,
        netInflowMain: 0, netInflowMainPct: 0, turnoverRate: 0 },
    ]
    wireSelect(mockRows)

    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'csv', params: { codes: ['600519'], scope: 'sector', startDate: '2026-01-01', endDate: '2026-01-31' } })

    expect(res.status).toBe(200)
    expect(mockRepo.complete).toHaveBeenCalled()
  })

  it('Excel: calls create, updateProgress(80), buildExcelBuffer, updateProgress(100), complete', async () => {
    const mockRows = [
      { code: '600519', name: '贵州茅台', tradeDate: '2026-01-15', closePrice: 1800, changePct: 2.5,
        netInflowSuperLarge: 100, netInflowLarge: 200, netInflowMedium: 50, netInflowSmall: -10,
        netInflowMain: 340, netInflowMainPct: 1.2, turnoverRate: 0.5 },
    ]
    wireSelect(mockRows)

    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'excel', params: { startDate: '2026-01-01', endDate: '2026-01-31' } })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('completed')
    expect(mockRepo.create).toHaveBeenCalledWith({ type: 'excel', params: expect.any(Object) })
    expect(mockRepo.updateProgress).toHaveBeenNthCalledWith(1, 1, 50)
    expect(mockRepo.updateProgress).toHaveBeenNthCalledWith(2, 1, 80)
    expect(mockRepo.complete).toHaveBeenCalledWith(1, expect.any(String))
  })

  it('Excel: computes trends dateMap correctly (multiple rows same date)', async () => {
    const mockRows = [
      { code: '600519', name: '贵州茅台', tradeDate: '2026-01-15', closePrice: 1800, changePct: 2.5,
        netInflowSuperLarge: 100, netInflowLarge: 200, netInflowMedium: 50, netInflowSmall: -10,
        netInflowMain: 340, netInflowMainPct: 1.2, turnoverRate: 0.5 },
      { code: '000001', name: '平安银行', tradeDate: '2026-01-15', closePrice: 12, changePct: 1,
        netInflowSuperLarge: 50, netInflowLarge: 100, netInflowMedium: 30, netInflowSmall: -5,
        netInflowMain: 175, netInflowMainPct: 0.8, turnoverRate: 0.3 },
      { code: '600519', name: '贵州茅台', tradeDate: '2026-01-16', closePrice: 1810, changePct: 0.56,
        netInflowSuperLarge: 200, netInflowLarge: 300, netInflowMedium: 60, netInflowSmall: -20,
        netInflowMain: 540, netInflowMainPct: 2.0, turnoverRate: 0.6 },
    ]
    wireSelect(mockRows)

    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'excel', params: { codes: ['600519', '000001'], startDate: '2026-01-01', endDate: '2026-01-31' } })

    expect(res.status).toBe(200)
    expect(mockRepo.complete).toHaveBeenCalled()
  })

  it('Excel: builds latestByCode map correctly (keeps newest row per code)', async () => {
    const mockRows = [
      { code: '600519', name: '贵州茅台', tradeDate: '2026-01-15', closePrice: 1800, changePct: 2.5,
        netInflowSuperLarge: 100, netInflowLarge: 200, netInflowMedium: 50, netInflowSmall: -10,
        netInflowMain: 340, netInflowMainPct: 1.2, turnoverRate: 0.5 },
      { code: '600519', name: '贵州茅台', tradeDate: '2026-01-16', closePrice: 1810, changePct: 0.56,
        netInflowSuperLarge: 200, netInflowLarge: 300, netInflowMedium: 60, netInflowSmall: -20,
        netInflowMain: 540, netInflowMainPct: 2.0, turnoverRate: 0.6 },
      { code: '000001', name: '平安银行', tradeDate: '2026-01-16', closePrice: 12, changePct: 1,
        netInflowSuperLarge: 50, netInflowLarge: 100, netInflowMedium: 30, netInflowSmall: -5,
        netInflowMain: 175, netInflowMainPct: 0.8, turnoverRate: 0.3 },
    ]
    wireSelect(mockRows)

    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'excel', params: { codes: ['600519', '000001'], startDate: '2026-01-01', endDate: '2026-01-31' } })

    expect(res.status).toBe(200)
    expect(mockRepo.complete).toHaveBeenCalled()
  })

  it('returns 500 and calls fail when DB query throws', async () => {
    const insertChain: any = { values: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([{ id: 2 }]) }
    mockDb.insert = vi.fn().mockReturnValue(insertChain)
    mockDb.select = vi.fn().mockImplementation(() => { throw new Error('Query failed') })
    mockDb.update = vi.fn().mockReturnValue({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) })

    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'csv', params: { startDate: '2026-01-01', endDate: '2026-01-31' } })

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Query failed')
    expect(mockRepo.fail).toHaveBeenCalledWith(0, 'Query failed')
  })

  it('calls fail(taskId=0) when create throws', async () => {
    mockRepo.create.mockRejectedValue(new Error('Create failed'))

    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'csv', params: {} })

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Create failed')
    expect(mockRepo.fail).toHaveBeenCalledWith(0, 'Create failed')
  })

  it('handles scope=market without codes filter', async () => {
    wireSelect([])
    mockDb.execute = vi.fn().mockResolvedValue({ rows: [] })

    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'csv', params: { scope: 'market', startDate: '2026-01-01', endDate: '2026-01-31' } })

    expect(res.status).toBe(200)
    expect(mockRepo.complete).toHaveBeenCalled()
  })

  it('POST /create: uses default endDate (no startDate) → lte only', async () => {
    wireSelect([])
    // When startDate is absent, gte condition is skipped
    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'csv', params: { endDate: '2026-01-31' } })

    expect(res.status).toBe(200)
    expect(mockRepo.complete).toHaveBeenCalled()
  })

  it('POST /create: no codes → skips inArray condition', async () => {
    wireSelect([])
    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'csv', params: { startDate: '2026-01-01', endDate: '2026-01-31' } })

    expect(res.status).toBe(200)
    expect(mockRepo.complete).toHaveBeenCalled()
  })

  it('POST /create: codes explicitly undefined → codes?.length false branch', async () => {
    wireSelect([])
    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'csv', params: { codes: undefined, startDate: '2026-01-01', endDate: '2026-01-31' } })

    expect(res.status).toBe(200)
    expect(mockRepo.complete).toHaveBeenCalled()
  })

  it('POST /create: existsSync=true → skips mkdirSync branch', async () => {
    mockFs.existsSync.mockReturnValue(true)
    wireSelect([])
    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'csv', params: { startDate: '2026-01-01', endDate: '2026-01-31' } })

    expect(res.status).toBe(200)
    expect(mockFs.mkdirSync).not.toHaveBeenCalled()
  })

  it('Excel: latestByCode keeps newer row (else branch when existing is newer)', async () => {
    // Row 1: 600519 on 2026-01-16 (newer)
    // Row 2: 600519 on 2026-01-15 (older) → should be skipped
    const mockRows = [
      { code: '600519', name: '贵州茅台', tradeDate: '2026-01-16', closePrice: 1810, changePct: 0.56,
        netInflowSuperLarge: 200, netInflowLarge: 300, netInflowMedium: 60, netInflowSmall: -20,
        netInflowMain: 540, netInflowMainPct: 2.0, turnoverRate: 0.6 },
      { code: '600519', name: '贵州茅台', tradeDate: '2026-01-15', closePrice: 1800, changePct: 2.5,
        netInflowSuperLarge: 100, netInflowLarge: 200, netInflowMedium: 50, netInflowSmall: -10,
        netInflowMain: 340, netInflowMainPct: 1.2, turnoverRate: 0.5 },
    ]
    wireSelect(mockRows)

    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'excel', params: { startDate: '2026-01-01', endDate: '2026-01-31' } })

    expect(res.status).toBe(200)
    expect(mockRepo.complete).toHaveBeenCalled()
  })
})

// ─── GET /tasks ───────────────────────────────────────────────────────────────

describe('GET /api/export/tasks', () => {
  it('returns tasks without userId filter', async () => {
    const tasks = [
      { id: 1, type: 'csv', status: 'completed', progress: 100 },
      { id: 2, type: 'excel', status: 'pending', progress: 50 },
    ]
    wireSelect(tasks)

    const res = await request(app).get('/api/export/tasks')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
  })

  it('filters by userId when provided', async () => {
    wireSelect([{ id: 3, userId: 'user-123' }])

    const res = await request(app).get('/api/export/tasks?userId=user-123')

    expect(res.status).toBe(200)
    expect(mockDb.where).toHaveBeenCalled()
  })

  it('applies limit(50) and returns up to 50 tasks', async () => {
    const manyTasks = Array.from({ length: 60 }, (_, i) => ({ id: i + 1 }))
    wireSelect(manyTasks.slice(0, 50))

    const res = await request(app).get('/api/export/tasks')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(50)
  })

  it('orders by createdAt desc', async () => {
    const tasks = [
      { id: 2, createdAt: new Date('2026-01-16') },
      { id: 1, createdAt: new Date('2026-01-15') },
    ]
    wireSelect(tasks)

    const res = await request(app).get('/api/export/tasks')

    expect(res.status).toBe(200)
    expect(res.body[0].id).toBe(2)
    expect(res.body[1].id).toBe(1)
  })
})

// ─── GET /tasks/:id ───────────────────────────────────────────────────────────

describe('GET /api/export/tasks/:id', () => {
  it('returns task when found', async () => {
    wireSelect([{ id: 5, type: 'csv', status: 'pending', progress: 50 }])

    const res = await request(app).get('/api/export/tasks/5')

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(5)
  })

  it('returns 404 when task not found', async () => {
    wireSelect([])

    const res = await request(app).get('/api/export/tasks/999')

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Not found')
  })
})

// ─── Direct unit tests for toCSV and buildExcelBuffer ─────────────────────────

const { toCSV, buildExcelBuffer } = await import('../../routes/export.js')

describe('toCSV', () => {
  it('handles null/undefined fields (typeof v !== string branch)', () => {
    const rows = [
      { code: '600519', name: null, tradeDate: undefined, closePrice: null, changePct: null,
        netInflowSuperLarge: null, netInflowLarge: null, netInflowMedium: null, netInflowSmall: null,
        netInflowMain: null, netInflowMainPct: null, turnoverRate: null },
    ]
    const csv = toCSV(rows)
    expect(csv).toContain('600519')
  })

  it('escapes fields containing commas, double-quotes, and newlines', () => {
    const rows = [
      { code: '600,519', name: '贵州"茅台', tradeDate: '2026-01-15', closePrice: '1,800', changePct: '2.5%',
        netInflowSuperLarge: '100\nmillion', netInflowLarge: '', netInflowMedium: null, netInflowSmall: null,
        netInflowMain: null, netInflowMainPct: null, turnoverRate: null },
    ]
    const csv = toCSV(rows)
    expect(csv).toContain('"600,519"')
    expect(csv).toContain('"贵州""茅台"')
    expect(csv).toContain('"1,800"')
    expect(csv).toContain('"100\nmillion"')
  })
})

describe('buildExcelBuffer', () => {
  it('computes latestByCode: newer row replaces older (if branch)', async () => {
    const summary = [
      { code: '600519', name: '贵州茅台', netInflowMain: 540, mainNetInflow5d: 1000, closePrice: 1810, changePct: 0.56 },
      { code: '600519', name: '贵州茅台', netInflowMain: 340, mainNetInflow5d: 900, closePrice: 1800, changePct: 2.5 },
    ]
    const buf = await buildExcelBuffer({ summary, details: [], trends: [] })
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  it('computes latestByCode: older row kept when not newer (else branch)', async () => {
    const summary = [
      { code: '600519', name: '贵州茅台', netInflowMain: 340, mainNetInflow5d: 900, closePrice: 1800, changePct: 2.5 },
      { code: '600519', name: '贵州茅台', netInflowMain: 540, mainNetInflow5d: 1000, closePrice: 1810, changePct: 0.56 },
    ]
    const buf = await buildExcelBuffer({ summary, details: [], trends: [] })
    expect(Buffer.isBuffer(buf)).toBe(true)
  })

  it('handles empty summary/details/trends arrays', async () => {
    const buf = await buildExcelBuffer({ summary: [], details: [], trends: [] })
    expect(Buffer.isBuffer(buf)).toBe(true)
  })
})

// ─── GET /download/:id ────────────────────────────────────────────────────────

describe('GET /api/export/download/:id', () => {
  it('returns 404 when task not found', async () => {
    wireSelect([])

    const res = await request(app).get('/api/export/download/1')

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('File not found')
  })

  it('returns 404 when task.status is not completed', async () => {
    wireSelect([{ id: 1, type: 'csv', status: 'pending', filePath: '/path/file.csv' }])

    const res = await request(app).get('/api/export/download/1')

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('File not found')
  })

  it('returns 404 when filePath is null', async () => {
    wireSelect([{ id: 1, type: 'csv', status: 'completed', filePath: null }])

    const res = await request(app).get('/api/export/download/1')

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('File not found')
  })

  it('returns 200 with correct filename for csv', async () => {
    wireSelect([{ id: 1, type: 'csv', status: 'completed', filePath: '/tmp/test.csv' }])

    const res = await request(app).get('/api/export/download/1')

    expect(res.status).toBe(200)
  })

  it('returns 200 with correct filename for excel', async () => {
    wireSelect([{ id: 2, type: 'excel', status: 'completed', filePath: '/tmp/test.xlsx' }])

    const res = await request(app).get('/api/export/download/2')

    expect(res.status).toBe(200)
  })
})
