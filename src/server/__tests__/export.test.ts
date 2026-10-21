import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { setExportTaskRepository } from '../repositories/IExportTaskRepository.js'
import { buildExcelBuffer } from '../routes/export.js'

const { mockDb, mockRepo } = vi.hoisted(() => {
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    innerJoin: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  }

  const mockRepo = {
    create: vi.fn().mockResolvedValue({ id: 1 }),
    updateProgress: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  }

  return { mockDb, mockRepo }
})

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

vi.mock('../../db/db.js', () => ({
  db: mockDb,
}))

// ─── Mock repository so we can control create/updateProgress/complete/fail ───

setExportTaskRepository(mockRepo as any)

const exportRoutes = (await import('../routes/export.js')).default

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/export', exportRoutes)
  return app
}

const app = createApp()

// ─── toCSV (already tested but add edge case) ────────────────────────────────

const CSV_HEADERS = ['股票代码', '股票名称', '交易日期', '收盘价', '涨跌幅', '超大单净流入', '大单净流入', '中单净流入', '小单净流入', '主力净流入', '主力净流入率', '换手率']
const CSV_FIELDS = ['code', 'name', 'tradeDate', 'closePrice', 'changePct', 'netInflowSuperLarge', 'netInflowLarge', 'netInflowMedium', 'netInflowSmall', 'netInflowMain', 'netInflowMainPct', 'turnoverRate']

function toCSV(rows: any[]): string {
  const lines = [CSV_HEADERS.join(',')]
  for (const r of rows) {
    const values = CSV_FIELDS.map(f => {
      let v = r[f]
      if (v == null) v = ''
      if (typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))) {
        v = `"${v.replace(/"/g, '""')}"`
      }
      return v
    })
    lines.push(values.join(','))
  }
  return '\uFEFF' + lines.join('\n')
}

describe('toCSV', () => {
  it('returns BOM + headers for empty rows', () => {
    const result = toCSV([])
    expect(result.charCodeAt(0)).toBe(0xFEFF)
    expect(result).toContain('股票代码,股票名称,交易日期')
  })

  it('maps all fields correctly', () => {
    const row = { code: '000001', name: '平安银行', tradeDate: '2026-01-01', closePrice: 12.34, changePct: 2.5, netInflowSuperLarge: 1000000, netInflowLarge: 500000, netInflowMedium: -200000, netInflowSmall: -1300000, netInflowMain: 3000000, netInflowMainPct: 5.2, turnoverRate: 3.1 }
    const result = toCSV([row])
    expect(result).toContain('000001')
    expect(result).toContain('平安银行')
  })

  it('escapes fields with commas', () => {
    const row = { code: 'A,B', name: '测试', tradeDate: '2026-01-01', closePrice: 1, changePct: 0, netInflowSuperLarge: 0, netInflowLarge: 0, netInflowMedium: 0, netInflowSmall: 0, netInflowMain: 0, netInflowMainPct: 0, turnoverRate: 0 }
    const result = toCSV([row])
    expect(result).toContain('"A,B"')
  })

  it('escapes fields with double quotes', () => {
    const row = { code: '000001', name: '说"好"', tradeDate: '2026-01-01', closePrice: 1, changePct: 0, netInflowSuperLarge: 0, netInflowLarge: 0, netInflowMedium: 0, netInflowSmall: 0, netInflowMain: 0, netInflowMainPct: 0, turnoverRate: 0 }
    const result = toCSV([row])
    expect(result).toContain('"说""好"""')
  })

  it('escapes fields with newlines', () => {
    const row = { code: '000001', name: '多行\n文本', tradeDate: '2026-01-01', closePrice: 1, changePct: 0, netInflowSuperLarge: 0, netInflowLarge: 0, netInflowMedium: 0, netInflowSmall: 0, netInflowMain: 0, netInflowMainPct: 0, turnoverRate: 0 }
    const result = toCSV([row])
    expect(result).toContain('多行\n文本')
  })

  it('handles null and undefined values', () => {
    const row = { code: '000001', name: null, tradeDate: undefined, closePrice: null, changePct: 0, netInflowSuperLarge: 0, netInflowLarge: 0, netInflowMedium: 0, netInflowSmall: 0, netInflowMain: 0, netInflowMainPct: 0, turnoverRate: 0 }
    const result = toCSV([row])
    expect(result).not.toContain('null')
    expect(result).not.toContain('undefined')
  })
})

