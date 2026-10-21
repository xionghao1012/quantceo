import dns from 'node:dns'

// 东财行情接口对 IPv6 不友好：Node 默认优先 IPv6 时连接会被对端 reset
// （UND_ERR_SOCKET）。改成 IPv4 优先，autoSelectFamily 仍会在 IPv4 不通时回落。
dns.setDefaultResultOrder('ipv4first')

import type { KLine } from '../../shared/types.js'
import { fetchSohuKlines } from './sohu.js'

const GTIMG_API = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'
const EASTMONEY_KLINE_API = 'https://push2his.eastmoney.com/api/qt/stock/kline/get'

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

function toSecid(code: string): string {
  if (code.startsWith('6') || code.startsWith('9')) return `1.${code}`
  if (code.startsWith('0') || code.startsWith('3')) return `0.${code}`
  return `1.${code}`
}

/**
 * 东财日线，支持全历史 + 复权（fqt: 0=不复权 1=前复权 2=后复权）。
 * 腾讯的 qfq 接口只给最近 1000 根，长区间回测必须用这个。
 */
export async function fetchEastmoneyKlines(code: string, fqt: 0 | 1 | 2 = 1): Promise<KLine[]> {
  const url = `${EASTMONEY_KLINE_API}?secid=${toSecid(code)}&klt=101&fqt=${fqt}`
    + '&beg=19900101&end=20500101&lmt=100000&fields1=f1&fields2=f51,f52,f53,f54,f55,f56,f57'

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://quote.eastmoney.com/' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)

  const json = await res.json()
  const rows = json?.data?.klines as string[] | undefined
  if (!rows?.length) return []

  // f51 日期, f52 开, f53 收, f54 高, f55 低, f56 量, f57 额
  return rows.map((line) => {
    const [date, open, close, high, low, volume, amount] = line.split(',')
    return {
      code,
      date,
      open: Number(open),
      close: Number(close),
      high: Number(high),
      low: Number(low),
      volume: Number(volume),
      amount: Number(amount) || 0,
    }
  })
}

/**
 * 回测用复权序列。
 *
 * 东财的 fqt=1（前复权）对现金分红是**减法**复权：比例关系会被破坏，
 * 长期高分红股甚至会出负价（茅台 2001 年 -312），不能用来算收益率。
 * 所以用 fqt=2（后复权）保证收益率正确，再按「末日收盘价」缩放回今天的真实价位，
 * 等价于乘法前复权：收益率不变，价格量级和用户看到的一致。
 */
export async function fetchAdjustedKlines(code: string): Promise<KLine[]> {
  // 顺序请求：并发打同一主机时东财会偶发 reset（UND_ERR_SOCKET）
  const hfq = await fetchEastmoneyKlines(code, 2)
  const raw = await fetchEastmoneyKlines(code, 0)
  if (hfq.length === 0 || hfq.length !== raw.length) {
    throw new Error(`Adjusted kline series mismatch for ${code}`)
  }

  const last = hfq.length - 1
  const hfqLast = hfq[last].close
  const rawLast = raw[last].close
  if (!(hfqLast > 0) || !(rawLast > 0)) throw new Error(`Invalid last close for ${code}`)

  const factor = rawLast / hfqLast
  return hfq.map(k => ({
    ...k,
    open: k.open * factor,
    close: k.close * factor,
    high: k.high * factor,
    low: k.low * factor,
  }))
}
