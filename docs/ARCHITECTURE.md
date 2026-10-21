# QuantCEO 架构文档

## 一、系统架构总览

```
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│   Browser     │     │   WeChat      │     │  External API │
│  Vue 3 SPA    │     │  (ServerChan) │     │  搜狐/腾讯    │
└──────┬────────┘     └──────┬────────┘     └──────┬────────┘
       │ HTTP/JSON          │ HTTP               │ HTTP
       ▼                    │                    │
┌──────────────────────────────────────────────────────────┐
│              Express Server (Port 3001/4001)              │
│                                                          │
│  ┌─────────┐  ┌──────────┐  ┌────────┐  ┌───────────┐  │
│  │  OSS    │  │  Pro     │  │ Auth   │  │ Scheduler │  │
│  │ Routes  │◄─│ Plugin   │  │ MW     │  │ (cron)    │  │
│  └────┬────┘  └────┬─────┘  └────────┘  └─────┬─────┘  │
│       │            │                          │         │
│  ┌────▼────────────▼──────────────────────────▼──────┐  │
│  │              Services Layer                        │  │
│  │  cache.ts  indicators/  backtest/  scan/  ai/     │  │
│  │  push/     workers/     engine/                   │  │
│  └────┬────────────┬──────────────────────────▲──────┘  │
│       │            │                          │         │
│       ▼            ▼                          ▼         │
│  ┌──────────┐ ┌──────────┐            ┌──────────────┐ │
│  │PostgreSQL│ │  Redis   │            │  Python CLI  │ │
│  │quant_ceo │ │ (cache)  │            │  akshare     │ │
│  └──────────┘ └──────────┘            │  weibo/news  │ │
│                                       └──────────────┘ │
└──────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────┴────────────────────────────────┐
│                quant-sso (Port 3002)                     │
│  独立认证服务：登录 / 注册 / JWT 签发 / 用户管理          │
│  数据库：quant_sso                                       │
└──────────────────────────────────────────────────────────┘
```

## 二、分层设计

### 2.1 前端层 (`src/client/`)

| 模块 | 技术 | 说明 |
|------|------|------|
| 路由 | Vue Router | 懒加载页面组件，动态添加 Pro 路由 |
| 状态管理 | Pinia | auth store 管理登录态 |
| HTTP | fetch | 原生 fetch + authHeaders |
| 图表 | ECharts | K 线、权益曲线、指标可视化 |
| UI | Scoped CSS | 暗色主题，CSS 变量驱动 |

路由权限模型：
- **OSS 公共路由**：登陆后可访问所有 OSS 页面
- **Pro 受保护路由**：需要 `LICENSE_KEY` 或付费计划

### 2.2 API 层 (`src/server/routes/`)

30 个路由文件，约 130 个端点。路由通过 `registerPlugins()`（`src/server/plugin.ts`）注册。核心路由在 `plugins/core.ts` 中注册，Pro 路由在 `plugins/pro.ts` 中动态加载。大多数 OSS 路由接受 `requireAuth` 中间件认证（部分公开路由如 auth/login、health 除外）。

### 2.3 服务层 (`src/server/services/`)

