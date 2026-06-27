import { spawn } from 'child_process'
import type { MinuteKLine, MinutePeriod } from '../../shared/types.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PY_SCRIPT = path.resolve(__dirname, '../../../src/server/data/minute_akshare.py')

function runPythonAsync(input: object, timeoutMs = 120000): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [PY_SCRIPT], {
      timeout: timeoutMs,
      env: { ...process.env, https_proxy: '', http_proxy: '', HTTPS_PROXY: '', HTTP_PROXY: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timer: NodeJS.Timeout | null = null

    child.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    child.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })

    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      const jsonStart = stdout.indexOf('{"ok":')
      if (jsonStart === -1) {
        reject(new Error(`akshare: no JSON in stdout (exit ${code}): ${stderr.slice(0, 200)}`))
        return
      }
      try {
        const result = JSON.parse(stdout.slice(jsonStart))
        if (!result.ok) {
          reject(new Error(result.error || 'akshare fetch failed'))
          return
        }
        resolve(result)
      } catch (e: any) {
        reject(new Error(`akshare parse error: ${e.message}. stdout: ${stdout.slice(0, 200)}`))
      }
    })

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error(`akshare timeout after ${timeoutMs}ms`))
      }, timeoutMs)
    }

    child.stdin!.write(JSON.stringify(input))
    child.stdin!.end()
  })
}

export async function fetchAkshareMinuteKlines(
  code: string,
  period: MinutePeriod,
): Promise<MinuteKLine[]> {
  const result = await runPythonAsync({ codes: [code], period })
  return (result.data[code] || []) as MinuteKLine[]
}

export async function fetchAkshareMinuteKlinesBatch(
  codes: string[],
  period: MinutePeriod,
  timeoutMs = 600000,
): Promise<Record<string, MinuteKLine[]>> {
  if (codes.length === 0) return {}
  const result = await runPythonAsync({ codes, period }, timeoutMs)
  return result.data as Record<string, MinuteKLine[]>
}
