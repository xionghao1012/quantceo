# 盘中异动功能说明

## 一、功能概述

盘中异动监控全市场持仓股票的实时价格异动，检测急涨（>2.5%）、急跌（<-2.5%）、放量（>3倍均量）等异常信号，并在检测到异动时推送告警。

**页面路径**: `/intraday-alerts`
**访问权限**: 登录用户
**检测频率**: 每 5 分钟（工作日 9:00-11:30、13:00-14:59）

---

## 二、功能范围

| 功能 | 说明 |
|------|------|
| 急涨告警 | 日内涨幅超过 2.5% 时触发 |
| 急跌告警 | 日内跌幅超过 2.5% 时触发 |
| 放量告警 | 量比达到 3 倍且涨跌幅小于 2.5% 时触发 |
| 实时推送 | 检测到异动时通过推送服务发送告警通知 |
| 异动历史 | 查看近期所有异动记录 |
| 市场状态 | 显示当前是否处于交易时段 |

---

## 三、异动检测逻辑

### 3.1 检测时机

系统通过 Scheduler 每 5 分钟自动执行检测（`scheduler.ts:446-458`）：

```typescript
cron.schedule('*/5 9,10,11,13,14 * * 1-5', async () => {
  const proUsers = await db.select().from(users).where(eq(users.role, 'premium'))
  for (const user of proUsers) {
    await checkIntradayAnomalies(user.id)
  }
})
```

**触发条件**：
- 周一至周五（工作日）
- 9:00-11:30（第一个交易时段）
- 13:00-14:59（第二个交易时段）
- 非周末

### 3.2 异动类型判定

检测逻辑位于 `intradayAlert.ts:138-155`：

```typescript
// 急涨/急跌：日内涨跌幅绝对值 >= 2.5%
const absChange = Math.abs(q.day_change_pct)
if (absChange >= 2.5) {
  const alertType = q.day_change_pct > 0 ? 'price_surge' : 'price_plunge'
  alerts.push({ code, name, alertType, price, changePct, volumeRatio, dayChangePct, detail })
}

// 放量：量比 >= 3 且涨跌幅 < 2.5%
if (volumeRatio >= 3 && absChange < 2.5) {
  const alertType = 'volume_surge'
  alerts.push({ code, name, alertType, price, changePct, volumeRatio, dayChangePct, detail })
}
```

### 3.3 异动阈值说明

| 异动类型 | 阈值条件 | 说明 |
|---------|---------|------|
| 急涨 (price_surge) | 日涨幅 ≥ 2.5% | 价格快速上涨信号 |
| 急跌 (price_plunge) | 日跌幅 ≥ -2.5% | 价格快速下跌信号 |
| 放量 (volume_surge) | 量比 ≥ 3 且涨跌 < 2.5% | 成交量异常放大 |

### 3.4 量比计算

量比 = 当前成交量 / 5 日平均成交量

```typescript
async function getVolumeBaseline(code: string): Promise<number> {
  const rows = await db.execute(sql`
    SELECT volume FROM klines
    WHERE code = ${code}
    ORDER BY date DESC LIMIT 5
  `)
  const avg = rows.rows.reduce((s, r) => s + r.volume, 0) / rows.rows.length
  return avg
}
```

### 3.5 去重机制

同一股票 10 分钟内只告警一次，避免重复推送：

```typescript
const recentCount = await getRecentAlerts(q.code, 10)
if (recentCount > 0) continue
```

---

## 四、告警推送

### 4.1 推送内容格式

检测到异动后，通过 `dispatchPush` 发送推送（`intradayAlert.ts:170-176`）：

```
🚨 盘中异动 14:30

📈急涨 000001 平安银行: 12.50 (+2.85%)
📉急跌 600519 贵州茅台: 1650.00 (-3.12%) 量比3.5x
📊放量 000002 万科A: 8.20 (+0.85%) 量比4.2x
```

### 4.2 推送信号结构

