# AI 预测机制说明

> 文档编号：XIO-72
> 版本：v1.0
> 更新日期：2026-07-23

---

## 1. 预测输出格式

每条 AI 预测记录包含以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `direction` | `up \| down \| sideways` | 价格方向预测 |
| `confidence` | `integer (0-100)` | 置信度评分 |
| `targetPrice` | `number` | 目标价（元） |
| `stopLoss` | `number` | 止损价（元） |
| `reasoning` | `string` | 分析依据（中文，30-80 字） |

### 示例

```json
{
  "direction": "up",
  "confidence": 78,
  "targetPrice": 152.30,
  "stopLoss": 141.50,
  "reasoning": "MA5 上穿 MA10 金叉，RSI 从 38 回升，成交量放大至 5 日均量 1.5 倍，短期多头趋势形成"
}
```

---

## 2. 置信度计算方式

AI 模型（MiniMax-M3）根据以下因素综合给出置信度评分：

### 2.1 评分依据

- **数据完整性**：K 线数据越多（≥60 日最佳），置信度越高
- **信号一致性**：多个技术指标同向（如 MA 金叉 + RSI 上升 + MACD 柱扩大），置信度更高
- **波动率**：价格位于布林带不同位置提示不同信号强度
- **趋势强度**：均线多头排列（MA5 > MA10 > MA20 > MA60）比空头排列置信度更高

### 2.2 置信度 Clamp 规则

```typescript
function clampConfidence(c: any): number {
  const n = Number(c)
  if (Number.isNaN(n)) return 50  // LLM 返回无效值时默认 50
  return Math.max(0, Math.min(100, Math.round(n)))  // 裁剪到 [0, 100]
}
```

### 2.3 每日精选（Daily Picks）评分标准

| 评分区间 | 含义 | 信号强度 |
|----------|------|----------|
| 80-100 | 强烈买入 | 多重技术信号共振 |
| 60-79 | 值得关注 | 有积极信号 |
| 40-59 | 中性 | 等待更好时机 |
| 0-39 | 回避 | 风险大于机会 |

---

## 3. 历史准确率评估指标

### 3.1 核心指标

| 指标 | 说明 | 计算方式 |
|------|------|----------|
| `directionRate` | 方向准确率 | 方向正确次数 / 已评估预测数 |
| `targetRate` | 目标价达成率 | 达到目标价次数 / 已评估预测数 |
| `highConfidenceRate` | 高置信度准确率（≥70 分） | 高置信度预测中方向正确比例 |

### 3.2 评估逻辑

```typescript
// 方向判断
if (predictedDirection === 'up')
  isDirectionCorrect = actualClose > currentPrice
else if (predictedDirection === 'down')
  isDirectionCorrect = actualClose < currentPrice
else // sideways
  isDirectionCorrect = Math.abs(actualClose - currentPrice) / currentPrice < 0.01

// 目标达成判断
isTargetReached = actualHigh >= targetPrice
```

### 3.3 统计接口

```
GET /api/ai/predict/stats?days=30
```

返回：

```json
{
  "total": 150,
  "evaluated": 142,
  "directionCorrect": 98,
  "directionRate": 0.690,
  "targetReached": 67,
  "targetRate": 0.472,
  "highConfidenceRate": 0.780
}
```

---

## 4. 预测触发条件

### 4.1 自动触发（Scheduler）

| 时间 | 任务 | 说明 |
|------|------|------|
| **08:00** | AI 每日精选生成 | 从 RSI < 45 的股票中选 10 只跑 AI 分析 |
| **09:25** | 推送 AI 预测摘要 | 对全市场 Top 20 股票生成预测并推送高置信度结果 |
| **15:30** | 计算每日技术指标 | RSI / MACD / MA / 布林带 / 波动率 |
| **15:32** | 评估昨日预测 | 对目标日期为当日的预测进行准确率评估 |
| **15:35** | AI 预测生成（收盘版） | 对持仓股 + Top 50 股票跑 LLM 预测（daysAhead=1） |

