import type { KLine } from '../../shared/types.js'

export async function fetchUSKlines(symbol: string): Promise<KLine[]> {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5y`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result) throw new Error('No data')

  const timestamps = result.timestamp as number[]
  const quotes = result.indicators?.quote?.[0]
  if (!timestamps?.length || !quotes) throw new Error('No quotes')

  return timestamps.map((ts, i) => ({
    code: symbol,
    date: new Date(ts * 1000).toISOString().slice(0, 10),
    open: quotes.open?.[i] ?? 0,
    close: quotes.close?.[i] ?? 0,
    high: quotes.high?.[i] ?? 0,
    low: quotes.low?.[i] ?? 0,
    volume: quotes.volume?.[i] ?? 0,
    amount: 0,
  }))
}

export async function fetchHKKlines(code: string): Promise<KLine[]> {
  const numCode = code.replace('hk', '').replace('HK', '')
  const res = await fetch(
    `https://web.ifzq.gtimg.cn/appstock/app/hkline/get?param=hk${numCode},day,,,1000,qfq`,
    { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.qq.com/' } }
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const rows = json?.data?.[`hk${numCode}`]?.qfqday
  if (!rows?.length) throw new Error('No HK kline data')

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