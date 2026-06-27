import { Router } from 'express'
import { calcMA, calcEMA, calcMACD, calcRSI, calcBollinger, calcATR, calcAll } from '../indicators.js'

const router = Router()

router.get('/health', (_req, res) => res.json({ status: 'ok', service: 'indicator-service' }))

router.post('/calc', async (req, res) => {
  try {
    const { klines, indicators } = req.body
    if (!Array.isArray(klines) || !klines.length) return res.status(400).json({ error: 'klines array required' })

    // If no specific indicators requested, compute all
    if (!indicators) {
      const result = calcAll(klines)
      // Return last values for convenience
      const last = {
        ma5: result.ma5.at(-1), ma10: result.ma10.at(-1), ma20: result.ma20.at(-1), ma60: result.ma60.at(-1),
        macd: result.macd.macd.at(-1), macdSignal: result.macd.signal.at(-1), macdHist: result.macd.histogram.at(-1),
        rsi: result.rsi.at(-1),
        bollUpper: result.bollinger.upper.at(-1), bollMiddle: result.bollinger.middle.at(-1), bollLower: result.bollinger.lower.at(-1),
        atr: result.atr.at(-1),
        full: result,
      }
      return res.json(last)
    }

    // Compute only requested indicators
    const result: any = {}
    for (const ind of indicators) {
      switch (ind) {
        case 'ma5': result.ma5 = calcMA(klines, 5); break
        case 'ma10': result.ma10 = calcMA(klines, 10); break
        case 'ma20': result.ma20 = calcMA(klines, 20); break
        case 'ma60': result.ma60 = calcMA(klines, 60); break
        case 'macd': result.macd = calcMACD(klines); break
        case 'rsi': result.rsi = calcRSI(klines); break
        case 'bollinger': result.bollinger = calcBollinger(klines); break
        case 'atr': result.atr = calcATR(klines); break
      }
    }
    res.json(result)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export default router