```typescript
const signals = alerts.slice(0, 10).map(a => ({
  code: a.code,
  name: a.name,
  direction: a.alertType === 'price_surge' ? '📈暴涨' :
             a.alertType === 'price_plunge' ? '📉急跌' : '📊放量',
  strength: a.alertType === 'price_surge' ? 4 :
            a.alertType === 'price_plunge' ? 5 : 3,
  strategyName: `盘中${a.alertType === 'price_surge' ? '拉升' :
                 a.alertType === 'price_plunge' ? '急跌' : '放量'}`,
  price: String(a.price),
}))
```

---

## 五、数据模型

### 5.1 intraday_alerts 表结构

| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial | 主键 |
| code | varchar(10) | 股票代码 |
| name | varchar(100) | 股票名称 |
| alertType | varchar(30) | 异动类型 (price_surge/price_plunge/volume_surge) |
| price | numeric(12,2) | 异动时价格 |
| changePct | numeric(6,2) | 异动时涨跌幅 |
| volumeRatio | numeric(6,2) | 异动时量比 |
| dayChangePct | numeric(6,2) | 当日涨跌幅 |
| detail | jsonb | 详细信息（昨收、最高、最低、成交量等） |
| notified | boolean | 是否已推送 |
| createdAt | timestamp | 异动发生时间 |

### 5.2 detail 字段结构

```typescript
// 急涨/急跌时
{
  prev_close: number  // 昨收价
  high: number       // 最高价
  low: number        // 最低价
  volume: number     // 当前成交量
  time: string       // 时间
}

// 放量时
{
  prev_close: number  // 昨收价
  volume: number      // 当前成交量
  avg_volume: number  // 5日平均成交量
  time: string         // 时间
}
```

---

## 六、API 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/intraday/alerts` | 获取异动历史记录 |
| POST | `/api/intraday/check` | 手动触发异动检测 |

### 6.1 GET /api/intraday/alerts

**响应**:
```json
[
  {
    "id": 123,
    "code": "000001",
    "name": "平安银行",
    "alertType": "price_surge",
    "price": "12.50",
    "changePct": "2.85",
    "volumeRatio": "1.2",
    "dayChangePct": "2.85",
    "detail": {
      "prev_close": 12.16,
      "high": 12.55,
      "low": 12.10,
      "volume": 1250000,
      "time": "14:30:00"
    },
    "notified": true,
    "createdAt": "2024-07-22T14:30:00+08:00"
  }
]
```

### 6.2 POST /api/intraday/check

手动触发异动检测，返回检测结果。

**响应**:
```json
{
  "count": 3,
  "alerts": [
    {
      "code": "000001",
      "name": "平安银行",
      "alertType": "price_surge",
      "price": 12.50,
      "changePct": 2.85,
      "volumeRatio": 1.2,
      "dayChangePct": 2.85,
      "detail": { ... }
    }
  ]
}
```

---

## 七、前端页面

### 7.1 页面布局

页面路径：`/intraday-alerts`

**顶部区域**：
- 标题：盘中异动
- 市场状态指示器（交易中/已收盘）
- 刷新按钮

**描述信息**：
> 监控全市场股票盘中异动，检测急涨(>2.5%)、急跌(<-2.5%)、放量(>3x均量)等异常信号

### 7.2 异动卡片展示

每条异动记录以卡片形式展示，包含：

| 区域 | 内容 |
|------|------|
| 头部 | 异动类型标签（急涨/急跌/放量）、股票代码、名称、时间 |
| 主体 | 价格、涨跌幅、量比 |
| 详情 | 昨收、最高价、最低价 |

### 7.3 卡片样式区分

| 异动类型 | 左边框颜色 |
|---------|-----------|
| 急涨 (price_surge) | 红色（上） |
| 急跌 (price_plunge) | 绿色（下） |
| 放量 (volume_surge) | 品牌色 |

---

## 八、相关文件

| 文件路径 | 说明 |
|---------|------|
| `quant-trading/src/server/ai/intradayAlert.ts` | 异动检测核心逻辑 |
| `quant-trading/src/server/routes/intradayAlerts.ts` | API 路由 |
| `quant-trading/src/server/services/scheduler.ts` | 定时任务调度 |
| `quant-trading/src/client/views/IntradayAlertsView.vue` | 前端页面组件 |
| `quant-trading/src/server/db/schema.ts` | 数据库表定义 |
| `quant-trading/src/server/data/intraday_quote.py` | 实时行情获取脚本 |
