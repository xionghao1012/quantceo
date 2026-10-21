# 交易日志功能说明

## 一、功能概述

交易日志模块为 Pro 用户提供完整的交易记录、统计分析、收益日历和趋势追踪功能，帮助用户量化交易表现并持续优化投资策略。

**页面路径**: `/trade-journal`
**访问权限**: Pro 用户专用

---

## 二、功能范围

### 2.1 核心功能

| 功能 | 说明 |
|------|------|
| 交易记录 | 记录每笔入场/出场交易，含持仓周期、盈亏、收益率 |
| 统计分析 | 胜率、盈亏比、期望收益、月度趋势等核心指标 |
| 收益日历 | 按日/按月展示交易频次和盈亏热力图 |
| 标签管理 | 支持自定义标签（策略、题材、情绪等）分类交易 |
| 策略追踪 | 关联策略名称，评估不同策略表现差异 |
| 评分系统 | 用户可对每笔交易进行 0-5 星评分复盘 |

---

## 三、交易日志数据模型

### 3.1 trade_journal 表结构

| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial | 主键 |
| userId | integer | 用户 ID |
| code | varchar(10) | 股票代码 |
| name | varchar(100) | 股票名称 |
| direction | varchar(10) | 交易方向（long/short） |
| entryDate | date | 入场日期 |
| exitDate | date | 出场日期（平仓时填写） |
| entryPrice | numeric(12,4) | 入场价格 |
| exitPrice | numeric(12,4) | 出场价格 |
| shares | integer | 持仓数量（股数） |
| pnl | numeric(14,2) | 盈亏金额（元） |
| returnPct | numeric(10,4) | 收益率（%） |
| tags | varchar(200)[] | 标签数组 |
| notes | text | 交易笔记 |
| strategy | varchar(100) | 关联策略名称 |
| rating | integer | 交易评分（0-5 星） |
| createdAt | timestamp | 记录创建时间 |
| updatedAt | timestamp | 最后更新时间 |

### 3.2 交易状态判断

```
持仓状态 = exit_date IS NULL ? 'open' : 'closed'
```

- **open（持仓中）**: exit_date 为空，表示尚未平仓
- **closed（已平仓）**: exit_date 非空，表示已完成交易

---

## 四、日志写入机制

### 4.1 新建交易记录

**触发时机**: 用户手动录入入场交易，或系统自动同步券商交易记录

**必填字段**: code, direction, entryDate, entryPrice, shares

**可选字段**: name, exitDate, exitPrice, tags, notes, strategy, rating

**PnL 自动计算逻辑** (`tradeJournal.ts:43-48`):
```typescript
if (exitDate && exitPrice) {
  const cost = shares * entryPrice          // 买入成本
  const proceeds = shares * exitPrice       // 卖出收入
  pnl = proceeds - cost                      // 绝对盈亏
  returnPct = cost > 0 ? ((proceeds - cost) / cost) * 100 : 0  // 收益率
}
```

### 4.2 更新交易记录（平仓）

**触发时机**: 用户填写出场日期和出场价格时

**字段更新**:
```typescript
updates.exitDate = exitDate
updates.exitPrice = exitPrice
updates.pnl = (shares * exitPrice) - (shares * entryPrice)
updates.returnPct = ((shares * exitPrice - shares * entryPrice) / (shares * entryPrice)) * 100
updates.updatedAt = new Date()
```

### 4.3 删除交易记录

**触发时机**: 用户删除某笔交易

**执行**: 物理删除，不可恢复

---

## 五、量化指标计算

### 5.1 基础统计指标

| 指标 | SQL 聚合 | 计算公式 |
|------|---------|---------|
| totalClosed | COUNT(*) FILTER (WHERE exit_date IS NOT NULL) | 已平仓交易数 |
| totalOpen | COUNT(*) FILTER (WHERE exit_date IS NULL) | 持仓中交易数 |
| wins | COUNT(*) FILTER (WHERE pnl > 0) | 盈利交易数 |
| losses | COUNT(*) FILTER (WHERE pnl < 0) | 亏损交易数 |
| totalPnl | COALESCE(SUM(pnl), 0) | 累计盈亏总额 |
| avgPnl | COALESCE(AVG(pnl) FILTER (WHERE exit_date IS NOT NULL), 0) | 平均每笔盈亏 |
| avgReturn | COALESCE(AVG(return_pct) FILTER (WHERE exit_date IS NOT NULL), 0) | 平均收益率 |
| bestTrade | COALESCE(MAX(pnl) FILTER (WHERE exit_date IS NOT NULL), 0) | 单笔最大盈利 |
| worstTrade | COALESCE(MIN(pnl) FILTER (WHERE exit_date IS NOT NULL), 0) | 单笔最大亏损 |

### 5.2 胜率 (Win Rate)

**定义**: 盈利交易次数占已平仓交易总数的比例

**计算公式**:
```
winRate = (wins / closed) × 100%
```

**代码实现** (`tradeJournal.ts:114`):
```typescript
const winRate = closed > 0 ? (wins / closed) * 100 : 0
```

### 5.3 盈亏比 (Profit Factor)

**定义**: 平均盈利金额与平均亏损金额的比值

**计算公式**:
```
avgWin = AVG(pnl) WHERE pnl > 0
avgLoss = ABS(AVG(pnl) WHERE pnl < 0)
profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0
```

**代码实现** (`tradeJournal.ts:121-123`):
```typescript
const avgWin = Math.abs(Number((pnlRows[0] as any)?.avg_win || 0))
const avgLoss = Math.abs(Number((pnlRows[0] as any)?.avg_loss || 0))
const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0
```

