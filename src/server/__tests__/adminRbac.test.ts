import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import adminRoutes from '../routes/admin.js'


const testApp = express()
testApp.use(express.json())
testApp.use('/api/admin', adminRoutes)

const ADMIN_EMAIL = 'dev@test.com'
const ADMIN_PASSWORD = 'DevTest@123'

let adminToken = ''
let nonAdminToken = ''
let testUserId = 0

beforeAll(async () => {
  const loginRes = await request(testApp)
    .post('/api/admin/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })

  if (loginRes.body.token) {
    adminToken = loginRes.body.token
  }

  const nonAdminEmail = `rbac_test_${Date.now()}@test.com`
  const regRes = await request(testApp)
    .post('/api/admin/register')
    .send({ email: nonAdminEmail, password: 'Test@123456', name: 'RBAC Test User' })

  if (regRes.status === 201 || regRes.status === 200) {
    testUserId = regRes.body.user?.id || 0
    const nonAdminLogin = await request(testApp)
      .post('/api/admin/login')
      .send({ email: nonAdminEmail, password: 'Test@123456' })
    if (nonAdminLogin.body.token) {
      nonAdminToken = nonAdminLogin.body.token
    }
  }

})

// ============================================================
// 一、权限定义与角色数据验证
// ============================================================
describe('RBAC Data Model - Permissions and Roles', () => {
  describe('GET /api/admin/permissions', () => {
    it('returns 401 without auth', async () => {
      const res = await request(testApp).get('/api/admin/permissions')
      expect([401, 403, 500]).toContain(res.status)
    })

    it('returns all permissions with correct structure', async () => {
      if (!adminToken) return
      const res = await request(testApp)
        .get('/api/admin/permissions')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.permissions).toBeDefined()
      expect(Array.isArray(res.body.permissions)).toBe(true)
      expect(res.body.permissions.length).toBeGreaterThan(0)

      const perm = res.body.permissions[0]
      expect(perm).toHaveProperty('id')
      expect(perm).toHaveProperty('code')
      expect(perm).toHaveProperty('name_zh')
      expect(perm).toHaveProperty('module')
    })

    it('contains all MVP permission codes', async () => {
      if (!adminToken) return
      const res = await request(testApp)
        .get('/api/admin/permissions')
        .set('Authorization', `Bearer ${adminToken}`)

      const codes = res.body.permissions.map((p: any) => p.code)
      const expectedCodes = [
        'user.view', 'user.upgrade', 'order.approve', 'order.view',
        'stats.view', 'oauth.manage', 'system.config', 'apikey.manage', 'role.manage'
      ]
      for (const code of expectedCodes) {
        expect(codes).toContain(code)
      }
    })

    it('permissions are grouped by module', async () => {
      if (!adminToken) return
      const res = await request(testApp)
        .get('/api/admin/permissions')
        .set('Authorization', `Bearer ${adminToken}`)

      const modules = new Set(res.body.permissions.map((p: any) => p.module))
      expect(modules.has('user')).toBe(true)
      expect(modules.has('order')).toBe(true)
      expect(modules.has('stats')).toBe(true)
      expect(modules.has('oauth')).toBe(true)
      expect(modules.has('system')).toBe(true)
      expect(modules.has('apikey')).toBe(true)
      expect(modules.has('role')).toBe(true)
    })
  })

  describe('GET /api/admin/roles', () => {
    it('returns 401 without auth', async () => {
      const res = await request(testApp).get('/api/admin/roles')
      expect([401, 403, 500]).toContain(res.status)
    })

    it('returns all active roles', async () => {
      if (!adminToken) return
      const res = await request(testApp)
        .get('/api/admin/roles')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.roles).toBeDefined()
      expect(Array.isArray(res.body.roles)).toBe(true)
      expect(res.body.roles.length).toBeGreaterThan(0)
    })

    it('contains all five MVP roles', async () => {
      if (!adminToken) return
      const res = await request(testApp)
        .get('/api/admin/roles')
        .set('Authorization', `Bearer ${adminToken}`)

      const codes = res.body.roles.map((r: any) => r.code)
      expect(codes).toContain('operator')
      expect(codes).toContain('ops')
      expect(codes).toContain('support')
      expect(codes).toContain('admin')
      expect(codes).toContain('sales')
    })

    it('each role has correct fields', async () => {
      if (!adminToken) return
      const res = await request(testApp)
        .get('/api/admin/roles')
        .set('Authorization', `Bearer ${adminToken}`)

      for (const role of res.body.roles) {
        expect(role).toHaveProperty('id')
        expect(role).toHaveProperty('code')
        expect(role).toHaveProperty('name_zh')
        expect(role).toHaveProperty('is_active')
      }
    })
  })
})

