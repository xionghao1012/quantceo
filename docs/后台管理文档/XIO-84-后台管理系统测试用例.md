# XIO-84 后台管理系统测试用例

> 基于 XIO-82 后台功能详细设计文档，编写测试用例。

---

## 一、测试范围

本测试用例覆盖以下模块：

1. **RBAC 数据模型** - 权限定义、角色定义、关联表
2. **角色-权限关联 API** - CRUD 操作
3. **用户-角色关联 API** - 授予/撤销操作
4. **权限矩阵验证** - 5 个角色 × 9 个权限
5. **requireAdminRole 中间件** - 鉴权行为
6. **向后兼容** - 现有 Admin API 不受影响
7. **数据完整性** - 唯一性约束、无孤立数据

---

## 二、测试用例详情

### 2.1 RBAC 数据模型测试

| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 |
|---------|---------|---------|---------|---------|
| RBAC-DM-001 | 获取所有权限定义 | 已登录 Admin | GET /api/admin/permissions | 返回所有 MVP 权限，字段完整 |
| RBAC-DM-002 | 权限代码唯一性 | 无 | 检查 permissions 表 | 无重复 code |
| RBAC-DM-003 | 权限按模块分组 | 已登录 Admin | GET /api/admin/permissions | 包含 user/order/stats/oauth/system/apikey/role 模块 |
| RBAC-DM-004 | 获取所有角色列表 | 已登录 Admin | GET /api/admin/roles | 返回 5 个角色（operator/ops/support/admin/sales） |
| RBAC-DM-005 | 角色代码唯一性 | 无 | 检查 admin_roles 表 | 无重复 code |
| RBAC-DM-006 | 角色字段完整性 | 已登录 Admin | GET /api/admin/roles | 每个角色包含 id/code/name_zh/is_active |

### 2.2 角色-权限关联测试

| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 |
|---------|---------|---------|---------|---------|
| RBAC-RP-001 | 查看 admin 角色权限 | 已登录 Admin | GET /api/admin/roles/1/permissions | 返回所有权限 |
| RBAC-RP-002 | 查看 operator 角色权限 | 已登录 Admin | GET /api/admin/roles/2/permissions | 返回 5 个权限 |
| RBAC-RP-003 | 查看 ops 角色权限 | 已登录 Admin | GET /api/admin/roles/3/permissions | 返回 4 个权限 |
| RBAC-RP-004 | 查看 support 角色权限 | 已登录 Admin | GET /api/admin/roles/4/permissions | 返回 2 个权限 |
| RBAC-RP-005 | 查看 sales 角色权限 | 已登录 Admin | GET /api/admin/roles/5/permissions | 返回 1 个权限 |
| RBAC-RP-006 | 更新角色权限 | 已登录 Admin | PUT /api/admin/roles/1 + permissionIds | 权限更新成功 |
| RBAC-RP-007 | 清空角色权限 | 已登录 Admin | PUT /api/admin/roles/1 + [] | 权限列表清空 |
| RBAC-RP-008 | 无效角色ID | 已登录 Admin | GET /api/admin/roles/invalid/permissions | 返回 400 |
| RBAC-RP-009 | 不存在角色ID | 已登录 Admin | GET /api/admin/roles/99999/permissions | 返回空数组 |

### 2.3 用户-角色关联测试

| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 |
|---------|---------|---------|---------|---------|
| RBAC-UR-001 | 授予角色 | 已登录 Admin + 测试用户 | POST /api/admin/users/{id}/roles + roleId + grant | 角色授予成功 |
| RBAC-UR-002 | 撤销角色 | 已登录 Admin + 已授权用户 | POST /api/admin/users/{id}/roles + roleId + revoke | 角色撤销成功 |
| RBAC-UR-003 | 查看用户角色 | 已登录 Admin | GET /api/admin/users/{id}/roles | 返回用户所有角色 |
| RBAC-UR-004 | 无角色用户 | 已登录 Admin + 新用户 | GET /api/admin/users/{新用户id}/roles | 返回空数组 |
| RBAC-UR-005 | 缺少 roleId 参数 | 已登录 Admin | POST /api/admin/users/{id}/roles + action only | 返回 400 |
| RBAC-UR-006 | 幂等撤销 | 已登录 Admin | POST revoke 不存在的角色 | 返回 200，不报错 |

