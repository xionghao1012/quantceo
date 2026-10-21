/**
 * pythonRunner.ts — 封装所有 Python 脚本调用，便于单元测试时 mock
 *
 * 原代码直接使用 child_process.spawn，无法在 vitest 中安全 mock。
 * 所有 Python 调用通过本模块代理，测试时 mock 本模块而非 child_process。
 */

import { spawn } from 'child_process'
import path from 'path'

export interface PythonResult {
  stdout: string
  stderr: string
  code: number
}

export interface RunPythonOptions {
  cwd?: string
  timeout?: number // ms
}

const DEFAULT_TIMEOUT = 30000

/**
 * 运行 Python 脚本，返回 stdout
 * @param scriptPath 相对于项目根目录的路径，或绝对路径
 * @param args 命令行参数
 * @param opts 可选配置
 */
export async function runPythonScript(
  scriptPath: string,
  args: string[] = [],
  opts: RunPythonOptions = {}
): Promise<string> {
  const resolvedPath = path.isAbsolute(scriptPath)
    ? scriptPath
    : path.join(process.cwd(), scriptPath)

  return new Promise((resolve, reject) => {
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
      reject(new Error(`Python script timed out after ${timeout}ms: ${scriptPath}`))
    }, timeout)

    const proc = spawn('python3', [resolvedPath, ...args], {
      cwd: opts.cwd ?? process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => { stdout += data.toString() })
    proc.stderr?.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) return // already rejected
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        const err = new Error(`Python script exited with code ${code}: ${stderr || stdout}`)
        reject(err)
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      if (!timedOut) reject(err)
    })
  })
}

/**
 * 运行 opencode CLI，返回 stdout
 */
export async function runOpencode(
  prompt: string,
  opts: RunPythonOptions = {}
): Promise<string> {
  const OPENCODE = process.env.OPENCODE_PATH || 'opencode'
  const timeout = opts.timeout ?? 600000

  return new Promise((resolve, reject) => {
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
      reject(new Error(`opencode timed out after ${timeout}ms`))
    }, timeout)

    const proc = spawn(OPENCODE, [
      'run', '--format', 'json',
      '--dir', opts.cwd ?? process.cwd(),
      '--', prompt
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    proc.stdin?.end()
    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => { stdout += data.toString() })
    proc.stderr?.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) return
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(new Error(stderr || `opencode exit ${code}`))
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      if (!timedOut) reject(err)
    })
  })
}

/**
 * 运行 opencode CLI，返回原始结果（含 stdout/stderr）
 * strategyDiscovery.ts 的 callOpencode 需要 stderr 来做 JSON 行过滤
 */
export async function runOpencodeRaw(
  prompt: string,
  opts: RunPythonOptions = {}
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const OPENCODE = process.env.OPENCODE_PATH || 'opencode'
  const timeout = opts.timeout ?? 600000

  return new Promise((resolve, reject) => {
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
      reject(new Error(`opencode timed out after ${timeout}ms`))
    }, timeout)

    const proc = spawn(OPENCODE, [
      'run', '--format', 'json',
      '--dir', opts.cwd ?? process.cwd(),
      '--', prompt
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    proc.stdin?.end()
    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => { stdout += data.toString() })
    proc.stderr?.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) return
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code })
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      if (!timedOut) reject(err)
    })
  })
}
