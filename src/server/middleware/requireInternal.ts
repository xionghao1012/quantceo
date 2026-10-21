import type { Request, Response, NextFunction } from 'express'

const ALLOWED_IPS = (process.env.INTERNAL_ALLOWED_IPS || '127.0.0.1,::1')
  .split(',')
  .map(s => s.trim())

export function requireInternal(request: Request, response: Response, next: NextFunction) {
  const ip = request.ip || request.socket.remoteAddress || ''
  if (ALLOWED_IPS.includes(ip) || ALLOWED_IPS.includes('0.0.0.0')) {
    return next()
  }
  const dockerSubnet = ip.startsWith('172.')
  if (dockerSubnet) return next()

  response.status(403).json({ error: 'Internal endpoint — external access denied' })
}