### 2.4 权限矩阵验证

| 角色 | stats.view | user.upgrade | order.approve | order.view | oauth.manage | system.config | apikey.manage | role.manage |
|------|-----------|-------------|-------------|-----------|-------------|--------------|--------------|------------|
| operator | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| ops | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| support | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| sales | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**测试用例**：对每个角色验证其权限列表与矩阵完全一致。

### 2.5 requireAdminRole 中间件测试

| 用例编号 | 用例名称 | 测试步骤 | 预期结果 |
|---------|---------|---------|---------|
| RBAC-MW-001 | isAdmin bypass | Admin 用户访问 role.manage 端点 | 正常返回，bypass 权限检查 |
| RBAC-MW-002 | 权限不足 403 | 无 role.manage 权限用户访问 /api/admin/roles | 返回 403 |
| RBAC-MW-003 | 未认证 401 | 未带 token 访问受保护端点 | 返回 401 |

### 2.6 向后兼容测试

| 用例编号 | 用例名称 | 测试步骤 | 预期结果 |
|---------|---------|---------|---------|
| RBAC-BC-001 | 用户列表 API | GET /api/admin/users | 正常返回用户列表 |
| RBAC-BC-002 | 用户搜索 | GET /api/admin/users?search=xxx | 按名称/邮箱过滤 |
| RBAC-BC-003 | 统计 API | GET /api/admin/stats | 返回 totalUsers/proActive/pendingOrders |
| RBAC-BC-004 | 待审核订单 | GET /api/admin/pending-orders | 返回订单列表 |

### 2.7 数据完整性测试

| 用例编号 | 用例名称 | 预期结果 |
|---------|---------|---------|
| RBAC-DI-001 | permissions.code 无重复 | Set(codes).size === codes.length |
| RBAC-DI-002 | admin_roles.code 无重复 | Set(codes).size === codes.length |
| RBAC-DI-003 | 每个角色至少有一个权限 | admin 角色必须有权限 |

---

## 三、测试数据要求

### 3.1 Seed 数据（DB Migration）

```sql
-- 权限数据
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

-- 角色数据
INSERT INTO admin_roles (code, name_zh, description) VALUES
  ('operator', '运营', '日常运营管理'),
  ('ops', '运维', '系统运维'),
  ('support', '客服', '客服支持'),
  ('admin', '管理', '全面管理'),
  ('sales', '销售', '销售管理');

-- 角色-权限关联
-- operator: stats.view, user.upgrade, order.approve, order.view, apikey.manage
-- ops: stats.view, oauth.manage, system.config, apikey.manage
-- support: order.approve, order.view
-- admin: 所有权限
-- sales: stats.view
```

### 3.2 测试用户

| 用户 | 用途 | 角色 |
|------|------|------|
| dev@test.com | Admin 基准用户 | isAdmin=true |
| rbac_test_{timestamp}@test.com | 无角色测试用户 | 无 |
| rbac_operator@test.com | Operator 角色测试 | operator |
| rbac_ops@test.com | Ops 角色测试 | ops |

---

## 四、测试执行要求

1. **前置条件**：数据库已执行 migration（4 张新表 + seed 数据）
2. **环境**：dev 环境（quant_ceo_dev）
3. **执行顺序**：先跑数据模型测试，再跑 API 测试
4. **清理**：测试后撤销授予的角色，避免污染数据库

---

## 五、测试代码位置

- 单元/集成测试：`quant-trading/src/server/__tests__/adminRbac.test.ts`
- 测试覆盖范围：后端 RBAC API + 中间件 + 数据验证
