# 后台管理系统功能说明

## 一、功能概述

后台管理系统为 QuantCEO 管理员提供完整的系统运营管理能力，包括用户管理、订单审核、角色权限控制、OAuth 应用管理、数据统计等核心功能。

**访问方式**: `/admin`
**访问权限**: Admin 用户（session 登录或 API Key 认证）

---

## 二、访问控制机制

### 2.1 认证方式

| 认证方式 | 说明 | 适用场景 |
|---------|------|---------|
| Session 认证 | 已登录用户且 `isAdmin=true` | 浏览器访问管理后台 |
| API Key 认证 | `x-admin-key` header 或 `adminKey` body 参数匹配 `ADMIN_UPGRADE_KEY` 环境变量 | 外部系统调用 |

### 2.2 quant-trading 管理后台

**中间件**: `requireAdmin`（`quant-trading/src/server/routes/admin.ts`）

```typescript
// 两种认证方式二选一：
// 1. Session: req.user.isAdmin === true
// 2. API Key: x-admin-key header 或 adminKey body 参数匹配 ADMIN_UPGRADE_KEY
```

### 2.3 quant-sso 管理后台

**中间件**: `requireAdmin`（`quant-sso/src/server/middleware/require-admin.ts`）

```typescript
// 检查 req.user.role === 'admin'
```

### 2.4 内部接口访问控制

**中间件**: `requireInternal`（`quant-trading/src/server/middleware/requireInternal.ts`）

允许 IP 列表：`127.0.0.1`、`::1`、Docker 网段 `172.*`

---

## 三、用户管理

### 3.1 用户数据模型

**表名**: `users`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | serial | 主键 |
| `ssoUserId` | integer | 关联 SSO 用户 ID（唯一） |
| `email` | varchar(255) | 用户邮箱（唯一） |
| `name` | varchar(100) | 显示名称 |
| `avatar` | varchar(500) | 头像 URL |
| `role` | varchar(20) | 角色：free / pro / premium / admin |
| `isAdmin` | boolean | 管理员标识（默认 false） |
| `settings` | jsonb | 用户偏好设置 |
| `usage` | jsonb | 每日用量统计（scans、backtests） |
| `referralCode` | varchar(50) | 唯一推荐码 |
| `referredBy` | integer | 推荐人用户 ID |

### 3.2 SSO 用户数据模型

**表名**: `sso_users`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | serial | 主键 |
| `email` | varchar(255) | 邮箱（唯一） |
| `role` | varchar(20) | 角色：free / pro / admin |
| `emailVerified` | boolean | 邮箱验证状态 |
| `totpSecret` | varchar(255) | TOTP 2FA 密钥 |
| `totpEnabled` | boolean | 2FA 启用状态 |
| `totpRecoveryCodes` | jsonb | 恢复码数组 |
| `failedLoginAttempts` | integer | 登录失败次数 |
| `lockedUntil` | timestamp | 账户锁定截止时间 |

### 3.3 API 端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/admin/users` | GET | 获取所有用户列表，支持邮箱搜索 |

---

## 四、角色权限体系

### 4.1 角色类型

**quant-trading**:

```typescript
export type UserRole = 'free' | 'pro' | 'premium' | 'admin'
```

**quant-sso**:

```typescript
export type UserRole = 'free' | 'pro' | 'admin'
```

### 4.2 套餐权限矩阵

| 套餐 | 每日扫描 | 每日回测 | 自选股 | 自定义策略 | 实时推送 | API 访问 |
|------|---------|---------|--------|-----------|---------|---------|
| free | 3 | 3 | 20 | 0 | false | false |
| pro | ∞ | 50 | 100 | 10 | true | false |
| premium | ∞ | ∞ | 500 | ∞ | true | true |

### 4.3 权限控制中间件

| 中间件 | 文件 | 说明 |
|-------|------|------|
| `requireRole(roles)` | `middleware/auth.ts` | 基于角色访问控制 |
| `requirePlan(minPlan)` | `middleware/checkUsage.ts` | 基于套餐的功能门槛 |
| `checkUsage()` | `middleware/checkUsage.ts` | 每日用量限制检查 |
| `checkWatchlistLimit()` | `middleware/checkUsage.ts` | 自选股数量限制检查 |

---

## 五、订阅与订单管理

### 5.1 订阅数据模型

**表名**: `subscriptions`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | serial | 主键 |
| `userId` | integer | 用户 ID（外键） |
| `plan` | varchar(20) | 套餐：free / pro / premium |
| `status` | varchar(20) | 状态：active / trialing / cancelled / pending |
| `provider` | varchar(20) | 支付渠道 |
| `externalOrderId` | varchar(100) | 外部订单号 |
| `externalPlatform` | varchar(20) | 平台：wechat / alipay |
| `externalVerifiedAt` | timestamp | 管理员审核时间 |
| `externalVerifiedBy` | integer | 审核管理员 ID |
| `currentPeriodEnd` | timestamp | 订阅到期时间 |

### 5.2 支付日志数据模型

