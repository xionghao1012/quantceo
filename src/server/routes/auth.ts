import { Router } from 'express'
import type { Request, Response } from 'express'
import { eq, and, gt } from 'drizzle-orm'
import { db } from '../db/db.js'
import { sql } from 'drizzle-orm'
import { users, sessions } from '../db/schema.js'
import { requireAuth } from '../middleware/auth.js'
import {
  hashPassword, verifyPassword, generateToken, generateRefreshToken,
  sanitizeUser, validatePassword, verifyToken,
} from '../services/auth.js'

const router = Router()
const SSO_URL = process.env.SSO_URL || 'http://localhost:3002'
const isPro = !!process.env.LICENSE_KEY

async function seedNewUser(userId: number, email: string, name: string) {
  const userName = name || email.split('@')[0] || '用户'
  try {
    await db.execute(sql`
      INSERT INTO users (id, email, name, role, settings, usage, password_hash, avatar)
      VALUES (${userId}, ${email}, ${userName}, 'free', '{}', '{}', '', '')
      ON CONFLICT (id) DO UPDATE SET email = ${email}, name = ${userName}
    `)
  } catch {}
  try {
    await db.execute(sql`
      INSERT INTO push_settings (user_id, channels, triggers, filter)
      VALUES (${userId}, '{"inApp":true,"wechat":false,"email":false}', '{"onSignal":true,"dailyDigest":false,"weeklyReport":false}', '{"minStrength":50,"onlyBuy":false,"codes":[]}')
      ON CONFLICT (user_id) DO NOTHING
    `)
  } catch {}
  try {
    await db.execute(sql`
      INSERT INTO notification_logs (user_id, channel, type, title, body, data, status)
      VALUES (${userId}, 'inApp', 'signal', '欢迎使用 QuantCEO', ${userName + '，欢迎！系统将为您推送交易信号和选股报告。'}, '{}', 'sent')
    `)
  } catch {}
}

function proxyToSSO(req: Request, res: Response, path: string, opts: { method?: string; body?: boolean } = {}) {
  const url = `${SSO_URL}/api/auth/${path}`
  const options: RequestInit = {
    method: opts.method || req.method,
    headers: {
      'Content-Type': 'application/json',
      ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
    },
  }
  if (opts.body && ['POST', 'PUT', 'PATCH'].includes(options.method!)) {
    options.body = JSON.stringify(req.body)
  }
  fetch(url, options as any)
    .then(async r => {
      const data = await r.json()
      if (path === 'register' && r.ok && data.user?.id) {
        const userEmail = data.user.email || ''
        const userName = data.user.name || userEmail.split('@')[0] || '用户'
        seedNewUser(data.user.id, userEmail, userName).catch(() => {})
      }
      res.status(r.status)
      r.headers.forEach((v, k) => {
        if (['content-type'].includes(k)) res.setHeader(k, v)
      })
      res.json(data)
    })
    .catch(() => res.status(502).json({ error: '认证服务暂时不可用，请稍后重试' }))
}

async function localRegister(req: Request, res: Response) {
  try {
    const { email, password, name } = req.body as { email?: string; password?: string; name?: string }
    if (!email || !password) {
      return res.status(400).json({ error: '邮箱和密码不能为空' })
    }
    const pwErr = validatePassword(password)
    if (pwErr) return res.status(400).json({ error: pwErr })

    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1)
    if (existing.length > 0) {
      return res.status(409).json({ error: '该邮箱已被注册' })
    }

    const passwordHash = await hashPassword(password)
    const [user] = await db.insert(users).values({
      email,
      name: name || email.split('@')[0],
      passwordHash,
      role: 'free',
      settings: {},
      usage: {},
    }).returning()

    const token = generateToken({ id: user.id, email: user.email, role: user.role })
    const refreshToken = generateRefreshToken()
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    await db.insert(sessions).values({ userId: user.id, refreshToken, expiresAt })
    seedNewUser(user.id, user.email, user.name || user.email).catch(() => {})

    res.status(201).json({ token, refreshToken, user: sanitizeUser(user) })
  } catch (e: any) {
    res.status(500).json({ error: e.message || '注册失败' })
  }
}

async function localLogin(req: Request, res: Response) {
  try {
    const { email, password } = req.body as { email?: string; password?: string }
    if (!email || !password) {
      return res.status(400).json({ error: '邮箱和密码不能为空' })
    }

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    if (!user) {
      return res.status(401).json({ error: '邮箱或密码错误' })
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      return res.status(401).json({ error: '邮箱或密码错误' })
    }

    const token = generateToken({ id: user.id, email: user.email, role: user.role })
    const refreshToken = generateRefreshToken()
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    await db.insert(sessions).values({ userId: user.id, refreshToken, expiresAt })

    res.json({ token, refreshToken, user: sanitizeUser(user) })
  } catch (e: any) {
    res.status(500).json({ error: e.message || '登录失败' })
  }
}

