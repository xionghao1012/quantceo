# 策略回测功能说明

## 一、功能概述

策略回测模块提供量化策略的历史表现评估，支持内置策略选择和自定义参数配置，帮助用户验证策略有效性。

**页面路径**: `/backtest`
**访问权限**: OSS 用户可直接访问

---

## 二、支持的内置策略

| 策略 | 评分 SQL | 条件 SQL |
|------|---------|---------|
| MA5/20 金叉 | MA5 > MA20 | RSI < 70 |
| MA10/60 金叉 | MA10 > MA60 | RSI < 70 |
| RSI 超卖反弹 | 30 - RSI（越低越好） | RSI < 30 |
| MACD 零轴金叉 | DIF - DEA（MACD 柱） | DIF > DEA AND DIF > 0 |

---

## 三、回测参数说明

### 3.1 基础参数

| 参数 | 默认值 | 说明 |
|------|-------|------|
| startDate | - | 回测开始日期 |
| endDate | - | 回测结束日期 |
| initialCapital | 100000 | 初始资金（元） |
| topN | 5 | 每日持仓股票数量 |
| holdingDays | 5 | 持有天数 |

### 3.2 成本参数

| 参数 | 默认值 | 说明 |
|------|-------|------|
| commissionRate | 0.025% | 佣金率（双向） |
| stampTaxRate | 0.1% | 印花税（卖出时收取） |
| slippage | 0.1% | 滑点（买卖时价格偏移） |

---

## 四、量化指标计算公式

### 4.1 总收益率

```
总收益率 = (最终权益 - 初始资金) / 初始资金 × 100%
```

**代码实现** (`backtestStrategyService.ts:370`):
```typescript
const totalReturn = initialCapital > 0
  ? ((finalEquity - initialCapital) / initialCapital) * 100
  : 0
```

### 4.2 年化收益率

```
年化收益率 = 总收益率 × (252 / 交易天数)
```

**代码实现** (`backtestStrategyService.ts:372`):
```typescript
const tradingDays = equityCurve.length - 1
const annualReturn = tradingDays > 0 ? totalReturn * (252 / tradingDays) : 0
```

### 4.3 夏普比 (Sharpe Ratio)

```
夏普比 = (日均收益率 / 日收益率标准差) × √252

其中：
日均收益率 = Σ(日收益率) / 交易天数
日收益率 = (当日权益 - 前日权益) / 前日权益
```

**代码实现** (`backtestStrategyService.ts:374-385`):
```typescript
let sum = 0, sumSq = 0
for (let i = 1; i < equityCurve.length; i++) {
  const prev = equityCurve[i - 1].value
  if (prev === 0) continue
  const r = (equityCurve[i].value - prev) / prev
  sum += r
  sumSq += r * r
}
const avgReturn = tradingDays > 0 ? sum / tradingDays : 0
const variance = tradingDays > 0 ? sumSq / tradingDays - avgReturn * avgReturn : 0
const stdDev = Math.sqrt(Math.max(0, variance))
const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0
```

### 4.4 最大回撤 (Max Drawdown)

```
最大回撤 = max((历史最高点 - 当前点) / 历史最高点 × 100%)
```

**代码实现** (`backtestStrategyService.ts:387-393`):
```typescript
let peak = initialCapital
let maxDrawdown = 0
for (const e of equityCurve) {
  if (e.value > peak) peak = e.value
  const dd = peak > 0 ? ((peak - e.value) / peak) * 100 : 0
  if (dd > maxDrawdown) maxDrawdown = dd
}
```

### 4.5 胜率

```
胜率 = 盈利交易次数 / 总交易次数 × 100%
```

**代码实现** (`backtestStrategyService.ts:395`):
```typescript
const winRate = tradeCount > 0 ? (wins / tradeCount) * 100 : 0
```

### 4.6 平均持有天数

```
平均持有天数 = Σ(每笔交易持有天数) / 交易次数
```

---