### 4.2 手动触发

| 接口 | 权限 | 说明 |
|------|------|------|
| `POST /api/ai/predict/run` | Pro 计划 | 单只股票预测 |
| `POST /api/ai/predict/run-batch` | Premium 计划 | 批量预测（最多 300 只） |
| `POST /api/ai/predict/run-market` | 系统 | 全市场批量预测 |

---

## 5. AI 模型输入特征说明

### 5.1 数据基础

- **K 线数据**：最近 90 日日线（至少需要 30 日，否则无法预测）
- **时间窗口**：预测周期为未来 1-7 个交易日（默认 1）

### 5.2 技术指标特征

预测模型输入以下技术指标：

| 指标类别 | 具体指标 | 说明 |
|----------|----------|------|
| 均线 | MA5, MA10, MA20, MA60 | 短期/中期/长期趋势 |
| MACD | DIF, DEA, Histogram | 趋势动量 |
| RSI | RSI(14) | 超买超卖 |
| 布林带 | 上轨/中轨/下轨 | 波动率通道 |
| 成交量 | 近 5 日/20 日均量比 | 资金活跃度 |
| 板块 | 板块名称 + 近 5 日涨跌 | 行业联动 |

### 5.3 辅助特征

| 特征 | 来源 | 说明 |
|------|------|------|
| 主力净流入 | 资金流数据 | 近 5 日主力净流入（万元） |
| 用户持仓 | positions 表 | 用户是否持有该股票 |
| 板块信息 | stocks 表 | 股票所属板块及涨跌 |

### 5.4 Prompt 构建示例

```
股票：贵州茅台（600519）
当前价：1680.50（+2.35%）
近 60 日：最高 1850.00 / 最低 1520.00 / 涨跌 +10.53%
均线：MA5=1650.30, MA10=1620.45, MA20=1580.20, MA60=1550.80
MACD：DIF=12.350, DEA=10.230, 柱=2.120
RSI(14)：58.3
布林：上轨=1750.00, 中轨=1680.00, 下轨=1610.00
资金：近 5 日主力净流入 12500 万
板块：白酒，近 5 日涨跌 +3.25%
预测周期：未来 1 个交易日

输出 JSON：
{"direction":"up|down|sideways","confidence":0-100整数,"target_price":数字,"stop_loss":数字,"reasoning":"一句话"}
```

---

## 6. 预测降级路径

当 LLM 调用失败时，系统按以下顺序降级：

### 6.1 单只股票预测降级（predictOne）

```
llmCompleteJSON 失败
  → 返回默认值 { direction: 'sideways', confidence: 50,
      targetPrice: lastPrice * 1.05, stopLoss: lastPrice * 0.95,
      reasoning: '模型调用失败，使用默认值' }
```

### 6.2 每日精选降级（analyzeCandidate）

```typescript
// LLM 调用失败时，基于 RSI 的简单规则引擎
const fallback: AIAnalysisResult = {
  score: Math.round(Math.max(0, 60 - ((rsiVal ?? 50) - 30) * 2)),
  direction: 'hold',
  risk: 'medium',
  reasoning: `RSI ${rsiVal?.toFixed(1) ?? '--'}，${ma5Val ? 'MA5 ' + ma5Val.toFixed(2) : ''}`,
}
```

规则：
- RSI 越高（>50），分数越低（模型认为上涨空间有限）
- RSI 越低（<30），分数越高（超卖反弹概率大）
- 默认方向为 `hold`，风险为 `medium`

### 6.3 批量任务容错

```typescript
async function processOne(code, name) {
  try {
    const klines = await loadKlines(code, 60)
    if (klines.length < 30) { job.fail++; return }
    const result = await predictOne({ code, name, klines, daysAhead })
    await savePrediction(...)
    job.ok++
  } catch {
    job.fail++  // 单只失败不影响其他股票
  } finally {
    job.processed++
  }
}
```