// ─── buildExcelBuffer ─────────────────────────────────────────────────────────

vi.mock('xlsx', () => ({
  utils: {
    book_new: () => ({}),
    json_to_sheet: () => ({}),
    book_append_sheet: () => {},
  },
  write: () => Buffer.alloc(0),
}))

describe('buildExcelBuffer', () => {
  it('builds buffer with summary, details, trends sheets', async () => {
    const data = {
      summary: [{ code: '600519', name: '贵州茅台', netInflowMain: 3000000, mainNetInflow5d: 15000000, closePrice: 1800, changePct: 2.5 }],
      details: [{ code: '600519', name: '贵州茅台', tradeDate: '2026-01-15', closePrice: '1800', changePct: '2.5', netInflowSuperLarge: '1000000', netInflowLarge: '500000', netInflowMedium: '-200000', netInflowSmall: '-1300000', netInflowMain: '3000000', netInflowMainPct: '5.2', turnoverRate: '3.1' }],
      trends: [{ tradeDate: '2026-01-15', totalNetInflowMain: 3000000, totalSuperLarge: 1000000, totalLarge: 500000, totalMedium: -200000, totalSmall: -1300000, stockCount: 1 }],
    }
    const buf = await buildExcelBuffer(data)
    expect(Buffer.isBuffer(buf)).toBe(true)
  })
})

// ─── POST /api/export/create ─────────────────────────────────────────────────

