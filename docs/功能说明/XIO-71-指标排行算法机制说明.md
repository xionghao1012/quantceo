# XIO-71 指标排行算法机制说明

## 一、功能概述

指标排行模块展示全市场股票在 8 大技术指标维度下的排名，支持按单一指标排序或使用策略评分模式。

**页面路径**: `/rankings`
**访问权限**: OSS 用户可直接访问

---

## 二、8 大指标计算公式

### 2.1 RSI（相对强弱指数）

- **字段**: `rsi`
- **公式**: `RSI = 100 - 100 / (1 + AVG_Gain / AVG_Loss)`
- **周期**: 14 日
- **EMA/SMA 选择**: 采用 RMA（Wilder's EMA），等效于 `alpha = 1/period` 的 EMA
- **平均计算**: 使用 RMA 递归计算平均涨跌，初始值取前 14 期简单平均
- **RSI 范围**: 0-100，<30 为超卖，>70 为超买

**代码实现** (`indicators/index.ts`):
```typescript
export function calcRSI(klines: KLine[], period = 14): number[] {
  const closes = klines.map(k => k.close)
  const changes: number[] = [0]
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1])
  }
  const gains = changes.map(c => c > 0 ? c : 0)
  const losses = changes.map(c => c < 0 ? -c : 0)
  const avgGain = rma(gains, period)  // RMA = Wilder's EMA
  const avgLoss = rma(losses, period)
  return avgGain.map((g, i) => {
    if (avgLoss[i] === 0) return 100
    return 100 - (100 / (1 + g / avgLoss[i]))
  })
}
```

### 2.2 MACD（移动平均收敛发散）

- **字段**: `macd_signal`（存储 DIF - DEA 差值）
- **快速 EMA 周期**: 12 日
- **慢速 EMA 周期**: 26 日
- **信号线周期**: 9 日
- **DIF（差值线）**: `EMA(close, 12) - EMA(close, 26)`
- **DEA（信号线）**: `EMA(DIF, 9)`
- **柱状图（MACD Histogram）**: `DIF - DEA`

**代码实现** (`indicators/index.ts`):
```typescript
export function calcMACD(klines: KLine[], fast = 12, slow = 26, signalPeriod = 9): MACDResult {
  const closes = klines.map(k => k.close)
  const fastEma = ema(closes, fast)
  const slowEma = ema(closes, slow)
  const macdLine = fastEma.map((v, i) => v - slowEma[i])
  const signalLine = ema(macdLine, signalPeriod)
  const histogram = macdLine.map((v, i) => v - signalLine[i])
  return { macd: macdLine, signal: signalLine, histogram }
}
```

### 2.3 涨跌幅（change_pct）

- **字段**: `change_pct`
- **公式**: `(当日收盘价 - 前一日收盘价) / 前一日收盘价 × 100%`
- **存储**: 百分比数值，保留 2 位小数
- **排序方向**: 降序（高优先）

### 2.4 成交量比（vol_ratio）

- **字段**: `vol_ratio`
- **公式**: `当日成交量 / 20 日均量`
- **20 日均量**: 前 20 个交易日的成交量简单移动平均（不含当日）
- **排序方向**: 降序（高优先）

### 2.5 布林带位置（bb_position）

- **字段**: `bb_position`
- **周期**: 20 日
- **标准差倍数**: 2
- **上轨**: `MA(close, 20) + 2 × STD(close, 20)`
- **下轨**: `MA(close, 20) - 2 × STD(close, 20)`
- **布林位置**: `(现价 - 下轨) / (上轨 - 下轨) × 100`
- **范围**: 0（下轨）到 100（上轨），50 为中轨
- **排序方向**: 降序（高优先）

**代码实现** (`indicators/index.ts`):
```typescript
export function calcBollinger(klines: KLine[], period = 20, multiplier = 2) {
  const closes = klines.map(k => k.close)
  const ma = sma(closes, period)
  const upper: number[] = []
  const lower: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { upper.push(NaN); lower.push(NaN); continue }
    let sumSq = 0
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += (closes[j] - ma[i]) ** 2
    }
    const std = Math.sqrt(sumSq / period)
    upper.push(ma[i] + multiplier * std)
    lower.push(ma[i] - multiplier * std)
  }
  return { upper, middle: ma, lower }
}
```

