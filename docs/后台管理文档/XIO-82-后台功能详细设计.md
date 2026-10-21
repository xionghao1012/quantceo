# XIO-82 后台功能详细设计

> 基于 XIO-81 需求文档 + 5 个澄清问题回答，产出可交给开发人员的完整设计文档。

---

## 一、设计目标与约束

**MVP 目标**：在现有 `/admin` 管理后台基础上，叠加 RBAC 权限管理体系，使五类内部角色（运营、运维、客服、管理、销售）能够安全地使用后台，且不影响现有系统访问速度。

**硬约束**：
- 新增模块不得引入同步阻塞到现有 API 路径
- RBAC 权限独立于用户付费订阅体系（`free/pro/premium` 与内部角色分开管理）
- 与现有技术栈一致（Vue 3 前端、Express/Drizzle ORM 后端、PostgreSQL）

---

## 二、角色权限体系

### 2.1 内部角色定义

| 内部角色 | 英文标识 | 核心职责 |
|---------|---------|---------|
| 运营 | `operator` | 日常运营监控、用户状态管理 |
| 运维 | `ops` | 系统运维、技术配置、异常处理 |
| 客服 | `support` | 用户问题处理、订单审核辅助 |
| 管理 | `admin` | 全面权限，可管理所有模块 |
| 销售 | `sales` | 客户管理、销售数据查看 |

> 注意：`admin` 内部角色与传统 `isAdmin=true` 等效，但未来可逐步废弃 `isAdmin` 标志，统一迁移到 RBAC 表驱动。

### 2.2 权限矩阵（MVP Scope）

| 功能 | operator | ops | support | admin | sales |
|------|----------|-----|---------|-------|-------|
| 查看运营统计 | ✅ | ✅ | ❌ | ✅ | ✅ |
| 管理用户（升降级/封禁） | ✅ | ❌ | ❌ | ✅ | ❌ |
| 审核订单 | ✅ | ❌ | ✅ | ✅ | ❌ |
| 查看持仓/策略 | ✅ | ✅ | ✅ | ✅ | ❌ |
| OAuth 应用管理 | ❌ | ✅ | ❌ | ✅ | ❌ |
| 系统配置 | ❌ | ✅ | ❌ | ✅ | ❌ |
| API Keys 管理（查看/吊销） | ✅ | ✅ | ❌ | ✅ | ❌ |

### 2.3 权限模型

采用**角色-权限关联表**模式（而非硬编码角色判断）：

```
admin_roles        — 角色定义（id, name, name_zh, description）
admin_role_permissions — 角色→权限关联（role_id, permission）
admin_user_roles   — 用户→角色关联（user_id, role_id, granted_by, created_at）
permissions        — 权限定义（id, code, name_zh, module）
```

> **性能设计**：权限数据在用户登录时一次性加载到 session（`req.user.permissions[]`），后续请求不查库。角色变更需重新登录或主动刷新 session。

---

## 三、数据模型变更

### 3.1 新增表：permissions

