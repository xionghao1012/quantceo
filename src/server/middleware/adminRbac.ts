import type{ Request, Response, NextFunction } from 'express'
import { db } from '../db/db.js'
import { adminUserRoles, adminRoles, adminRolePermissions, permissions } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: number
        email: string
        role: string
        isAdmin?: boolean
        permissions?: string[]
      }
    }
  }
}

export async function loadAdminPermissions(userId: number): Promise<string[]> {
  const rows = await db
    .select({ code: permissions.code })
    .from(adminUserRoles)
    .innerJoin(adminRoles, eq(adminUserRoles.roleId, adminRoles.id))
    .innerJoin(adminRolePermissions, eq(adminRolePermissions.roleId, adminRoles.id))
    .innerJoin(permissions, eq(adminRolePermissions.permissionId, permissions.id))
    .where(and(
      eq(adminUserRoles.userId, userId),
      eq(adminRoles.isActive, true)
    ))
  return rows.map(r => r.code)
}

export function requireAdminRole(permissionCode: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: '未认证' })
    if (req.user.isAdmin) return next()
    const perms: string[] = (req.user as any).permissions || []
    if (!perms.includes(permissionCode)) {
      return res.status(403).json({ error: '权限不足' })
    }
    next()
  }
}

export async function getAdminRoles() {
  return db.select().from(adminRoles).where(eq(adminRoles.isActive, true))
}

export async function getRolePermissions(roleId: number) {
  const rows = await db
    .select({ code: permissions.code, name_zh: permissions.name_zh, module: permissions.module })
    .from(adminRolePermissions)
    .innerJoin(permissions, eq(adminRolePermissions.permissionId, permissions.id))
    .where(eq(adminRolePermissions.roleId, roleId))
  return rows
}

export async function getUserRoles(userId: number) {
  const rows = await db
    .select({
      roleId: adminUserRoles.roleId,
      roleCode: adminRoles.code,
      roleNameZh: adminRoles.name_zh,
      description: adminRoles.description,
    })
    .from(adminUserRoles)
    .innerJoin(adminRoles, eq(adminUserRoles.roleId, adminRoles.id))
    .where(eq(adminUserRoles.userId, userId))
  return rows
}

export async function grantUserRole(userId: number, roleId: number, grantedBy: number): Promise<boolean> {
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.id, roleId)).limit(1);
  if (!role) return false;
  await db.insert(adminUserRoles).values({ userId, roleId, grantedBy }).onConflictDoNothing();
  return true;
}

export async function revokeUserRole(userId: number, roleId: number): Promise<boolean> {
  const [role] = await db.select().from(adminRoles).where(eq(adminRoles.id, roleId)).limit(1);
  if (!role) return false;
  await db.delete(adminUserRoles).where(and(
    eq(adminUserRoles.userId, userId),
    eq(adminUserRoles.roleId, roleId)
  ));
  return true;
}
