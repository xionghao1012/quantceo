import { Router } from 'express'
import { getMarketState } from '../ai/marketState.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

const INDICES = [
  { code: 'sh000001', name: '上证指数', shortName: '上证' },
  { code: 'sz399001', name: '深证成指', shortName: '深证' },
  { code: 'sz399006', name: '创业板指', shortName: '创业板' },
  { code: 'sh000300', name: '沪深300', shortName: '沪深300' },
  { code: 'sh000688', name: '科创50', shortName: '科创50' },
]

let cachedState: ReturnType<typeof getMarketState> | null = null
let cacheTime = 0
const CACHE_TTL = 5 * 60 * 1000

router.get('/state', requireAuth, async (req, res) => {
  try {
    const now = Date.now()
    if (cachedState && now - cacheTime < CACHE_TTL) {
      return res.json(await cachedState)
    }

    const index = (req.query.index as string) || '000300'
    cachedState = getMarketState(index)
    cacheTime = now
    const result = await cachedState
    res.json(result)
  } catch (e: any) {
    console.error('Market state error:', e)
    res.status(500).json({ error: e.message || '获取市场状态失败' })
  }
})

router.get('/indices', async (_req, res) => {
  try {
    // Fetch simplified (for prices) + full format for sh000001 (to get date)
    const codes = INDICES.map(i => `s_${i.code}`).join(',')
    const url = `http://qt.gtimg.cn/q=${codes},sh000001`
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    const text = await resp.text()
    const lines = text.split('\n').filter(Boolean)

    // Extract market date from full format sh000001
    const fullLine = lines.find(l => l.startsWith('v_sh000001'))
    let marketDate = ''
    if (fullLine) {
      const parts = fullLine.split('~')
      // Field ~30: "20260618161419" (YYYYMMDDHHMMSS)
      const ts = parts[30]
      if (ts && ts.length >= 8) {
        marketDate = `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)}`
      }
    }

    const result = INDICES.map((idx) => {
      const line = lines.find(l => l.startsWith(`v_s_${idx.code}`))
      if (!line) return null
      const parts = line.split('~')
      return {
        code: idx.code,
        name: idx.name,
        shortName: idx.shortName,
        price: parseFloat(parts[3]) || 0,
        change: parseFloat(parts[4]) || 0,
        changePct: parseFloat(parts[5]) || 0,
        volume: parts[6] || '0',
        turnover: parts[9] || '0',
      }
    }).filter(Boolean)

    res.json({ indices: result, marketDate, updatedAt: new Date().toISOString() })
  } catch (e: any) {
    console.error('Indices error:', e)
    res.status(500).json({ error: e.message || '获取指数数据失败' })
  }
})

router.get('/hot-sectors', async (_req, res) => {
  try {
    const url = 'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=8&np=1&fltt=2&invt=2&fs=m:90+t:2&fields=f12,f14,f3,f62,f184,f66,f70&fid=f3&po=1'
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://quote.eastmoney.com/',
      },
    })
    const text = await resp.text()
    // EastMoney returns JSONP-style response
    const jsonStr = text.replace(/^.*?\(/, '').replace(/\);?\s*$/, '')
    const json = JSON.parse(jsonStr)
    const list = json?.data?.diff || []
    const sectors = list.slice(0, 8).map((item: any) => ({
      code: item.f12,
      name: item.f14,
      changePct: item.f3,
      mainForceInflow: item.f62,
      leaderCode: item.f184,
      leaderName: item.f66,
      leaderChange: item.f70,
    }))
    res.json({ sectors, updatedAt: new Date().toISOString() })
  } catch (e: any) {
    console.error('Hot sectors error:', e)
    res.status(200).json({ sectors: [], updatedAt: new Date().toISOString() })
  }
})

export default router
