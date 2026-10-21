# 信号扫描功能说明

## 一、功能概述

信号扫描模块对全市场股票进行技术面扫描，发现满足特定策略条件的交易信号，支持内置策略和自定义规则。

**页面路径**: `/scan`
**访问权限**: OSS 用户可直接访问

---

## 二、内置扫描策略

### 2.1 策略列表

| ID | 策略名称 | 方向 | 基础强度 | 触发条件 |
|----|---------|------|---------|---------|
| 1 | MA5/20 金叉 | BUY | 70 | 昨日 MA5 ≤ MA20，且今日 MA5 > MA20 |
| 1 | MA5/20 死叉 | SELL | 70 | 昨日 MA5 ≥ MA20，且今日 MA5 < MA20 |
| 2 | MA10/60 金叉 | BUY | 80 | 昨日 MA10 ≤ MA60，且今日 MA10 > MA60 |
| 2 | MA10/60 死叉 | SELL | 80 | 昨日 MA10 ≥ MA60，且今日 MA10 < MA60 |
| 3 | MACD 金叉 | BUY | 60 | 昨日 DIF ≤ Signal，且今日 DIF > Signal |
| 3 | MACD 死叉 | SELL | 60 | 昨日 DIF ≥ Signal，且今日 DIF < Signal |
| 4 | RSI 超卖 | BUY | 50 | RSI < 30 |
| 4 | RSI 超买 | SELL | 50 | RSI > 70 |
| 5 | MACD 零轴下方金叉 | BUY | 75 | DIF < 0（零轴下方）+ 金叉 |
| 6 | 放量突破 | BUY | 65 | 量比 > 1.5 且涨幅 > 2% |

### 2.2 策略触发逻辑

每只股票的扫描基于当日 (`cur`) 和前一日 (`prev`) 的指标对比：

```typescript
interface IndicatorSnapshot {
  ma5: number; ma10: number; ma20: number; ma60: number
  macd: number; macdSignal: number; rsi: number
  volRatio: number; changePct: number
}

// 金叉/死叉：前一日状态 + 当日状态变化
MA5/20 金叉: prev.ma5 <= prev.ma20 && cur.ma5 > cur.ma20
MACD 金叉: prev.macd <= prev.macdSignal && cur.macd > cur.macdSignal
```

---

## 三、技术指标计算

### 3.1 移动平均线 (MA)

```typescript
function calcMA(klines: KLine[], period: number): number[] {
  const arr: number[] = []
  for (let i = 0; i < klines.length; i++) {
    if (i < period - 1) { arr.push(NaN); continue }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += klines[j].close
    arr.push(sum / period)
  }
  return arr
}
```

### 3.2 MACD

```typescript
function calcMACD(klines: KLine[]) {
  const closes = klines.map(k => k.close)
  const ema12 = calcEMA(closes, 12)
  const ema26 = calcEMA(closes, 26)
  const macd = ema12.map((v, i) => v - ema26[i])
  const signal = calcEMA(macd, 9)
  const histogram = macd.map((v, i) => v - signal[i])
  return { macd, signal, histogram }
}
```

### 3.3 RSI

```typescript
function calcRSI(klines: KLine[], period = 14): number[] {
  const rsi: number[] = new Array(klines.length).fill(NaN)
  if (klines.length < period + 1) return rsi
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const diff = klines[i].close - klines[i - 1].close
    if (diff > 0) avgGain += diff; else avgLoss -= diff
  }
  avgGain /= period; avgLoss /= period
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < klines.length; i++) {
    const diff = klines[i].close - klines[i - 1].close
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return rsi
}
```

### 3.4 量比

```
量比 = 当日成交量 / 20日平均成交量

avgVol20 = Σ(最近20日成交量) / 20
volRatio = 当日成交量 / avgVol20
```

### 3.5 涨跌幅

```
changePct = (当前收盘价 - 前收盘价) / 前收盘价 × 100%
```

---

## 四、扫描引擎架构

### 4.1 核心扫描流程

```typescript
export function scanStock(code: string, name: string, klines: KLine[]): ScanResult | null {
  if (klines.length < 30) return null  // 数据不足跳过

  // 1. 计算所有指标
  const ma5 = calcMA(klines, 5)
  const ma10 = calcMA(klines, 10)
  const ma20 = calcMA(klines, 20)
  const ma60 = calcMA(klines, 60)
  const { macd, signal: macdSignal } = calcMACD(klines)
  const rsi = calcRSI(klines)

  // 2. 构建指标快照
  const cur = { ma5, ma10, ma20, ma60, macd, macdSignal, rsi, volRatio, changePct }
  const prev = { ... } // 前一日数据

  // 3. 遍历策略检查
  const signals: Signal[] = []
  for (const s of STRATEGIES) {
    if (s.check(cur, prev)) {
      signals.push({ strategyId: s.id, strategyName: s.name, direction: s.direction, strength: s.strength })
    }
  }

  // 4. 无信号返回 null
  if (!signals.length) return null
  return { code, name, price: last, signals }
}
```

### 4.2 并行计算机制

`scanStocks` 函数支持批量扫描：

```typescript
export function scanStocks(stocks: { code: string; name: string }[], allKlines: Record<string, KLine[]>): ScanResult[] {
  const results: ScanResult[] = []
  for (const s of stocks) {
    const klines = allKlines[s.code]
    if (!klines) continue
    const r = scanStock(s.code, s.name, klines)
    if (r) results.push(r)
  }
  return results
}
```

**注意**：当前实现为串行扫描，Worker 线程池用于定时批量扫描任务。

---

## 五、定时扫描

### 5.1 扫描时间

| 任务 | 执行时间 | 说明 |
|------|---------|------|
| 日终信号扫描 | 交易日 18:30 | 扫描当日收盘后全市场信号 |

### 5.2 扫描结果存储

扫描结果存入 PostgreSQL `signals` 表：

```sql
signals (
  id, code, name, strategy_id, strategy_name,
  direction, strength, price, indicators,
  scan_date, created_at
)
```

---

## 六、API 接口

### 6.1 查询信号

```
GET /api/signals
Query: code, strategyId, direction, date, limit
```

### 6.2 今日信号

```
GET /api/signals/today
```

返回按股票分组的今日信号列表，按信号强度排序：

```json
[
  {
    "code": "600519",
    "name": "贵州茅台",
    "price": 1850.00,
    "signals": [
      { "strategyId": 1, "strategyName": "MA5/20 金叉", "direction": "BUY", "strength": 70 }
    ],
    "totalStrength": 70
  }
]
```

### 6.3 信号统计

```
GET /api/signals/stats?days=30
```

---

## 七、相关文件

| 文件路径 | 说明 |
|---------|------|
| `scan-engine/src/scan.ts` | 扫描引擎核心逻辑 |
| `scan-engine/src/routes/scan.ts` | 扫描 API 路由 |
| `src/server/routes/signals.ts` | 信号查询 API |
| `src/server/workers/scan.worker.cjs` | Worker 线程任务 |
| `src/server/db/schema.ts` | signals 表定义 |