### 2.6 均线多头（ma_alignment）

- **字段**: `ma_alignment`
- **定义**: MA5 > MA20 AND MA20 > MA60
- **计算**: 多头排列满足时为 1，否则为 0
- **周期**: MA5、MA20、MA60 均为简单移动平均（SMA）
- **排序方向**: 降序（高优先）

### 2.7 波动率（volatility）

- **字段**: `volatility`
- **公式**: `日收益率标准差 × √252 × 100%`
- **日收益率**: `(当日收盘价 - 前日收盘价) / 前日收盘价`
- **标准差周期**: 20 日
- **年化系数**: √252（一年交易日约 252 天）
- **排序方向**: 降序（高优先）

### 2.8 动量（momentum）

- **字段**: `momentum`
- **公式**: `(当前收盘价 - 10 日前收盘价) / 10 日前收盘价 × 100%`
- **排序方向**: 降序（高优先）

---

## 三、6 种策略评分模型

### 3.1 超卖反转（oversold_reversal）

- **语义**: 捕捉 RSI<30 的超跌股票，MACD 黄金交叉且动量为负
- **评分公式**:
```
评分 = (30 - RSI) / 30 × 40       -- RSI 越低得分越高，上限 40
     + min(MACD信号 / 2, 1) × 30   -- MACD 信号强度，上限 30
     + min(-动量 / 10, 1) × 30     -- 跌幅越大得分越高，上限 30
```
- **评分 SQL**:
```sql
GREATEST(0, (30 - COALESCE(rsi, 30)) / 30.0 * 40)
+ GREATEST(0, LEAST(COALESCE(macd_signal, 0) / 2, 1) * 30)
+ GREATEST(0, LEAST(-COALESCE(momentum, 0) / 10, 1) * 30)
```
- **触发条件**: RSI < 30, MACD信号 > 0, 动量 < -3

### 3.2 放量突破（volume_breakout）

- **语义**: 捕捉放量且涨幅较大的突破股票
- **评分公式**:
```
评分 = min((量比 - 1) / 3, 1) × 35       -- 量比越高得分越高，上限 35
     + min((涨幅 - 3) / 7, 1) × 35       -- 涨幅越大得分越高，上限 35
     + 布林位置 / 100 × 30               -- 布林上轨附近得分越高，上限 30
```
- **评分 SQL**:
```sql
GREATEST(0, LEAST((COALESCE(vol_ratio, 1) - 1) / 3, 1) * 35)
+ GREATEST(0, LEAST((COALESCE(change_pct, 0) - 3) / 7, 1) * 35)
+ GREATEST(0, COALESCE(bb_position, 0) / 100 * 30)
```
- **触发条件**: 量比 > 1.5, 涨幅 > 3%, 布林位置 > 60

### 3.3 底部启动（bottom_start）

- **语义**: 抄底布局，低 RSI + 温和放量 + 小幅上涨
- **评分公式**:
```
评分 = (35 - RSI) / 35 × 40         -- RSI 越低得分越高，上限 40
     + min((量比 - 1) / 4, 1) × 30   -- 温和放量得分越高，上限 30
     + min(涨幅 / 5, 1) × 30         -- 底部启动迹象，上限 30
```
- **评分 SQL**:
```sql
GREATEST(0, (35 - COALESCE(rsi, 35)) / 35.0 * 40)
+ GREATEST(0, LEAST((COALESCE(vol_ratio, 1) - 1) / 4, 1) * 30)
+ GREATEST(0, LEAST(COALESCE(change_pct, 0) / 5, 1) * 30)
```
- **触发条件**: RSI < 35, 量比 > 1, 涨幅 > 1%

### 3.4 强势回调（strong_pullback）

- **语义**: 强势股小幅回调后的买入机会
- **评分公式**:
```
评分 = (RSI - 50) / 50 × 30         -- RSI 在中高位得分越高，上限 30
     + min(-涨幅 / 10, 1) × 40       -- 回调幅度越大得分越高，上限 40
     + min((量比 - 1) / 3, 1) × 30   -- 缩量回调得分越高，上限 30
```
- **评分 SQL**:
```sql
GREATEST(0, (COALESCE(rsi, 50) - 50) / 50.0 * 30)
+ GREATEST(0, LEAST(-COALESCE(change_pct, 0) / 10, 1) * 40)
+ GREATEST(0, LEAST((COALESCE(vol_ratio, 1) - 1) / 3, 1) * 30)
```
- **触发条件**: RSI > 50, 涨幅 < -2%, 量比 > 1

