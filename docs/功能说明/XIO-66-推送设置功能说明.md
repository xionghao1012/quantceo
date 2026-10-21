# 推送设置功能说明

## 一、功能概述

推送设置允许用户配置站内通知、微信 ServerChan 推送通道，以及选择触发条件。

**页面路径**: `/settings/push`
**访问权限**: Pro 用户

---

## 二、推送通道配置

### 2.1 支持的通道

| 通道 | 说明 | 默认状态 |
|------|------|---------|
| 站内通知 | 应用内实时通知 | 开启 |
| 微信 ServerChan | 通过 ServerChan 推送至微信 | 关闭 |
| 邮件 | Email 推送 | 关闭 |

### 2.2 ServerChan SCKEY 设置

**API 端点**: `https://sctapi.ftqq.com/{SCKEY}.send`

**设置步骤**:
1. 在 [ServerChan 官网](https://sct.ftqq.com/) 开通服务
2. 获取 SCKEY
3. 在推送设置页面填写 SCKEY
4. 点击"测试"验证配置

**测试接口**:
```typescript
POST /api/push/test
// 成功返回: { success: true }
// 失败返回: { success: false, error: '错误信息' }
```

---

## 三、推送设置数据模型

### 3.1 数据库表结构

**表名**: `push_settings`

| 字段 | 类型 | 说明 |
|------|------|------|
| `userId` | integer | 用户 ID |
| `channels` | jsonb | 通道配置 |
| `triggers` | jsonb | 触发条件配置 |
| `filter` | jsonb | 过滤条件配置 |
| `serverChanKey` | varchar(100) | ServerChan SCKEY |

### 3.2 默认值

```typescript
channels: { inApp: true, wechat: false, email: false }
triggers: { onSignal: true, dailyDigest: false, weeklyReport: false }
filter: { minStrength: 50, onlyBuy: false, codes: [] }
```

---

## 四、推送触发条件

### 4.1 触发类型

| 触发类型 | 说明 | 频率 |
|---------|------|------|
| `onSignal` | 信号实时推送 | 实时 |
| `dailyDigest` | 每日信号摘要 | 每日一次 |
| `weeklyReport` | 每周报告 | 每周一 |

### 4.2 过滤条件

| 条件 | 说明 |
|------|------|
| `minStrength` | 最小信号强度（默认 50） |
| `onlyBuy` | 仅推送买入信号 |
| `codes` | 指定股票代码列表（为空则全部） |

---

## 五、推送频率限制

| 触发类型 | 频率 | 限制 |
|---------|------|------|
| 信号推送 | 实时 | 无严格限制 |
| 每日摘要 | 每日 08:00 | 每天一次 |
| 每周报告 | 每周一 08:00 | 每周一次 |
| 测试推送 | 手动 | 无限制 |

**按套餐访问权限**:
- **Free 用户**: 无实时推送权限
- **Pro/Premium 用户**: 开启实时推送

---

## 六、ServerChan API 集成

### 6.1 API 调用格式

```
GET https://sctapi.ftqq.com/{SCKEY}.send?title={title}&content={content}
User-Agent: QuantCEO/1.0
```

**成功判断**: `json.code === 0` 或响应包含 `success`

### 6.2 消息格式

**微信/ServerChan 消息**:
```
Title: QuantCEO信号: {code} {direction} 强度{strength}
Body: • {name}({code}) | {direction} | 强度{strength} | {price}
```

**每日摘要**:
```
Title: QuantCEO 每日信号 {date}
Body: 信号列表...
```

---

## 七、推送失败处理

### 7.1 失败处理机制

- **无自动重试**: 失败记录到 `notification_logs`，状态为 `failed`
- **手动重试**: 通过 `/api/push/test` 端点测试和重试
- **站内通知失败**: 不阻塞其他通道（每个用户单独 try-catch）
- **邮件失败**: SMTP 未配置时静默跳过

### 7.2 Redis 重试策略

```typescript
retryStrategy(times) {
  if (times > 3) return null  // 最多 3 次重试
  return Math.min(times * 100, 1000)  // 100ms, 200ms, 300ms... 最高 1000ms
}
```

---

## 八、通知日志

### 8.1 日志表结构

**表名**: `notification_logs`

| 字段 | 类型 | 说明 |
|------|------|------|
| `channel` | varchar | 通道（inApp/wechat/email） |
| `type` | varchar | 类型（signal/dailyDigest/weeklyReport/alert） |
| `title` | varchar | 标题 |
| `body` | text | 内容 |
| `data` | jsonb | 完整数据 |
| `status` | varchar | 状态（sent/failed/read） |
| `readAt` | timestamp | 已读时间 |

---

## 九、API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `GET /api/push/settings` | GET | 获取推送设置 |
| `PUT /api/push/settings` | PUT | 更新推送设置 |
| `GET /api/push/notifications` | GET | 获取通知历史 |
| `GET /api/push/unread-count` | GET | 获取未读数量 |
| `PUT /api/push/notifications/:id/read` | PUT | 标记已读 |
| `PUT /api/push/notifications/read-all` | PUT | 全部标记已读 |
| `POST /api/push/test` | POST | 测试 ServerChan |

---

## 十、相关代码文件

| 文件路径 | 说明 |
|---------|------|
| `quant-trading/src/server/routes/push.ts` | 推送设置 API |
| `quant-trading/src/server/services/push/dispatcher.ts` | 推送调度器 |
| `quant-trading/src/server/services/push/channels/server-chan.ts` | ServerChan 集成 |
| `quant-trading/src/server/services/push/channels/email.ts` | 邮件通道 |
| `quant-trading/src/server/db/schema.ts` | 数据库 schema |
| `quant-trading/src/client/views/PushSettingsView.vue` | 推送设置前端页面 |
