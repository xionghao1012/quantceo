# 个股详情功能说明

## 一、功能概述

个股详情页面提供单只股票的完整技术分析视图，包含多周期 K 线图、技术指标叠加、基本面数据查询。

**页面路径**: `/stock/:code`
**访问权限**: OSS 用户可直接访问

---

## 二、K 线周期说明

### 2.1 支持的周期类型

| 周期 | 类型 | 数据源 | 典型数据量 |
|------|------|--------|-----------|
| 日 K | 日线 | PostgreSQL klines 表 | 1000+ 条 |
| 周 K | 周线 | 由日 K 聚合计算 | 250+ 条 |
| 月 K | 月线 | 由日 K 聚合计算 | 120+ 条 |
| m1/m5/m15/m30/m60 | 分钟线 | minuteKlines 表 | 640 条 |

### 2.2 各周期 K 线获取逻辑

**日 K 线获取流程**:
```
1. 先查 Redis kline:{code}
2. Redis 命中且数据量 > 1000 条 → 直接返回（source: cache）
3. Redis 未命中 → 查询 PostgreSQL klines 表
4. DB 有数据且 > 1000 条 → 写入 Redis → 返回（source: cache）
5. DB 无数据 → 调用东方财富 API 抓取
6. 写入 PostgreSQL → 写入 Redis → 返回（source: api）
7. 若 K 线日期早于今日，异步刷新最新数据
```

**分钟 K 线获取流程**:
```
1. 先查 Redis mkline:{period}:{code}
2. Redis 命中且最后数据时间 > 5 分钟前 → 直接返回
3. Redis 未命中 → 查询 PostgreSQL minuteKlines 表
4. DB 有数据 → 写入 Redis → 异步刷新
5. DB 无数据 → 按以下顺序尝试：
   - m1: akshare → 腾讯
   - m5/m15/m30/m60: baostock → akshare → 腾讯
```

---

## 三、技术指标计算

### 3.1 移动平均线 (MA)

**计算方法**: 简单移动平均 (SMA)
```
MA(n) = Σ(收盘价) / n  (最近 n 日)
```

**默认参数**:
| 指标 | 周期 | 说明 |
|------|------|------|
| MA5 | 5 日 | 短期趋势 |
| MA10 | 10 日 | 短期趋势 |
| MA20 | 20 日 | 中期趋势 |
| MA60 | 60 日 | 长期趋势 |

**代码实现** (`indicators/index.ts`):
```typescript
function sma(values: number[], period: number): number[] {
  const result: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { result.push(NaN); continue }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += values[j]
    result.push(sum / period)
  }
  return result
}
```

### 3.2 MACD (Moving Average Convergence Divergence)

**计算方法**:
```
DIF = EMA(close, 12) - EMA(close, 26)
DEA = EMA(DIF, 9)
MACD 柱 = (DIF - DEA) × 2
```

**默认参数**:
| 参数 | 值 | 说明 |
|------|-----|------|
| 快线周期 | 12 | 短期指数移动平均 |
| 慢线周期 | 26 | 长期指数移动平均 |
| 信号线周期 | 9 | DIF 的指数移动平均 |

**EMA 计算公式**:
```
EMA(n) = close × (2/(n+1)) + EMA(n-1) × (1 - 2/(n+1))
```

**代码实现**:
```typescript
function ema(values: number[], period: number): number[] {
  const result: number[] = []
  const k = 2 / (period + 1)
  for (let i = 0; i < values.length; i++) {
    if (i === 0) { result.push(values[0]); continue }
    result.push(values[i] * k + result[i - 1] * (1 - k))
  }
  return result
}
```

### 3.3 RSI (Relative Strength Index)

**计算方法**: 相对强弱指数
```
RSI(n) = 100 - (100 / (1 + RS))
RS = n 日平均涨幅 / n 日平均跌幅

平均涨幅 = RMA(涨幅, n)  (指数移动平均)
平均跌幅 = RMA(跌幅, n)
```

**默认参数**: 周期 14 日

**超买超卖区间**:
| 区间 | 信号 |
|------|------|
| RSI < 30 | 超卖，可能反弹 |
| RSI > 70 | 超买，可能回调 |

