import type { SourceAdapter, MoneyFlowData, MoneyFlowMinute } from '@shared/sources.js'

const THS_MONEY_FLOW_API = 'https://d.10jqka.com.cn/v6/line/hs_fund/{code}/01/last20.js'
const THS_MINUTE_API = 'https://d.10jqka.com.cn/v6/line/hs_fund/{code}/01/today.js'

export class TonghuashunAdapter implements SourceAdapter {
  readonly name = 'tonghuashun'
  readonly priority = 10

  async fetchDailyMoneyFlow(code: string, days = 5): Promise<MoneyFlowData[]> {
    try {
      const url = THS_MONEY_FLOW_API.replace('{code}', code)
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://stockpage.10jqka.com.cn/',
        },
      })
      if (!res.ok) return []

      const text = await res.text()
      const match = text.match(/\{.*\}/s)
      if (!match) return []

      const json = JSON.parse(match[0])
      const data = json[code] || []
      if (!Array.isArray(data) || data.length === 0) return []

      return data.slice(-days).map((item: string[]) => ({
        code,
        name: item[0] || code,
        date: item[1] || '',
        close: Number(item[2]) || 0,
        changePct: Number(item[3]) || 0,
        netInflowSuperLarge: Number(item[4]) || 0,
        netInflowLarge: Number(item[5]) || 0,
        netInflowMedium: Number(item[6]) || 0,
        netInflowSmall: Number(item[7]) || 0,
        netInflowMain: (Number(item[4]) || 0) + (Number(item[5]) || 0),
        netInflowMainPct: Number(item[8]) || 0,
      }))
    } catch {
      return []
    }
  }

  async fetchMinuteMoneyFlow(code: string, _date?: string): Promise<MoneyFlowMinute[]> {
    try {
      const url = THS_MINUTE_API.replace('{code}', code)
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://stockpage.10jqka.com.cn/',
        },
      })
      if (!res.ok) return []

      const text = await res.text()
      const match = text.match(/\{.*\}/s)
      if (!match) return []

      const json = JSON.parse(match[0])
      const data = json[code] || []
      if (!Array.isArray(data) || data.length === 0) return []

      return data.map((item: string[], index: number) => ({
        code,
        datetime: item[0] || `today_${index}`,
        close: Number(item[1]) || 0,
        netInflowSuperLarge: Number(item[2]) || 0,
        netInflowLarge: Number(item[3]) || 0,
        netInflowMedium: Number(item[4]) || 0,
        netInflowSmall: Number(item[5]) || 0,
        netInflowMain: (Number(item[2]) || 0) + (Number(item[3]) || 0),
      }))
    } catch {
      return []
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch('https://www.10jqka.com.cn/', {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000),
      })
      return res.ok
    } catch {
      return false
    }
  }
}

export const tonghuashunAdapter = new TonghuashunAdapter()
