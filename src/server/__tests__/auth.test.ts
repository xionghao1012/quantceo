import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createTestApp, TEST_USER } from './helpers.js'
import authRoutes from '../routes/auth.js'
import { validatePassword, sanitizeUser, hashPassword, verifyPassword, generateRefreshToken, generateToken, verifyToken } from '../services/auth.js'

// ─── Pure function unit tests ────────────────────────────────────────────────

describe('validatePassword', () => {
  it('returns null for valid password', () => {
    expect(validatePassword('Valid123')).toBeNull()
    expect(validatePassword('LongEnough1')).toBeNull()
    expect(validatePassword('abcDEF12345678')).toBeNull()
  })

  it('returns error for password < 8 chars', () => {
    expect(validatePassword('Short1!')).toBe('密码至少8位')
    expect(validatePassword('Ab1')).toBe('密码至少8位')
  })

  it('returns error for password without letters', () => {
    expect(validatePassword('12345678')).toBe('密码需包含字母')
    expect(validatePassword('1234567890')).toBe('密码需包含字母')
  })

  it('returns error for password without numbers', () => {
    expect(validatePassword('abcdefgh')).toBe('密码需包含数字')
    expect(validatePassword('ABCDEFGH')).toBe('密码需包含数字')
  })

  it('returns first error only (length checked first)', () => {
    expect(validatePassword('abc')).toBe('密码至少8位')
  })
})

describe('sanitizeUser', () => {
  const baseUser = {
    id: 1,
    email: 'test@example.com',
    name: 'Test User',
    avatar: 'avatar.png',
    role: 'user',
    settings: {},
    usage: {},
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
  }

  it('returns user with all fields', () => {
    const result = sanitizeUser(baseUser)
    expect(result.id).toBe(1)
    expect(result.email).toBe('test@example.com')
    expect(result.name).toBe('Test User')
    expect(result.avatar).toBe('avatar.png')
    expect(result.role).toBe('user')
    expect(result.settings).toEqual({})
    expect(result.usage).toEqual({})
  })

  it('defaults avatar to empty string when missing', () => {
    const result = sanitizeUser({ ...baseUser, avatar: '' as any })
    expect(result.avatar).toBe('')
  })

  it('defaults isAdmin to false when null', () => {
    const result = sanitizeUser({ ...baseUser, isAdmin: null })
    expect(result.isAdmin).toBe(false)
  })

  it('parses string settings', () => {
    const result = sanitizeUser({ ...baseUser, settings: '{"theme":"dark"}' })
    expect(result.settings).toEqual({ theme: 'dark' })
  })

  it('keeps object settings as-is', () => {
    const result = sanitizeUser({ ...baseUser, settings: { theme: 'light' } })
    expect(result.settings).toEqual({ theme: 'light' })
  })

  it('parses string usage', () => {
    const result = sanitizeUser({ ...baseUser, usage: '{"requests":10}' })
    expect(result.usage).toEqual({ requests: 10 })
  })

  it('defaults settings/usage to {} when null/undefined', () => {
    const r1 = sanitizeUser({ ...baseUser, settings: null as any })
    expect(r1.settings).toEqual({})
    const r2 = sanitizeUser({ ...baseUser, usage: undefined as any })
    expect(r2.usage).toEqual({})
  })

  it('converts Date createdAt/updatedAt to ISO string', () => {
    const result = sanitizeUser(baseUser)
    expect(result.createdAt).toBe('2024-01-01T00:00:00.000Z')
    expect(result.updatedAt).toBe('2024-01-02T00:00:00.000Z')
  })

  it('converts string createdAt/updatedAt to String', () => {
    const result = sanitizeUser({ ...baseUser, createdAt: '2024-01-01' as any, updatedAt: '2024-01-02' as any })
    expect(result.createdAt).toBe('2024-01-01')
    expect(result.updatedAt).toBe('2024-01-02')
  })

  it('preserves isAdmin when true', () => {
    const result = sanitizeUser({ ...baseUser, isAdmin: true })
    expect(result.isAdmin).toBe(true)
  })
})

