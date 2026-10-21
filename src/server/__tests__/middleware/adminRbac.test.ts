import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { requireAdminRole, grantUserRole, revokeUserRole, loadAdminPermissions, getAdminRoles, getRolePermissions, getUserRoles } from '../../middleware/adminRbac.js'

vi.mock('../../db/db.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue([]),
  },
}))

function mockReq(overrides: Partial<{ user: any }> = {}) {
  return { user: { userId: 1, email: 'admin@test.com', role: 'admin', permissions: [] }, ...overrides } as unknown as Request
}
function mockRes() {
  const res: Partial<Response> = { status: vi.fn().mockReturnThis(), json: vi.fn() }
  return res as unknown as Response
}
const mockNext: NextFunction = vi.fn()

beforeEach(() => vi.clearAllMocks())

describe('requireAdminRole', () => {
  it('returns 401 if no user', () => {
    const middleware = requireAdminRole('users.read')
    const req = { user: undefined } as unknown as Request
    const res = mockRes()
    middleware(req, res, mockNext)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(mockNext).not.toHaveBeenCalled()
  })

  it('allows admin user with isAdmin=true', () => {
    const middleware = requireAdminRole('users.read')
    const req = mockReq({ user: { userId: 1, isAdmin: true } })
    const res = mockRes()
    middleware(req, res, mockNext)
    expect(mockNext).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('allows user with required permission', () => {
    const middleware = requireAdminRole('users.read')
    const perms = ['users.read', 'users.write']
    const req = mockReq({ user: { userId: 1, isAdmin: false, permissions: perms } })
    const res = mockRes()
    middleware(req, res, mockNext)
    expect(mockNext).toHaveBeenCalled()
  })

  it('denies user without required permission', () => {
    const middleware = requireAdminRole('users.read')
    const perms = ['users.write']
    const req = mockReq({ user: { userId: 1, isAdmin: false, permissions: perms } })
    const res = mockRes()
    middleware(req, res, mockNext)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('denies user with empty permissions', () => {
    const middleware = requireAdminRole('users.read')
    const req = mockReq({ user: { userId: 1, isAdmin: false, permissions: [] } })
    const res = mockRes()
    middleware(req, res, mockNext)
    expect(res.status).toHaveBeenCalledWith(403)
  })
})

describe('loadAdminPermissions', () => {
  let db: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../../db/db.js')
    db = mod.db
  })

  function makeQb(rows: any[]) {
    const qb: any = {
      then(resolve: (v: any) => void) { resolve(rows) },
      execute: vi.fn().mockResolvedValue(rows),
    }
    qb.from = vi.fn().mockReturnValue(qb)
    qb.innerJoin = vi.fn().mockReturnValue(qb)
    qb.where = vi.fn().mockReturnValue(qb)
    return qb
  }

  it('returns permission codes for a user with roles', async () => {
    db.select = vi.fn().mockReturnValue(makeQb([
      { code: 'user.view' },
      { code: 'user.upgrade' },
    ]))
    const perms = await loadAdminPermissions(1)
    expect(perms).toContain('user.view')
    expect(perms).toContain('user.upgrade')
  })

  it('returns empty array when user has no roles', async () => {
    db.select = vi.fn().mockReturnValue(makeQb([]))
    const perms = await loadAdminPermissions(999)
    expect(perms).toEqual([])
  })
})

describe('getAdminRoles', () => {
  let db: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../../db/db.js')
    db = mod.db
  })

  it('returns active roles', async () => {
    const mockRows = [{ id: 1, code: 'admin', name_zh: '管理员' }]
    db.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(mockRows),
      }),
    })
    const roles = await getAdminRoles()
    expect(roles).toEqual(mockRows)
  })
})

describe('getRolePermissions', () => {
  let db: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../../db/db.js')
    db = mod.db
  })

  it('returns permissions for a role', async () => {
    const mockRows = [{ code: 'user.view', name_zh: '查看用户', module: 'user' }]
    db.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockRows),
        }),
      }),
    })
    const perms = await getRolePermissions(1)
    expect(perms).toEqual(mockRows)
  })
})

describe('getUserRoles', () => {
  let db: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../../db/db.js')
    db = mod.db
  })

  it('returns roles for a user', async () => {
    const mockRows = [{ roleId: 1, roleCode: 'admin', roleNameZh: '管理员', description: 'Admin role' }]
    db.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockRows),
        }),
      }),
    })
    const roles = await getUserRoles(1)
    expect(roles).toEqual(mockRows)
  })
})

describe('grantUserRole', () => {
  let db: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../../db/db.js')
    db = mod.db
  })

  // Creates a thenable that resolves to rows when awaited
  function makeQb(rows: any[]) {
    const qb: any = {
      then(resolve: (v: any) => void) { resolve(rows) },
      execute: vi.fn().mockResolvedValue(rows),
    }
    qb.from = vi.fn().mockReturnValue(qb)
    qb.where = vi.fn().mockReturnValue(qb)
    qb.limit = vi.fn().mockReturnValue(qb)
    return qb
  }

  it('returns false when role does not exist', async () => {
    db.select = vi.fn().mockReturnValue(makeQb([]))
    const result = await grantUserRole(1, 999, 1)
    expect(result).toBe(false)
  })

  it('returns true and inserts when role exists', async () => {
    db.select = vi.fn().mockReturnValue(makeQb([{ id: 2, code: 'editor' }]))

    const insertQb: any = {}
    insertQb.values = vi.fn().mockReturnValue(insertQb)
    insertQb.onConflictDoNothing = vi.fn().mockResolvedValue([])
    db.insert = vi.fn().mockReturnValue(insertQb)

    const result = await grantUserRole(1, 2, 1)
    expect(result).toBe(true)
    expect(db.insert).toHaveBeenCalled()
  })
})

describe('revokeUserRole', () => {
  let db: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../../db/db.js')
    db = mod.db
  })

  function makeQb(rows: any[]) {
    const qb: any = {
      then(resolve: (v: any) => void) { resolve(rows) },
      execute: vi.fn().mockResolvedValue(rows),
    }
    qb.from = vi.fn().mockReturnValue(qb)
    qb.where = vi.fn().mockReturnValue(qb)
    qb.limit = vi.fn().mockReturnValue(qb)
    return qb
  }

  it('returns false when role does not exist', async () => {
    db.select = vi.fn().mockReturnValue(makeQb([]))
    const result = await revokeUserRole(1, 999)
    expect(result).toBe(false)
  })

  it('returns true and deletes when role exists', async () => {
    db.select = vi.fn().mockReturnValue(makeQb([{ id: 2, code: 'editor' }]))

    const deleteQb: any = {}
    deleteQb.execute = vi.fn().mockResolvedValue([])
    deleteQb.where = vi.fn().mockReturnValue(deleteQb)
    db.delete = vi.fn().mockReturnValue(deleteQb)

    const result = await revokeUserRole(1, 2)
    expect(result).toBe(true)
    expect(db.delete).toHaveBeenCalled()
  })
})
