# 指标排行功能说明

## 一、功能概述

指标排行模块展示全市场股票在 8 大技术指标维度下的排名，支持按单一指标排序或使用策略评分模式。

**页面路径**: `/rankings`
**访问权限**: OSS 用户可直接访问

---

## 二、8 大指标说明

| 指标 Key | 标签 | 排序方向 | 说明 |
|---------|------|---------|------|
| rsi | RSI | 升序（低优先） | 相对强弱指数，<30 超卖 |
| change_pct | 涨跌幅 | 降序（高优先） | 当日涨跌幅百分比 |
| vol_ratio | 成交量比 | 降序（高优先） | 当日量 / 20日均量 |
| macd_signal | MACD信号 | 降序（高优先） | DIF - DEA 差值 |
| bb_position | 布林位置 | 降序（高优先） | 0=下轨，100=上轨 |
| ma_alignment | 均线多头 | 降序（高优先） | 多头排列程度 |
| volatility | 波动率 | 降序（高优先） | 年化波动率 |
| momentum | 动量 | 降序（高优先） | 10日价格变化率 |

---

## 三、6 种策略评分模式

### 3.1 超跌反弹 (oversold_reversal)

适用于捕捉超跌反弹机会：

```
评分 = (30 - RSI) / 30 × 40        -- RSI 越低越好
      + min(MACD信号 / 2, 1) × 30   -- MACD 信号强度
      + min(-动量 / 10, 1) × 30     -- 跌幅越大反弹概率越高
```

### 3.2 放量突破 (volume_breakout)

适用于捕捉放量突破的股票：

```
评分 = min((量比 - 1) / 3, 1) × 35       -- 量比越高越好
      + min((涨幅 - 3) / 7, 1) × 35       -- 涨幅越大越好
      + 布林位置 / 100 × 30               -- 布林带位置
```

### 3.3 底部启动 (bottom_start)

适用于抄底布局：

```
评分 = (35 - RSI) / 35 × 40         -- 低 RSI
      + min((量比 - 1) / 4, 1) × 30 -- 温和放量
      + min(涨幅 / 5, 1) × 30        -- 底部启动迹象
```

### 3.4 强势回调 (strong_pullback)

适用于强势股回调买入：

```
评分 = (RSI - 50) / 50 × 30         -- RSI 在中高位
      + min(-涨幅 / 10, 1) × 40      -- 小幅回调
      + min((量比 - 1) / 3, 1) × 30  -- 回调缩量
```

### 3.5 多头复合 (bullish_composite)

综合多头信号：

```
评分 = (RSI - 50) / 50 × 25         -- RSI 中高位
      + min(MACD信号 / 3, 1) × 25    -- MACD 强度
      + (均线多头 > 0 ? 25 : 0)      -- 均线多头排列
      + min(动量 / 10, 1) × 25       -- 正向动量
```

### 3.6 极度超卖 (extreme_oversold)

极端超卖信号：

```
评分 = (20 - RSI) / 20 × 60         -- 极度超卖
      + min((0.6 - 量比) / 0.5, 1) × 40  -- 地量见地价
```

---

## 四、数据来源

指标排行数据来自 `daily_metrics` 表，该表由每日 15:30 的定时任务计算更新。

### 4.1 daily_metrics 表关键字段

| 字段 | 说明 |
|------|------|
| metric_date | 指标计算日期 |
| code | 股票代码 |
| name | 股票名称 |
| exchange | 交易所 |
| board | 板块（hsb/kcb/cyb） |
| rsi | RSI 指标值 |
| change_pct | 涨跌幅 |
| vol_ratio | 量比 |
| macd_signal | MACD 信号值 |
| bb_position | 布林带位置 (0-100) |
| ma_alignment | 均线多头排列程度 |
| volatility | 年化波动率 |
| momentum | 10日动量 |

---

## 五、板块筛选

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

**响应**:
```json
{
  "date": "2026-07-22",
  "board": "all",
  "boardLabel": "全部",
  "metric": "rsi",
  "metricLabel": "RSI",
  "sort": "asc",
  "total": 5307,
  "hasData": true,
  "rankings": [
    { "rank": 1, "code": "600519", "name": "贵州茅台", "value": 15.3, "rsi": 15.3, ... }
  ]
}
```

### 6.2 按策略评分排行

```
GET /api/rankings/strategies?date=2026-07-22&strategy=oversold_reversal&limit=100
```

**响应**:
```json
{
  "date": "2026-07-22",
  "strategy": "oversold_reversal",
  "strategyLabel": "超跌反弹",
  "scoreLabel": "超跌反弹评分",
  "total": 123,
  "rankings": [
    { "rank": 1, "code": "600519", "score": 85, "rsi": 18.5, ... }
  ]
}
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

## 七、定时计算

每日 15:30 自动计算全市场股票的指标数据，存入 `daily_metrics` 表。

| 指标 | 计算方式 |
|------|---------|
| RSI | 14日RSI |
| 涨跌幅 | (收盘价 - 前收盘) / 前收盘 × 100% |
| 量比 | 当日成交量 / 20日均量 |
| MACD信号 | DIF - DEA |
| 布林位置 | (现价 - 下轨) / (上轨 - 下轨) × 100 |
| 均线多头 | MA5>MA20>MA60 ? 1 : 0 |
| 波动率 | 日收益率标准差 × √252 |
| 动量 | (当前价 - 10日前价) / 10日前价 × 100% |

---

## 八、相关文件

| 文件路径 | 说明 |
|---------|------|
| `src/server/routes/rankings.ts` | 排行 API |
| `src/server/db/schema.ts` | daily_metrics 表定义 |
| `src/server/indicators/index.ts` | 指标计算 |