单只股票失败不影响整体批处理，失败计数单独记录。

### 6.4 LLM 调用超时

- 单次调用超时：60 秒（predictOne）/ 15 秒（analyzeCandidate）
- 超时后视为失败，触发降级逻辑

---

## 7. 推送时机（09:25）触发机制

### 7.2 触发流程

```
09:25 Scheduler 触发
  → POST /api/ai/predictions/run-market { count: 20 }
  → quant-ai 服务
      1. 选取全市场当日成交额 Top 20 股票
      2. 并发加载每只股票的 K 线数据（90 日）
      3. 对每只股票调用 predictOne()
      4. 筛选置信度 >= 70 的预测
      5. 生成推送内容，发送到用户
```

### 7.3 推送内容

- 只推送置信度 ≥ 70 的预测
- 每条推送包含：股票名称、方向、目标价、止损价、置信度、分析依据
- 推送渠道：App 内推送、微信（需配置 ServerChan）

---

## 8. 置信度分级标准

### 8.1 AI 预测置信度分级

| 等级 | 分数区间 | 含义 | 操作建议 |
|------|----------|------|----------|
| A | 80-100 | 信号极强 | 重点关注，积极操作 |
| B | 60-79 | 信号较强 | 可考虑建仓，谨慎乐观 |
| C | 40-59 | 信号中性 | 观望为主 |
| D | 20-39 | 信号偏弱 | 谨慎，减少操作 |
| E | 0-19 | 信号极弱 | 回避，不建议操作 |

### 8.2 推送过滤阈值

| 用户计划 | 推送阈值 | 说明 |
|----------|----------|------|
| Free | 不推送 | 免费用户不推送 AI 预测 |
| Pro | confidence >= 70 | 仅推送高置信度预测 |
| Premium | 无限制 | 推送所有预测 |

### 8.3 高置信度预测标识

数据库中 `confidence >= 70` 的预测被视为高置信度预测，参与 `highConfidenceRate` 统计。

---

## 附录：数据库字段

### ai_predictions 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `stock_code` | varchar | 股票代码 |
| `stock_name` | varchar | 股票名称 |
| `predict_date` | date | 预测日期 |
| `target_date` | date | 目标日期 |
| `direction` | varchar | 方向（up/down/sideways） |
| `confidence` | real | 置信度（0-100） |
| `current_price` | numeric | 预测时价格 |
| `target_price` | numeric | 目标价 |
| `stop_loss` | numeric | 止损价 |
| `reasoning` | text | 分析依据 |
| `model_used` | varchar | 使用的模型 |
| `tokens_input` | integer | 输入 token 数 |
| `tokens_output` | integer | 输出 token 数 |
| `latency_ms` | integer | 推理延迟（毫秒） |
| `actual_close` | numeric | 实际收盘价 |
| `actual_high` | numeric | 实际最高价 |
| `actual_low` | numeric | 实际最低价 |
| `is_direction_correct` | boolean | 方向是否正确 |
| `is_target_reached` | boolean | 目标价是否达成 |
| `evaluated_at` | timestamp | 评估时间 |

### daily_picks 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | varchar | 股票代码 |
| `name` | varchar | 股票名称 |
| `pick_date` | date | 精选日期 |
| `price` | numeric | 入选价格 |
| `change_pct` | numeric | 涨跌百分比 |
| `rsi` | numeric | RSI 值 |
| `ai_score` | numeric | AI 评分（0-100） |
| `ai_direction` | varchar | AI 方向（buy/hold/avoid） |
| `ai_risk` | varchar | 风险等级（low/medium/high） |
| `return_1d/3d/5d/10d/20d` | numeric | 各周期收益率 |
| `max_return` | numeric | 最大收益 |
| `max_drawdown` | numeric | 最大回撤 |

---

*本文档基于 XIO-72 issue 生成，自动同步代码变更*