## 五、交易成本扣除顺序

每笔卖出交易的扣除顺序：

```
1. 滑点损耗：卖出价 × (1 - slippage)
2. 佣金：成交金额 × commissionRate
3. 印花税：成交金额 × stampTaxRate
4. 成本本金：买入成本
5. 净利润 = 卖出净收入 - 佣金 - 印花税 - 成本本金
```

**代码实现** (`backtestStrategyService.ts:222-228`):
```typescript
const sellPrice = exitPrice * (1 - slippage)
const proceeds = pos.shares * sellPrice
const commission = proceeds * commissionRate
const tax = proceeds * stampTaxRate
const costBasis = pos.shares * pos.entryPrice
const pnl = proceeds - commission - tax - costBasis
```

---

## 六、回测引擎逻辑

### 6.1 每日调仓流程

```
for 每个交易日 date:
    1. 获取当日评分排名前 (topN + 现有持仓数) 的股票
    2. 遍历现有持仓：
       - 持有天数 >= holdingDays → 卖出
       - 条件不再满足 → 卖出
    3. 计算可用仓位 = topN - 当前持仓数
    4. 按评分权重分配资金，买入新股票
    5. 计算当日总权益，记录权益曲线
```

### 6.2 买入逻辑

```typescript
// 按评分权重分配资金
allocateCapital = (cash × candidate.score) / totalScore

// 按手整买（100 股为 1 手）
maxShares = floor(allocateCapital / buyPrice / 100) × 100

// 滑点：买入价 × (1 + slippage)
buyPrice = entryPrice × (1 + slippage)
```

### 6.3 卖出逻辑

```typescript
// 滑点：卖出价 × (1 - slippage)
sellPrice = exitPrice × (1 - slippage)

// 卖出时扣除佣金 + 印花税
cash += proceeds - commission - tax
```

---

## 七、策略评分与选择

### 7.1 策略综合评分

`selectBestStrategy` 函数综合多维度评估策略：

```
策略评分 = 年化收益率 × 0.25
          + 夏普比 × 25
          - 最大回撤 × 0.2
          + 胜率 × 20
```

**注意**：交易次数 < 5 的策略不参与评分。

### 7.2 多周期回测

`runStrategyBacktestAllPeriods` 同时回测 4 种持有期（1/3/5/10 天），返回最优结果。

---

## 八、回测结果输出

### 8.1 统计指标

```typescript
interface StrategyBacktestStats {
  totalReturn: number    // 总收益率 (%)
  annualReturn: number   // 年化收益率 (%)
  sharpe: number         // 夏普比
  maxDrawdown: number    // 最大回撤 (%)
  winRate: number        // 胜率 (%)
  tradeCount: number     // 交易次数
  avgHoldDays: number    // 平均持有天数
  return1d: number       // 持有≥1天平均收益 (%)
  return3d: number       // 持有≥3天平均收益 (%)
  return5d: number       // 持有≥5天平均收益 (%)
  return10d: number      // 持有≥10天平均收益 (%)
}
```

### 8.2 交易记录

```typescript
interface StrategyTrade {
  entryDate: string      // 买入日期
  exitDate: string       // 卖出日期
  code: string           // 股票代码
  name: string           // 股票名称
  entryPrice: number     // 买入价格（含滑点）
  exitPrice: number      // 卖出价格（含滑点）
  shares: number         // 买入股数
  pnl: number            // 净利润
  returnPct: number      // 收益率 (%)
  holdingDays: number    // 持有天数
  score: number          // 买入时评分
}
```

---

## 九、相关文件

| 文件路径 | 说明 |
|---------|------|
| `src/server/services/backtestStrategyService.ts` | 回测引擎核心逻辑 |
| `src/server/routes/backtest.ts` | 回测 API 路由 |
| `src/server/db/schema.ts` | daily_metrics 表定义 |
| `backtest-engine/strategy_backtest.py` | Python 回测引擎参考 |