- **scheduler.ts**：基于 `node-cron` 的定时任务调度中心
- **push/**：多通道通知分发（站内 + 微信 ServerChan）
- **auth.ts**：密码哈希（bcrypt）+ JWT 签发/验证
- **subscription.ts**：付费计划管理 + 支付对接

### 2.4 计算引擎层

| 模块 | 路径 | 说明 |
|------|------|------|
| 技术指标 | `src/server/indicators/` | MA, MACD, RSI, Bollinger |
| 规则引擎 | `src/server/engine/` | ruleEngine（规则解析）, optimizer（遗传算法） |
| 回测引擎 | `src/server/backtest/` | 规则解析→信号生成→交易执行→统计输出 |
| 信号扫描 | `src/server/scan/` | 顺序扫描，for...of 遍历股票 |
| AI 推理 | `src/server/ai/` | 13 个模块：预测、情绪分析、每日精选、持仓预警、盘中异动、策略发现等 |

### 2.5 数据层

| 数据库 | 用途 | 核心表 |
|--------|------|--------|
| `quant_ceo` | 主业务数据 | stocks, klines, signals, daily_metrics, positions, push_settings, notifications, strategies, backtest_runs, predictions |
| `quant_sso` | 认证数据 | users, sessions |
| Redis | K 线缓存 | — |

## 三、OSS/Pro 双轨架构

使用**单仓库双轨分发**策略。所有文件同属一个仓库，通过 `LICENSE_KEY` 环境变量区分模式。

### 插件系统

```
registerPlugins(app, plugins)
  ├── plugins/index.ts → 遍历 plugins 数组调用 register()
  └── plugins/pro.ts → if (LICENSE_KEY) 注册 Pro 路由/功能
```

在 OSS 模式下，Pro 路由文件源码存在但不会被加载到 Express 中。

### 发布流程

`publish-oss.sh` 脚本：
1. 克隆当前仓库
2. 删除 Pro 相关文件（依据 `pro-manifest.json`）
3. 替换 Pro 路由为 stub
4. 清理 LICENSE_KEY 引用
5. 生成纯 OSS 代码到目标目录

## 四、关键设计决策

| 决策 | 方案 | 理由 |
|------|------|------|
| OSS/Pro 隔离 | 单仓库 + License 环境变量 | 避免两份代码同步成本 |
| 认证 | 独立 SSO 服务 | 分离关注点，支持多服务统一认证 |
| ORM | Drizzle | 类型安全，性能优于 Prisma |
| 数据库 | 直连 PostgreSQL | 简化部署，无需 ORM 连接池 |
| 定时任务 | node-cron（进程内） | 单实例部署无需外部调度器 |
| 并行计算 | Worker 线程 | 避免 Python GIL 限制 |
| LLM 接口 | MiniMax API（OpenAI 兼容） | 国内可直连，无需代理 |
| 数据源 | 搜狐/腾讯免费 API | 零成本，无需 API Key |

## 五、数据流关键路径

### 每日收盘后流水线

```
15:00 收盘
   ↓
15:30 计算每日指标 (RSI/MACD/布林等) → daily_metrics 表
   ↓
15:32 评估昨日 AI 预测 → 更新 ai_predictions 表
   ↓
15:33 评估每日精选表现 → 更新 recTracking 表
   ↓
15:35 策略回测 → strategy_backtest_runs 表
   ↓
15:35 AI 批量预测 → ai_predictions 表
   ↓
18:00 更新日 K 线数据 → klines 表
   ↓
18:30 全市场信号扫描 → signals 表 → 推送通知
```

### 用户操作链路（情绪分析示例）

```
用户点击 "情绪指标"
   ↓
GET /api/ai/news/sentiment/600519
   ↓
analyzeNewsSentiment("600519", "贵州茅台")
   ├── fetchNews("600519")           → Python akshare 新闻
   ├── getWeiboSentiment("600519")   → Python akshare 微博热度
   ├── getWechatHeat("600519")       → 基于伪随机模拟（无公开 API）
   └── LLM 综合分析 / 规则降级       → 返回 {score, label, reasoning, items}
```

## 六、微服务架构

| 服务 | 端口 | 技术栈 | 职责 |
|------|------|--------|------|
| quant-trading | 4001 | Express + Vue 3 | 主应用（前端 + API, 含行情/回测/扫描/指标/引擎） |
| quant-sso | 3002 | Express | 独立认证服务 |
| quant-ai | 4002 | Express | AI 预测服务 |
| market-data | 4003 | Express | 行情数据服务（独立部署时） |
| scan-engine | 4004 | Express | 信号扫描服务（独立部署时） |
| indicator-service | 4005 | Express | 技术指标服务（独立部署时） |
| scheduler | — | Express | 定时任务调度（独立部署时） |
| backtest-engine | 4006 | FastAPI (Python) | 回测引擎（独立部署时） |
| nginx | 80 | Nginx | 反向代理（独立部署时） |

> 默认 Docker Compose 仅启动 quant-trading / quant-sso / quant-ai 三个核心服务。其余微服务可按需独立部署。
