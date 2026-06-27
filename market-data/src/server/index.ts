import express from 'express'
import cors from 'cors'
import dataRouter from '../routes/data.js'

const app = express()
const PORT = Number(process.env.PORT) || 4003

app.use(cors({ origin: true }))
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'market-data', port: PORT }))
app.use('/api/data', dataRouter)

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[market-data] running on http://0.0.0.0:${PORT}`)
  console.log(`[market-data] API: /api/data/{klines,minute,quotes,stocks}`)
})

export default app
