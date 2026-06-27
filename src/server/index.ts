import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import compression from 'compression'
import path from 'path'
import { fileURLToPath } from 'url'
import { registerPlugins } from './plugin.js'
import { corePlugin } from './plugins/core.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()

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

const distDir = path.resolve(__dirname, '../client')
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

// Evaluate predictions on startup (Pro only)
const today = new Date().toISOString().slice(0, 10)
try {
  const { evaluatePredictions } = await import('./ai/predict.js')
  evaluatePredictions(today).catch(() => {})
} catch { /* Predict module not available in OSS */ }

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() })
})

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err)
  res.status(500).json({ error: err.message || String(err) })
})

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' })
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.set('Pragma', 'no-cache')
  res.set('Expires', '0')
  res.sendFile(path.join(distDir, 'index.html'))
})

const PORT = Number(process.env.PORT) || 3001
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`)
})

export default app