```sql
CREATE TABLE permissions (
  id SERIAL PRIMARY KEY,
  code VARCHAR(64) UNIQUE NOT NULL,  -- 例: 'user.upgrade', 'order.approve'
  name_zh VARCHAR(100) NOT NULL,     -- '用户升降级'
  module VARCHAR(32) NOT NULL,         -- 'user' | 'order' | 'system' | 'oauth'
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.2 新增表：admin_roles

```sql
CREATE TABLE admin_roles (
  id SERIAL PRIMARY KEY,
  code VARCHAR(32) UNIQUE NOT NULL,  -- 'operator', 'ops', 'support', 'admin', 'sales'
  name_zh VARCHAR(64) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.3 新增表：admin_role_permissions

```sql
CREATE TABLE admin_role_permissions (
  role_id INT REFERENCES admin_roles(id) ON DELETE CASCADE,
  permission_id INT REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
```

### 3.4 新增表：admin_user_roles

```sql
CREATE TABLE admin_user_roles (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INT NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
  granted_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, role_id)
);
```

### 3.5 users 表变更（无结构变更）

通过 `admin_user_roles` 表关联，不在 `users` 表新增字段。

---

## 四、后端设计

### 4.1 中间件：`requireAdminRole(permissionCode)`

```typescript
// quant-trading/src/server/middleware/adminRbac.ts

export function requireAdminRole(permissionCode: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: '未认证' });

    // 超级管理员（isAdmin=true） bypass 所有权限检查
    if (req.user.isAdmin) return next();

    const perms: string[] = (req.user as any).permissions || [];
    if (!perms.includes(permissionCode)) {
      return res.status(403).json({ error: '权限不足' });
    }
    next();
  };
}
```

### 4.2 认证时填充 permissions

修改 `auth.ts` 中的 `ssoVerify` / `localVerify` 函数，在用户认证成功后从 DB 加载其权限列表：

```typescript
// 伪代码
const userPerms = await db
  .select({ code: permissions.code })
  .from(admin_user_roles)
  .innerJoin(admin_roles, eq(admin_user_roles.role_id, admin_roles.id))
  .innerJoin(admin_role_permissions, eq(admin_role_permissions.role_id, admin_roles.id))
  .innerJoin(permissions, eq(admin_role_permissions.permission_id, permissions.id))
  .where(eq(admin_user_roles.user_id, userRow.id));

req.user.permissions = userPerms.map(p => p.code);
```

### 4.3 新增 API 路由

| 端点 | 方法 | 权限 | 功能 |
|------|------|------|------|
| `/api/admin/roles` | GET | `role.manage` | 获取所有角色列表 |
| `/api/admin/roles/:id/permissions` | GET | `role.manage` | 获取角色对应权限 |
| `/api/admin/roles/:id` | PUT | `role.manage` | 更新角色权限配置 |
| `/api/admin/users/:userId/roles` | GET | `role.manage` | 获取用户的内部角色 |
| `/api/admin/users/:userId/roles` | POST | `role.manage` | 授予/撤销用户角色 |
| `/api/admin/permissions` | GET | `role.manage` | 获取所有权限定义 |

### 4.4 性能保障

- **权限加载**：登录时一次性查询，不在每个请求中查库
- **读写分离**：若未来性能瓶颈，将 `admin_user_roles` 表数据放入 Redis（当前 MVP 直接查 DB，单次 JOIN 查询 <1ms）
- **禁止同步外部调用**：`requireAdminRole` 中不允许 await DB 以外的同步阻塞（如外部 API 调用）

---

## 五、前端设计

### 5.1 路由改造

现有 `/admin` 页面基于 `AdminView.vue`。MVP 阶段将导航菜单改造为**角色驱动**：

```typescript
// 伪代码：导航配置
const navByRole: Record<string, NavItem[]> = {
  operator: [
    { label: '概览统计', path: '/admin', icon: 'chart' },
    { label: '用户管理', path: '/admin/users', icon: 'users' },
    { label: '订单审核', path: '/admin/orders', icon: 'clipboard' },
  ],
  ops: [
    { label: '概览统计', path: '/admin', icon: 'chart' },
    { label: 'OAuth 应用', path: '/admin/oauth-apps', icon: 'key' },
    { label: '系统配置', path: '/admin/config', icon: 'settings' },
    { label: 'API Keys', path: '/admin/api-keys', icon: 'code' },
  ],
  support: [
    { label: '订单审核', path: '/admin/orders', icon: 'clipboard' },
    { label: '持仓查看', path: '/admin/positions', icon: 'chart-bar' },
  ],
  admin: [/* 所有菜单 */],
  sales: [
    { label: '运营统计', path: '/admin', icon: 'chart' },
    { label: '客户管理', path: '/admin/customers', icon: 'users' },
  ],
};
```

### 5.2 AdminView.vue 改造

**改造原则**：最小化改动，快速上线。

1. **入口判断**：登录后从 `/api/me` 或 session 中获取 `permissions[]`，前端根据权限过滤导航菜单
2. **路由守卫**：每个 `/admin/*` 路由在 `beforeEnter` 中检查权限，无权限重定向到 `/admin`
3. **现有功能保持不变**：订单审核、用户管理、统计三个 Tab 对所有需要权限的角色可见

### 5.3 MVP 不做的事

- 不做角色管理 UI（角色配置在 DB seed 脚本中，admin 自己 SQL 管理）
- 不做权限管理 UI（初期通过迁移脚本管理）
- 不做审计日志 UI（后期迭代）

---

## 六、部署与数据迁移

### 6.1 数据库迁移

```sql
-- 1. 创建权限表
CREATE TABLE permissions (...);
CREATE TABLE admin_roles (...);
CREATE TABLE admin_role_permissions (...);
CREATE TABLE admin_user_roles (...);

-- 2. 插入初始数据
INSERT INTO permissions (code, name_zh, module) VALUES
  ('user.view', '查看用户', 'user'),
  ('user.upgrade', '用户升降级', 'user'),
  ('order.approve', '订单审核', 'order'),
  ('order.view', '查看订单', 'order'),
  ('stats.view', '查看统计', 'stats'),
  ('oauth.manage', 'OAuth 管理', 'oauth'),
  ('system.config', '系统配置', 'system'),
  ('apikey.manage', 'API Keys 管理', 'apikey'),
  ('role.manage', '角色管理', 'role');

INSERT INTO admin_roles (code, name_zh, description) VALUES
  ('operator', '运营', '日常运营管理'),
  ('ops', '运维', '系统运维'),
  ('support', '客服', '客服支持'),
  ('admin', '管理', '全面管理'),
  ('sales', '销售', '销售管理');

-- 3. 给现有 admin 用户分配角色
INSERT INTO admin_user_roles (user_id, role_id, granted_by)
SELECT id, (SELECT id FROM admin_roles WHERE code = 'admin'), id
FROM users WHERE is_admin = true;
```

### 6.2 环境变量

新增 `ADMIN_SESSION_SECRET`（用于签名权限 session），无需新增服务。

---

## 七、MVP 交付范围

### MVP 完成标准

| 交付项 | 说明 |
|--------|------|
| DB Migration | 4 张新表 + 初始数据 seed |
| 中间件 | `requireAdminRole(permissionCode)` |
| API | 6 个新 endpoint（角色管理、用户角色关联） |
| 前端 | 导航菜单按角色过滤、路由守卫 |
| 文档 | 本设计文档 + API 接口文档 |

### MVP 不包含（后期迭代）

- 角色管理 UI（通过 SQL 管理）
- 权限管理 UI
- 操作审计日志
- Redis 缓存权限
- 多因素认证（MFA）支持
- 批量授权 API

---

## 八、风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 权限覆盖不全，admin 用户绕过了 RBAC | 低 | 高 | 初期保留 `isAdmin=true` bypass，但记录 audit log |
| 登录时 JOIN 查权限，延迟增加 | 低 | 中 | MVP 直接查 DB；若成瓶颈迁移到 Redis |
| 前端路由守卫被绕过 | 低 | 高 | 后端每个 API 都有 `requireAdminRole` 检查，前端守卫为 UX 优化 |
| 角色定义与业务不匹配 | 中 | 中 | MVP 阶段角色通过 seed 管理，可快速 SQL 调整 |
