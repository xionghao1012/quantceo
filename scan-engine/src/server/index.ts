import express from 'express'
import cors from 'cors'
import scanRouter from '../routes/scan.js'

const app = express()
const PORT = Number(process.env.PORT) || 4004

app.use(cors({ origin: true }))
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'scan-engine', port: PORT }))
app.get('/metrics', (_req, res) => {
  const mem = process.memoryUsage()
  res.set('Content-Type', 'text/plain; version=0.0.4')
  res.end([
    `process_heap_bytes ${mem.heapUsed}`,
    `process_rss_bytes ${mem.rss}`,
    `process_uptime_seconds ${process.uptime()}`,
  ].join('\n') + '\n')
})
app.use('/api/scan', scanRouter)

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[scan-engine] running on http://0.0.0.0:${PORT}`)
})

export default app
