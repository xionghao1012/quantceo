# 每日精选功能说明

## 一、功能概述

每日精选为 Pro 用户提供 AI 驱动的股票推荐服务。每个交易日 08:00 自动从全市场筛选 10 只具备短线买入价值的股票，并生成推荐理由。

**页面路径**: `/picks-history`
**访问权限**: Pro 用户专用

---

## 二、功能范围

| 功能 | 说明 |
|------|------|
| AI 每日推荐 | 每个交易日 08:00 自动生成 Top 10 推荐股票 |
| AI 评分 | 每只股票给出 0-100 的综合评分和方向判断 |
| 推荐理由 | AI 基于技术指标生成一句话中文推荐理由 |
| 历史回顾 | 查看历史每日精选及后续表现 |
| 效果评估 | 15:33 自动计算持仓期收益和最大回撤 |

---

## 三、数据模型

### 3.1 daily_picks 表结构

| 字段 | 类型 | 说明 |
|------|------|------|
| id | serial | 主键 |
| pickDate | date | 推荐日期 |
| code | varchar(10) | 股票代码 |
| name | varchar(50) | 股票名称 |
| price | numeric(10,4) | 推荐时价格 |
| changePct | numeric(8,4) | 推荐时涨跌幅 |
| rsi | numeric(6,2) | 推荐时 RSI(14) 值 |
| reason | text | AI 推荐理由 |
| aiScore | numeric(6,2) | AI 综合评分 (0-100) |
| aiDirection | varchar(20) | 方向 (buy/hold/avoid) |
| aiRisk | varchar(20) | 风险等级 (low/medium/high) |
| return1d | numeric(8,4) | 1 日收益率 |
| return3d | numeric(8,4) | 3 日收益率 |
| return5d | numeric(8,4) | 5 日收益率 |
| return10d | numeric(8,4) | 10 日收益率 |
| return20d | numeric(8,4) | 20 日收益率 |
| maxReturn | numeric(8,4) | 持仓期最大收益率 |
| maxDrawdown | numeric(8,4) | 持仓期最大回撤 |
| evaluated | boolean | 是否已评估 |
| createdAt | timestamp | 创建时间 |

---

## 四、精选生成逻辑

### 4.1 生成时间

每个交易日 08:00，Scheduler 触发 `/api/ai/predictions/trigger-daily-picks`，调用 `generateDailyPicks()`。

### 4.2 候选股票池筛选

候选股票池通过 SQL 聚合从 `stocks` + `klines` 表筛选 (`dailyPicksAI.ts:161-212`)：

```sql
WITH price_data AS (
  -- 取最新价和涨跌幅
  SELECT DISTINCT ON (s.code)
    s.code, s.name,
    l0.close AS price,
    CASE WHEN l1.close > 0
      THEN (l0.close - l1.close) / l1.close * 100
      ELSE 0
    END AS change_pct
  FROM stocks s
  JOIN LATERAL (SELECT close FROM klines WHERE code = s.code ORDER BY date DESC LIMIT 1) l0 ON true
  LEFT JOIN LATERAL (SELECT close FROM klines WHERE code = s.code ORDER BY date DESC LIMIT 1 OFFSET 1) l1 ON true
  WHERE s.status = 'active' AND l0.close IS NOT NULL
),
rsi_data AS (...),
rsi_agg AS (...)
SELECT code, name, price, change_pct, rsi
FROM rsi_agg
WHERE rsi < 45          -- RSI 处于低位
  AND change_pct > -7   -- 跌幅不超过 7%
  AND change_pct < 7    -- 涨幅不超过 7%
ORDER BY rsi ASC
LIMIT 60
```

**筛选条件**:
- `status = 'active'`：股票状态正常
- `rsi < 45`：RSI 处于偏低区域（超卖区域），预留上涨空间
- `change_pct > -7%` 且 `< 7%`：排除极端涨跌，排除一字板
- 取 RSI 最低的 60 只进入 AI 分析阶段

### 4.3 AI 精选评估

对 60 只候选股，每只调用 `analyzeCandidate()` 并行分析（5 并发），综合评分排序取 Top 10。

**AI 评分标准** (`dailyPicksAI.ts:17-27`):

| 评分区间 | 含义 |
|---------|------|
| 80-100 | 强烈买入，多重技术信号共振 |
| 60-79 | 值得关注，有积极信号 |
| 40-59 | 中性，等待更好时机 |
| 0-39 | 回避，风险大于机会 |

**AI 输入指标** (`dailyPicksAI.ts:29-69`):

| 指标 | 说明 |
|------|------|
| MA5/10/20/60 | 均线及多头/空头排列判断 |
| MACD | DIF/DEA/柱状图及趋势判断 |
| RSI(14) | 相对强弱指标 |
| Bollinger %B | 布林带位置 |
| 成交量比 | 5 日均量 / 20 日均量 |

**输出** (`AIAnalysisResult`):
```typescript
{
  score: number      // 0-100 评分
  direction: 'buy' | 'hold' | 'avoid'
  risk: 'low' | 'medium' | 'high'
  reasoning: string  // 中文推荐理由，15-40 字
}
```

