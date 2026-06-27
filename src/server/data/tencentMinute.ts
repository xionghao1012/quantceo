import type { MinuteKLine, MinutePeriod } from '../../shared/types.js'

const MKLINE_API = 'https://ifzq.gtimg.cn/appstock/app/kline/mkline'

function toExchange(code: string): string {
  if (code.startsWith('6') || code.startsWith('9')) return 'sh'
  if (code.startsWith('0') || code.startsWith('3')) return 'sz'
  return 'sh'
}

export async function fetchMinuteKlines(code: string, period: MinutePeriod, count = 640): Promise<MinuteKLine[]> {
  const exch = toExchange(code)
  const symbol = `${exch}${code}`
  const url = `${MKLINE_API}?param=${symbol},${period},,${count}`

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.qq.com/' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)

  const json = await res.json()
  if (json.code !== 0) throw new Error(`API error: ${json.msg}`)

  const rows = json.data?.[symbol]?.[period]
  if (!rows?.length) throw new Error(`No minute data for ${code} ${period}`)

  return rows.map((row: any) => {
    const dtStr = String(row[0])
    const year = dtStr.slice(0, 4)
    const month = dtStr.slice(4, 6)
    const day = dtStr.slice(6, 8)
    const hour = dtStr.slice(8, 10)
    const min = dtStr.slice(10, 12)
    return {
      code,
      datetime: `${year}-${month}-${day}T${hour}:${min}:00`,
      period,
      open: Number(row[1]),
      close: Number(row[2]),
      high: Number(row[3]),
      low: Number(row[4]),
      volume: Math.round(Number(row[5]) * 100),
      amount: Number(row[7]) * 10000,
    }
  })
}