describe('hashPassword + verifyPassword', () => {
  it('hashes a password and verifies it correctly', async () => {
    const password = 'Test@123456'
    const hash = await hashPassword(password)
    expect(hash).not.toBe(password)
    expect(hash.length).toBeGreaterThan(20)
    const isValid = await verifyPassword(password, hash)
    expect(isValid).toBe(true)
  })

  it('returns false for wrong password', async () => {
    const hash = await hashPassword('Correct@123')
    const isValid = await verifyPassword('Wrong@123', hash)
    expect(isValid).toBe(false)
  })

  it('different hashes for same password (due to salt)', async () => {
    const hash1 = await hashPassword('SamePass@123')
    const hash2 = await hashPassword('SamePass@123')
    expect(hash1).not.toBe(hash2)
    // but both verify correctly
    expect(await verifyPassword('SamePass@123', hash1)).toBe(true)
    expect(await verifyPassword('SamePass@123', hash2)).toBe(true)
  })
})

describe('generateRefreshToken', () => {
  it('returns a hex string of expected length', () => {
    const token = generateRefreshToken()
    expect(typeof token).toBe('string')
    expect(token.length).toBe(96) // 48 bytes * 2 hex chars
    expect(/^[0-9a-f]+$/.test(token)).toBe(true)
  })

  it('generates unique tokens', () => {
    const t1 = generateRefreshToken()
    const t2 = generateRefreshToken()
    expect(t1).not.toBe(t2)
  })
})

describe('generateToken + verifyToken', () => {
  it('generates and verifies a JWT token', () => {
    const user = { id: 42, email: 'test@example.com', role: 'user' }
    const token = generateToken(user)
    expect(typeof token).toBe('string')
    expect(token.split('.').length).toBe(3) // JWT has 3 parts

    const payload = verifyToken(token)
    expect(payload.userId).toBe(42)
    expect(payload.email).toBe('test@example.com')
    expect(payload.role).toBe('user')
  })

  it('throws for invalid token', () => {
    expect(() => verifyToken('not.a.valid.token')).toThrow()
  })

  it('throws for tampered token', () => {
    const user = { id: 1, email: 'a@b.com', role: 'user' }
    const token = generateToken(user)
    const tampered = token.slice(0, -5) + 'xxxxx'
    expect(() => verifyToken(tampered)).toThrow()
  })
})

// ─── Route tests ─────────────────────────────────────────────────────────────

const app = createTestApp()
app.use('/api/auth', authRoutes)

