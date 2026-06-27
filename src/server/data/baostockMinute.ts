import { execSync } from 'child_process'
import type { MinuteKLine, MinutePeriod } from '../../shared/types.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PY_SCRIPT = path.resolve(__dirname, '../../../src/server/data/minute.py')

function runPython(input: object, timeoutMs = 120000): any {
  const stdout = execSync(`python3 "${PY_SCRIPT}"`, {
    input: JSON.stringify(input),
    timeout: timeoutMs,
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env, https_proxy: '', http_proxy: '', HTTPS_PROXY: '', HTTP_PROXY: '' },
    stdio: ['pipe', 'pipe', 'ignore'],
  }).toString()

  const result = JSON.parse(stdout)
  if (!result.ok) {
    throw new Error(result.error || 'baostock fetch failed')
  }
  return result
}

export async function fetchBaostockMinuteKlines(
  code: string,
  period: MinutePeriod,
  startDate?: string,
  endDate?: string,
): Promise<MinuteKLine[]> {
  if (period === 'm1') return []

  try {
    const result = runPython({
      action: 'fetch',
      codes: [code],
      period,
      start_date: startDate || '20000101',
      end_date: endDate,
    })
    return (result.data[code] || []) as MinuteKLine[]
  } catch (e: any) {
    throw e
  }
}

export async function fetchBaostockMinuteKlinesBatch(
  codes: string[],
  period: MinutePeriod,
  startDate?: string,
  endDate?: string,
  timeoutMs = 300000,
): Promise<Record<string, MinuteKLine[]>> {
  if (period === 'm1' || codes.length === 0) return {}

  try {
    const result = runPython({
      action: 'fetch',
      codes,
      period,
      start_date: startDate || '20000101',
      end_date: endDate,
    }, timeoutMs)
    return result.data as Record<string, MinuteKLine[]>
  } catch (e: any) {
    throw e
  }
}