async function localRefresh(req: Request, res: Response) {
  try {
    const { refreshToken: token } = req.body as { refreshToken?: string }
    if (!token) return res.status(400).json({ error: 'refreshToken 不能为空' })

    const [session] = await db.select()
      .from(sessions)
      .where(and(eq(sessions.refreshToken, token), gt(sessions.expiresAt, new Date())))
      .limit(1)
    if (!session) return res.status(401).json({ error: 'refreshToken 无效或已过期' })

    const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1)
    if (!user) return res.status(401).json({ error: '用户不存在' })

    const newToken = generateToken({ id: user.id, email: user.email, role: user.role })
    const newRefreshToken = generateRefreshToken()
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

    await db.delete(sessions).where(eq(sessions.id, session.id))
    await db.insert(sessions).values({ userId: user.id, refreshToken: newRefreshToken, expiresAt })

    res.json({ token: newToken, refreshToken: newRefreshToken, user: sanitizeUser(user) })
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'token 刷新失败' })
  }
}

async function localLogout(req: Request, res: Response) {
  try {
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      const payload = verifyToken(authHeader.slice(7))
      await db.delete(sessions).where(eq(sessions.userId, payload.userId))
    }
    res.json({ success: true })
  } catch {
    res.json({ success: true })
  }
}

async function localMe(req: Request, res: Response) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: '未登录' })
    }
    const payload = verifyToken(authHeader.slice(7))
    const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1)
    if (!user) return res.status(401).json({ error: '用户不存在' })
    res.json({ user: sanitizeUser(user) })
  } catch {
    res.status(401).json({ error: 'token 无效' })
  }
}

async function localUpdateMe(req: Request, res: Response) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: '未登录' })
    }
    const payload = verifyToken(authHeader.slice(7))
    const { name, avatar, settings } = req.body as { name?: string; avatar?: string; settings?: any }
    const updates: any = {}
    if (name !== undefined) updates.name = name
    if (avatar !== undefined) updates.avatar = avatar
    if (settings !== undefined) updates.settings = settings
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: '没有要更新的字段' })

    const [user] = await db.update(users).set(updates)
      .where(eq(users.id, payload.userId))
      .returning()
    res.json({ user: sanitizeUser(user) })
  } catch (e: any) {
    res.status(500).json({ error: e.message || '更新失败' })
  }
}

async function localChangePassword(req: Request, res: Response) {
  try {
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string }
    if (!currentPassword || !newPassword) return res.status(400).json({ error: '当前密码和新密码不能为空' })

    const pwErr = validatePassword(newPassword)
    if (pwErr) return res.status(400).json({ error: pwErr })

    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: '未登录' })
    const payload = verifyToken(authHeader.slice(7))

    const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1)
    if (!user) return res.status(401).json({ error: '用户不存在' })

    const valid = await verifyPassword(currentPassword, user.passwordHash)
    if (!valid) return res.status(401).json({ error: '当前密码错误' })

    const passwordHash = await hashPassword(newPassword)
    await db.update(users).set({ passwordHash }).where(eq(users.id, payload.userId))

    res.json({ success: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message || '密码修改失败' })
  }
}

// Routes: OSS 走本地, Pro 走 SSO 代理
if (isPro) {
  router.post('/register', (req, res) => proxyToSSO(req, res, 'register', { method: 'POST', body: true }))
  router.post('/login', (req, res) => proxyToSSO(req, res, 'login', { method: 'POST', body: true }))
  router.post('/refresh', (req, res) => proxyToSSO(req, res, 'refresh', { method: 'POST', body: true }))
  router.post('/logout', (req, res) => proxyToSSO(req, res, 'logout', { method: 'POST', body: true }))
  router.get('/me', (req, res) => proxyToSSO(req, res, 'me'))
  router.put('/me', (req, res) => proxyToSSO(req, res, 'me', { method: 'PUT', body: true }))
  router.post('/change-password', requireAuth, (req, res) => proxyToSSO(req, res, 'change-password', { method: 'POST', body: true }))
  router.get('/github', (_req, res) => { res.redirect(`${SSO_URL}/api/auth/github`) })
  router.get('/github/callback', (req, res) => {
    const query = new URLSearchParams(req.query as Record<string, string>).toString()
    res.redirect(`${SSO_URL}/api/auth/github/callback?${query}`)
  })
} else {
  router.post('/register', localRegister)
  router.post('/login', localLogin)
  router.post('/refresh', localRefresh)
  router.post('/logout', localLogout)
  router.get('/me', localMe)
  router.put('/me', localUpdateMe)
  router.post('/change-password', requireAuth, localChangePassword)
}

export default router
