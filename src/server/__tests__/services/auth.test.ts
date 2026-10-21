import { describe, it, expect } from 'vitest'
import {
  generateToken, verifyToken, generateRefreshToken,
  hashPassword, verifyPassword, validatePassword, sanitizeUser,
} from '../../services/auth.js'

describe('auth service', () => {
  // Lines 7-8 are covered by auth.jwt-warning.test.ts (separate module import)
  describe('generateToken', () => {
    it('generates a non-empty string token', () => {
      const token = generateToken({ id: 1, email: 'test@test.com', role: 'user' })
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(10)
    })
    it('generates different tokens for different users', () => {
      const token1 = generateToken({ id: 1, email: 'user1@test.com', role: 'user' })
      const token2 = generateToken({ id: 2, email: 'user2@test.com', role: 'user' })
      expect(token1).not.toBe(token2)
    })
    it('payload contains all user fields', () => {
      const token = generateToken({ id: 99, email: 'a@b.com', role: 'admin' })
      const payload = verifyToken(token)
      expect(payload.userId).toBe(99)
      expect(payload.email).toBe('a@b.com')
      expect(payload.role).toBe('admin')
    })
    it('tokens are valid JWT format', () => {
      const token = generateToken({ id: 1, email: 'test@test.com', role: 'user' })
      expect(token.split('.').length).toBe(3)
    })
  })

  describe('verifyToken', () => {
    it('verifies a valid token', () => {
      const token = generateToken({ id: 1, email: 'test@test.com', role: 'user' })
      const payload = verifyToken(token)
      expect(payload.userId).toBe(1)
      expect(payload.email).toBe('test@test.com')
    })
    it('throws for invalid token', () => {
      expect(() => verifyToken('invalid.token.here')).toThrow()
    })
    it('throws for empty token', () => {
      expect(() => verifyToken('')).toThrow()
    })
    it('throws for tampered token', () => {
      const token = generateToken({ id: 1, email: 'a@b.com', role: 'user' })
      const tampered = token.slice(0, -5) + 'XXXXX'
      expect(() => verifyToken(tampered)).toThrow()
    })
  })

  describe('generateRefreshToken', () => {
    it('generates a non-empty string', () => {
      const token = generateRefreshToken()
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(10)
    })
    it('generates different tokens on each call', () => {
      const token1 = generateRefreshToken()
      const token2 = generateRefreshToken()
      expect(token1).not.toBe(token2)
    })
    it('generates 96-char hex string (48 bytes)', () => {
      const token = generateRefreshToken()
      expect(token.length).toBe(96)
      expect(/^[0-9a-f]+$/.test(token)).toBe(true)
    })
  })

  describe('hashPassword + verifyPassword', () => {
    it('hashes and verifies a valid password', async () => {
      const hash = await hashPassword('Test@123456')
      expect(hash).not.toBe('Test@123456')
      expect(hash.length).toBeGreaterThan(20)
      const valid = await verifyPassword('Test@123456', hash)
      expect(valid).toBe(true)
    })
    it('returns false for wrong password', async () => {
      const hash = await hashPassword('Correct@123')
      const valid = await verifyPassword('Wrong@123', hash)
      expect(valid).toBe(false)
    })
    it('different hashes for same password (salted)', async () => {
      const h1 = await hashPassword('Same@123')
      const h2 = await hashPassword('Same@123')
      expect(h1).not.toBe(h2)
      expect(await verifyPassword('Same@123', h1)).toBe(true)
      expect(await verifyPassword('Same@123', h2)).toBe(true)
    })
  })

  describe('validatePassword', () => {
    it('returns null for valid password', () => {
      expect(validatePassword('Valid123')).toBeNull()
      expect(validatePassword('LongEnough1')).toBeNull()
      expect(validatePassword('abcDEF12345678')).toBeNull()
    })
    it('returns error for short password', () => {
      expect(validatePassword('Short1!')).toBe('密码至少8位')
      expect(validatePassword('Ab1')).toBe('密码至少8位')
    })
    it('returns error for password without letter', () => {
      expect(validatePassword('12345678')).toBe('密码需包含字母')
    })
    it('returns error for password without number', () => {
      expect(validatePassword('abcdefgh')).toBe('密码需包含数字')
    })
    it('checks length first (short + no letter → length error)', () => {
      expect(validatePassword('abc')).toBe('密码至少8位')
    })
  })

  describe('sanitizeUser', () => {
    const base = {
      id: 1, email: 'test@example.com', name: 'Test', role: 'user',
      settings: {}, usage: {}, isAdmin: false,
      createdAt: new Date('2024-01-01'), updatedAt: new Date('2024-01-02'),
    }
    it('returns all fields', () => {
      const r = sanitizeUser(base as any)
      expect(r.id).toBe(1)
      expect(r.email).toBe('test@example.com')
      expect(r.name).toBe('Test')
    })
    it('defaults avatar to empty string', () => {
      const r = sanitizeUser({ ...base, avatar: '' as any })
      expect(r.avatar).toBe('')
    })
    it('defaults isAdmin to false when null', () => {
      const r = sanitizeUser({ ...base, isAdmin: null as any } as any)
      expect(r.isAdmin).toBe(false)
    })
    it('parses string settings as JSON', () => {
      const r = sanitizeUser({ ...base, settings: '{"theme":"dark"}' } as any)
      expect(r.settings).toEqual({ theme: 'dark' })
    })
    it('keeps object settings as-is', () => {
      const r = sanitizeUser({ ...base, settings: { theme: 'light' } } as any)
      expect(r.settings).toEqual({ theme: 'light' })
    })
    it('parses string usage as JSON', () => {
      const r = sanitizeUser({ ...base, usage: '{"requests":5}' } as any)
      expect(r.usage).toEqual({ requests: 5 })
    })
    it('defaults settings/usage to {} when null/undefined', () => {
      const r1 = sanitizeUser({ ...base, settings: null as any } as any)
      expect(r1.settings).toEqual({})
      const r2 = sanitizeUser({ ...base, usage: undefined as any } as any)
      expect(r2.usage).toEqual({})
    })
    it('converts Date createdAt/updatedAt to ISO string', () => {
      const r = sanitizeUser(base as any)
      expect(r.createdAt).toBe('2024-01-01T00:00:00.000Z')
      expect(r.updatedAt).toBe('2024-01-02T00:00:00.000Z')
    })
    it('keeps string dates as strings', () => {
      const r = sanitizeUser({ ...base, createdAt: '2024-01-01' as any, updatedAt: '2024-01-02' as any } as any)
      expect(r.createdAt).toBe('2024-01-01')
      expect(r.updatedAt).toBe('2024-01-02')
    })
    it('preserves isAdmin when true', () => {
      const r = sanitizeUser({ ...base, isAdmin: true } as any)
      expect(r.isAdmin).toBe(true)
    })
  })
})
