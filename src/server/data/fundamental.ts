const EM_FUNDAMENTAL_API = 'https://push2.eastmoney.com/api/qt/stock/get'

export interface FundamentalData {
  code: string
  name: string
  close?: number
  pe?: number
  pb?: number
  roe?: number
  marketCap?: number
  floatMarketCap?: number
  shares?: number
  floatShares?: number
  high52w?: number
  low52w?: number
  dividendYield?: number
  source: string
}

function toSecid(code: string): string {
  if (code.startsWith('6') || code.startsWith('9')) return `1.${code}`
  return `0.${code}`
}

export async function fetchFundamental(code: string): Promise<FundamentalData | null> {
  try {
    const secid = toSecid(code)
    const url = `${EM_FUNDAMENTAL_API}?fields=f57,f58,f43,f162,f167,f116,f173,f174,f175,f176,f169,f170&secid=${secid}`

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://quote.eastmoney.com/',
      },
    })
    if (!res.ok) return null

    const json = await res.json()
    const data = json.data
    if (!data) return null

    const close = data.f43 ? Number(data.f43) / 100 : undefined
    const pe = data.f162 && Number(data.f162) > 0 ? Number(data.f162) / 100 : undefined
    const pb = data.f167 && Number(data.f167) > 0 ? Number(data.f167) / 100 : undefined
    const shares = data.f175 ? Number(data.f175) : undefined

    return {
      code,
      name: data.f58 || code,
      close,
      pe,
      pb,
      roe: pb != null && pe != null && pe > 0 ? Number((pb / pe * 100).toFixed(2)) : undefined,
      high52w: data.f169 ? Number(data.f169) : undefined,
      low52w: data.f170 ? Number(data.f170) : undefined,
      dividendYield: data.f173 && Number(data.f173) > 0 ? Number(data.f173) : undefined,
      marketCap: close && shares ? Number((close * shares * 10000).toFixed(2)) : undefined,
      floatMarketCap: close && shares ? Number((close * shares * 10000).toFixed(2)) : undefined,
      shares,
      floatShares: shares,
      source: 'eastmoney',
    }
  } catch {
    return null
  }
}
