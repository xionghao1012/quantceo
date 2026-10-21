# 自选股功能说明

## 一、功能概述

自选股模块允许用户将关注的股票添加到个人列表中，支持分组管理和批量操作，方便快速查看关注的股票行情。

**页面路径**: `/watchlist`
**访问权限**: OSS 用户需登录后访问

---

## 二、功能范围

### 2.1 核心功能

| 功能 | 说明 |
|------|------|
| 添加自选股 | 单个或批量添加股票到自选列表 |
| 删除自选股 | 单个或批量删除 |
| 分组管理 | 创建、编辑、删除自定义分组 |
| 移动股票 | 将股票移动到不同分组 |
| 添加备注 | 为自选股添加笔记说明 |

### 2.2 分组功能

- 支持创建多个分组（默认分组）
- 每个分组可设置不同颜色标识
- 分组支持排序（按 sortOrder 字段）
- 删除分组时，分组内的股票移至"未分组"

---

## 三、数量限制

| 限制项 | 限制值 | 说明 |
|--------|--------|------|
| 自选股总数 | 无明确上限 | 建议控制在 200 只以内 |
| 分组数量 | 无明确上限 | 建议控制在 20 个以内 |
| 分组名称 | 最多 50 字符 | |
| 单次批量添加 | 最多 100 只 | 超出部分返回错误 |
| 单次批量删除 | 最多 100 只 | 超出部分返回错误 |

---

## 四、API 接口

### 4.1 自选股 CRUD

**获取自选股列表**
```
GET /api/watchlist
```

**添加单只自选股**
```
POST /api/watchlist
Body: { "code": "600519", "note": "关注", "groupId": 1 }
```

**批量添加自选股**
```
POST /api/watchlist/batch
Body: { "codes": ["600519", "000858"], "groupId": 1 }
```

**更新自选股**
```
PUT /api/watchlist/:id
Body: { "note": "新备注", "groupId": 2 }
```

**删除自选股**
```
DELETE /api/watchlist/:id
```

**批量删除自选股**
```
DELETE /api/watchlist/batch
Body: { "codes": ["600519", "000858"] }
```

### 4.2 分组管理

**获取分组列表**
```
GET /api/watchlist/groups
```

**创建分组**
```
POST /api/watchlist/groups
Body: { "name": "我的持仓", "color": "#f59e0b" }
```

**更新分组**
```
PUT /api/watchlist/groups/:id
Body: { "name": "新名称", "color": "#3b82f6", "sortOrder": 1 }
```

**删除分组**
```
DELETE /api/watchlist/groups/:id
```

---

## 五、数据模型

### 5.1 watchlist 表

```sql
watchlist (
  id: integer PRIMARY KEY,
  user_id: integer NOT NULL,
  group_id: integer NULL,          -- 关联 watchlist_groups.id
  code: varchar(10) NOT NULL,      -- 股票代码
  note: text DEFAULT '',           -- 用户备注
  added_at: timestamp DEFAULT NOW()
)
UNIQUE(user_id, code)              -- 同一用户不能重复添加同一股票
```

### 5.2 watchlist_groups 表

```sql
watchlist_groups (
  id: integer PRIMARY KEY,
  user_id: integer NOT NULL,
  name: varchar(50) NOT NULL,      -- 分组名称
  color: varchar(20) DEFAULT '#f59e0b',
  sort_order: integer DEFAULT 0
)
```

---

## 六、关键逻辑

### 6.1 添加自选股流程

```
1. 验证股票代码是否有效（查询 stocks 表）
2. 检查是否已存在于自选股（防止重复）
3. 如指定 groupId，验证分组是否属于该用户
4. 写入 watchlist 表
```

**重复添加处理**:
- 已存在的股票返回 409 Conflict 错误
- 批量添加时，已存在的股票会被跳过（skipped 计数）

### 6.2 批量添加优化

```typescript
// 1. 过滤有效代码
const validCodes = codes.filter(c => typeof c === 'string' && c.length > 0)

// 2. 查询已存在的股票
const existing = await db.select({ code: watchlist.code })
  .from(watchlist)
  .where(and(eq(watchlist.userId, userId), inArray(watchlist.code, validCodes)))
const existingSet = new Set(existing.map(e => e.code))

// 3. 计算差集，只插入不存在的
const toAdd = validCodes.filter(c => !existingSet.has(c))
```

### 6.3 分组删除

删除分组时，分组内的股票 `groupId` 设为 `NULL`，股票本身保留在自选股中。

---

## 七、相关文件

| 文件路径 | 说明 |
|---------|------|
| `src/server/routes/watchlist.ts` | 自选股 API 路由 |
| `src/client/stores/watchlist.ts` | 前端状态管理 |
| `src/server/db/schema.ts` | watchlist 表定义 |
