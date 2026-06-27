import type { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from '../db/db.js'
import { users } from '../db/schema.js'
import { verifyToken, hashPassword } from '../services/auth.js'

declare global {
  namespace Express {
    interface Request {
      user?: { userId: number; email: string; role: string }
    }
  }
}

const SSO_URL = process.env.SSO_URL || 'http://localhost:3002'
const isPro = !!process.env.LICENSE_KEY

async function ssoVerify(token: string): Promise<{ userId: number; email: string; role: string } | null> {
  try {
    const ssoRes = await fetch(`${SSO_URL}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const data = await ssoRes.json() as { valid?: boolean; user?: { id: number; email: string; role: string } }
    if (!ssoRes.ok || !data.valid || !data.user) return null

    const ssoUserId = data.user.id
    let rows = await db.select().from(users).where(eq(users.ssoUserId, ssoUserId)).limit(1)
    if (rows.length > 0) {
      return { userId: rows[0].id, email: rows[0].email, role: rows[0].role }
    }

    rows = await db.select().from(users).where(eq(users.email, data.user.email)).limit(1)
    if (rows.length > 0) {
      await db.update(users).set({ ssoUserId }).where(eq(users.id, rows[0].id))
      return { userId: rows[0].id, email: rows[0].email, role: rows[0].role }
    }

    const tempPassword = crypto.randomUUID()
    const [newUser] = await db.insert(users).values({
      ssoUserId,
      email: data.user.email,
      name: '',
      avatar: '',
      passwordHash: await hashPassword(tempPassword),
      role: data.user.role,
      settings: {},
      usage: {},
    }).returning()
    return { userId: newUser.id, email: newUser.email, role: newUser.role }
  } catch {
    return null
  }
}

function localVerify(token: string): { userId: number; email: string; role: string } | null {
  try {
    const payload = verifyToken(token)
    return { userId: payload.userId, email: payload.email, role: payload.role }
  } catch {
    return null
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录，请先登录' })
  }

  const token = header.slice(7)
  let user: { userId: number; email: string; role: string } | null = null

  if (isPro) {
    user = await ssoVerify(token)
    if (!user) return res.status(502).json({ error: '认证服务不可用，请稍后重试' })
  } else {
    user = localVerify(token)
    if (!user) return res.status(401).json({ error: '登录已过期，请重新登录' })
  }

  req.user = user
  next()
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7)
    const user = isPro ? null : localVerify(token)
    if (user) req.user = user
  }
  next()
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: '未登录' })
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: '权限不足' })
    next()
  }
}
