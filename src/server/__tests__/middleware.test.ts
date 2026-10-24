import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

describe('middleware/auth', () => {
  it('requireAuth rejects missing header', async () => {
    const { requireAuth } = await import('../middleware/auth.js')
    const req = { headers: {} } as Request
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    await requireAuth(req, res, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: '未登录，请先登录' })
  })

  it('requireAuth rejects non-Bearer header', async () => {
    const { requireAuth } = await import('../middleware/auth.js')
    const req = { headers: { authorization: 'Basic token' } } as Request
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    await requireAuth(req, res, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('requireAuth rejects invalid token', async () => {
    const { requireAuth } = await import('../middleware/auth.js')
    const req = { headers: { authorization: 'Bearer invalidtoken' } } as Request
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    await requireAuth(req, res, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('requireAuth accepts valid token', async () => {
    const { requireAuth } = await import('../middleware/auth.js')
    const { generateToken } = await import('../services/auth.js')
    const token = generateToken({ id: 1, email: 'test@test.com', role: 'user' })
    const req = { headers: { authorization: `Bearer ${token}` } } as Request
    const next = vi.fn() as NextFunction
    const res = {} as Response
    await requireAuth(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(req.user).toBeDefined()
    expect(req.user!.userId).toBe(1)
  })

  it('optionalAuth skips when no header', async () => {
    const { optionalAuth } = await import('../middleware/auth.js')
    const req = { headers: {} } as Request
    const next = vi.fn() as NextFunction
    await optionalAuth(req, {} as Response, next)
    expect(next).toHaveBeenCalled()
    expect(req.user).toBeUndefined()
  })

  it('optionalAuth decodes valid token', async () => {
    const { optionalAuth } = await import('../middleware/auth.js')
    const { generateToken } = await import('../services/auth.js')
    const token = generateToken({ id: 2, email: 'opt@test.com', role: 'user' })
    const req = { headers: { authorization: `Bearer ${token}` } } as Request
    const next = vi.fn() as NextFunction
    await optionalAuth(req, {} as Response, next)
    expect(next).toHaveBeenCalled()
    expect(req.user).toBeDefined()
    expect(req.user!.userId).toBe(2)
  })

  it('optionalAuth skips invalid token gracefully', async () => {
    const { optionalAuth } = await import('../middleware/auth.js')
    const req = { headers: { authorization: 'Bearer badtoken' } } as Request
    const next = vi.fn() as NextFunction
    await optionalAuth(req, {} as Response, next)
    expect(next).toHaveBeenCalled()
    expect(req.user).toBeUndefined()
  })

  it('requireRole rejects missing user', async () => {
    const { requireRole } = await import('../middleware/auth.js')
    const req = {} as Request
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    requireRole('admin')(req, res, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('requireRole rejects wrong role', async () => {
    const { requireRole } = await import('../middleware/auth.js')
    const req = { user: { userId: 1, email: 'a@b.com', role: 'user' } } as Request
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    requireRole('admin')(req, res, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('requireRole passes for matching role', async () => {
    const { requireRole } = await import('../middleware/auth.js')
    const req = { user: { userId: 1, email: 'a@b.com', role: 'admin' } } as Request
    const next = vi.fn() as NextFunction
    requireRole('admin')(req, {} as Response, next)
    expect(next).toHaveBeenCalled()
  })
})

describe('middleware/errors', () => {
  it('AppError with defaults', async () => {
    const { AppError } = await import('../middleware/errors.js')
    const e = new AppError('test error')
    expect(e.message).toBe('test error')
    expect(e.statusCode).toBe(500)
    expect(e.name).toBe('AppError')
  })

  it('AppError with custom status and code', async () => {
    const { AppError } = await import('../middleware/errors.js')
    const e = new AppError('custom', 418, 'TEAPOT')
    expect(e.statusCode).toBe(418)
    expect(e.code).toBe('TEAPOT')
  })

  it('NotFoundError', async () => {
    const { NotFoundError } = await import('../middleware/errors.js')
    const e = new NotFoundError()
    expect(e.statusCode).toBe(404)
    expect(e.code).toBe('NOT_FOUND')
  })

  it('ValidationError', async () => {
    const { ValidationError } = await import('../middleware/errors.js')
    const e = new ValidationError('invalid input')
    expect(e.statusCode).toBe(400)
    expect(e.code).toBe('VALIDATION_ERROR')
  })

  it('UnauthorizedError', async () => {
    const { UnauthorizedError } = await import('../middleware/errors.js')
    const e = new UnauthorizedError()
    expect(e.statusCode).toBe(401)
    expect(e.code).toBe('UNAUTHORIZED')
  })

  it('ForbiddenError', async () => {
    const { ForbiddenError } = await import('../middleware/errors.js')
    const e = new ForbiddenError('no access')
    expect(e.statusCode).toBe(403)
    expect(e.code).toBe('FORBIDDEN')
  })

  it('RateLimitError', async () => {
    const { RateLimitError } = await import('../middleware/errors.js')
    const e = new RateLimitError()
    expect(e.statusCode).toBe(429)
    expect(e.code).toBe('RATE_LIMIT')
  })
})

describe('middleware/requireInternal', () => {
  const KEY = 'test-internal-key-32-chars-long!!'
  const originalKey = process.env.INTERNAL_API_KEY

  beforeEach(() => { process.env.INTERNAL_API_KEY = KEY })
  afterEach(() => {
    if (originalKey === undefined) delete process.env.INTERNAL_API_KEY
    else process.env.INTERNAL_API_KEY = originalKey
  })

  const makeReq = (headers: Record<string, any> = {}, ip = '203.0.113.1') =>
    ({ headers, ip, socket: { remoteAddress: ip } }) as unknown as Request
  const makeRes = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() }) as unknown as Response

  it('accepts the correct x-internal-key', async () => {
    const { requireInternal } = await import('../middleware/requireInternal.js')
    const next = vi.fn() as NextFunction
    requireInternal(makeReq({ 'x-internal-key': KEY }), makeRes(), next)
    expect(next).toHaveBeenCalled()
  })

  it('rejects a wrong key', async () => {
    const { requireInternal } = await import('../middleware/requireInternal.js')
    const res = makeRes()
    requireInternal(makeReq({ 'x-internal-key': 'wrong' }), res, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('rejects spoofed X-Forwarded-For 172.x without a key (CSO 7250f48c)', async () => {
    const { requireInternal } = await import('../middleware/requireInternal.js')
    const res = makeRes()
    requireInternal(makeReq({ 'x-forwarded-for': '172.16.0.1' }, '172.16.0.1'), res, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('rejects loopback without a key (cloudflared connects over loopback)', async () => {
    const { requireInternal } = await import('../middleware/requireInternal.js')
    const res = makeRes()
    requireInternal(makeReq({}, '127.0.0.1'), res, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('fails closed when INTERNAL_API_KEY is not configured', async () => {
    delete process.env.INTERNAL_API_KEY
    const { requireInternal } = await import('../middleware/requireInternal.js')
    const res = makeRes()
    requireInternal(makeReq({ 'x-internal-key': 'anything' }), res, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(503)
  })
})

describe('middleware/metrics', () => {
  it('incCounter and createMetricsRouter work', async () => {
    const { incCounter } = await import('../middleware/metrics.js')
    incCounter('test_requests', { method: 'GET' })
    incCounter('test_requests', { method: 'GET' })
    incCounter('test_bytes', {}, 42)
  })

  it('metricsMiddleware instruments requests', async () => {
    const { metricsMiddleware } = await import('../middleware/metrics.js')
    const mw = metricsMiddleware('test-service')
    const req = { method: 'GET', path: '/api/test', route: null } as any
    const res: any = { statusCode: 200, end: vi.fn() }
    const next = vi.fn()
    mw(req, res, next)
    expect(next).toHaveBeenCalled()
    res.end()
  })

  it('metrics router returns prometheus format', async () => {
    const { incCounter, createMetricsRouter } = await import('../middleware/metrics.js')
    incCounter('test_req', { method: 'POST' })
    const router = createMetricsRouter()
    const req = { method: 'GET', url: '/' } as any
    const res = { set: vi.fn(), end: vi.fn() } as unknown as Response
    router(req, res, vi.fn() as NextFunction)
    expect(res.set).toHaveBeenCalledWith('Content-Type', 'text/plain; version=0.0.4')
    expect(res.end).toHaveBeenCalled()
    const output = (res.end as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(output).toContain('test_req')
  })
})

describe('middleware/adminRbac', () => {
  it('requireAdminRole rejects missing user', async () => {
    const { requireAdminRole } = await import('../middleware/adminRbac.js')
    const req = {} as Request
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    requireAdminRole('role.manage')(req, res, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: '未认证' })
  })

  it('requireAdminRole bypasses for isAdmin=true', async () => {
    const { requireAdminRole } = await import('../middleware/adminRbac.js')
    const req = { user: { userId: 1, email: 'admin@test.com', role: 'admin', isAdmin: true } } as Request
    const next = vi.fn() as NextFunction
    requireAdminRole('role.manage')(req, {} as Response, next)
    expect(next).toHaveBeenCalled()
  })

  it('requireAdminRole passes when user has required permission', async () => {
    const { requireAdminRole } = await import('../middleware/adminRbac.js')
    const req = {
      user: { userId: 1, email: 'admin@test.com', role: 'admin', isAdmin: false, permissions: ['role.manage'] }
    } as Request
    const next = vi.fn() as NextFunction
    requireAdminRole('role.manage')(req, {} as Response, next)
    expect(next).toHaveBeenCalled()
  })

  it('requireAdminRole returns 403 when user lacks required permission', async () => {
    const { requireAdminRole } = await import('../middleware/adminRbac.js')
    const req = {
      user: { userId: 1, email: 'user@test.com', role: 'free', isAdmin: false, permissions: ['stats.view'] }
    } as Request
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    requireAdminRole('role.manage')(req, res, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: '权限不足' })
  })

  it('requireAdminRole handles empty permissions array', async () => {
    const { requireAdminRole } = await import('../middleware/adminRbac.js')
    const req = {
      user: { userId: 1, email: 'user@test.com', role: 'free', isAdmin: false, permissions: [] as string[] }
    } as Request
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    requireAdminRole('role.manage')(req, res, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: '权限不足' })
  })

  it('requireAdminRole handles missing permissions property', async () => {
    const { requireAdminRole } = await import('../middleware/adminRbac.js')
    const req = { user: { userId: 1, email: 'user@test.com', role: 'free', isAdmin: false } } as Request
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    requireAdminRole('role.manage')(req, res, vi.fn() as NextFunction)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: '权限不足' })
  })
})
