import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import type { User, JwtPayload } from '../../shared/types.js'

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  console.warn('[auth] WARNING: JWT_SECRET not set. Using insecure default. Set JWT_SECRET in production.')
  return 'quantceo-dev-default-change-me'
})()
const JWT_EXPIRES_IN = '1d'
const REFRESH_TOKEN_BYTES = 48
const BCRYPT_ROUNDS = 12

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('hex')
}

export function generateToken(user: { id: number; email: string; role: string }): string {
  const payload: JwtPayload = {
    userId: user.id,
    email: user.email,
    role: user.role as User['role'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  }
  return jwt.sign(payload, JWT_SECRET)
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload
}

export function sanitizeUser(user: {
  id: number
  email: string
  name: string
  avatar: string
  role: string
  settings: any
  usage: any
  createdAt: Date
  updatedAt: Date
}): User {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar || '',
    role: user.role as User['role'],
    settings: typeof user.settings === 'string' ? JSON.parse(user.settings) : (user.settings || {}),
    usage: typeof user.usage === 'string' ? JSON.parse(user.usage) : (user.usage || {}),
    createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : String(user.createdAt),
    updatedAt: user.updatedAt instanceof Date ? user.updatedAt.toISOString() : String(user.updatedAt),
  }
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return '密码至少8位'
  if (!/[a-zA-Z]/.test(password)) return '密码需包含字母'
  if (!/[0-9]/.test(password)) return '密码需包含数字'
  return null
}
