# QuantCEO API 文档

## 基础信息

- **Base URL**: `http://localhost:4001/api`（可在 `.env` 中配置 `PORT`）
- **认证方式**: Bearer Token（从 `/api/auth/login` 或 `/api/auth/register` 获取）
- **内容类型**: `application/json`
- **OSS 模式**：无需 `LICENSE_KEY` 即可使用
- **Pro 模式**：需要设置 `LICENSE_KEY` 环境变量

---

## 目录

- [认证](#认证)
- [股票数据](#股票数据)
- [回测](#回测)
- [信号扫描](#信号扫描)
- [自选股](#自选股)
- [选股筛选](#选股筛选)
- [指标排行](#指标排行)
- [市场状态](#市场状态)
- [信号查询](#信号查询)
- [持仓管理 (Pro)](#持仓管理-pro)
- [AI 预测 (Pro)](#ai-预测-pro)
- [情绪分析 (Pro)](#情绪分析-pro)
- [推送设置 (Pro)](#推送设置-pro)
- [价格告警 (Pro)](#价格告警-pro)
- [策略优化 (Pro)](#策略优化-pro)
- [其他 (Pro)](#其他-pro)

---

## 认证

### POST /auth/register

注册新用户。

```json
// Request
{ "email": "user@example.com", "password": "Test@123456", "name": "User" }

// Response 201
{ "token": "jwt...", "refreshToken": "hex...", "user": { "id": 1, "email": "...", "name": "..." } }
```

### POST /auth/login

登录。

```json
// Request
{ "email": "user@example.com", "password": "Test@123456" }

// Response 200
{ "token": "jwt...", "refreshToken": "hex...", "user": { ... } }
```

### POST /auth/refresh

刷新 Token。

```json
// Request
{ "refreshToken": "hex..." }

// Response 200
{ "token": "jwt...", "refreshToken": "hex..." }
```

### POST /auth/logout

登出。

### GET /auth/me

获取当前用户信息。需要 Bearer Token。

### PUT /auth/me

更新个人资料。

```json
// Request
{ "name?": "NewName", "avatar?": "url", "settings?": {} }
```

### POST /auth/change-password

修改密码。需要认证。

```json
// Request
{ "currentPassword": "old", "newPassword": "New@123456" }
```

---

## 股票数据

### GET /stocks

股票列表。无需认证。

| 参数 | 类型 | 说明 |
|------|------|------|
| q | string | 搜索关键字（代码或名称） |
| limit | number | 数量限制（默认 50） |
| offset | number | 偏移量 |

### GET /stocks/quotes

全市场实时行情（缓存）。无需认证。

### POST /stocks/quotes/batch

批量查询指定股票的行情。

```json
// Request
{ "codes": ["600519", "000001"] }
```

### GET /stocks/strategies

系统内置策略列表。

### GET /stocks/:code

个股详情。

### GET /stocks/:code/klines

K 线数据。

| 参数 | 类型 | 说明 |
|------|------|------|
| period | string | 周期：day/week/month |
| start | string | 开始日期 YYYY-MM-DD |
| end | string | 结束日期 YYYY-MM-DD |

### GET /stocks/:code/indicators

技术指标。

| 参数 | 类型 | 说明 |
|------|------|------|
| period | string | 周期：day/week/month |

### GET /stocks/:code/fundamental

基本面数据。

### GET /stocks/intl/:market/:code/klines

国际市场 K 线（US/HK）。

### GET /stocks/intl/:market/:code/indicators

国际市场指标（US/HK）。

---

## 回测

### POST /backtest

运行回测。无需认证。

```json
// Request
{ "code": "600519", "strategyId": 1, "startDate": "2024-01-01", "endDate": "2024-12-31", "initialCapital": 100000 }
```

### GET /backtest

最近 100 条回测记录。

### GET /backtest/history

回测历史（分页）。

| 参数 | 类型 | 说明 |
|------|------|------|
| limit | number | 数量限制 |

### GET /backtest/compare

对比多个回测。`?ids=1,2,3`

### GET /backtest/leaderboard

回测排行榜。`?limit=20`

### GET /backtest/strategies/results

各策略在所有股票上的回测结果（含推荐）。

### GET /backtest/strategies/results/:key

单个策略回测详情。

### POST /backtest/strategies/run

手动触发策略回测。

### POST /backtest/portfolio

买入持有回测。

### POST /backtest/portfolio-enhanced

RSI 增强版买入持有回测。

---

## 信号扫描

### POST /scan

扫描股票。无需认证。

```json
// Request
{ "codes?": ["600519"], "custom?": [{ "field": "rsi", "operator": "<", "value": 30 }], "page?": 1, "limit?": 20 }
```

### POST /scan/stream

流式扫描（Server-Sent Events）。

### POST /scan/save-klines

批量保存 K 线数据（管理用）。

---

## 自选股

需要 Bearer Token。

### GET /watchlist/groups

分组列表。

### POST /watchlist/groups

创建分组。`{ "name": "ETF", "color?": "#ff0000" }`

### PUT /watchlist/groups/:id

更新分组。

### DELETE /watchlist/groups/:id

删除分组。

### GET /watchlist

自选股列表。

### POST /watchlist

添加自选。`{ "code": "600519", "note?": "消费龙头", "groupId?": 1 }`

### PUT /watchlist/:id

更新自选备注/分组。

### DELETE /watchlist/:id

删除自选。

### POST /watchlist/batch

批量添加。`{ "codes": ["600519", "000001"], "groupId?": 1 }`

### DELETE /watchlist/batch

批量删除。`{ "codes": ["600519"] }`

---

## 选股筛选

### GET /screener/fields

可用筛选字段列表。

### POST /screener

按条件筛选。

```json
// Request
{ "conditions": [{ "field": "price", "operator": ">", "value": 10 }], "sort?": { "field": "change", "order": "desc" }, "page?": 1, "limit?": 20 }

// Response
{ "total": 100, "page": 1, "limit": 20, "stocks": [...] }
```

支持的 operator: `>`, `<`, `>=`, `<=`, `=`, `between`, `cross_above`, `cross_below`

---

## 指标排行

### GET /rankings

指标排行。

| 参数 | 类型 | 说明 |
|------|------|------|
| date | string | YYYY-MM-DD，默认最新 |
| board | string | all/main/star/gem |
| metric | string | rsi/change/volume/macd/bollinger/ma_bull/volatility/momentum |
| limit | number | 限制数量 |

### GET /rankings/strategies

策略评分排行。

| 参数 | 类型 | 说明 |
|------|------|------|
| date | string | YYYY-MM-DD |
| board | string | 板块 |
| strategy | string | 策略 key |
| limit | number | 限制数量 |

### GET /rankings/strategies/list

所有评分策略列表。

### GET /rankings/available-dates

可选的日期列表。

---

## 市场状态

### GET /market/indices

大盘指数实时行情（上证/深证/创业板/科创板）。

### GET /market/hot-sectors

热门板块排行。

### GET /market/state

AI 市场状态分析（Pro）。需要认证。

---

## 信号查询

### GET /signals

查询信号。

| 参数 | 类型 | 说明 |
|------|------|------|
| code | string | 股票代码 |
| strategyId | number | 策略 ID |
| direction | string | buy/sell |
| date | string | 日期 YYYY-MM-DD |
| limit | number | 限制数量 |

### GET /signals/stats

信号统计。`?strategyId=1&days=30`

### GET /signals/today

今日信号（按股票分组）。

---

## 持仓管理 (Pro)

需要 Bearer Token。

### GET /positions

持仓列表。

### POST /positions

新建持仓。

```json
{ "code": "600519", "name?": "贵州茅台", "quantity": 100, "entryPrice": 1500, "stopLoss?": 1400, "takeProfit?": 1800, "notes?": "" }
```

### PUT /positions/:id

更新持仓。

### DELETE /positions/:id

删除持仓。

### GET /positions/analysis

持仓分析（含 RSI、盈亏计算）。

### GET /positions/rebalance

AI 调仓建议。

---

## AI 预测 (Pro)

需要 Bearer Token（批量预测需 Premium 计划）。

### GET /ai/predict/today

今日预测列表。

### GET /ai/predict/code/:code

指定股票的预测。

### POST /ai/predict/run

运行单股预测。`{ "code": "600519", "daysAhead?": 5 }`

### POST /ai/predict/run-batch

批量运行预测。`{ "limit?": 50, "daysAhead?": 5 }`

### POST /ai/predict/evaluate

评估历史预测准确率。

### GET /ai/predict/stats

预测统计概览。

### GET /ai/predict/history

预测历史（分页）。

| 参数 | 类型 | 说明 |
|------|------|------|
| page | number | 页码 |
| limit | number | 每页数量 |
| code | string | 股票代码筛选 |
| dateFrom | string | 起始日期 |
| dateTo | string | 结束日期 |
| evaluated | boolean | 是否已评估 |

### GET /ai/predict/stats/daily

每日准确率（近 30 天）。

### POST /ai/predict/run-market

全市场批量预测（异步任务）。

### GET /ai/predict/jobs

运行中的批量任务列表。

### GET /ai/predict/jobs/:id

任务状态。

---

## 情绪分析 (Pro)

需要 Bearer Token。

### GET /ai/news/sentiment/:code

个股情绪分析。`GET /api/ai/news/sentiment/600519`

### GET /ai/news/weibo

微博热度排行（TOP 50）。

### GET /ai/news/wechat-heat

微信热度排行（TOP 50）。

---

## 推送设置 (Pro)

需要 Bearer Token。

### GET /push/settings

获取推送设置。

### PUT /push/settings

更新推送设置。

```json
{ "channels?": { "inApp": true, "serverChan": false }, "triggers?": { "signal": true, "dailyPick": true, "weeklyReport": true, "priceAlert": true, "positionAlert": true }, "serverChanKey?": "sct..." }
```

### GET /push/notifications

通知列表。`?limit=50`

### GET /push/notifications/:id

单条通知详情。

### GET /push/unread-count

未读通知数量。

### PUT /push/notifications/:id/read

标记已读。

### PUT /push/notifications/read-all

全部标记已读。

### POST /push/test

测试 ServerChan 推送。

---

## 价格告警 (Pro)

需要 Bearer Token。

### GET /alerts

告警列表。

### POST /alerts

创建告警。`{ "code": "600519", "name?": "茅台预警", "condition": "price_lte", "targetValue": "1400" }`

### DELETE /alerts/:id

删除告警。

### POST /alerts/:id/trigger

手动触发告警。

---

## 策略优化 (Pro)

需要 Bearer Token（运行优化需 Pro 计划）。

### GET /strategy/optimize

优化任务列表。

### POST /strategy/optimize

启动遗传算法优化。

```json
{ "strategyType": "ma_cross", "symbol": "600519", "startDate": "2024-01-01", "endDate": "2024-12-31", "paramRanges?": {}, "populationSize?": 50, "generations?": 20 }
```

### DELETE /strategy/optimize/:id

删除优化任务。

### POST /strategy/optimize/grid-search

网格参数搜索。

### POST /strategy/optimize/walk-forward

Walk-forward 分析。

### POST /strategy/optimize/compare-strategies

多策略对比。

### GET /strategy/optimize/parameter-ranges

参数预设范围。

---

## 其他 (Pro)

### GET /subscription/plans

付费计划列表。无需认证。

### GET /subscription/me

当前订阅信息。

### POST /subscription/create

创建支付订单。

### POST /subscription/cancel

取消订阅。

### GET /api-keys

API 密钥列表。需要 Premium 计划。

### POST /api-keys

创建 API 密钥。

### DELETE /api-keys/:id

删除 API 密钥。

### GET /my-strategies

自定义策略列表。

### POST /my-strategies

创建自定义策略。

### GET /ai/strategy/discover

AI 策略发现列表。

### POST /ai/strategy/discover

启动 AI 策略发现。

### GET /ai/positions/alerts

AI 持仓告警分析。

### GET /intraday/alerts

盘中异常告警。

---

## 健康检查

### GET /health

```json
// Response 200
{ "status": "ok", "service": "quant-trading", "uptime": 1234.56, "dependencies": { "postgres": true, "redis": true } }
```