### 4.4 精选结果写入

生成完成后，删除当天旧记录，插入新 Top 10：
```typescript
await db.delete(dailyPicks).where(eq(dailyPicks.pickDate, today))
for (const p of top10) {
  await db.insert(dailyPicks).values({ pickDate: today, code, name, price, changePct, rsi, reason, aiScore, aiDirection, aiRisk })
}
```

---

## 五、效果评估（15:33）

### 5.1 评估触发

每个交易日 15:33，Scheduler 触发 `/api/ai/predictions/evaluate-picks`，调用 `evaluateAllUnrated()`，评估所有 5 天前未评估的精选。

### 5.2 评估逻辑

**时间窗口**：从推荐日起，分别计算 1/3/5/10/20 日收益率 (`pickEvaluator.ts:25-36`)：

```typescript
function findForwardCloses(klData, pickDate, horizons) {
  // 从推荐日后第 h 天的收盘价
  const pickIdx = klData.findIndex(k => k.date >= pickDate)
  // horizons = [1, 3, 5, 10, 20]
}
```

**收益率计算** (`pickEvaluator.ts:59-62`):
```typescript
returnXd = (第Xd天收盘价 - 推荐价格) / 推荐价格 × 100%
```

**最大回撤计算** (`pickEvaluator.ts:66-76`):
```typescript
// 从持仓期内最高点最大跌幅
for (i = pickIdx + 1; i < min(pickIdx + 21, klData.length); i++) {
  peakEntry = max(peakEntry, klData[i].high)
  dd = (peakEntry - klData[i].low) / peakEntry × 100%
  maxDrawdown = max(maxDrawdown, dd)
}
```

### 5.3 评估字段更新

```typescript
await db.update(dailyPicks).set({
  return1d, return3d, return5d, return10d, return20d,
  maxReturn, maxDrawdown, evaluated: true,
}).where(eq(dailyPicks.id, pickId))
```

---

## 六、API 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ai/predictions/trigger-daily-picks` | 触发每日精选生成 |
| POST | `/api/ai/predictions/evaluate-picks` | 评估精选表现 |
| GET | `/api/ai/predictions/pick-accuracy` | 获取精选准确率统计 |
| GET | `/api/ai/predictions/pick/:id/backtest` | 获取单条精选详情及回测 |

### 6.1 POST /api/ai/predictions/trigger-daily-picks

**触发时机**: Scheduler 08:00 调用

**响应**:
```json
{
  "success": true,
  "count": 10,
  "stocks": [
    {
      "code": "000001",
      "name": "平安银行",
      "price": 10.50,
      "changePct": 1.23,
      "rsi": 32.5,
      "analysis": {
        "score": 78,
        "direction": "buy",
        "risk": "low",
        "reasoning": "RSI 32.5 超卖区域，MA5 上穿 MA10 金叉，均线多头排列"
      }
    }
  ]
}
```

### 6.2 POST /api/ai/predictions/evaluate-picks

**触发时机**: Scheduler 15:33 调用

**请求体**:
```json
{ "pickId": 123 }  // 可选，指定评估某一条；不传则评估所有未评估的
```

**响应**:
```json
{ "success": true, "count": 10 }
```

### 6.3 GET /api/ai/predictions/pick-accuracy

**查询参数**: `?days=90`

**响应**:
```json
{
  "total": 200,
  "evaluated": 200,
  "positiveReturn1d": 112,
  "positiveReturn3d": 128,
  "positiveReturn5d": 135,
  "avgReturn1d": 0.85,
  "avgReturn3d": 2.31,
  "avgReturn5d": 3.72,
  "avgReturn10d": 5.14,
  "bestPick": { "id": 45, "code": "600519", "name": "贵州茅台", "return5d": 12.3 },
  "worstPick": { "id": 89, "code": "000002", "name": "万科A", "return5d": -8.5 }
}
```

### 6.4 GET /api/ai/predictions/pick/:id/backtest

**响应**:
```json
{
  "id": 45,
  "code": "600519",
  "name": "贵州茅台",
  "pickDate": "2024-07-15",
  "entryPrice": 1680.00,
  "return1d": 1.2,
  "return3d": 3.5,
  "return5d": 12.3,
  "return10d": 8.7,
  "return20d": 15.2,
  "maxReturn": 18.5,
  "maxDrawdown": 2.1,
  "equity": [
    { "date": "2024-07-16", "close": 1700.16, "return": 1.2 },
    { "date": "2024-07-17", "close": 1738.88, "return": 3.5 }
  ]
}
```

---

## 七、相关文件

| 文件路径 | 说明 |
|---------|------|
| `quant-ai/src/dailyPicksAI.ts` | 每日精选生成逻辑 |
| `quant-ai/src/pickEvaluator.ts` | 精选效果评估逻辑 |
| `quant-ai/src/routes/predictions.ts` | API 路由定义 |
| `quant-ai/src/db/schema.ts` | daily_picks 表定义 |
| `scheduler/src/index.ts` | 定时任务调度 |
