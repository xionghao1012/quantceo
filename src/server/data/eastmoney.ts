import type { KLine } from '../../shared/types.js'
import { fetchSohuKlines } from './sohu.js'

const GTIMG_API = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'

function toExchange(code: string): string {
  if (code.startsWith('6') || code.startsWith('9')) return 'sh'
  if (code.startsWith('0') || code.startsWith('3')) return 'sz'
  return 'sh'
}

export async function fetchKlines(code: string): Promise<KLine[]> {
  // Try Sohu first for full history (25+ years)
  try {
    const sohuData = await fetchSohuKlines(code)
    if (sohuData.length > 0) return sohuData
  } catch {}

  // Fallback to Tencent qfq data (2.5 years)
  const exch = toExchange(code)
  const url = `${GTIMG_API}?param=${exch}${code},day,,,1000,qfq`

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.qq.com/' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)

  const json = await res.json()
  if (json.code !== 0) throw new Error(`API error: ${json.msg}`)

  const key = `${exch}${code}`
  const rows = json.data?.[key]?.qfqday
  if (!rows?.length) throw new Error(`No K-line data for ${code}`)

  return rows.map((row: any) => ({
    code,
    date: row[0],
    open: Number(row[1]),
    close: Number(row[2]),
    high: Number(row[3]),
    low: Number(row[4]),
    volume: Number(row[5]),
    amount: Number(row[6]) || 0,
  }))
}
