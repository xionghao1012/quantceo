import crypto from 'crypto'
import type { Request, Response, NextFunction } from 'express'

/**
 * 内部接口鉴权。
 *
 * 之前用 IP 前缀授权（127.0.0.1 或任意 172.*），配合 `app.set('trust proxy', 1)`
 * 可被 `X-Forwarded-For: 172.16.0.1` 伪造（CSO finding 7250f48c）：
 * 未认证者能触发 /api/internal/* 的全市场重算任务。
 *
 * 现在只认共享密钥头，且：
 * - 常数时间比较，避免时序侧信道；
 * - 未配置密钥时 **fail closed**（503），避免「忘了配 = 全网可调」；
 * - 不再信任任何 IP：cloudflared 从本机 loopback 连源站，IP 无法区分隧道流量与本地进程。
 */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

export function requireInternal(request: Request, response: Response, next: NextFunction) {
  const key = process.env.INTERNAL_API_KEY || ''
  if (!key) {
    response.status(503).json({ error: '内部接口未配置 INTERNAL_API_KEY' })
    return
  }
  const provided = request.headers['x-internal-key']
  if (typeof provided === 'string' && timingSafeEqualStr(provided, key)) {
    next()
    return
  }
  response.status(403).json({ error: 'Internal endpoint — 需要 x-internal-key' })
}
