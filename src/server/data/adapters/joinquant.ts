import type { SourceAdapter, MoneyFlowData, MoneyFlowMinute } from '@shared/sources.js'

export class JoinQuantAdapter implements SourceAdapter {
  readonly name = 'joinquant'
  readonly priority = 20

  async fetchDailyMoneyFlow(code: string, days = 5): Promise<MoneyFlowData[]> {
    try {
      const { execSync } = await import('child_process')
      const script = `
import sys
try:
    import jqdata
except:
    print('{"ok":false,"error":"joinquant not installed"}')
    sys.exit()

try:
    from jqdata import get_money_flow
    import pandas as pd
    import json
    
    df = get_money_flow(code, end_date=None, count=${days})
    if df is None or len(df) == 0:
        print('{"ok":true,"data":[]}')
    else:
        records = []
        for _, row in df.iterrows():
            records.append({
                "code": code,
                "name": row.get('name', code),
                "date": str(row.get('date', '')),
                "close": float(row.get('close', 0)),
                "changePct": float(row.get('pct_change', 0)),
                "netInflowSuperLarge": float(row.get('net_amount_extra_large', 0)),
                "netInflowLarge": float(row.get('net_amount_large', 0)),
                "netInflowMedium": float(row.get('net_amount_medium', 0)),
                "netInflowSmall": float(row.get('net_amount_small', 0)),
                "netInflowMain": float(row.get('net_amount_main', 0)),
                "netInflowMainPct": float(row.get('net_pct_main', 0)),
            })
        print(json.dumps({"ok":True,"data":records}))
except Exception as e:
    print(json.dumps({"ok":False,"error":str(e)}))
`
      const stdout = execSync(`python3 -c "${script.replace(/"/g, '\\"').replace(/\n/g, ';')}"`, {
        timeout: 30000,
        env: { ...process.env, https_proxy: '', http_proxy: '' },
      }).toString()

      const result = JSON.parse(stdout)
      if (!result.ok) return []
      return result.data || []
    } catch {
      return []
    }
  }

  async fetchMinuteMoneyFlow(code: string, date?: string): Promise<MoneyFlowMinute[]> {
    try {
      const { execSync } = await import('child_process')
      const targetDate = date || new Date().toISOString().slice(0, 10)
      const script = `
import sys
try:
    import jqdata
except:
    print('{"ok":false,"error":"joinquant not installed"}')
    sys.exit()

try:
    from jqdata import get_money_flow
    import pandas as pd
    import json
    
    df = get_money_flow(code, end_date='${targetDate}', count=1, data_type='m')
    if df is None or len(df) == 0:
        print('{"ok":true,"data":[]}')
    else:
        records = []
        for _, row in df.iterrows():
            records.append({
                "code": code,
                "datetime": str(row.get('datetime', '')),
                "close": float(row.get('close', 0)),
                "netInflowSuperLarge": float(row.get('net_amount_extra_large', 0)),
                "netInflowLarge": float(row.get('net_amount_large', 0)),
                "netInflowMedium": float(row.get('net_amount_medium', 0)),
                "netInflowSmall": float(row.get('net_amount_small', 0)),
                "netInflowMain": float(row.get('net_amount_main', 0)),
            })
        print(json.dumps({"ok":True,"data":records}))
except Exception as e:
    print(json.dumps({"ok":False,"error":str(e)}))
`
      const stdout = execSync(`python3 -c "${script.replace(/"/g, '\\"').replace(/\n/g, ';')}"`, {
        timeout: 30000,
        env: { ...process.env, https_proxy: '', http_proxy: '' },
      }).toString()

      const result = JSON.parse(stdout)
      if (!result.ok) return []
      return result.data || []
    } catch {
      return []
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { execSync } = await import('child_process')
      execSync('python3 -c "import jqdata"', { timeout: 5000 })
      return true
    } catch {
      return false
    }
  }
}

export const joinQuantAdapter = new JoinQuantAdapter()
