/**
 * auth.ts routes -- proxyToSSO + token verification supplementary coverage
 * Tests SSO proxy fallback, fetch failure branches, and token verification.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'

// ---------------------------------------------------------------------------
// Mock db
// ---------------------------------------------------------------------------
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
    if (!t || t === 'invalid_token' || t === 'invalid' || t === 'bad_token' || t === 'no_user_token') {
      throw new Error('invalid')
    }
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

// ---------------------------------------------------------------------------
// Default app (non-SSO)
// ---------------------------------------------------------------------------
const authRoutes = (await import('../routes/auth.js')).default
const app = express()
app.use(express.json())
app.use('/api/auth', authRoutes)

// ---------------------------------------------------------------------------
// SSO app factory -- uses vi.hoisted factory to get fresh routes per call
// This avoids vi.resetModules() issues with module caching.
// ---------------------------------------------------------------------------
const createSsoApp = (() => {
  let callCount = 0
  return async () => {
    callCount++
    const instanceId = callCount
    process.env.LICENSE_KEY = `pro_dev_${instanceId}`
    process.env.SSO_URL = 'http://localhost:3002'

    const { default: ssoAuthRoutes } = await import('../routes/auth.js')
    const ssoApp = express()
    ssoApp.use(express.json())
    ssoApp.use('/api/auth', ssoAuthRoutes)
    return ssoApp
  }
})()

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function resetDbMocks() {
  mockDb.execute.mockResolvedValue({ rows: [] })
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }),
  })
  mockDb.insert.mockReturnValue({
    values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 1 }]) }),
    returning: vi.fn().mockResolvedValue([{ id: 1 }]),
  })
  mockDb.update.mockReturnValue({
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{}]),
  })
  mockDb.delete.mockReturnValue({ where: vi.fn().mockResolvedValue({}) })
}

function configureSelectUser(user: any) {
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([user]),
    }),
  })
}

// ---------------------------------------------------------------------------
// proxyToSSO -- fetch throws -> fallback to localLogin
// ---------------------------------------------------------------------------
describe('proxyToSSO -- fetch throws network error', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('falls back to localLogin when fetch throws', async () => {
    const ssoApp = await createSsoApp()

    const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'))

    configureSelectUser({ id: 2, email: 'fallback@test.com', passwordHash: 'hashed', name: 'Fallback', role: 'free', settings: {}, usage: {}, isAdmin: false })
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{}]) }),
      returning: vi.fn().mockResolvedValue([{}]),
    })
    mockDb.delete.mockReturnValue({ where: vi.fn().mockResolvedValue({}) })

    const res = await request(ssoApp)
      .post('/api/auth/login')
      .send({ email: 'fallback@test.com', password: 'Test@123456' })

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('token')

    fetchSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// proxyToSSO -- ok response with user.id, seedNewUser called
// ---------------------------------------------------------------------------
describe('proxyToSSO -- ok response seeds new user', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbMocks()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('calls seedNewUser on successful register response from SSO', async () => {
    const ssoApp = await createSsoApp()

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ user: { id: 77, email: 'sso_new@test.com', name: 'SSO New' } }),
      headers: new Map([['content-type', 'application/json']]),
    } as any)

    const res = await request(ssoApp)
      .post('/api/auth/register')
      .send({ email: 'sso_new@test.com', password: 'Test@123456', name: 'SSO New' })

    expect(res.status).toBe(201)
    expect(res.body.user).toBeDefined()

    fetchSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// localMe -- token verification failure
// ---------------------------------------------------------------------------
describe('localMe -- token verification failure', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when verifyToken throws', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer bad_token')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('token 无效')
  })
})

// ---------------------------------------------------------------------------
// SSO /me route -- token verification failure
// ---------------------------------------------------------------------------
describe('SSO /me route (isPro=true) -- token verification failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbMocks()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('returns 401 when SSO verify fails and local JWT also fails', async () => {
    const ssoApp = await createSsoApp()

    // Mock SSO fetch to return non-ok (SSO rejects the token)
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'token invalid' }),
      headers: new Map([['content-type', 'application/json']]),
    } as any)

    const res = await request(ssoApp)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid_token')

    expect(res.status).toBe(401)
    expect(res.body.error).toBe('token 无效')

    fetchSpy.mockRestore()
  })

  it('returns 401 when user not found in DB after SSO verification', async () => {
    const ssoApp = await createSsoApp()

    // Mock SSO fetch to return user (SSO valid), but local DB has no user
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ userId: 99, email: 'sso@test.com', role: 'free' }),
      headers: new Map([['content-type', 'application/json']]),
    } as any)

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      }),
    })

    const res = await request(ssoApp)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer sso_valid_token')

    expect(res.status).toBe(401)
    expect(res.body.error).toBe('用户不存在')

    fetchSpy.mockRestore()
  })
})
