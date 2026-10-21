# Scheduler 定时任务链说明

## 一、功能概述

Scheduler 是独立的定时任务调度微服务，通过 HTTP 调用触发各微服务的定时任务，协调全系统每日任务流程。

**服务端口**: 3001
**健康检查**: `GET /health`

---

## 二、每日任务时间表

| 时间 | 任务 | 调用服务 | API 端点 |
|------|------|---------|---------|
| **08:00** | AI 每日精选生成 | quant-ai | `/api/ai/predictions/trigger-daily-picks` |
| **08:30** | 仓位预警分析 | quant-trading | `/api/internal/position-alerts` |
| **09:25** | 推送 AI 预测摘要 | quant-ai | `/api/ai/predictions/run-market` (count=20) |
| **15:30** | 计算每日指标 | quant-trading | `/api/internal/compute-metrics` |
| **15:32** | 评估 AI 历史预测 | quant-ai | `/api/ai/predictions/evaluate` |
| **15:33** | 评估每日精选表现 | quant-ai | `/api/ai/predictions/evaluate-picks` |
| **15:35** | AI 预测生成 | quant-ai | `/api/ai/predictions/run-market` (count=50, concurrency=3, daysAhead=1) |
| **15:35** | 策略回测 | backtest-engine | `/api/internal/strategy-backtest` |
| **18:00** | 刷新日 K 线数据 | market-data | `/api/data/klines/refresh-all` |
| **18:30** | 全市场信号扫描 | scan-engine | `/api/scan/market` |
| **周五 18:05** | 周报扫描 | scan-engine | `/api/scan/market` |

---

## 三、任务依赖关系图

```
┌──────────────────────────────────────────────────────────────────┐
│                        每日任务依赖链                             │
└──────────────────────────────────────────────────────────────────┘

08:00 AI精选生成 ─────────────────────────────────────────────────┐
    │                                                               │
    ▼                                                               │
09:25 推送预测摘要（Top 20）                                        │
                                                                       │
═══════════════════════════════════════════════════════════════════│
                                                                       │
15:30 指标计算 ────────────────────────┐                            │
    │                                  │                            │
    ▼                                  ▼                            │
15:32 AI预测评估 ←──────────────┐   15:35 策略回测                   │
    │                          │       │                            │
    ▼                          │       │                            │
15:33 精选效果评估              │       │                            │
    │                          │       │                            │
    ▼                          │       │                            │
15:35 AI预测生成 ←──────────────┘       │                            │
                                          │                            │
═══════════════════════════════════════════════════════════════════│

18:00 K线刷新 ───────────────────────────┐
    │                                     │
    ▼                                     ▼
18:30 全市场信号扫描              推送信号通知
```

**关键依赖规则**:
- `15:30` 指标计算必须先于 `15:32/15:33/15:35` 执行
- `18:00` K 线更新必须先于 `18:30` 信号扫描

---

## 四、关键任务详解

### 4.1 08:00 AI 每日精选生成

```
输入: 历史 K 线数据、情绪数据、指标数据
处理: AI 模型分析候选股票，生成 Top 10 推荐
输出: 每日精选列表（含推荐理由）
```

### 4.2 09:25 AI 预测推送

```
处理: 选取成交量 Top 20 股票，生成预测摘要
推送: App 推送 + 微信 ServerChan（已配置时）
内容: 股票名、方向、置信度、目标价、止损价
```

### 4.3 15:30 每日指标计算

```
输入: 全市场股票列表
处理: 分批（每批 50 只）计算 8 大技术指标
输出: daily_metrics 表
依赖: 18:00 K 线刷新完成
```

### 4.4 15:35 AI 预测生成

```
参数: count=50, concurrency=3, daysAhead=1
处理: 并发生成 50 只股票预测
输出: ai_predictions 表
依赖: 15:30 指标计算完成
```

### 4.5 18:30 全市场信号扫描

```
处理: Worker 线程池并行扫描全市场
策略: 10 种内置技术指标策略
输出: 信号结果，推送通知
依赖: 18:00 K 线刷新完成
```

---

## 五、Catch-up 机制

### 5.1 补跑逻辑

Scheduler 启动时自动检测错过的任务日期并进行补跑：

```typescript
async function runWithCatchUp(
  taskName: string,
  fn: (execDate: string) => Promise<number>,
  maxCatchUpDays = 10,
)
```

**规则**:
- 最多补跑 10 天（信号扫描 30 天）
- 仅补跑工作日（周一至周五）
- 补跑结果记录到 `scheduler_log` 表

### 5.2 补跑限制

| 任务 | 最大补跑天数 |
|------|-------------|
| 大部分任务 | 10 天 |
| 信号扫描 | 30 天 |

---

## 六、任务日志

### 6.1 日志表结构 (scheduler_log)

| 字段 | 类型 | 说明 |
|------|------|------|
| `taskName` | varchar | 任务名称 |
| `execDate` | date | 执行日期 |
| `status` | varchar | 状态（running/success/failed） |
| `itemsProcessed` | integer | 处理数量 |
| `errorMessage` | text | 错误信息 |
| `startedAt` | timestamp | 开始时间 |
| `completedAt` | timestamp | 完成时间 |

### 6.2 日志输出格式

```
[Scheduler] 15:30 指标计算: catching up 0 missed days
[Scheduler] 15:30 指标计算 (2026-07-22) done: 5307
[Scheduler] 15:35 AI预测生成 (2026-07-22) failed: Request timeout
[Scheduler] Catch-up check complete
```

---

## 七、监控方式

| 方式 | 说明 |
|------|------|
| `/health` 端点 | 返回 `{ status: 'ok', service: 'scheduler', uptime, cronJobs: 11 }` |
| `scheduler_log` 表 | 查询任务执行状态和错误信息 |
| 控制台日志 | 实时查看任务开始/完成/失败 |

---

## 八、相关代码文件

| 文件路径 | 说明 |
|---------|------|
| `scheduler/src/index.ts` | 独立调度微服务 |
| `quant-trading/src/server/services/scheduler.ts` | quant-trading 内置调度器 |
| `quant-ai/src/scheduler.ts` | AI 任务调度器 |
| `quant-trading/src/server/db/schema.ts` | `scheduler_log` 表定义 |
