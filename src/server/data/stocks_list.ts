import type { Stock } from '../../shared/types.js'

const SINA_API = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData'

interface SinaRow {
  code: string
  name: string
  symbol: string
}

async function fetchPage(node: string, page: number, pageSize: number): Promise<SinaRow[]> {
  const url = `${SINA_API}?page=${page}&num=${pageSize}&sort=symbol&asc=1&node=${node}&symbol=&_s_r_a=page`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://vip.stock.finance.sina.com.cn/' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${node} page ${page}`)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return []
  }
}

export async function fetchAllStocks(): Promise<Stock[]> {
  const all: Stock[] = []
  const nodes = ['sh_a', 'sz_a']

  for (const node of nodes) {
    let page = 1
    while (true) {
      const rows = await fetchPage(node, page, 100)
      if (rows.length === 0) break
      for (const item of rows) {
        const code = item.code
        const name = item.name?.trim()
        if (!code || !name) continue
        const exchange = code.startsWith('6') || code.startsWith('9') ? 'SH' : 'SZ'
        all.push({ code, name, exchange: exchange as 'SH' | 'SZ', status: 'active' })
      }
      if (rows.length < 100) break
      page++
    }
  }

  return all
}