**代码实现**:
```typescript
function rma(values: number[], period: number): number[] {
  const result: number[] = []
  const alpha = 1 / period
  for (let i = 0; i < values.length; i++) {
    if (i === 0) { result.push(values[0]); continue }
    result.push(alpha * values[i] + (1 - alpha) * result[i - 1])
  }
  return result
}

export function calcRSI(klines: KLine[], period = 14): number[] {
  const closes = klines.map(k => k.close)
  const changes = [0, ...closes.slice(1).map((c, i) => c - closes[i])]
  const gains = changes.map(c => c > 0 ? c : 0)
  const losses = changes.map(c => c < 0 ? -c : 0)
  const avgGain = rma(gains, period)
  const avgLoss = rma(losses, period)
  return avgGain.map((g, i) => {
    if (avgLoss[i] === 0) return 100
    return 100 - (100 / (1 + g / avgLoss[i]))
  })
}
```

### 3.4 布林带 (Bollinger Bands)

**计算方法**:
```
中轨 = SMA(close, 20)
上轨 = 中轨 + 2 × STD(close, 20)
下轨 = 中轨 - 2 × STD(close, 20)

STD = √(Σ(close - MA)² / n)
```

**默认参数**:
| 参数 | 值 | 说明 |
|------|-----|------|
| 周期 | 20 日 | |
| 倍数 | 2 | 标准差倍数 |

---

## 四、数据源优先级

### 4.1 日 K 线数据源

| 优先级 | 数据源 | 说明 |
|--------|--------|------|
| 1 | Redis 缓存 | TTL=2 小时，数据量 > 1000 条 |
| 2 | PostgreSQL | klines 表，取全部历史 |
| 3 | 东方财富 API | 无本地数据时抓取 |

### 4.2 分钟 K 线数据源

| 周期 | 优先级 1 | 优先级 2 | 优先级 3 |
|------|---------|---------|---------|
| m1 | akshare | 腾讯 | - |
| m5/m15/m30/m60 | baostock | akshare | 腾讯 |

---

## 五、API 接口

### 5.1 获取 K 线数据

```
GET /api/stocks/:code/klines
Query: period=m1|m5|m15|m30|m60 (可选，默认日 K)
       start=YYYYMMDD (可选)
       end=YYYYMMDD (可选)
```

**响应**:
```json
{
  "klines": [
    { "code": "600519", "date": "2026-07-22", "open": 1840, "high": 1860, "low": 1835, "close": 1850, "volume": 123456 }
  ],
  "source": "cache" | "api",
  "period": "day" | "m1" | "m5" | "m15" | "m30" | "m60"
}
```

### 5.2 获取技术指标

```
GET /api/stocks/:code/indicators
Query: period=m1|m5|m15|m30|m60 (可选)
```

**响应**:
```json
{
  "ma": { "MA5": [...], "MA10": [...], "MA20": [...], "MA60": [...] },
  "macd": { "macd": [...], "signal": [...], "histogram": [...] },
  "rsi": [...],
  "source": "cache" | "api",
  "period": "day" | "m1" | ...
}
```

### 5.3 获取基本面数据

```
GET /api/stocks/:code/fundamental
```

---

## 六、缓存机制

| 缓存类型 | Key 模式 | TTL | 说明 |
|---------|---------|-----|------|
| 日 K 线 | `kline:{code}` | 2 小时 | 全量历史 K 线 |
| 分钟 K 线 | `mkline:{period}:{code}` | 1 小时 | 分钟 K 线 |
| 指标数据 | 随 K 线缓存 | - | 指标实时计算 |

**缓存更新策略**:
- Redis 数据量 < 1000 条时，视为不完整，跳过缓存
- 日 K 线日期早于今日时，异步刷新最新数据
- 分钟 K 线最后数据 > 5 分钟前时，异步刷新

---

## 七、相关文件

| 文件路径 | 说明 |
|---------|------|
| `src/server/routes/stocks.ts` | K 线/指标 API 路由 |
| `src/server/data/cache.ts` | K 线缓存获取逻辑 |
| `src/server/data/eastmoney.ts` | 东方财富 K 线抓取 |
| `src/server/data/tencentMinute.ts` | 腾讯分钟 K 线 |
| `src/server/data/baostockMinute.ts` | baostock 分钟 K 线 |
| `src/server/data/akshareMinute.ts` | akshare 分钟 K 线 |
| `src/server/indicators/index.ts` | 指标计算实现 |
| `src/shared/types.ts` | KLine 类型定义 |