### 3.5 全面看多（bullish_composite）

- **语义**: 综合多头信号，RSI 中高位 + MACD 向上 + 均线多头 + 正动量
- **评分公式**:
```
评分 = (RSI - 50) / 50 × 25         -- RSI 中高位，上限 25
     + min(MACD信号 / 3, 1) × 25     -- MACD 强度，上限 25
     + (均线多头 > 0 ? 25 : 0)       -- 均线多头排列，25分
     + min(动量 / 10, 1) × 25        -- 正向动量，上限 25
```
- **评分 SQL**:
```sql
GREATEST(0, (COALESCE(rsi, 50) - 50) / 50.0 * 25)
+ GREATEST(0, LEAST(COALESCE(macd_signal, 0) / 3, 1) * 25)
+ CASE WHEN COALESCE(ma_alignment, 0) > 0 THEN 25 ELSE 0 END
+ GREATEST(0, LEAST(COALESCE(momentum, 0) / 10, 1) * 25)
```
- **触发条件**: RSI > 50, MACD信号 > 0, 均线多头 = 1, 动量 > 0

### 3.6 极度超卖（extreme_oversold）

- **语义**: 极端超卖信号，地量见地价
- **评分公式**:
```
评分 = (20 - RSI) / 20 × 60         -- 极度超卖，上限 60
     + min((0.6 - 量比) / 0.5, 1) × 40  -- 地量见地价，上限 40
```
- **评分 SQL**:
```sql
GREATEST(0, (20 - COALESCE(rsi, 20)) / 20.0 * 60)
+ GREATEST(0, LEAST((0.6 - COALESCE(vol_ratio, 0)) / 0.5, 1) * 40)
```
- **触发条件**: RSI < 20, 量比 < 0.6

---

## 四、每日 15:30 自动计算触发逻辑

### 4.1 触发时间

- 每个交易日 15:30（北京时间，A股收盘后 30 分钟）

### 4.2 执行方式

- `scheduler.ts` 中 `node-cron` 定时任务
- 任务链: 指标计算 → 策略评估 → 回测+预测

### 4.3 数据依赖

- 使用当日完整的日 K 线数据
- 前复权价格用于指标计算

### 4.4 输出

- 计算结果写入 `daily_metrics` 表
- 字段包括: metric_date, code, name, exchange, board, rsi, change_pct, vol_ratio, macd_signal, bb_position, ma_alignment, volatility, momentum

---

## 五、排行榜更新机制

### 5.1 数据源

- `daily_metrics` 表

### 5.2 更新频率

- 每个交易日 15:30 后一次性更新

### 5.3 排名方式

- **单一指标排行**: 按选定指标值升降序排列
- **策略评分排行**: 使用各策略的 `scoreSQL` 实时计算评分，按评分降序排列

### 5.4 板块筛选

| 板块 Key | 标签 | 说明 |
|---------|------|------|
| all | 全部 | 全市场 |
| hsb | 沪深主板 | 上交所主板 + 深交所主板 |
| kcb | 科创板 | 科创板股票 |
| cyb | 创业板 | 创业板股票 |

---

## 六、API 接口

### 6.1 按指标排行

```
GET /api/rankings?date=2026-07-22&board=all&metric=rsi&limit=100
```

### 6.2 按策略评分排行

```
GET /api/rankings/strategies?date=2026-07-22&strategy=oversold_reversal&limit=100
```

### 6.3 获取可用策略列表

```
GET /api/rankings/strategies/list
```

### 6.4 获取可用日期

```
GET /api/rankings/available-dates
```

---

## 七、相关文件

| 文件路径 | 说明 |
|---------|------|
| `src/server/routes/rankings.ts` | 排行 API |
| `src/server/db/schema.ts` | daily_metrics 表定义 |
| `src/server/indicators/index.ts` | 指标计算核心算法 |
| `src/server/db/seedStrategies.ts` | 6 种策略评分定义 |
| `src/server/services/scheduler.ts` | 定时任务调度 |
