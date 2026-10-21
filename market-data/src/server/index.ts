import express from 'express'
import cors from 'cors'
import dataRouter from '../routes/data.js'

const app = express()
const PORT = Number(process.env.PORT) || 4003

app.use(cors({ origin: true }))
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'market-data', port: PORT }))
app.get('/metrics', (_req, res) => {
  const mem = process.memoryUsage()
  const cpu = process.cpuUsage()
  res.set('Content-Type', 'text/plain; version=0.0.4')
  res.end([
    `process_heap_bytes ${mem.heapUsed}`,
    `process_rss_bytes ${mem.rss}`,
    `process_cpu_user_seconds_total ${cpu.user / 1e6}`,
    `process_uptime_seconds ${process.uptime()}`,
  ].join('\n') + '\n')
})
app.use('/api/data', dataRouter)

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[market-data] running on http://0.0.0.0:${PORT}`)
  console.log(`[market-data] API: /api/data/{klines,minute,quotes,stocks}`)
})

export default app
