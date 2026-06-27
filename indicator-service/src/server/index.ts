import express from 'express'
import cors from 'cors'
import calcRouter from '../routes/calc.js'

const app = express()
const PORT = Number(process.env.PORT) || 4005

app.use(cors({ origin: true }))
app.use(express.json({ limit: '2mb' }))

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'indicator-service', port: PORT }))
app.use('/api/indicators', calcRouter)

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[indicator-service] running on port ${PORT}`)
})

export default app
