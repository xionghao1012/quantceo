# 三级缓存机制说明

## 一、功能概述

三级缓存架构为市场数据（日 K 线、分钟 K 线、实时行情）提供 Redis → PostgreSQL → 外部 API 三层缓存策略。

---

## 二、三层缓存架构

```
┌──────────────────────────────────────────────────────────────────┐
│                      用户请求 /api/klines/:code                  │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│  第一层: Redis Cache (热点数据)                                   │
│  Key: kline:{code}          TTL: 2 小时                         │
│  Key: mkline:{period}:{code}  TTL: 1 小时                       │
│  Key: quotes:latest         TTL: 30 秒                          │
└───────┬──────────────────────────────────────────────────────────┘
        │ miss
        ▼
┌──────────────────────────────────────────────────────────────────┐
│  第二层: PostgreSQL (结构化数据)                                  │
│  表: klines (日 K 线，无限历史)                                   │
│  表: minute_klines (分钟 K 线，m1/m5/m15/m30/m60)                │
└───────┬──────────────────────────────────────────────────────────┘
        │ miss
        ▼
┌──────────────────────────────────────────────────────────────────┐
│  第三层: 外部 API (数据源)                                        │
│  - 东方财富/腾讯行情: 日 K 线                                     │
│  - Sina/腾讯/akshare: 实时行情                                    │
│  - akshare/baostock/腾讯: 分钟 K 线                               │
└──────────────────────────────────────────────────────────────────┘
```

---

## 三、各层详解

### 3.1 Redis 缓存层（热点数据）

| 函数 | Key 格式 | TTL | 用途 |
|------|---------|-----|------|
| `cacheGetKlines()` / `cacheSetKlines()` | `kline:{code}` | 2 小时 | 日 K 线 |
| `cacheGetKlinesBulk()` / `cacheSetKlinesBulk()` | `kline:{code}` | 2 小时 | 批量日 K 线（pipeline） |
| `cacheGetMinuteKlines()` / `cacheSetMinuteKlines()` | `mkline:{period}:{code}` | 1 小时 | 分钟 K 线 |
| `cacheSetMinuteKlinesBulk()` | `mkline:{period}:{code}` | 1 小时 | 批量分钟 K 线 |
| `cacheGetQuotes()` / `cacheSetQuotes()` | `quotes:latest` | 30 秒 | 实时行情 |

**实现特点**:
- 使用 `ioredis`，重试策略: `Math.min(times * 100, 1000)`（最大 3 次）
- 批量写入使用 `redis.pipeline()`
- 错误静默处理（try/catch）

### 3.2 PostgreSQL 缓存层（结构化数据）

**表结构**:

| 表名 | 字段 | 用途 |
|------|------|------|
| `klines` | `code, date, open, high, low, close, volume, amount` | 日 K 线 |
| `minute_klines` | `code, datetime, period, open, high, low, close, volume, amount` | 分钟 K 线 |

**写入策略**:
- 批量大小: 500 行/次
- 使用 `ON CONFLICT DO NOTHING` 避免重复
- 索引: `idx_klines_code_date`, `idx_minute_klines_code_period_datetime`

### 3.3 外部 API 层（数据源）

| 数据源 | 用途 | 超时 |
|--------|------|------|
| 东方财富 (Sohu/Tencent) | 日 K 线 | 5 秒 |
| 腾讯行情 | 分钟 K 线 | 5 秒 |
| akshare (Python) | 分钟 K 线（备份） | 10 秒 |
| baostock (Python) | 3 年分钟历史 | 10 秒 |
| Sina (新浪) | 实时行情 | 3 秒 |

**分钟 K 线降级策略**:
- m1 周期: `akshare → tencent`
- 其他周期 (m5/m15/m30/m60): `baostock → akshare → tencent`

---

## 四、数据获取流程

```
请求 /api/klines/:code
    │
    ├─→ Redis hit ──→ Return (source: 'cache')
    │                    (异步刷新如果数据过期)
    │
    ├─→ Redis miss ──→ PostgreSQL hit ──→ 写入 Redis ──→ Return (source: 'cache')
    │
    └─→ 全部 miss ──→ 调用外部 API
                        │
                        ├─→ 成功 ──→ 写入 PG + Redis ──→ Return (source: 'api')
                        │
                        └─→ 失败 ──→ Return 空数据
```

---

## 五、缓存预热机制

### 5.1 预热时间表

| 时间 | 任务 | 操作 |
|------|------|------|
| `0 18 * * 1-5` | 日 K 线批量刷新 | `getOrFetchKlines()` 全量刷新 |
| `*/15 9-15 * * 1-5` | 分钟 K 线刷新 | 持仓股 + 每日精选 |
| 手动 | 全量分钟 K 线同步 | `syncMinuteKlines.ts`（批量 10 只） |

### 5.2 预热判断逻辑

- **增量更新**: Redis 数据日期 < 今日，异步调用 `refreshLatestKlines()`
- **全量刷新**: 数据行数 < 1000，从 API 重新获取
- **分钟 K 线**: 最后更新时间 > 5 分钟前，异步 `refreshLatestMinuteKlines()`

---

## 六、缓存雪崩防护

### 6.1 防护机制

| 机制 | 实现 |
|------|------|
| **TTL 差异化** | 不同数据 TTL 不同，避免同时失效（日 K 线 2h，分钟 1h，行情 30s） |
| **异步刷新** | 缓存命中时返回旧数据，同时异步更新（非阻塞） |
| **多源降级** | API 失败自动切换：akshare → tencent → baostock |
| **熔断机制** | API 超时: 5s（eastmoney/tencent），10s（akshare/baostock） |
| **最小数据检查** | Redis 缓存仅在数据 >= 1000 行时有效（全历史阈值） |
| **优雅降级** | Redis/PG 错误静默穿透到下一层 |

### 6.2 雪崩场景处理

```
1. 首次请求触发 API 源
2. 后续请求从 PostgreSQL 返回（不等待 Redis）
3. API 数据写入 PG + Redis
4. 所有请求正常返回 — 无缓存击穿
```

---

## 七、配置参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `KLINE_TTL` | 7200s (2h) | Redis 日 K 线缓存 |
| `MKLINE_TTL` | 3600s (1h) | Redis 分钟 K 线缓存 |
| `QUOTES_TTL` | 30s | Redis 实时行情 |
| `MIN_FULL_HISTORY` | 1000 行 | 有效缓存阈值 |
| `BATCH_SIZE` | 500 行/批 | PostgreSQL 批量写入 |
| 日 K 线刷新阈值 | lastDate < today | 触发异步日 K 线刷新 |
| 分钟刷新阈值 | lastUpdate < 5 分钟前 | 触发异步分钟刷新 |

---

## 八、相关代码文件

| 文件路径 | 说明 |
|---------|------|
| `quant-trading/src/server/data/redis.ts` | Redis 缓存层实现 |
| `quant-trading/src/server/data/cache.ts` | PostgreSQL 缓存层实现 |
| `quant-trading/src/server/data/eastmoney.ts` | 东方财富数据源 |
| `quant-trading/src/server/data/tencentMinute.ts` | 腾讯分钟 K 线 |
| `quant-trading/src/server/data/akshareMinute.ts` | akshare 分钟 K 线 |
| `quant-trading/src/server/data/baostockMinute.ts` | baostock 分钟历史 |
| `quant-trading/src/server/data/intraday_quote.py` | Sina 实时行情 |
| `quant-trading/src/server/services/scheduler.ts` | 预热调度任务 |
| `quant-trading/src/server/data/syncMinuteKlines.ts` | 分钟 K 线同步脚本 |
