// 业务时间一律按北京时间：cron 写的 9-15 点是 A 股交易时段、18:30 是收盘后扫描。
// 容器默认 UTC 会让整套定时任务整体晚 8 小时（盘中告警跑到收盘后，日数据跑到次日凌晨）。
// 必须在任何 Date 调用之前设置。
process.env.TZ = process.env.TZ || 'Asia/Shanghai'

import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import compression from 'compression'
import http from 'http'
import path from 'path'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { registerPlugins, asyncRouter } from './plugin.js'
import { corePlugin } from './plugins/core.js'
import { metricsMiddleware, createMetricsRouter } from './middleware/metrics.js'
import { initWebSocket } from './services/wsServer.js'
import { AppError } from './middleware/errors.js'
import { pool } from './db/db.js'
import { redis } from './data/redis.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVICE_NAME = 'quant-trading'

const app = express()

app.set('trust proxy', 1)

app.use(metricsMiddleware(SERVICE_NAME))

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}))
// CORS 之前是 `origin: ... || true`（反射任意源）+ credentials: true。
// CSO finding ee6292e7：没配 ALLOWED_ORIGINS 时任何站点都能读响应。
// 现在 fail closed：只放行显式配置的源；不用 cookie 会话，所以关掉 credentials。
const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : false,
  credentials: false,
}))
app.use(compression({ threshold: 1024 }))

app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ limit: '1mb', extended: true }))

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
})
app.use('/api/', limiter)

const distDir = path.resolve(__dirname, '../../dist/client')
app.use(express.static(distDir, { index: false, maxAge: '1y', immutable: true }))

// 收款码图片：只暴露 data/payment-qr 这一个目录（不进 Git、不进开源仓）。
// 用户把 微信/支付宝 的收款码截图丢进去，env 里配成 /payment-qr/xxx.png 即可。
// 注意路径：编译后 __dirname 是 dist/server，源文件在 ../../src/server/data；
// dev 下 tsx 直接跑 src/server，同样两个 .. 回到项目根 —— 两边都成立。
const QR_DIR = process.env.PAYMENT_QR_DIR || path.join(__dirname, '../../src/server/data/payment-qr')
app.use('/payment-qr', express.static(QR_DIR, { maxAge: '10m' }))
// 图片缺失要 404，不要掉进 SPA 兜底返回 HTML（那样排查时只会看到一张破图）
app.use('/payment-qr', (_req, res) => { res.status(404).end() })

// API routes via plugins
const plugins = [corePlugin]

if (process.env.LICENSE_KEY) {
  try {
    const { proPlugin } = await import('./plugins/pro.js')
    plugins.push(proPlugin)
    console.log('[Pro] Pro features enabled')
  } catch {
    console.log('[Pro] Pro plugin not available in OSS build')
  }
} else {
  console.log('[Pro] Pro features disabled (set LICENSE_KEY to enable)')
}

registerPlugins(app, plugins)

// Start scheduler (intraday jobs only when centralized scheduler exists)
const { startScheduler } = await import('./services/scheduler.js')
startScheduler()

// Start money flow real-time feed
const { startRealtime } = await import('./services/moneyFlowService.js')
try {
  startRealtime()
} catch (e: any) {
  console.warn('[MoneyFlow] Failed to start real-time feed:', e.message)
}

// Start money flow alert engine
const { startAlertEngine } = await import('./services/moneyFlowAlertEngine.js')
try {
  startAlertEngine()
} catch (e: any) {
  console.warn('[MoneyFlowAlert] Failed to start alert engine:', e.message)
}

// Start composite signal alert engine
const { startCompositeAlertEngine } = await import('./services/compositeAlertEngine.js')
try {
  startCompositeAlertEngine()
} catch (e: any) {
  console.warn('[CompositeAlert] Failed to start:', e.message)
}

// 预热筛选快照：首次现算约 6-9 秒（全市场 5300 只 × 近 180 天 K 线）。
// 启动时自请求一次，让第一个真实用户不用等这段冷启动。
setTimeout(() => {
  fetch(`http://127.0.0.1:${process.env.PORT || 4001}/api/screener`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conditions: [{ field: 'price', operator: '>', value: 0 }] }),
  }).catch(() => {})
}, 5000)

// Evaluate predictions on startup (Pro only)
const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
try {
  const { evaluatePredictions } = await import('./ai/predict.js')
  evaluatePredictions(today).catch(() => {})
} catch { /* Predict module not available in OSS */ }

// 每次构建写入的标识（deploy-prod.sh 写），用来确认线上跑的是哪次构建
function readBuildId(): string {
  try {
    return readFileSync(path.join(__dirname, '..', 'BUILD_ID'), 'utf-8').trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

app.get('/api/health', async (_req, res) => {
  let pgOk = false, redisOk = false
  try {
    await pool.query('SELECT 1')
    pgOk = true
  } catch {}
  try {
    await redis.ping()
    redisOk = true
  } catch {}
  res.json({
    status: pgOk && redisOk ? 'ok' : 'degraded',
    service: SERVICE_NAME,
    uptime: process.uptime(),
    buildId: readBuildId(),
    dependencies: { postgres: pgOk, redis: redisOk },
    license: process.env.LICENSE_KEY ? 'pro' : 'free',
  })
})

app.use('/metrics', asyncRouter(createMetricsRouter()))

app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err)
  const statusCode = err instanceof AppError ? err.statusCode : 500
  const code = err instanceof AppError ? err.code : 'INTERNAL_ERROR'
  const message = err instanceof AppError ? err.message : '服务器内部错误'
  if (statusCode >= 500) {
    console.error(`[ERROR] ${err.stack || err.message || err}`)
  }
  res.status(statusCode).json({ error: message, code })
})

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' })
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.set('Pragma', 'no-cache')
  res.set('Expires', '0')
  res.sendFile(path.join(distDir, 'index.html'))
})

const PORT = Number(process.env.PORT) || 3001
const server = http.createServer(app)
initWebSocket(server)
// 上一个进程刚退出时端口可能还没释放（TIME_WAIT / 旧进程还没退干净），
// 直接 listen 会 EADDRINUSE 撞死，白白等一次重启
let listenRetries = 0
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE' && listenRetries < 10) {
    listenRetries++
    console.warn(`[server] 端口 ${PORT} 被占用，1.5 秒后重试（第 ${listenRetries} 次）`)
    setTimeout(() => server.listen(PORT, '0.0.0.0'), 1500)
    return
  }
  console.error('[server] listen error:', err)
  process.exit(1)
})
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`)
})

// 兜底：请求路径里的 rejection 已经被 asyncRouter 转给错误中间件（返回 500），
// 但后台任务（调度器 / SSE / 定时器）里的 rejection 仍会变成 unhandledRejection，
// Node 24 默认直接退出进程——生产是单进程部署，那等于一次全站宕机。
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandled rejection:', reason)
})
// 未捕获异常后进程状态不可信，退出让 docker（restart=always）或开发守护脚本拉起
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaught exception:', err)
  process.exit(1)
})

export default app
