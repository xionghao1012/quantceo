import { Router } from 'express'
import { computeDailyMetrics } from '../services/scheduler.js'

const router = Router()

// Called by scheduler service — no auth (internal only)

router.post('/compute-metrics', async (_req, res) => {
  try {
    await computeDailyMetrics()
    res.json({ success: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default router
