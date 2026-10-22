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
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || true,
  credentials: true,
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
