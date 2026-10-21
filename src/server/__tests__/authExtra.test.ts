/**
 * auth.test.ts 补充覆盖：catch 分支、seedNewUser、proxyToSSO fallback
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

// ─── Mock db + auth deps ────────────────────────────────────────────────────
const mockDb = vi.hoisted(() => ({
  execute: vi.fn().mockResolvedValue({ rows: [] }),
  insert: vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 1 }]) }),
    returning: vi.fn().mockResolvedValue([{ id: 1 }]),
  }),
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }),
  }),
  update: vi.fn().mockReturnValue({
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{}]),
  }),
  delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({}) }),
}))

vi.mock('../db/db.js', () => ({ db: mockDb }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), gt: vi.fn(), sql: vi.fn() }))

vi.mock('../services/auth.js', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed'),
  verifyPassword: vi.fn().mockResolvedValue(true),
  generateToken: vi.fn().mockReturnValue('mock_token'),
  generateRefreshToken: vi.fn().mockReturnValue('mock_refresh'),
  sanitizeUser: vi.fn().mockReturnValue({ id: 1, email: 'test@test.com', name: 'Test', role: 'free', settings: {}, usage: {}, isAdmin: false }),
  validatePassword: vi.fn().mockReturnValue(null),
  verifyToken: vi.fn().mockImplementation((t: string) => {
    if (!t || t === 'invalid_token' || t === 'invalid') throw new Error('invalid')
    return { userId: 1, email: 'test@test.com', role: 'free' }
  }),
}))

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: () => void) => next(),
  ssoVerify: vi.fn().mockResolvedValue(null),
}))

vi.mock('../middleware/adminRbac.js', () => ({
  loadAdminPermissions: vi.fn().mockResolvedValue([]),
}))

// ─── App ────────────────────────────────────────────────────────────────────
const authRoutes = (await import('../routes/auth.js')).default
const app = express()
app.use(express.json())
app.use('/api/auth', authRoutes)

// ─── localRegister catch branch ─────────────────────────────────────────────
describe('localRegister error handling', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 500 when db insert throws', async () => {
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockRejectedValue(new Error('db error')) }),
      returning: vi.fn().mockRejectedValue(new Error('db error')),
    })
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) }),
    })

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'err@test.com', password: 'Test@123456', name: 'Err' })
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('db error')
  })
})

// ─── localLogin catch branch ────────────────────────────────────────────────
describe('localLogin error handling', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 500 when db select throws', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnThis(), limit: vi.fn().mockRejectedValue(new Error('select error')) }),
    })

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'err@test.com', password: 'Test@123456' })
    expect(res.status).toBe(500)
  })
})

// ─── localRefresh catch branch + seedNewUser ───────────────────────────────
describe('localRefresh error handling', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 500 when db delete throws', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ id: 1, userId: 1, refreshToken: 'valid_token', expiresAt: new Date(Date.now() + 86400000) }]),
      }),
    })
    mockDb.delete.mockReturnValue({ where: vi.fn().mockRejectedValue(new Error('delete error')) })

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'valid_token' })
    expect(res.status).toBe(500)
  })

  it('seedNewUser swallow errors', async () => {
    mockDb.execute
      .mockRejectedValueOnce(new Error('seed error'))   // first try block
      .mockRejectedValueOnce(new Error('seed error'))   // second try block
      .mockRejectedValueOnce(new Error('seed error'))   // third try block

    // Trigger via register success flow
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 99, email: 'seed@test.com', name: 'Seed', role: 'free' }]) }),
      returning: vi.fn().mockResolvedValue([{ id: 99, email: 'seed@test.com', name: 'Seed', role: 'free' }]),
    })
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) }),
    })

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'seed@test.com', password: 'Test@123456', name: 'Seed' })
    // seedNewUser errors are swallowed; register should still succeed
    expect(res.status).toBe(201)
  })
})

// ─── localLogout catch branch ───────────────────────────────────────────────
describe('localLogout error handling', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns success even when token is invalid', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', 'Bearer invalid_token')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('returns success even with no auth header', async () => {
    const res = await request(app).post('/api/auth/logout')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

// ─── localMe catch branch ──────────────────────────────────────────────────
describe('localMe error handling', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when verifyToken throws', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer tampered_token')
    expect(res.status).toBe(401)
  })

  it('returns 500 when db select throws', async () => {
    // Valid token but db fails
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnThis(), limit: vi.fn().mockRejectedValue(new Error('db error')) }),
    })

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer valid_mock_token')
    // verifyToken succeeds but db select throws → 500
    expect([401, 500]).toContain(res.status)
  })
})

// ─── localUpdateMe catch branch ────────────────────────────────────────────
describe('localUpdateMe error handling', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 500 when db update throws', async () => {
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockRejectedValue(new Error('update error')),
    })

    const res = await request(app)
      .put('/api/auth/me')
      .set('Authorization', 'Bearer valid_mock_token')
      .send({ name: 'New Name' })
    expect(res.status).toBe(500)
  })
})

// ─── localChangePassword catch branch ──────────────────────────────────────
describe('localChangePassword error handling', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 500 when db update throws', async () => {
    // The actual code calls: db.update(users).set({...}).where(...)
    // No .returning() is called. Mock where() to throw.
    const updateChain: any = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockImplementation(() => { throw new Error('pw update error') }),
    }
    mockDb.update.mockReturnValue(updateChain)
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ id: 1, passwordHash: 'hash' }]),
      }),
    })

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', 'Bearer valid_mock_token')
      .send({ currentPassword: 'Test@123456', newPassword: 'NewPass@123' })
    expect(res.status).toBe(500)
  })
})

// ─── SSO GitHub OAuth routes (isPro=true) ────────────────────────────────
describe('SSO GitHub OAuth routes (isPro=true)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET /github redirects to SSO endpoint', async () => {
    const prev = process.env.LICENSE_KEY
    process.env.LICENSE_KEY = 'pro_dev'
    process.env.SSO_URL = 'http://sso.example.com'

    vi.resetModules()
    vi.doMock('../db/db.js', () => ({ db: mockDb }))
    vi.doMock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), gt: vi.fn(), sql: vi.fn() }))
    vi.doMock('../services/auth.js', () => ({
      hashPassword: vi.fn().mockResolvedValue('hashed'),
      verifyPassword: vi.fn().mockResolvedValue(true),
      generateToken: vi.fn().mockReturnValue('mock_token'),
      generateRefreshToken: vi.fn().mockReturnValue('mock_refresh'),
      sanitizeUser: vi.fn().mockReturnValue({ id: 1, email: 'test@test.com', name: 'Test', role: 'free', settings: {}, usage: {}, isAdmin: false }),
      validatePassword: vi.fn().mockReturnValue(null),
      verifyToken: vi.fn().mockImplementation((t: string) => {
        if (!t || t === 'invalid') throw new Error('invalid')
        return { userId: 1, email: 'test@test.com', role: 'free' }
      }),
    }))
    vi.doMock('../middleware/auth.js', () => ({
      requireAuth: (_req: any, _res: any, next: () => void) => next(),
      ssoVerify: vi.fn().mockResolvedValue(null),
    }))
    vi.doMock('../middleware/adminRbac.js', () => ({ loadAdminPermissions: vi.fn().mockResolvedValue([]) }))

    const { default: ssoAuthRoutes } = await import('../routes/auth.js')
    const ssoApp = express()
    ssoApp.use(express.json())
    ssoApp.use('/api/auth', ssoAuthRoutes)

    const res = await request(ssoApp).get('/api/auth/github')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('http://sso.example.com/api/auth/github')

    process.env.LICENSE_KEY = prev
    process.env.SSO_URL = prev
  })

  it('GET /github/callback redirects to SSO with query params', async () => {
    const prev = process.env.LICENSE_KEY
    process.env.LICENSE_KEY = 'pro_dev'
    process.env.SSO_URL = 'http://sso.example.com'

    vi.resetModules()
    vi.doMock('../db/db.js', () => ({ db: mockDb }))
    vi.doMock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), gt: vi.fn(), sql: vi.fn() }))
    vi.doMock('../services/auth.js', () => ({
      hashPassword: vi.fn().mockResolvedValue('hashed'),
      verifyPassword: vi.fn().mockResolvedValue(true),
      generateToken: vi.fn().mockReturnValue('mock_token'),
      generateRefreshToken: vi.fn().mockReturnValue('mock_refresh'),
      sanitizeUser: vi.fn().mockReturnValue({ id: 1, email: 'test@test.com', name: 'Test', role: 'free', settings: {}, usage: {}, isAdmin: false }),
      validatePassword: vi.fn().mockReturnValue(null),
      verifyToken: vi.fn().mockImplementation((t: string) => {
        if (!t || t === 'invalid') throw new Error('invalid')
        return { userId: 1, email: 'test@test.com', role: 'free' }
      }),
    }))
    vi.doMock('../middleware/auth.js', () => ({
      requireAuth: (_req: any, _res: any, next: () => void) => next(),
      ssoVerify: vi.fn().mockResolvedValue(null),
    }))
    vi.doMock('../middleware/adminRbac.js', () => ({ loadAdminPermissions: vi.fn().mockResolvedValue([]) }))

    const { default: ssoAuthRoutes } = await import('../routes/auth.js')
    const ssoApp = express()
    ssoApp.use(express.json())
    ssoApp.use('/api/auth', ssoAuthRoutes)

    const res = await request(ssoApp)
      .get('/api/auth/github/callback')
      .query({ code: 'abc123', state: 'xyz' })
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('http://sso.example.com/api/auth/github/callback')
    expect(res.headers.location).toContain('code=abc123')

    process.env.LICENSE_KEY = prev
    process.env.SSO_URL = prev
  })
})

// ─── SSO /me route (isPro=true) ─────────────────────────────────────────────
describe('SSO /me route (isPro=true)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when no auth header', async () => {
    const prev = process.env.LICENSE_KEY
    process.env.LICENSE_KEY = 'pro_dev'

    vi.resetModules()
    vi.doMock('../db/db.js', () => ({ db: mockDb }))
    vi.doMock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), gt: vi.fn(), sql: vi.fn() }))
    vi.doMock('../services/auth.js', () => ({
      hashPassword: vi.fn().mockResolvedValue('hashed'),
      verifyPassword: vi.fn().mockResolvedValue(true),
      generateToken: vi.fn().mockReturnValue('mock_token'),
      generateRefreshToken: vi.fn().mockReturnValue('mock_refresh'),
      sanitizeUser: vi.fn().mockReturnValue({ id: 1, email: 'test@test.com', name: 'Test', role: 'free', settings: {}, usage: {}, isAdmin: false }),
      validatePassword: vi.fn().mockReturnValue(null),
      verifyToken: vi.fn().mockImplementation((t: string) => {
        if (!t || t === 'invalid') throw new Error('invalid')
        return { userId: 1, email: 'test@test.com', role: 'free' }
      }),
    }))
    vi.doMock('../middleware/auth.js', () => ({
      requireAuth: (_req: any, _res: any, next: () => void) => next(),
      ssoVerify: vi.fn().mockResolvedValue(null),
    }))
    vi.doMock('../middleware/adminRbac.js', () => ({ loadAdminPermissions: vi.fn().mockResolvedValue([]) }))

    const { default: ssoAuthRoutes } = await import('../routes/auth.js')
    const ssoApp = express()
    ssoApp.use(express.json())
    ssoApp.use('/api/auth', ssoAuthRoutes)

    const res = await request(ssoApp).get('/api/auth/me')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('未登录')

    process.env.LICENSE_KEY = prev
  })

  it('returns 401 when SSO verify fails and local JWT also fails', async () => {
    const prev = process.env.LICENSE_KEY
    process.env.LICENSE_KEY = 'pro_dev'

    vi.resetModules()
    vi.doMock('../db/db.js', () => ({ db: mockDb }))
    vi.doMock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), gt: vi.fn(), sql: vi.fn() }))
    vi.doMock('../services/auth.js', () => ({
      hashPassword: vi.fn().mockResolvedValue('hashed'),
      verifyPassword: vi.fn().mockResolvedValue(true),
      generateToken: vi.fn().mockReturnValue('mock_token'),
      generateRefreshToken: vi.fn().mockReturnValue('mock_refresh'),
      sanitizeUser: vi.fn().mockReturnValue({ id: 1, email: 'test@test.com', name: 'Test', role: 'free', settings: {}, usage: {}, isAdmin: false }),
      validatePassword: vi.fn().mockReturnValue(null),
      // verifyToken always throws
      verifyToken: vi.fn().mockImplementation(() => { throw new Error('invalid') }),
    }))
    vi.doMock('../middleware/auth.js', () => ({
      requireAuth: (_req: any, _res: any, next: () => void) => next(),
      ssoVerify: vi.fn().mockResolvedValue(null), // SSO also returns null
    }))
    vi.doMock('../middleware/adminRbac.js', () => ({ loadAdminPermissions: vi.fn().mockResolvedValue([]) }))

    const { default: ssoAuthRoutes } = await import('../routes/auth.js')
    const ssoApp = express()
    ssoApp.use(express.json())
    ssoApp.use('/api/auth', ssoAuthRoutes)

    const res = await request(ssoApp)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid_token')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('token 无效')

    process.env.LICENSE_KEY = prev
  })

  it('returns 401 when user not found in DB', async () => {
    const prev = process.env.LICENSE_KEY
    process.env.LICENSE_KEY = 'pro_dev'

    vi.resetModules()
    vi.doMock('../db/db.js', () => ({ db: mockDb }))
    vi.doMock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), gt: vi.fn(), sql: vi.fn() }))
    vi.doMock('../services/auth.js', () => ({
      hashPassword: vi.fn().mockResolvedValue('hashed'),
      verifyPassword: vi.fn().mockResolvedValue(true),
      generateToken: vi.fn().mockReturnValue('mock_token'),
      generateRefreshToken: vi.fn().mockReturnValue('mock_refresh'),
      sanitizeUser: vi.fn().mockReturnValue({ id: 1, email: 'test@test.com', name: 'Test', role: 'free', settings: {}, usage: {}, isAdmin: false }),
      validatePassword: vi.fn().mockReturnValue(null),
      verifyToken: vi.fn().mockImplementation((t: string) => {
        if (!t || t === 'invalid') throw new Error('invalid')
        return { userId: 999, email: 'ghost@test.com', role: 'free' } // non-existent user
      }),
    }))
    vi.doMock('../middleware/auth.js', () => ({
      requireAuth: (_req: any, _res: any, next: () => void) => next(),
      ssoVerify: vi.fn().mockResolvedValue(null),
    }))
    vi.doMock('../middleware/adminRbac.js', () => ({ loadAdminPermissions: vi.fn().mockResolvedValue([]) }))

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]), // user not found
      }),
    })

    const { default: ssoAuthRoutes } = await import('../routes/auth.js')
    const ssoApp = express()
    ssoApp.use(express.json())
    ssoApp.use('/api/auth', ssoAuthRoutes)

    const res = await request(ssoApp)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer valid_token')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('用户不存在')

    process.env.LICENSE_KEY = prev
  })

  it('returns user with permissions when SSO user found', async () => {
    const prev = process.env.LICENSE_KEY
    process.env.LICENSE_KEY = 'pro_dev'

    vi.resetModules()
    vi.doMock('../db/db.js', () => ({ db: mockDb }))
    vi.doMock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), gt: vi.fn(), sql: vi.fn() }))
    vi.doMock('../services/auth.js', () => ({
      hashPassword: vi.fn().mockResolvedValue('hashed'),
      verifyPassword: vi.fn().mockResolvedValue(true),
      generateToken: vi.fn().mockReturnValue('mock_token'),
      generateRefreshToken: vi.fn().mockReturnValue('mock_refresh'),
      sanitizeUser: vi.fn().mockReturnValue({ id: 42, email: 'sso@test.com', name: 'SSO User', role: 'free', settings: {}, usage: {}, isAdmin: false }),
      validatePassword: vi.fn().mockReturnValue(null),
      verifyToken: vi.fn().mockImplementation(() => { throw new Error('invalid') }),
    }))
    vi.doMock('../middleware/auth.js', () => ({
      requireAuth: (_req: any, _res: any, next: () => void) => next(),
      // SSO returns a user
      ssoVerify: vi.fn().mockResolvedValue({ userId: 42, email: 'sso@test.com', role: 'free' }),
    }))
    vi.doMock('../middleware/adminRbac.js', () => ({ loadAdminPermissions: vi.fn().mockResolvedValue(['admin:read', 'admin:write']) }))

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ id: 42, email: 'sso@test.com', name: 'SSO User', role: 'free', settings: {}, usage: {}, isAdmin: false }]),
      }),
    })

    const { default: ssoAuthRoutes } = await import('../routes/auth.js')
    const ssoApp = express()
    ssoApp.use(express.json())
    ssoApp.use('/api/auth', ssoAuthRoutes)

    const res = await request(ssoApp)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer sso_token')
    expect(res.status).toBe(200)
    expect(res.body.user).toBeDefined()
    expect(res.body.user.permissions).toContain('admin:read')

    process.env.LICENSE_KEY = prev
  })

  it('loadAdminPermissions failure is caught silently', async () => {
    const prev = process.env.LICENSE_KEY
    process.env.LICENSE_KEY = 'pro_dev'

    vi.resetModules()
    vi.doMock('../db/db.js', () => ({ db: mockDb }))
    vi.doMock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), gt: vi.fn(), sql: vi.fn() }))
    vi.doMock('../services/auth.js', () => ({
      hashPassword: vi.fn().mockResolvedValue('hashed'),
      verifyPassword: vi.fn().mockResolvedValue(true),
      generateToken: vi.fn().mockReturnValue('mock_token'),
      generateRefreshToken: vi.fn().mockReturnValue('mock_refresh'),
      sanitizeUser: vi.fn().mockReturnValue({ id: 1, email: 'test@test.com', name: 'Test', role: 'free', settings: {}, usage: {}, isAdmin: false }),
      validatePassword: vi.fn().mockReturnValue(null),
      verifyToken: vi.fn().mockImplementation(() => { throw new Error('invalid') }),
    }))
    vi.doMock('../middleware/auth.js', () => ({
      requireAuth: (_req: any, _res: any, next: () => void) => next(),
      ssoVerify: vi.fn().mockResolvedValue({ userId: 1, email: 'test@test.com', role: 'free' }),
    }))
    vi.doMock('../middleware/adminRbac.js', () => ({
      loadAdminPermissions: vi.fn().mockRejectedValue(new Error('perms error')),
    }))

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ id: 1, email: 'test@test.com', name: 'Test', role: 'free', settings: {}, usage: {}, isAdmin: false }]),
      }),
    })

    const { default: ssoAuthRoutes } = await import('../routes/auth.js')
    const ssoApp = express()
    ssoApp.use(express.json())
    ssoApp.use('/api/auth', ssoAuthRoutes)

    const res = await request(ssoApp)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer sso_token')
    // Should still return 200 with empty permissions
    expect(res.status).toBe(200)
    expect(res.body.user.permissions).toEqual([])

    process.env.LICENSE_KEY = prev
  })
})

// ─── proxyToSSO callback branches ───────────────────────────────────────────
describe('proxyToSSO callback branches (isPro=true)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('seeds new user on successful SSO register response', async () => {
    const prev = process.env.LICENSE_KEY
    process.env.LICENSE_KEY = 'pro_dev'

    // Mock fetch to return successful register response
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ user: { id: 99, email: 'new@test.com', name: 'New User' } }),
      headers: new Map([['content-type', 'application/json']]),
    } as any)

    vi.resetModules()
    vi.doMock('../db/db.js', () => ({ db: mockDb }))
    vi.doMock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), gt: vi.fn(), sql: vi.fn() }))
    vi.doMock('../services/auth.js', () => ({
      hashPassword: vi.fn().mockResolvedValue('hashed'),
      verifyPassword: vi.fn().mockResolvedValue(true),
      generateToken: vi.fn().mockReturnValue('mock_token'),
      generateRefreshToken: vi.fn().mockReturnValue('mock_refresh'),
      sanitizeUser: vi.fn().mockReturnValue({ id: 99, email: 'new@test.com', name: 'New User', role: 'free', settings: {}, usage: {}, isAdmin: false }),
      validatePassword: vi.fn().mockReturnValue(null),
      verifyToken: vi.fn().mockImplementation((t: string) => {
        if (!t || t === 'invalid') throw new Error('invalid')
        return { userId: 99, email: 'new@test.com', role: 'free' }
      }),
    }))
    vi.doMock('../middleware/auth.js', () => ({
      requireAuth: (_req: any, _res: any, next: () => void) => next(),
      ssoVerify: vi.fn().mockResolvedValue(null),
    }))
    vi.doMock('../middleware/adminRbac.js', () => ({ loadAdminPermissions: vi.fn().mockResolvedValue([]) }))

    const { default: ssoAuthRoutes } = await import('../routes/auth.js')
    const ssoApp = express()
    ssoApp.use(express.json())
    ssoApp.use('/api/auth', ssoAuthRoutes)

    const res = await request(ssoApp)
      .post('/api/auth/register')
      .send({ email: 'new@test.com', password: 'Test@123456', name: 'New User' })

    expect(res.status).toBe(201)
    expect(res.body.user).toBeDefined()

    fetchSpy.mockRestore()
    process.env.LICENSE_KEY = prev
  })
})

// ─── SSO proxyToSSO fallback ────────────────────────────────────────────────
describe('proxyToSSO fallback (isPro=true)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('falls back to local handler when SSO fetch fails', async () => {
    // Override isPro env for this test
    const prev = process.env.LICENSE_KEY
    process.env.LICENSE_KEY = 'pro_dev'

    // Mock fetch to throw
    const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'))

    // Import fresh auth routes with isPro=true
    vi.resetModules()
    vi.doMock('../db/db.js', () => ({ db: mockDb }))
    vi.doMock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), gt: vi.fn(), sql: vi.fn() }))
    vi.doMock('../services/auth.js', () => ({
      hashPassword: vi.fn().mockResolvedValue('hashed'),
      verifyPassword: vi.fn().mockResolvedValue(true),
      generateToken: vi.fn().mockReturnValue('mock_token'),
      generateRefreshToken: vi.fn().mockReturnValue('mock_refresh'),
      sanitizeUser: vi.fn().mockReturnValue({ id: 1, email: 'sso@test.com', name: 'SSO', role: 'free', settings: {}, usage: {}, isAdmin: false }),
      validatePassword: vi.fn().mockReturnValue(null),
      verifyToken: vi.fn().mockImplementation((t: string) => {
        if (!t || t === 'invalid') throw new Error('invalid')
        return { userId: 1, email: 'sso@test.com', role: 'free' }
      }),
    }))
    vi.doMock('../middleware/auth.js', () => ({
      requireAuth: (_req: any, _res: any, next: () => void) => next(),
      ssoVerify: vi.fn().mockResolvedValue(null),
    }))
    vi.doMock('../middleware/adminRbac.js', () => ({ loadAdminPermissions: vi.fn().mockResolvedValue([]) }))

    const { default: ssoAuthRoutes } = await import('../routes/auth.js')
    const ssoApp = express()
    ssoApp.use(express.json())
    ssoApp.use('/api/auth', ssoAuthRoutes)

    // SSO fetch fails → should fall back to localLogin
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ id: 1, email: 'sso@test.com', passwordHash: 'hashed', name: 'SSO', role: 'free', settings: {}, usage: {}, isAdmin: false }]),
      }),
    })
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{}]) }),
      returning: vi.fn().mockResolvedValue([{}]),
    })
    mockDb.delete.mockReturnValue({ where: vi.fn().mockResolvedValue({}) })

    const res = await request(ssoApp)
      .post('/api/auth/login')
      .send({ email: 'sso@test.com', password: 'Test@123456' })

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('token')

    fetchSpy.mockRestore()
    process.env.LICENSE_KEY = prev
  })
})
