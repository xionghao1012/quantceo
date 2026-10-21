# 持仓管理功能说明

## 一、功能概述

持仓管理帮助 Pro 用户记录持仓、接收 AI 卖出建议、分析持仓风险。

**页面路径**: `/positions`
**访问权限**: Pro 用户
**预警推送时间**: 交易日 08:30

---

## 二、持仓数据模型

### 2.1 数据库表结构

**表名**: `positions`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | serial | 主键 |
| `userId` | integer | 用户 ID（外键） |
| `code` | varchar(10) | 股票代码 |
| `name` | varchar(100) | 股票名称 |
| `quantity` | integer | 持股数量 |
| `entryPrice` | numeric(12,4) | 买入价格 |
| `stopLoss` | numeric(12,4) | 止损价 |
| `takeProfit` | numeric(12,4) | 止盈价 |
| `status` | varchar(20) | 状态（open/closed） |
| `notes` | text | 备注 |
| `createdAt` | timestamp | 创建时间 |
| `updatedAt` | timestamp | 更新时间 |

---

## 三、持仓 CRUD 操作

### 3.1 API 端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/positions` | GET | 获取用户所有持仓 |
| `/api/positions/rebalance` | GET | 获取仓位调整建议 |
| `/api/positions/analysis` | GET | 获取详细分析（含现价、RSI、收益） |
| `/api/positions` | POST | 创建持仓（自动创建止损/止盈价格告警） |
| `/api/positions/:id` | PUT | 更新持仓（重建价格告警） |
| `/api/positions/:id` | DELETE | 删除持仓及关联告警 |

### 3.2 创建持仓

```
1. 验证用户权限
2. 创建持仓记录
3. 如设置了止损价/止盈价，自动创建价格告警
4. 返回持仓详情
```

### 3.3 更新持仓

```
1. 更新持仓字段
2. 删除旧的价格告警
3. 如设置了止损价/止盈价，重新创建告警
```

---

## 四、持仓预警分析（08:30）

### 4.1 触发机制

```
Scheduler（08:30）→ POST /api/internal/position-alerts
```

**调度时间**: `30 8 * * 1-5`（交易日 08:30 北京时间）

### 4.2 分析流程

```
1. 获取所有 Pro 用户
2. 遍历用户的每只持仓股：
   a. 获取当前价格和 K 线数据
   b. 计算 RSI（90 日）
   c. AI 分析持仓状态
3. 筛选推荐为"卖出"且置信度 >= 60 的预警
4. 推送通知
```

### 4.3 AI 分析维度

AI 角色设定为"15年A股交易员"，分析维度包括：

- **盈亏状态**: 绝对收益、相对收益（vs 大盘）
- **技术指标**: MA5/MA10/MA20、RSI、MACD
- **AI 预测参考**: 近 3 日预测方向
- **微博情绪**: 市场情绪指标
- **止损/止盈位**: 当前价格与设置的止损止盈比较

### 4.4 预警输出格式

```typescript
interface PositionAlert {
  code: string           // 股票代码
  name: string           // 股票名称
  entryPrice: number     // 买入价
  currentPrice: number   // 当前价
  pnl: number            // 盈亏金额
  pnlPercent: number     // 盈亏比例
  recommendation: 'hold' | 'sell' | 'add'  // 建议
  confidence: number     // 置信度（0-100）
  reasoning: string      // 理由（<= 100 字）
  targetExit?: number    // 建议卖出价
  quantity: number       // 持股数量
  daysHeld: number       // 持有天数
}
```

---

## 五、卖出信号判定

### 5.1 触发条件

```
recommendation === 'sell' AND confidence >= 60
```

### 5.2 AI 卖出判定逻辑

在 `analyzePosition` 函数中，LLM 根据以下条件判断卖出：

- **绝对收益 < -10%**: 建议止损离场
- **绝对收益 < -5% 且相对收益 < -8%**: 建议止损离场
- **RSI 超买**: 指标显示超买
- **趋势破位**: 技术面显示趋势向下

### 5.3 仓位再平衡卖出逻辑

```typescript
function decideAction(absReturn, relativeReturn, rsi) {
  // 止损卖出
  if (absReturn < -10 || (absReturn < -5 && relativeReturn < -8))
    return { action: 'sell', reason: '亏损较大，建议止损离场', priority: 1 }

  // 减仓
  if (absReturn < -3 && relativeReturn < -10)
    return { action: 'reduce', reason: '相对大盘明显跑输，建议减仓', priority: 2 }

  // 持有/加仓...
}
```

---

## 六、推送消息格式

```
🚨 AI持仓预警 {date}

🚩 {code} {name}: 建议卖出 置信{confidence}%
   现价{currentPrice} 盈亏{pnlPercent}% 理由: {reasoning}

⚠️ 不构成投资建议
```

---

## 七、相关代码文件

| 文件路径 | 说明 |
|---------|------|
| `quant-trading/src/server/db/schema.ts` | 持仓数据模型 |
| `quant-trading/src/server/routes/positions.ts` | 持仓 CRUD API |
| `quant-trading/src/server/ai/positionAlert.ts` | AI 持仓分析核心逻辑 |
| `quant-trading/src/server/ai/rebalancer.ts` | 仓位再平衡算法 |
| `quant-trading/src/server/services/scheduler.ts` | 08:30 预警调度 |
| `quant-trading/src/server/routes/internal.ts` | 内部预警 API |
| `quant-trading/src/client/views/PositionAnalysisView.vue` | 持仓分析前端页面 |
