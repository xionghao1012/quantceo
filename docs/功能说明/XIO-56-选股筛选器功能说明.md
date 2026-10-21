# 选股筛选器功能说明

## 一、功能概述

选股筛选器支持多维度技术指标组合条件筛选，帮助用户从全市场股票中快速筛选出满足特定条件的股票。

**页面路径**: `/screener`
**访问权限**: OSS 用户可直接访问

---

## 二、支持的筛选字段

| 字段 | 标签 | 类型 | 支持的运算符 |
|------|------|------|------------|
| price | 最新价 | number | >, <, ==, between |
| change | 涨跌幅% | number | >, <, ==, between |
| volume | 成交量 | number | >, <, ==, between |
| amount | 成交额 | number | >, <, ==, between |
| amplitude | 振幅% | number | >, <, ==, between |
| ma5 | MA5 | number | >, <, == |
| ma10 | MA10 | number | >, <, == |
| ma20 | MA20 | number | >, <, == |
| ma60 | MA60 | number | >, <, == |
| macd | MACD | number | >, <, == |
| macdSignal | MACD信号 | number | >, <, == |
| macdHistogram | MACD柱 | number | >, <, == |
| rsi | RSI | number | >, <, == |

---

## 三、运算符说明

| 运算符 | 说明 | 示例 |
|--------|------|------|
| > | 大于 | RSI > 30 |
| < | 小于 | RSI < 70 |
| == | 等于 | change == 0 |
| between | 范围（含边界） | price between [100, 200] |
| cross_above | 上穿（均线交叉） | ma5 cross_above ma20 |
| cross_below | 下穿（均线交叉） | ma5 cross_below ma20 |

### 3.1 交叉运算符逻辑

```typescript
// cross_above: 前一日 A <= B，且当日 A > B
if (!((curVal > curOther) && (prevVal <= prevOther))) return null

// cross_below: 前一日 A >= B，且当日 A < B
if (!((curVal < curOther) && (prevVal >= prevOther))) return null
```

---

## 四、筛选条件组合

### 4.1 多条件组合逻辑

筛选条件之间使用 **AND** 逻辑，即所有条件都必须满足：

```json
{
  "conditions": [
    { "field": "rsi", "operator": "<", "value": 30 },
    { "field": "change", "operator": ">", "value": 2 },
    { "field": "volume", "operator": ">", "value": 1000000 }
  ]
}
```

上述条件表示：RSI < 30 **且** 涨幅 > 2% **且** 成交量 > 100万

### 4.2 典型筛选场景

**超跌反弹选股**:
```json
[
  { "field": "rsi", "operator": "<", "value": 30 },
  { "field": "change", "operator": ">", "value": 2 },
  { "field": "macdHistogram", "operator": ">", "value": 0 }
]
```

**放量突破选股**:
```json
[
  { "field": "volume", "operator": ">", "value": 5000000 },
  { "field": "change", "operator": ">", "value": 3 },
  { "field": "ma5", "operator": "cross_above", "value": "ma20" }
]
```

---

## 五、API 接口

### 5.1 获取支持的筛选字段

```
GET /api/screener/fields
```

### 5.2 执行筛选

```
POST /api/screener
Body: {
  "conditions": [...],
  "sort": { "field": "change", "order": "desc" },
  "page": 1,
  "limit": 50
}
```

**响应**:
```json
{
  "total": 123,
  "page": 1,
  "limit": 50,
  "stocks": [
    {
      "code": "600519",
      "name": "贵州茅台",
      "price": 1850.00,
      "change": 2.35,
      "volume": 123456,
      "indicators": { "ma5": 1800, "rsi": 28, ... }
    }
  ]
}
```

---

## 六、性能优化

### 6.1 批量处理

筛选器按 100 只股票为一批进行并行处理：

```typescript
const BATCH = 100
const batchChunks = []
for (let i = 0; i < limitedCodes.length; i += BATCH) {
  batchChunks.push(limitedCodes.slice(i, i + BATCH))
}

const allBatchResults = await Promise.allSettled(
  batchChunks.map(async (batch) => { /* 处理每批 */ })
)
```

### 6.2 数据量限制

| 限制项 | 值 | 说明 |
|--------|---|------|
| 最大筛选股票数 | 500 | 超出部分截断 |
| 单页最大条数 | 100 | 超出部分分页 |

### 6.3 指标计算优化

技术指标在内存中批量计算后缓存，避免重复计算：

```typescript
const maMap = calcMA(klines_data, [5, 10, 20, 60])
const macd = calcMACD(klines_data)
const rsi = calcRSI(klines_data, 14)
```

---

## 七、相关文件

| 文件路径 | 说明 |
|---------|------|
| `src/server/routes/screener.ts` | 筛选器 API |
| `src/server/indicators/index.ts` | 指标计算 |
| `src/server/db/schema.ts` | stocks/klines 表 |