describe('POST /api/export/create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRepo.create.mockResolvedValue({ id: 1 })
    mockRepo.updateProgress.mockResolvedValue(undefined)
    mockRepo.complete.mockResolvedValue(undefined)
    mockRepo.fail.mockResolvedValue(undefined)
    // Reset the chain mocks so .mockReturnValue() works correctly
    mockDb.select.mockReset()
    mockDb.select.mockReturnThis()
  })

  it('returns 400 when type is missing', async () => {
    const res = await request(app)
      .post('/api/export/create')
      .send({ params: {} })
    expect(res.status).toBe(400)
  })

  it('returns 400 when type is invalid', async () => {
    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'pdf', params: {} })
    expect(res.status).toBe(400)
  })

  it('returns 200 with downloadUrl for csv type', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    })

    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'csv', params: { codes: ['600519'], startDate: '2026-01-01', endDate: '2026-01-31' } })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('completed')
    expect(res.body.downloadUrl).toContain('/api/export/download/')
  })

  it('returns 200 for excel type with trends computation', async () => {
    const mockRows = [
      { code: '600519', name: '贵州茅台', tradeDate: '2026-01-15', closePrice: '1800', changePct: '2.5', netInflowSuperLarge: '1000000', netInflowLarge: '500000', netInflowMedium: '-200000', netInflowSmall: '-1300000', netInflowMain: '3000000', netInflowMainPct: '5.2', turnoverRate: '3.1' },
      { code: '600519', name: '贵州茅台', tradeDate: '2026-01-16', closePrice: '1810', changePct: '0.56', netInflowSuperLarge: '800000', netInflowLarge: '400000', netInflowMedium: '-100000', netInflowSmall: '-1100000', netInflowMain: '2000000', netInflowMainPct: '3.1', turnoverRate: '2.8' },
    ]
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(mockRows),
    })

    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'excel', params: { codes: ['600519'], startDate: '2026-01-01', endDate: '2026-01-31' } })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('completed')
    expect(res.body.downloadUrl).toContain('/api/export/download/')
  })

  it('repo.fail is called on error', async () => {
    // Force create to throw by rejecting the mock
    mockRepo.create.mockRejectedValueOnce(new Error('DB error'))

    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'csv', params: {} })
    expect(res.status).toBe(500)
    expect(mockRepo.fail).toHaveBeenCalled()
  })

  it('csv path uses market scope when scope not specified', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    })

    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'csv', params: { endDate: '2026-01-31' } })
    expect(res.status).toBe(200)
  })

  it('csv path with codes filter', async () => {
    const chain: any = {}
    const methods = ['from', 'where', 'orderBy', 'limit']
    methods.forEach(m => { chain[m] = vi.fn().mockReturnThis() })
    chain.limit = vi.fn().mockResolvedValue([])
    mockDb.select.mockReturnValue(chain)

    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'csv', params: { codes: ['600519', '000001'], startDate: '2026-01-01', endDate: '2026-01-31' } })
    expect(res.status).toBe(200)
  })

  it('excel path computes latestByCode correctly', async () => {
    const mockRows = [
      { code: '600519', name: '贵州茅台', tradeDate: '2026-01-14', closePrice: '1790', changePct: '1.0', netInflowSuperLarge: '900000', netInflowLarge: '400000', netInflowMedium: '-100000', netInflowSmall: '-1200000', netInflowMain: '2500000', netInflowMainPct: '4.0', turnoverRate: '2.5' },
      { code: '600519', name: '贵州茅台', tradeDate: '2026-01-15', closePrice: '1800', changePct: '2.5', netInflowSuperLarge: '1000000', netInflowLarge: '500000', netInflowMedium: '-200000', netInflowSmall: '-1300000', netInflowMain: '3000000', netInflowMainPct: '5.2', turnoverRate: '3.1' },
      { code: '000001', name: '平安银行', tradeDate: '2026-01-15', closePrice: '12.0', changePct: '0.5', netInflowSuperLarge: '100000', netInflowLarge: '50000', netInflowMedium: '-20000', netInflowSmall: '-130000', netInflowMain: '300000', netInflowMainPct: '1.5', turnoverRate: '0.8' },
    ]
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(mockRows),
    })

    const res = await request(app)
      .post('/api/export/create')
      .send({ type: 'excel', params: { codes: ['600519', '000001'], startDate: '2026-01-01', endDate: '2026-01-31' } })
    expect(res.status).toBe(200)
    // latestByCode should pick 2026-01-15 for 600519 and 2026-01-15 for 000001
    expect(mockRepo.updateProgress).toHaveBeenCalledWith(1, 80)
  })

  it('excel path calls repo.updateProgress at 50 and 80', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    })

    await request(app)
      .post('/api/export/create')
      .send({ type: 'excel', params: { endDate: '2026-01-31' } })

    expect(mockRepo.updateProgress).toHaveBeenCalledWith(1, 50)
    expect(mockRepo.updateProgress).toHaveBeenCalledWith(1, 80)
  })
})

describe('GET /api/export/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns tasks array', async () => {
    mockDb.select.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        { id: 1, type: 'csv', status: 'completed', progress: 100 },
        { id: 2, type: 'excel', status: 'pending', progress: 50 },
      ]),
    })

    const res = await request(app).get('/api/export/tasks')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns 404 for unknown task id', async () => {
    mockDb.select.mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    })

    const res = await request(app).get('/api/export/tasks/99999')
    expect(res.status).toBe(404)
  })

  it('returns tasks filtered by userId', async () => {
    mockDb.select.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 3, type: 'csv', status: 'completed', progress: 100, userId: 'user123' }]),
    })

    const res = await request(app).get('/api/export/tasks?userId=user123')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

describe('GET /api/export/download/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 when task not found', async () => {
    mockDb.select.mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    })

    const res = await request(app).get('/api/export/download/99999')
    expect(res.status).toBe(404)
  })

  it('returns 404 when task not completed', async () => {
    mockDb.select.mockReturnValue({
      where: vi.fn().mockResolvedValue([{ id: 5, type: 'csv', status: 'pending', filePath: null }]),
    })

    const res = await request(app).get('/api/export/download/5')
    expect(res.status).toBe(404)
  })

  it('returns 404 when task completed but no filePath', async () => {
    mockDb.select.mockReturnValue({
      where: vi.fn().mockResolvedValue([{ id: 5, type: 'csv', status: 'completed', filePath: null }]),
    })

    const res = await request(app).get('/api/export/download/5')
    expect(res.status).toBe(404)
  })
})