### 5.4 期望收益 (Expectancy)

**定义**: 每笔交易的平均期望收益，综合考虑胜率和盈亏比

**计算公式**:
```
expectancy = (winRate/100 × avgWin) - ((1 - winRate/100) × avgLoss)
```

**代码实现** (`tradeJournal.ts:124-126`):
```typescript
const expectancy = closed > 0
  ? (winRate / 100 * avgWin - (1 - winRate / 100) * avgLoss)
  : 0
```

### 5.5 月度趋势 (Monthly Trend)

**查询逻辑**:
```sql
SELECT DATE_TRUNC('month', entry_date) as month,
       COUNT(*) as count,
       COALESCE(SUM(pnl), 0) as pnl
FROM trade_journal
WHERE user_id = $1 AND exit_date IS NOT NULL
GROUP BY month ORDER BY month DESC LIMIT 12
```

**输出**: 最近 12 个月，每月交易次数和盈亏汇总

---

## 六、收益日历计算

### 6.1 日频模式 (daily)

**查询逻辑**:
```sql
SELECT exit_date as period,
       COUNT(*) as count,
       COALESCE(SUM(pnl), 0) as pnl,
       COALESCE(AVG(return_pct), 0) as avg_return
FROM trade_journal
WHERE user_id = $1 AND exit_date IS NOT NULL
  AND EXTRACT(YEAR FROM exit_date) = $year
GROUP BY period ORDER BY period
```

### 6.2 月频模式 (monthly)

**查询逻辑**:
```sql
SELECT DATE_TRUNC('month', exit_date)::date as period,
       COUNT(*) as count,
       COALESCE(SUM(pnl), 0) as pnl,
       COALESCE(AVG(return_pct), 0) as avg_return
FROM trade_journal
WHERE user_id = $1 AND exit_date IS NOT NULL
  AND EXTRACT(YEAR FROM exit_date) = $year
GROUP BY period ORDER BY period
```

### 6.3 输出字段

| 字段 | 类型 | 说明 |
|------|------|------|
| period | date | 日期或月份 |
| count | integer | 当日/当月交易次数 |
| pnl | number | 当日/当月累计盈亏 |
| avgReturn | number | 当日/当月平均收益率 |

---

## 七、历史交易查询

### 7.1 查询参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|-------|------|
| limit | number | 50 | 每页数量 |
| offset | number | 0 | 偏移量 |
| tag | string | - | 按标签筛选 |
| strategy | string | - | 按策略名筛选 |
| direction | string | - | 按方向筛选（long/short） |
| startDate | string | - | 入场日期起 |
| endDate | string | - | 入场日期止 |
| status | string | - | open/closed 按持仓状态 |

### 7.2 查询实现

**SQL 拼接逻辑** (`tradeJournal.ts:70-78`):
```typescript
let whereClause = `user_id = ${userId}`
if (tag) whereClause += ` AND $2 = ANY(tags)`
if (strategy) whereClause += ` AND strategy = '${strategy}'`
if (direction) whereClause += ` AND direction = '${direction}'`
if (startDate) whereClause += ` AND entry_date >= '${startDate}'`
if (endDate) whereClause += ` AND entry_date <= '${endDate}'`
if (status === 'open') whereClause += ` AND exit_date IS NULL`
if (status === 'closed') whereClause += ` AND exit_date IS NOT NULL`
```

**返回结构**:
```typescript
{
  rows: TradeJournalRecord[],  // 交易记录数组
  total: number                // 符合条件的总数
}
```

---

## 八、API 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/trade-journal` | 新建交易记录 |
| GET | `/api/trade-journal` | 查询交易列表（支持分页和筛选） |
| GET | `/api/trade-journal/stats` | 获取统计数据（胜率、盈亏比等） |
| GET | `/api/trade-journal/pnl-calendar` | 收益日历 |
| PUT | `/api/trade-journal/:id` | 更新交易记录（平仓、编辑） |
| DELETE | `/api/trade-journal/:id` | 删除交易记录 |

### 8.1 POST /api/trade-journal

**请求体**:
```json
{
  "code": "000001",
  "name": "平安银行",
  "direction": "long",
  "entryDate": "2024-01-15",
  "entryPrice": 10.50,
  "shares": 1000,
  "tags": ["银行", "低估"],
  "strategy": "价值投资",
  "rating": 4
}
```

**响应**: 201 Created，返回创建的记录

### 8.2 GET /api/trade-journal/stats

**响应**:
```json
{
  "totalClosed": 45,
  "totalOpen": 3,
  "wins": 28,
  "losses": 17,
  "winRate": 62.22,
  "totalPnl": 12500.00,
  "avgPnl": 277.78,
  "avgReturn": 3.45,
  "bestTrade": 2500.00,
  "worstTrade": -1800.00,
  "profitFactor": 1.85,
  "expectancy": 156.32,
  "monthlyTrend": [
    { "month": "2024-07", "count": 8, "pnl": 3200.00 },
    { "month": "2024-06", "count": 12, "pnl": -500.00 }
  ]
}
```

---

## 九、相关文件

| 文件路径 | 说明 |
|---------|------|
| `src/server/routes/tradeJournal.ts` | 交易日志 API 路由 |
| `src/server/db/schema.ts` | trade_journal 表定义 |
| `src/server/middleware/auth.ts` | 用户认证中间件 |
| `src/server/middleware/checkUsage.ts` | Pro 套餐校验中间件 |
