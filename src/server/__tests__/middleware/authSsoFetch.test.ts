/**
 * middleware/auth.ts — isPro + ssoVerify fetch 分支覆盖测试
 *
 * 测试 requireAuth 在 isPro=true 时调用真实 ssoVerify 函数，
 * ssoVerify 内部通过 global.fetch 调用 SSO 服务。
 * 覆盖 line 77-79: if (isPro) { user = await ssoVerify(token) }
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Global fetch mock — 在任何模块导入前设置
const mockFetch = vi.fn()
;(globalThis as any).fetch = mockFetch

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockDb } = vi.hoisted(() => {
  function chain(data: unknown) {
    const p = Promise.resolve(data)
    const t: any = { then: (onF: any) => p.then(onF) }
    t.from = vi.fn().mockReturnThis()
    t.where = vi.fn().mockReturnThis()
    t.limit = vi.fn().mockReturnThis()
    t.update = vi.fn().mockReturnThis()
    t.set = vi.fn().mockReturnThis()
    t.insert = vi.fn().mockReturnThis()
    t.values = vi.fn().mockReturnThis()
    t.returning = vi.fn().mockResolvedValue([])
    return t
  }
  return {
    mockDb: {
      select: vi.fn().mockImplementation(() => chain([])),
      update: vi.fn().mockImplementation(() => chain([])),
      insert: vi.fn().mockImplementation(() => chain([])),
    },
  }
})

vi.mock('../../db/db.js', () => ({ db: mockDb }))

// ── Test setup ───────────────────────────────────────────────────────────────

// 设置 isPro=true 并导入 requireAuth
let requireAuth: any

beforeEach(async () => {
  vi.clearAllMocks()
  process.env.LICENSE_KEY = 'pro_dev'
  process.env.SSO_URL = 'http://localhost:3002'
  // 重新导入模块，使 isPro=true 生效
  await vi.resetModules()
  mockDb.select = vi.fn().mockReturnValue({
    then: (onF: any) => Promise.resolve([]).then(onF),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  })
  mockDb.update = vi.fn().mockReturnValue({
    then: (onF: any) => Promise.resolve([]).then(onF),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
  })
  mockDb.insert = vi.fn().mockReturnValue({
    then: (onF: any) => Promise.resolve([{ id: 99, email: 'sso@test.com', role: 'user' }]).then(onF),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 99, email: 'sso@test.com', role: 'user' }]),
  })
})

afterEach(() => {
  delete process.env.LICENSE_KEY
  delete process.env.SSO_URL
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('optionalAuth with isPro=true — ssoVerify 分支 (line 103-104)', () => {
  it('optionalAuth ssoVerify 成功 → 设置 user (line 104, 109-112)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        valid: true,
        user: { id: 55, email: 'opt_sso@test.com', role: 'user' },
      }),
    })
    // ssoUserId 查找 → 找到
    mockDb.select = vi.fn().mockReturnValue({
      then: (onF: any) => Promise.resolve([{ id: 7, email: 'opt_sso@test.com', role: 'user' }]).then(onF),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    })

    const { optionalAuth } = await import('../../middleware/auth.js')
    const { req, res, next } = makeReqRes()
    req.headers.authorization = 'Bearer opt-token'

    await optionalAuth(req, res, next)

    expect(mockFetch).toHaveBeenCalled()
    expect(next).toHaveBeenCalled()
    expect((req as any).user.userId).toBe(7)
  })
})

describe('requireAuth with isPro=true — ssoVerify fetch 分支 (line 77-79)', () => {
  it('ssoVerify 返回 null → 降级到 localVerify (line 80)', async () => {
    // SSO fetch 返回无效响应
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ valid: false }),
    })
    // localVerify 返回 null → 401
    mockDb.select = vi.fn().mockReturnValue({
      then: (onF: any) => Promise.resolve([]).then(onF),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    })

    const { requireAuth: fn } = await import('../../middleware/auth.js')
    const { req, res, next } = makeReqRes()
    req.headers.authorization = 'Bearer some-token'

    await fn(req, res, next)

    expect(mockFetch).toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('ssoVerify 返回有效用户 → 设置 req.user (line 78, 85-93)', async () => {
    // SSO fetch 返回有效用户，但 DB 中不存在（走 autoRegister 分支）
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        valid: true,
        user: { id: 55, email: 'sso_new@test.com', role: 'user' },
      }),
    })

    // ssoUserId 查找 → 空，email 查找 → 空，走 autoRegister
    let selectCount = 0
    mockDb.select = vi.fn().mockImplementation(() => {
      selectCount++
      const p = Promise.resolve([])
      const t: any = { then: (onF: any) => p.then(onF) }
      t.from = vi.fn().mockReturnThis()
      t.where = vi.fn().mockReturnThis()
      t.limit = vi.fn().mockReturnThis()
      return t
    })

    const { requireAuth: fn } = await import('../../middleware/auth.js')
    const { req, res, next } = makeReqRes()
    req.headers.authorization = 'Bearer sso-token'

    await fn(req, res, next)

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3002/api/auth/verify',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(next).toHaveBeenCalled()
    expect((req as any).user).toBeDefined()
    expect((req as any).user.userId).toBe(99)
  })

  it('ssoVerify fetch 抛出异常 → 降级到 localVerify (line 80)', async () => {
    mockFetch.mockRejectedValue(new Error('SSO network error'))

    mockDb.select = vi.fn().mockReturnValue({
      then: (onF: any) => Promise.resolve([]).then(onF),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    })

    const { requireAuth: fn } = await import('../../middleware/auth.js')
    const { req, res, next } = makeReqRes()
    req.headers.authorization = 'Bearer some-token'

    await fn(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('ssoVerify 用户已在 DB 中（按 ssoUserId 查找）→ 直接返回 (line 32-33)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        valid: true,
        user: { id: 200, email: 'sso_existing@test.com', role: 'admin' },
      }),
    })

    // ssoUserId 查找 → 找到用户
    mockDb.select = vi.fn().mockReturnValue({
      then: (onF: any) => Promise.resolve([{ id: 7, email: 'sso_existing@test.com', role: 'admin' }]).then(onF),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    })

    const { requireAuth: fn } = await import('../../middleware/auth.js')
    const { req, res, next } = makeReqRes()
    req.headers.authorization = 'Bearer sso-existing-token'

    await fn(req, res, next)

    expect(next).toHaveBeenCalled()
    expect((req as any).user.userId).toBe(7)
    expect((req as any).user.email).toBe('sso_existing@test.com')
  })
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReqRes() {
  const req = {
    headers: {} as Record<string, string | undefined>,
    user: undefined as any,
  } as any
  const res = {
    statusCode: 200,
    status: function (code: number) {
      this.statusCode = code
      return this
    },
    json: vi.fn(),
    jsonp: vi.fn(),
    end: vi.fn(),
  } as any
  const next = vi.fn()
  return { req, res, next }
}
