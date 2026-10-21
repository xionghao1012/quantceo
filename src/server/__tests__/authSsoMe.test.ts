/**
 * Supplemental auth tests: SSO /me route error branches (Pro mode, lines 272-309)
 *
 * The Pro-mode /me route is exercised when process.env.LICENSE_KEY is set.
 * Tests the error branches that are verifiable with mock ssoVerify:
 * - 401 when no Bearer token (line 274-276)
 * - 401 when SSO verify fails and local JWT also fails (line 292)
 * - 401 when user not found in DB after SSO verify (line 305)
 * - 200 with local JWT fallback when SSO verify returns null (line 284-289)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'

// ─── vi.hoisted FIRST — defines mock state accessible to vi.mock factory ──────

const { mockDb, mockSsoVerify } = vi.hoisted(() => {
  function chain(data: unknown) {
    const p = Promise.resolve(data)
    const t: any = { then: (onF: any) => p.then(onF) }
    t.from = vi.fn().mockReturnValue(t)
    t.where = vi.fn().mockReturnValue(t)
    t.limit = vi.fn().mockReturnValue(t)
    return t
  }
  return {
    mockDb: {
      select: vi.fn().mockImplementation(() => chain([])),
      update: vi.fn().mockImplementation(() => chain([])),
      insert: vi.fn().mockImplementation(() => chain([])),
      delete: vi.fn().mockImplementation(() => chain([])),
      execute: vi.fn().mockResolvedValue(undefined),
    },
    mockSsoVerify: vi.fn(),
  }
})

// ─── Then vi.mock calls reference hoisted variables ─────────────────────────────

vi.mock('../db/db.js', () => ({ db: mockDb }))

// Mock auth middleware — factory references mockSsoVerify via closure
vi.mock('../middleware/auth.js', () => ({
  requireAuth: vi.fn(),
  ssoVerify: mockSsoVerify,
}))

// Mock loadAdminPermissions to return empty permissions
vi.mock('../middleware/adminRbac.js', () => ({
  loadAdminPermissions: vi.fn().mockResolvedValue([]),
}))

// ─── Test app factory ─────────────────────────────────────────────────────────

function createProApp() {
  process.env.LICENSE_KEY = 'pro_test_key_12345'
  process.env.SSO_URL = 'http://localhost:3002'
  const app = express()
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
  return app
}

// Import auth routes after mocks are set up
import authRoutes from '../routes/auth.js'

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GET /api/auth/me — SSO mode (Pro) error branches', () => {
  let app: express.Express

  beforeEach(() => {
    vi.clearAllMocks()
    app = createProApp()
    app.use('/api/auth', authRoutes)

    mockSsoVerify.mockResolvedValue(null)
    mockDb.select = vi.fn().mockImplementation(function (...args: any[]) {
      const t: any = { then: (onF: any) => Promise.resolve([]).then(onF) }
      t.from = vi.fn().mockReturnValue(t)
      t.where = vi.fn().mockReturnValue(t)
      t.limit = vi.fn().mockReturnValue(t)
      return t
    })
  })

  afterEach(() => {
    delete process.env.LICENSE_KEY
    delete process.env.SSO_URL
  })

  it('returns 401 when no Authorization header (line 274-276)', async () => {
    const res = await request(app).get('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('returns 401 when ssoVerify fails and local token invalid (line 292)', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid_local_token')
    expect(res.status).toBe(401)
  })

  it('returns 401 when user not found in DB after SSO verify (line 305)', async () => {
    mockSsoVerify.mockResolvedValue({ userId: 99, email: 'sso@test.com', role: 'pro' })
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer sso_valid_token')
    expect(res.status).toBe(401)
  })

  it('falls back to local JWT when SSO verify returns null (line 284-289)', async () => {
    mockSsoVerify.mockResolvedValue(null)

    const { generateToken } = await import('../services/auth.js')
    const localToken = generateToken({ id: 10, email: 'local@test.com', role: 'user' })
    const mockUser = {
      id: 10, email: 'local@test.com', name: 'Local User', avatar: '',
      role: 'user', settings: {}, usage: {}, isAdmin: false,
      createdAt: new Date(), updatedAt: new Date(),
    }

    mockDb.select = vi.fn().mockImplementation(function (...args: any[]) {
      const t: any = { then: (onF: any) => Promise.resolve([mockUser]).then(onF) }
      t.from = vi.fn().mockReturnValue(t)
      t.where = vi.fn().mockReturnValue(t)
      t.limit = vi.fn().mockReturnValue(t)
      return t
    })

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${localToken}`)
    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe('local@test.com')
  })
})
