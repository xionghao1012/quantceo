import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { requireAdmin } from '../../middleware/requireAdmin.js'

function mockReq(overrides: Partial<{ user: any; headers: Record<string, string>; body: any }> = {}): any {
  return {
    user: undefined,
    headers: {},
    body: {},
    ...overrides,
  }
}

function mockRes() {
  const res: any = { statusCode: 200, _body: null }
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res._body = body; return res })
  return res
}

describe('requireAdmin middleware', () => {
  let next: ReturnType<typeof vi.fn>

  beforeEach(() => {
    next = vi.fn()
    delete process.env.ADMIN_UPGRADE_KEY
  })

  afterEach(() => {
    delete process.env.ADMIN_UPGRADE_KEY
  })

  it('calls next() when req.user.isAdmin is true', async () => {
    const req = mockReq({ user: { userId: 42, isAdmin: true } })
    const res = mockRes()
    await requireAdmin(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(req.adminUserId).toBe(42)
  })

  it('calls next() when ADMIN_KEY matches x-admin-key header', async () => {
    process.env.ADMIN_UPGRADE_KEY = 'secret-admin-key'
    const req = mockReq({ headers: { 'x-admin-key': 'secret-admin-key' } })
    const res = mockRes()
    await requireAdmin(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('calls next() when ADMIN_KEY matches adminKey in body', async () => {
    process.env.ADMIN_UPGRADE_KEY = 'body-key'
    const req = mockReq({ body: { adminKey: 'body-key' } })
    const res = mockRes()
    await requireAdmin(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('returns 401 when adminKey does not match ADMIN_KEY', async () => {
    process.env.ADMIN_UPGRADE_KEY = 'correct-key'
    const req = mockReq({
      user: { userId: 1, isAdmin: undefined },
      headers: { 'x-admin-key': 'wrong-key' },
    })
    const res = mockRes()
    await requireAdmin(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('无效') }))
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when user is not admin and no key provided', async () => {
    process.env.ADMIN_UPGRADE_KEY = 'some-key'
    const req = mockReq({ user: { userId: 1, isAdmin: undefined } })
    const res = mockRes()
    await requireAdmin(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 500 when ADMIN_KEY is empty string', async () => {
    // ADMIN_UPGRADE_KEY is set but empty
    process.env.ADMIN_UPGRADE_KEY = ''
    const req = mockReq({ user: { userId: 1, isAdmin: undefined } })
    const res = mockRes()
    await requireAdmin(req, res, next)
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('未配置') }))
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 500 when ADMIN_KEY is not set at all', async () => {
    const req = mockReq({ user: { userId: 1, isAdmin: undefined } })
    const res = mockRes()
    await requireAdmin(req, res, next)
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('未配置') }))
    expect(next).not.toHaveBeenCalled()
  })
})