**表名**: `payment_logs`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | serial | 主键 |
| `subscriptionId` | integer | 订阅 ID（外键） |
| `userId` | integer | 用户 ID（外键） |
| `provider` | varchar(50) | 支付渠道 |
| `eventType` | varchar(50) | 事件类型 |
| `amount` | integer | 金额（分） |
| `status` | varchar(20) | 状态：success / failed / pending |

### 5.3 API 端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/admin/pending-orders` | GET | 获取待审核订单列表 |
| `/api/admin/verify-order` | POST | 审核通过/拒绝订单 |
| `/api/admin/set-plan` | POST | 手动设置用户套餐 |
| `/api/admin/stats` | GET | 获取运营统计数据 |

### 5.4 订单审核流程

```
1. 用户提交二维码订单 → subscription.status = 'pending'
2. 管理员登录后台 → 查看待审核订单
3. 管理员审核：
   - 通过 → subscription.status = 'active'，更新 user.role
   - 拒绝 → subscription.status = 'cancelled'
4. 审核结果记录到 payment_logs
```

---

## 六、OAuth 应用管理（SSO）

### 6.1 应用数据模型

**表名**: `applications`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | serial | 主键 |
| `name` | varchar(100) | 应用名称 |
| `clientId` | varchar(64) | OAuth 客户端 ID（唯一） |
| `clientSecret` | varchar(128) | OAuth 客户端密钥 |
| `redirectUris` | jsonb | 允许的回调 URI 列表 |
| `scopes` | jsonb | 允许的 OAuth 范围 |
| `ipWhitelist` | jsonb | IP 白名单 |
| `active` | boolean | 应用启用状态 |

### 6.2 API 端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/sso/admin/applications` | GET | 获取所有 OAuth 应用列表 |
| `/api/sso/admin/applications` | POST | 创建新 OAuth 应用 |
| `/api/sso/admin/applications/:id` | GET | 获取应用详情 |
| `/api/sso/admin/applications/:id` | PUT | 更新应用配置 |
| `/api/sso/admin/applications/:id` | DELETE | 删除应用 |
| `/api/sso/admin/applications/:id/rotate-secret` | POST | 轮换客户端密钥 |

---

## 七、数据统计

### 7.1 运营统计接口

**端点**: `GET /api/admin/stats`

```typescript
interface AdminStats {
  totalUsers: number    // 总用户数
  proActive: number     // 有效 Pro 订阅数
  pendingOrders: number // 待审核订单数
}
```

---

## 八、内部调度接口

### 8.1 quant-trading 内部接口

| 端点 | 方法 | 认证 | 功能 |
|------|------|------|------|
| `/api/internal/compute-metrics` | POST | IP 白名单 | 触发每日指标计算 |
| `/api/internal/strategy-backtest` | POST | IP 白名单 | 全周期策略回测 |
| `/api/internal/position-alerts` | POST | IP 白名单 | 持仓预警分析（08:30） |

### 8.2 quant-trading 调度任务接口

| 端点 | 方法 | 认证 | 功能 |
|------|------|------|------|
| `/api/scheduler/trigger-daily-picks` | POST | requireAuth | 触发 AI 每日选股 |
| `/api/scheduler/compute-metrics` | POST | requireAuth | 手动触发指标计算 |

---

## 九、API Keys 管理

### 9.1 API Keys 数据模型

**表名**: `api_keys`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | serial | 主键 |
| `userId` | integer | 用户 ID（外键） |
| `name` | varchar(100) | Key 名称 |
| `key` | varchar(100) | 原始 API Key |
| `keyPrefix` | varchar(20) | 显示用前缀 |
| `keyHash` | varchar(255) | 加密存储的 Key |
| `permissions` | jsonb | 权限数组：`["read"]` |
| `expiresAt` | timestamp | 过期时间 |
| `status` | varchar(20) | 状态：active / revoked |

### 9.2 API 端点

| 端点 | 方法 | 权限要求 | 功能 |
|------|------|---------|------|
| `/api/api-keys` | GET | requireAuth + premium | 获取用户 API Keys |
| `/api/api-keys` | POST | requireAuth + premium | 创建新 API Key |
| `/api/api-keys/:id` | DELETE | requireAuth | 吊销 API Key |

---

## 十、相关代码文件

| 文件路径 | 说明 |
|---------|------|
| `quant-trading/src/server/routes/admin.ts` | quant-trading 管理后台 API |
| `quant-trading/src/server/middleware/auth.ts` | 权限中间件（requireRole） |
| `quant-trading/src/server/middleware/checkUsage.ts` | 用量检查与套餐限制 |
| `quant-trading/src/server/middleware/requireInternal.ts` | 内部接口 IP 白名单 |
| `quant-trading/src/server/services/plans.ts` | 套餐权限定义 |
| `quant-trading/src/server/services/subscription.ts` | 订阅管理服务 |
| `quant-trading/src/server/db/schema.ts` | 数据库 Schema |
| `quant-trading/src/client/views/AdminView.vue` | 管理后台前端页面 |
| `quant-sso/src/server/middleware/require-admin.ts` | SSO 管理员认证中间件 |
| `quant-sso/src/server/routes/applications.ts` | OAuth 应用管理 API |
| `quant-sso/src/server/db/schema.ts` | SSO 数据库 Schema |