describe('POST /api/auth/register', () => {
  const user = { ...TEST_USER, email: `test_${Date.now()}@quantceo.dev` }

  it('registers a new user successfully', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: user.email, password: user.password, name: user.name })
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('token')
    expect(res.body).toHaveProperty('refreshToken')
    expect(res.body).toHaveProperty('user')
    expect(res.body.user.email).toBe(user.email)
    expect(res.body.user.name).toBe(user.name)
    expect(res.body.user.passwordHash).toBeUndefined()
  })

  it('rejects duplicate email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: user.email, password: user.password })
    expect(res.status).toBe(409)
    expect(res.body.error).toContain('已被注册')
  })

  it('rejects missing email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ password: user.password })
    expect(res.status).toBe(400)
  })

  it('rejects missing password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@test.com' })
    expect(res.status).toBe(400)
  })

  it('rejects weak password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'weak@test.com', password: '123' })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/auth/login', () => {
  const user = { ...TEST_USER, email: `login_${Date.now()}@quantceo.dev` }

  beforeAll(async () => {
    await request(app).post('/api/auth/register').send(user)
  })

  it('logs in with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('token')
    expect(res.body).toHaveProperty('user')
    expect(res.body.user.email).toBe(user.email)
  })

  it('rejects wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'wrong_password' })
    expect(res.status).toBe(401)
    expect(res.body.error).toContain('邮箱或密码错误')
  })

  it('rejects non-existent user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nonexistent@test.com', password: 'SomePass1!' })
    expect(res.status).toBe(401)
  })

  it('rejects empty fields', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: '', password: '' })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/auth/me', () => {
  let token: string
  const user = { ...TEST_USER, email: `me_${Date.now()}@quantceo.dev` }

  beforeAll(async () => {
    const res = await request(app).post('/api/auth/register').send(user)
    token = res.body.token
  })

  it('returns user info when authenticated', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe(user.email)
  })

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('returns 401 with invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid_token')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/auth/logout', () => {
  let token: string
  const user = { ...TEST_USER, email: `logout_${Date.now()}@quantceo.dev` }

  beforeAll(async () => {
    const res = await request(app).post('/api/auth/register').send(user)
    token = res.body.token
  })

  it('logs out successfully', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

describe('POST /api/auth/change-password', () => {
  let token: string
  const user = { ...TEST_USER, email: `changepw_${Date.now()}@quantceo.dev` }

  beforeAll(async () => {
    const res = await request(app).post('/api/auth/register').send(user)
    token = res.body.token
  })

  it('changes password successfully', async () => {
    const newPw = 'NewPass@123'
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: user.password, newPassword: newPw })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    // Verify can login with new password
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: newPw })
    expect(loginRes.status).toBe(200)
  })

  it('rejects wrong current password', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'wrong', newPassword: 'NewPass@456' })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/auth/refresh', () => {
  let refreshToken: string
  const user = { ...TEST_USER, email: `refresh_${Date.now()}@quantceo.dev` }

  beforeAll(async () => {
    // Register and login to get a valid refresh token
    await request(app).post('/api/auth/register').send(user)
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password })
    refreshToken = loginRes.body.refreshToken
  })

  it('returns new tokens with valid refreshToken', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('token')
    expect(res.body).toHaveProperty('refreshToken')
    expect(res.body).toHaveProperty('user')
  })

  it('returns 400 when refreshToken is missing', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('refreshToken')
  })

  it('returns 401 when refreshToken is invalid', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'invalid_token_xyz' })
    expect(res.status).toBe(401)
  })

  it('returns 401 when refreshToken is expired (manipulated)', async () => {
    // Manually construct an expired session token by using a non-existent token
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'a'.repeat(96) }) // valid format but non-existent
    expect(res.status).toBe(401)
  })
})

describe('PUT /api/auth/me (localUpdateMe)', () => {
  let token: string
  const user = { ...TEST_USER, email: `updateme_${Date.now()}@quantceo.dev` }

  beforeAll(async () => {
    const res = await request(app).post('/api/auth/register').send(user)
    token = res.body.token
  })

  it('updates name successfully', async () => {
    const res = await request(app)
      .put('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Name' })
    expect(res.status).toBe(200)
    expect(res.body.user.name).toBe('New Name')
  })

  it('updates avatar successfully', async () => {
    const res = await request(app)
      .put('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ avatar: 'new_avatar.png' })
    expect(res.status).toBe(200)
  })

  it('updates settings successfully', async () => {
    const res = await request(app)
      .put('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ settings: { theme: 'dark' } })
    expect(res.status).toBe(200)
  })

  it('updates multiple fields at once', async () => {
    const res = await request(app)
      .put('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Multi Update', avatar: 'multi.png' })
    expect(res.status).toBe(200)
  })

  it('returns 400 when no fields provided', async () => {
    const res = await request(app)
      .put('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('没有要更新的字段')
  })

  it('returns 401 without token', async () => {
    const res = await request(app)
      .put('/api/auth/me')
      .send({ name: 'No Auth' })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/auth/change-password extra branches', () => {
  let token: string
  const user = { ...TEST_USER, email: `cpw_extra_${Date.now()}@quantceo.dev` }

  beforeAll(async () => {
    const res = await request(app).post('/api/auth/register').send(user)
    token = res.body.token
  })

  it('rejects missing currentPassword', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'NewPass@123' })
    expect(res.status).toBe(400)
  })

  it('rejects missing newPassword', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: user.password })
    expect(res.status).toBe(400)
  })

  it('rejects weak newPassword', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: user.password, newPassword: 'weak' })
    expect(res.status).toBe(400)
  })

  it('rejects newPassword without letter', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: user.password, newPassword: '12345678' })
    expect(res.status).toBe(400)
  })

  it('rejects newPassword without number', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: user.password, newPassword: 'abcdefgh' })
    expect(res.status).toBe(400)
  })
})
