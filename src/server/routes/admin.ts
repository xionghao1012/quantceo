import { Router } from 'express';
import { eq, desc, and, or, like, sql } from 'drizzle-orm';
import { db } from '../db/db.js';
import { users, subscriptions, permissions, adminRoles, adminRolePermissions } from '../db/schema.js';
import { activateSubscription, cancelSubscription, logPayment } from '../services/subscription.js';
import { optionalAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { requireAdminRole, getAdminRoles, getRolePermissions, getUserRoles, grantUserRole, revokeUserRole } from '../middleware/adminRbac.js';

const router = Router();

// 1. 列出待验证订单
router.get('/pending-orders', optionalAuth, requireAdmin, async (_req, res) => {
  try {
    const rows = await db.select({
      id: subscriptions.id,
      userId: subscriptions.userId,
      plan: subscriptions.plan,
      externalPlatform: subscriptions.externalPlatform,
      externalOrderId: subscriptions.externalOrderId,
      externalNote: subscriptions.externalNote,
      externalSubmittedAt: subscriptions.externalSubmittedAt,
      createdAt: subscriptions.createdAt,
      email: users.email,
      name: users.name,
    })
    .from(subscriptions)
    .innerJoin(users, eq(subscriptions.userId, users.id))
    .where(eq(subscriptions.status, 'pending'))
    .orderBy(desc(subscriptions.externalSubmittedAt))
    .limit(100);
    res.json({ orders: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 2. 列出所有用户（精简）
router.get('/users', optionalAuth, requireAdmin, async (req, res) => {
  try {
    const search = (req.query.search as string || '').trim();
    let whereClause;
    if (search) {
      whereClause = or(
        like(users.email, `%${search}%`),
        like(users.name, `%${search}%`)
      );
    }
    const userRows = await db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(whereClause)
    .orderBy(desc(users.createdAt))
    .limit(100);

    const subRows = await db.select({
      userId: subscriptions.userId,
      plan: subscriptions.plan,
      status: subscriptions.status,
      provider: subscriptions.provider,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      externalPlatform: subscriptions.externalPlatform,
      externalOrderId: subscriptions.externalOrderId,
    })
    .from(subscriptions)
    .orderBy(desc(subscriptions.createdAt));

    const latestByUser = new Map<number, any>();
    for (const s of subRows) {
      if (!latestByUser.has(s.userId)) latestByUser.set(s.userId, s);
    }

    const result = userRows.map((u) => {
      const sub = latestByUser.get(u.id);
      return {
        ...u,
        plan: sub?.plan || 'free',
        subStatus: sub?.status || null,
        subProvider: sub?.provider || null,
        currentPeriodEnd: sub?.currentPeriodEnd || null,
        externalPlatform: sub?.externalPlatform || null,
        externalOrderId: sub?.externalOrderId || null,
      };
    });

    res.json({ users: result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 3. 验证订单 → 激活订阅
router.post('/verify-order', optionalAuth, requireAdmin, async (req: any, res) => {
  try {
    const { subscriptionId, action, durationDays } = req.body || {};
    if (!subscriptionId) return res.status(400).json({ error: '缺少 subscriptionId' });
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: '无效的 action（approve/reject）' });
    }

    const subRow = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
    const sub = subRow[0];
    if (!sub) return res.status(404).json({ error: '订单不存在' });

    if (action === 'reject') {
      await db.update(subscriptions).set({
        status: 'cancelled',
        cancelledAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(subscriptions.id, subscriptionId));
      await logPayment({
        userId: sub.userId,
        provider: 'manual_qr',
        eventType: 'order_rejected',
        status: 'failed',
        rawData: { subscriptionId, reason: '管理员拒绝' },
      });
      return res.json({ success: true, message: '订单已拒绝' });
    }

    // approve: 激活订阅
    const days = Number(durationDays) > 0 ? Number(durationDays) : 365;
    const periodEnd = new Date(Date.now() + days * 86400000);
    const startDate = new Date();

    await activateSubscription(sub.userId, sub.plan as any, {
      provider: 'manual_qr',
      providerSubId: sub.externalOrderId || undefined,
      providerData: { verifiedFromQueue: subscriptionId, platform: sub.externalPlatform },
      trialDays: 0,
      currentPeriodEnd: periodEnd,
      startDate,
    });

    await db.update(subscriptions).set({
      externalVerifiedAt: new Date(),
      externalVerifiedBy: req.adminUserId || null,
      updatedAt: new Date(),
    }).where(eq(subscriptions.id, subscriptionId));

    await logPayment({
      userId: sub.userId,
      provider: 'manual_qr',
      eventType: 'order_approved',
      amount: sub.plan === 'pro' ? 29900 : 2399200,
      currency: 'CNY',
      status: 'success',
      rawData: { subscriptionId, platform: sub.externalPlatform, orderId: sub.externalOrderId },
    });

    res.json({ success: true, message: '已激活' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 4. 手动升降级
router.post('/set-plan', optionalAuth, requireAdmin, async (req: any, res) => {
  try {
    const { userId, plan, durationDays } = req.body || {};
    if (!userId || !['free', 'pro', 'premium'].includes(plan)) {
      return res.status(400).json({ error: '缺少 userId 或 无效的 plan' });
    }
    const [targetUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!targetUser) return res.status(404).json({ error: '用户不存在' });
    const days = Number(durationDays) > 0 ? Number(durationDays) : 365;
    const periodEnd = new Date(Date.now() + days * 86400000);

    if (plan === 'free') {
      await cancelSubscription(userId);
      await db.update(users).set({ role: 'free' }).where(eq(users.id, userId));
      const sub = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
      if (sub[0]) {
        await db.update(subscriptions).set({ plan: 'free' }).where(eq(subscriptions.id, sub[0].id));
      }
      return res.json({ success: true, message: '已降级到免费' });
    }
    await activateSubscription(userId, plan, {
      provider: 'manual',
      trialDays: 0,
      currentPeriodEnd: periodEnd,
    });
    res.json({ success: true, message: `已升级到 ${plan}` });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 5. 概览统计
router.get('/stats', optionalAuth, requireAdmin, async (_req, res) => {
  try {
    const totalUsers = (await db.select({ count: sql<number>`count(*)::int` }).from(users))[0]?.count || 0;
    const proActive = (await db.select({ count: sql<number>`count(*)::int` }).from(subscriptions).where(eq(subscriptions.status, 'active')))[0]?.count || 0;
    const pending = (await db.select({ count: sql<number>`count(*)::int` }).from(subscriptions).where(eq(subscriptions.status, 'pending')))[0]?.count || 0;
    res.json({
      totalUsers: Number(totalUsers),
      proActive: Number(proActive),
      pendingOrders: Number(pending),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 6. 获取所有权限定义
router.get('/permissions', optionalAuth, requireAdmin, async (_req, res) => {
  try {
    const rows = await db.select().from(permissions).orderBy(permissions.module, permissions.id);
    res.json({ permissions: rows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 7. 获取所有角色列表
router.get('/roles', optionalAuth, requireAdminRole('role.manage'), async (_req, res) => {
  try {
    const roles = await getAdminRoles();
    res.json({ roles });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 8. 获取角色对应的权限
router.get('/roles/:id/permissions', optionalAuth, requireAdminRole('role.manage'), async (req: any, res: any) => {
  try {
    const roleId = Number(req.params.id);
    if (!roleId) return res.status(400).json({ error: '无效的角色ID' });
    const perms = await getRolePermissions(roleId);
    res.json({ permissions: perms });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 9. 更新角色权限配置
router.put('/roles/:id', optionalAuth, requireAdminRole('role.manage'), async (req: any, res: any) => {
  try {
    const roleId = Number(req.params.id);
    const { permissionIds } = req.body as { permissionIds?: number[] };
    if (!roleId) return res.status(400).json({ error: '无效的角色ID' });

    await db.delete(adminRolePermissions).where(eq(adminRolePermissions.roleId, roleId));

    if (Array.isArray(permissionIds) && permissionIds.length > 0) {
      await db.insert(adminRolePermissions).values(
        permissionIds.map(pid => ({ roleId, permissionId: pid }))
      );
    }

    res.json({ success: true, message: '角色权限已更新' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 10. 获取用户的内部角色
router.get('/users/:userId/roles', optionalAuth, requireAdminRole('role.manage'), async (req: any, res: any) => {
  try {
    const userId = Number(req.params.userId);
    if (!userId) return res.status(400).json({ error: '无效的用户ID' });
    const roles = await getUserRoles(userId);
    res.json({ roles });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 11. 授予/撤销用户角色
router.post('/users/:userId/roles', optionalAuth, requireAdminRole('role.manage'), async (req: any, res: any) => {
  try {
    const userId = Number(req.params.userId);
    const { roleId, action } = req.body as { roleId?: number; action?: string };
    if (!userId) return res.status(400).json({ error: '无效的用户ID' });
    if (!roleId) return res.status(400).json({ error: '缺少 roleId' });

    const adminUserId = req.user?.userId;

    if (action === 'revoke') {
      const revoked = await revokeUserRole(userId, roleId);
      if (!revoked) return res.status(400).json({ error: '无效的角色ID' });
      res.json({ success: true, message: '角色已撤销' });
    } else {
      const granted = await grantUserRole(userId, roleId, adminUserId);
      if (!granted) return res.status(400).json({ error: '无效的角色ID' });
      res.json({ success: true, message: '角色已授予' });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
