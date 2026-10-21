/**
 * requireAdmin.ts — 管理员权限中间件
 *
 * 从 routes/admin.ts 中抽取，便于单元测试时 mock。
 */

export async function requireAdmin(req: any, res: any, next: any) {
  if (req.user && req.user.isAdmin) {
    req.adminUserId = req.user.userId
    next()
    return
  }
  const ADMIN_KEY = process.env.ADMIN_UPGRADE_KEY || ''
  if (!ADMIN_KEY) {
    res.status(500).json({ error: 'admin key 未配置' })
    return
  }
  const key = req.headers['x-admin-key'] || req.body?.adminKey
  if (key !== ADMIN_KEY) {
    res.status(401).json({ error: '无效的管理员密钥或无权访问' })
    return
  }
  next()
}
