/**
 * Tests for the ssoVerify function in middleware/auth.ts.
 * Uses top-level fetch mocking + vi.hoisted + vi.mock for correct ordering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Global fetch mock — set up before any module imports
const mockFetch = vi.fn()
;(globalThis as any).fetch = mockFetch

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Use vi.hoisted with a function to ensure correct execution order
const { mockDb, mockHashPassword } = vi.hoisted(() => {
  function chain(data: unknown) {
    const p = Promise.resolve(data)
    const t: any = { then: (onF: any) => p.then(onF) }
    t.from = vi.fn().mockReturnValue(t)
    t.where = vi.fn().mockReturnValue(t)
    t.limit = vi.fn().mockReturnValue(t)
    t.update = vi.fn().mockReturnValue(t)
    t.set = vi.fn().mockReturnValue(t)
    t.insert = vi.fn().mockReturnValue(t)
    t.values = vi.fn().mockReturnValue(t)
    t.returning = vi.fn().mockResolvedValue([])
    return t
  }
  return {
    mockDb: {
      select: vi.fn().mockImplementation(() => chain([])),
      update: vi.fn().mockImplementation(() => chain([])),
      insert: vi.fn().mockImplementation(() => chain([])),
    },
    mockHashPassword: vi.fn().mockResolvedValue('hashed_temp'),
  }
})

vi.mock('../../db/db.js', () => ({ db: mockDb }))
vi.mock('../../services/auth.js', () => ({
  hashPassword: mockHashPassword,
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  // Reset mockDb chain implementations
  mockDb.select = vi.fn().mockReturnValue({ then: (onF: any) => Promise.resolve([]).then(onF), from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis() })
  mockDb.update = vi.fn().mockReturnValue({ then: (onF: any) => Promise.resolve([]).then(onF), set: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis() })
  mockDb.insert = vi.fn().mockReturnValue({ then: (onF: any) => Promise.resolve([]).then(onF), values: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([]) })
  mockHashPassword.mockResolvedValue('hashed')
  delete process.env.SSO_URL
})

describe('ssoVerify', () => {
  it('returns null when HTTP response is not ok', async () => {
    process.env.SSO_URL = 'http://localhost:3002'
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ valid: true, user: { id: 1, email: 'a@b.com', role: 'user' } }),
    })

    const { ssoVerify } = await import('../../middleware/auth.js')
    const result = await ssoVerify('some-token')
    expect(result).toBeNull()
  })

  it('returns null when data.valid is false', async () => {
    process.env.SSO_URL = 'http://localhost:3002'
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ valid: false, user: { id: 1, email: 'a@b.com', role: 'user' } }),
    })

    const { ssoVerify } = await import('../../middleware/auth.js')
    const result = await ssoVerify('some-token')
    expect(result).toBeNull()
  })

  it('returns null when data.user is missing', async () => {
    process.env.SSO_URL = 'http://localhost:3002'
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true }), // user missing
    })

    const { ssoVerify } = await import('../../middleware/auth.js')
    const result = await ssoVerify('some-token')
    expect(result).toBeNull()
  })

  it('returns user when found by ssoUserId lookup', async () => {
    process.env.SSO_URL = 'http://localhost:3002'
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, user: { id: 99, email: 'sso@b.com', role: 'user' } }),
    })

    // Make select return the existing user
    mockDb.select = vi.fn().mockReturnValue({
      then: (onF: any) => Promise.resolve([{ id: 5, email: 'sso@b.com', role: 'user' }]).then(onF),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    })

    const { ssoVerify } = await import('../../middleware/auth.js')
    const result = await ssoVerify('sso-token')
    expect(result).toEqual({ userId: 5, email: 'sso@b.com', role: 'user' })
  })

  it('updates ssoUserId when user found by email (not ssoUserId) and returns user', async () => {
    process.env.SSO_URL = 'http://localhost:3002'
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, user: { id: 77, email: 'existing@b.com', role: 'pro' } }),
    })

    // First select: ssoUserId lookup → empty, Second: email lookup → found
    let selectCount = 0
    mockDb.select = vi.fn().mockImplementation(() => ({
      then: (onF: any) => {
        selectCount++
        const data = selectCount === 1 ? [] : [{ id: 8, email: 'existing@b.com', role: 'pro' }]
        return Promise.resolve(data).then(onF)
      },
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    }))

    const { ssoVerify } = await import('../../middleware/auth.js')
    const result = await ssoVerify('sso-token-link-email')
    expect(result).toEqual({ userId: 8, email: 'existing@b.com', role: 'pro' })
  })

  it('creates new user when not found by ssoUserId or email', async () => {
    process.env.SSO_URL = 'http://localhost:3002'
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true, user: { id: 55, email: 'brandnew@b.com', role: 'vip' } }),
    })

    // Both lookups return empty
    mockDb.select = vi.fn().mockReturnValue({
      then: (onF: any) => Promise.resolve([]).then(onF),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    })

    // Insert returns new user
    mockDb.insert = vi.fn().mockReturnValue({
      then: (onF: any) => Promise.resolve([{ id: 12, email: 'brandnew@b.com', role: 'vip' }]).then(onF),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 12, email: 'brandnew@b.com', role: 'vip' }]),
    })

    const { ssoVerify } = await import('../../middleware/auth.js')
    const result = await ssoVerify('brand-new-token')
    expect(result).toEqual({ userId: 12, email: 'brandnew@b.com', role: 'vip' })
  })

  it('returns null when fetch throws', async () => {
    process.env.SSO_URL = 'http://localhost:3002'
    mockFetch.mockRejectedValue(new Error('Network error'))

    const { ssoVerify } = await import('../../middleware/auth.js')
    const result = await ssoVerify('error-token')
    expect(result).toBeNull()
  })
})