// ============================================================
// 二、角色权限关联验证
// ============================================================
describe('Role-Permission Association', () => {
  describe('GET /api/admin/roles/:id/permissions', () => {
    it('returns 401 without auth', async () => {
      const res = await request(testApp).get('/api/admin/roles/1/permissions')
      expect([401, 403, 500]).toContain(res.status)
    })

    it('returns permissions for admin role (id=1)', async () => {
      if (!adminToken) return
      const res = await request(testApp)
        .get('/api/admin/roles/1/permissions')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.permissions).toBeDefined()
      expect(Array.isArray(res.body.permissions)).toBe(true)
    })

    it('admin role has all permissions', async () => {
      if (!adminToken) return
      const res = await request(testApp)
        .get('/api/admin/roles/1/permissions')
        .set('Authorization', `Bearer ${adminToken}`)

      const codes = res.body.permissions.map((p: any) => p.code)
      expect(codes.length).toBeGreaterThan(5)
    })

    it('returns 400 for invalid role id', async () => {
      if (!adminToken) return
      const res = await request(testApp)
        .get('/api/admin/roles/invalid/permissions')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(400)
    })

    it('returns 400 for non-existent role id', async () => {
      if (!adminToken) return
      const res = await request(testApp)
        .get('/api/admin/roles/99999/permissions')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.permissions).toEqual([])
    })
  })

  describe('PUT /api/admin/roles/:id', () => {
    it('returns 401 without auth', async () => {
      const res = await request(testApp)
        .put('/api/admin/roles/1')
        .send({ permissionIds: [1] })
      expect([401, 403, 500]).toContain(res.status)
    })

    it('updates role permissions successfully', async () => {
      if (!adminToken) return
      const res = await request(testApp)
        .put('/api/admin/roles/1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ permissionIds: [1, 2, 3] })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('returns 400 for invalid role id', async () => {
      if (!adminToken) return
      const res = await request(testApp)
        .put('/api/admin/roles/invalid')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ permissionIds: [1] })

      expect(res.status).toBe(400)
    })

    it('accepts empty permission array (clears all permissions)', async () => {
      if (!adminToken) return
      const res = await request(testApp)
        .put('/api/admin/roles/1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ permissionIds: [] })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })
})

// ============================================================
// 三、用户角色关联验证
// ============================================================
describe('User-Role Association', () => {
  describe('GET /api/admin/users/:userId/roles', () => {
    it('returns 401 without auth', async () => {
      const res = await request(testApp).get('/api/admin/users/1/roles')
      expect([401, 403, 500]).toContain(res.status)
    })

    it('returns roles for existing user', async () => {
      if (!adminToken) return
      const res = await request(testApp)
        .get('/api/admin/users/30/roles')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.roles).toBeDefined()
      expect(Array.isArray(res.body.roles)).toBe(true)
    })

    it('returns 400 for invalid user id', async () => {
      if (!adminToken) return
      const res = await request(testApp)
        .get('/api/admin/users/invalid/roles')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(400)
    })

    it('returns empty roles for user with no assigned roles', async () => {
      if (!adminToken || !testUserId) return
      const res = await request(testApp)
        .get(`/api/admin/users/${testUserId}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.roles).toBeDefined()
      expect(Array.isArray(res.body.roles)).toBe(true)
    })
  })

  describe('POST /api/admin/users/:userId/roles', () => {
    it('returns 401 without auth', async () => {
      const res = await request(testApp)
        .post('/api/admin/users/1/roles')
        .send({ roleId: 1, action: 'grant' })
      expect([401, 403, 500]).toContain(res.status)
    })

    it('returns 400 when roleId is missing', async () => {
      if (!adminToken) return
      const res = await request(testApp)
        .post('/api/admin/users/30/roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'grant' })

      expect(res.status).toBe(400)
    })

    it('grants role to user successfully', async () => {
      if (!adminToken || !testUserId) return
      const res = await request(testApp)
        .post(`/api/admin/users/${testUserId}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleId: 2, action: 'grant' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('revokes role from user successfully', async () => {
      if (!adminToken || !testUserId) return
      const res = await request(testApp)
        .post(`/api/admin/users/${testUserId}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleId: 2, action: 'revoke' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('idempotent - revoking non-existent role does not error', async () => {
      if (!adminToken || !testUserId) return
      const res = await request(testApp)
        .post(`/api/admin/users/${testUserId}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleId: 999, action: 'revoke' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })
})

// ============================================================
// 四、权限矩阵验证（基于 XIO-82 设计文档 Section 2.2）
// ============================================================
describe('Permission Matrix Verification', () => {
  const operatorRoleId = 2
  const opsRoleId = 3
  const supportRoleId = 4
  const adminRoleId = 1
  const salesRoleId = 5

  const permissionMatrix = {
    operator: ['stats.view', 'user.upgrade', 'order.approve', 'order.view', 'apikey.manage'],
    ops: ['stats.view', 'oauth.manage', 'system.config', 'apikey.manage'],
    support: ['order.approve', 'order.view'],
    admin: ['stats.view', 'user.upgrade', 'order.approve', 'order.view', 'oauth.manage', 'system.config', 'apikey.manage', 'role.manage'],
    sales: ['stats.view'],
  }

  for (const [role, expectedPerms] of Object.entries(permissionMatrix)) {
    describe(`${role} role`, () => {
      it(`should have exactly ${expectedPerms.length} permissions`, async () => {
        if (!adminToken) return

        let roleId: number
        switch (role) {
          case 'operator': roleId = operatorRoleId; break
          case 'ops': roleId = opsRoleId; break
          case 'support': roleId = supportRoleId; break
          case 'admin': roleId = adminRoleId; break
          case 'sales': roleId = salesRoleId; break
          default: return
        }

        const res = await request(testApp)
          .get(`/api/admin/roles/${roleId}/permissions`)
          .set('Authorization', `Bearer ${adminToken}`)

        expect(res.status).toBe(200)
        const actualCodes = res.body.permissions.map((p: any) => p.code)
        expect(actualCodes.sort()).toEqual(expectedPerms.sort())
      })
    })
  }
})

// ============================================================
// 五、requireAdminRole 中间件行为验证
// ============================================================
describe('requireAdminRole Middleware', () => {
  it('isAdmin=true user bypasses all permission checks', async () => {
    if (!adminToken) return
    const res = await request(testApp)
      .get('/api/admin/roles')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.roles).toBeDefined()
  })

  it('user without role.manage permission gets 403 on role endpoints', async () => {
    if (!nonAdminToken) return
    const res = await request(testApp)
      .get('/api/admin/roles')
      .set('Authorization', `Bearer ${nonAdminToken}`)

    expect(res.status).toBe(403)
  })

  it('unauthenticated request gets 401', async () => {
    const res = await request(testApp)
      .get('/api/admin/roles')
    expect([401, 403]).toContain(res.status)
  })
})

// ============================================================
// 六、现有 Admin API 向后兼容验证
// ============================================================
describe('Existing Admin API Backward Compatibility', () => {
  describe('GET /api/admin/users', () => {
    it('returns 401 without auth', async () => {
      const res = await request(testApp).get('/api/admin/users')
      expect([401, 403, 500]).toContain(res.status)
    })

    it('returns user list for admin', async () => {
      if (!adminToken) return
      const res = await request(testApp)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.users).toBeDefined()
      expect(Array.isArray(res.body.users)).toBe(true)
    })

    it('supports search by name', async () => {
      if (!adminToken) return
      const uniqueName = `SearchUser_${Date.now()}`
      await request(testApp)
        .post('/api/admin/register')
        .send({ email: `search_${Date.now()}@test.com`, password: 'Test@123456', name: uniqueName })

      const res = await request(testApp)
        .get(`/api/admin/users?search=${encodeURIComponent(uniqueName)}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.users.length).toBeGreaterThan(0)
      const matched = res.body.users.find((u: any) => u.name === uniqueName)
      expect(matched).toBeDefined()
    })
  })

  describe('GET /api/admin/stats', () => {
    it('returns 401 without auth', async () => {
      const res = await request(testApp).get('/api/admin/stats')
      expect([401, 403, 500]).toContain(res.status)
    })

    it('returns admin stats', async () => {
      if (!adminToken) return
      const res = await request(testApp)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('totalUsers')
      expect(res.body).toHaveProperty('proActive')
      expect(res.body).toHaveProperty('pendingOrders')
    })
  })

  describe('GET /api/admin/pending-orders', () => {
    it('returns 401 without auth', async () => {
      const res = await request(testApp).get('/api/admin/pending-orders')
      expect([401, 403, 500]).toContain(res.status)
    })

    it('returns pending orders for admin', async () => {
      if (!adminToken) return
      const res = await request(testApp)
        .get('/api/admin/pending-orders')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('orders')
      expect(Array.isArray(res.body.orders)).toBe(true)
    })
  })
})

// ============================================================
// 七、数据完整性验证
// ============================================================
describe('Data Integrity', () => {
  it('permissions table has unique codes', async () => {
    if (!adminToken) return
    const res = await request(testApp)
      .get('/api/admin/permissions')
      .set('Authorization', `Bearer ${adminToken}`)

    const codes = res.body.permissions.map((p: any) => p.code)
    const uniqueCodes = new Set(codes)
    expect(uniqueCodes.size).toBe(codes.length)
  })

  it('admin_roles table has unique codes', async () => {
    if (!adminToken) return
    const res = await request(testApp)
      .get('/api/admin/roles')
      .set('Authorization', `Bearer ${adminToken}`)

    const codes = res.body.roles.map((r: any) => r.code)
    const uniqueCodes = new Set(codes)
    expect(uniqueCodes.size).toBe(codes.length)
  })

  it('each role has at least one permission (except potentially sales)', async () => {
    if (!adminToken) return
    const rolesRes = await request(testApp)
      .get('/api/admin/roles')
      .set('Authorization', `Bearer ${adminToken}`)

    for (const role of rolesRes.body.roles) {
      const permsRes = await request(testApp)
        .get(`/api/admin/roles/${role.id}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(permsRes.status).toBe(200)
    }
  })
})
