import type { SourceAdapter, MoneyFlowData, MoneyFlowMinute } from '@shared/sources.js'

function toSecid(code: string): string {
  if (code.startsWith('6') || code.startsWith('9')) return `1.${code}`
  return `0.${code}`
}

const EM_MONEY_FLOW_API = 'https://push2.eastmoney.com/api/qt/stock/fflow/daykline/get'
const EM_STOCK_FLOW_API = 'https://push2.eastmoney.com/api/qt/stock/fflow/kline/get'

export class EastmoneyAdapter implements SourceAdapter {
  readonly name = 'eastmoney'
  readonly priority = 5

  async fetchDailyMoneyFlow(code: string, days = 5): Promise<MoneyFlowData[]> {
    try {
      const secid = toSecid(code)
      const url = `${EM_MONEY_FLOW_API}?lmt=0&klt=101&fields1=f1,f2,f3,f7,f8,f10,f12,f14&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63&secid=${secid}&ut=7eea3edcaed734bea9fbf704ac458128&cb=jQuery351099999&_=${Date.now()}`

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://quote.eastmoney.com/',
        },
      })
      if (!res.ok) return []

      const text = await res.text()
      const jsonStr = text.replace(/^jQuery\d+\(/, '').replace(/\)$/, '')
      const json = JSON.parse(jsonStr)

      const klines: string[] = json.data?.klines || []
      const result: MoneyFlowData[] = []

      for (const row of klines.slice(-days)) {
        const parts = row.split('|')
        if (parts.length < 12) continue
        result.push({
          code,
          name: parts[10] || code,
          date: parts[0],
          close: Number(parts[1]) || 0,
          changePct: Number(parts[2]) || 0,
          netInflowSuperLarge: Number(parts[3]) || 0,
          netInflowLarge: Number(parts[4]) || 0,
          netInflowMedium: Number(parts[5]) || 0,
          netInflowSmall: Number(parts[6]) || 0,
          netInflowMain: Number(parts[7]) || 0,
          netInflowMainPct: Number(parts[8]) || 0,
          turnoverRate: Number(parts[9]) || undefined,
        })
      }

      return result
    } catch {
      return []
    }
  }

  async fetchMinuteMoneyFlow(code: string, _date?: string): Promise<MoneyFlowMinute[]> {
    try {
      const secid = toSecid(code)
      const url = `${EM_STOCK_FLOW_API}?lmt=0&klt=1&fields1=f1,f2,f3,f7,f8,f10,f12,f14&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63&secid=${secid}&ut=7eea3edcaed734bea9fbf704ac458128`

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://quote.eastmoney.com/',
        },
      })
      if (!res.ok) return []

      const json = await res.json()
      const klines: string[] = json.data?.klines || []

      return klines.map((row: string) => {
        const parts = row.split('|')
        return {
          code,
          datetime: parts[0] || '',
          close: Number(parts[1]) || 0,
          netInflowSuperLarge: Number(parts[3]) || 0,
          netInflowLarge: Number(parts[4]) || 0,
          netInflowMedium: Number(parts[5]) || 0,
          netInflowSmall: Number(parts[6]) || 0,
          netInflowMain: Number(parts[7]) || 0,
        }
      })
    } catch {
      return []
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch('https://www.eastmoney.com/', {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000),
      })
      return res.ok
    } catch {
      return false
    }
  }
}

export const eastmoneyAdapter = new EastmoneyAdapter()
