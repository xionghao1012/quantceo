import type { KLine } from '../../shared/types.js'
import { execSync } from 'child_process'

const SOHU_API = 'https://q.stock.sohu.com/hisHq'

function toSohuCode(code: string): string {
  return `cn_${code}`
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://q.stock.sohu.com/' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  // Get raw bytes - Sohu uses GB18030 encoding
  const buf = Buffer.from(await res.arrayBuffer())
  try {
    return JSON.parse(buf.toString('utf-8'))
  } catch {
    const decoded = execSync('iconv -f GB18030 -t UTF-8', { input: buf }).toString()
    return JSON.parse(decoded)
  }
}

// Sohu kline row: [date, open, close, change, change%, low, high, volume, amount, amplitude%]
function parseRow(row: any[], code: string): KLine {
  return {
    code,
    date: row[0],
    open: Number(row[1]),
    close: Number(row[2]),
    high: Number(row[6]),
    low: Number(row[5]),
    volume: Number(row[7]),
    amount: Number(row[8]) || 0,
  }
}

export async function fetchSohuKlines(code: string, startDate = '20000101'): Promise<KLine[]> {
  const today = new Date()
  const endDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
  const url = `${SOHU_API}?code=${toSohuCode(code)}&start=${startDate}&end=${endDate}&stat=1&order=D&period=d`

  const data = await fetchJson(url)

  if (!data?.[0]?.hq?.length) {
    if (data?.status !== 0) throw new Error(`Sohu API error: code=${data?.status}`)
    throw new Error(`No data for ${code}`)
  }

  const rows = data[0].hq as any[][]
  return rows.map(row => parseRow(row, code)).reverse()
}

export async function fetchBatchKlines(codes: string[], startDate = '20000101'): Promise<Map<string, KLine[]>> {
  const result = new Map<string, KLine[]>()
  const batchSize = 50

  for (let i = 0; i < codes.length; i += batchSize) {
    const batch = codes.slice(i, i + batchSize)
    const codeParam = batch.map(toSohuCode).join(',')
    const today = new Date()
    const endDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
    const url = `${SOHU_API}?code=${codeParam}&start=${startDate}&end=${endDate}&stat=1&order=D&period=d`

    let data: any[]
    try { data = await fetchJson(url) } catch { continue }
    if (!data) continue

    for (const item of data) {
      if (!item?.hq?.length) continue
      const code = item.code?.replace(/^cn_/, '') || ''
      if (!code) continue
      const klines = item.hq.map((row: any) => parseRow(row, code)).reverse()
      result.set(code, klines)
    }
  }

  return result
}
