import { Router } from 'express'
import { getKlines, getKlinesBulk, getQuotes, getStockList, getMinuteKlines, refreshKline } from '../kline.js'

const router = Router()

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'market-data' })
})

router.get('/klines/:code', async (req, res) => {
  try {
    const code = String(req.params.code)
    const days = Math.min(500, Math.max(1, Number(req.query.days) || 90))
    const data = await getKlines(code, days)
    res.json({ code, count: data.length, klines: data })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/klines/bulk', async (req, res) => {
  try {
    const { codes, days = 90 } = req.body
    if (!Array.isArray(codes) || !codes.length) {
      return res.status(400).json({ error: 'codes array required' })
    }
    const data = await getKlinesBulk(codes, days)
    res.json({ count: Object.keys(data).length, klines: data })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/klines/:code/refresh', async (req, res) => {
  try {
    const code = String(req.params.code)
    const result = await refreshKline(code)
    res.json({ code, ...result })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/minute/:code', async (req, res) => {
  try {
    const code = String(req.params.code)
    const period = String(req.query.period || 'm5')
    const data = await getMinuteKlines(code, period)
    res.json({ code, period, count: data.length, klines: data })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/quotes', async (req, res) => {
  try {
    const codes = req.query.codes ? String(req.query.codes).split(',') : undefined
    const data = await getQuotes(codes)
    res.json({ count: data.length, quotes: data })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/stocks', async (_req, res) => {
  try {
    const data = await getStockList()
    res.json({ count: data.length, stocks: data })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default router
