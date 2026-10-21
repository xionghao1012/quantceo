import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawn } from 'child_process'

// ---------------------------------------------------------------------------
// ai/pythonRunner.ts — test runPythonScript, runOpencode, runOpencodeRaw
// ---------------------------------------------------------------------------

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

describe('runPythonScript', () => {
  let mockProc: any

  beforeEach(() => {
    mockProc = {
      stdout: { on: vi.fn((event: string, cb: Function) => { if (event === 'data') cb(Buffer.from('hello world')) }) },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
      stdin: { end: vi.fn() },
    };
    (spawn as any).mockReturnValue(mockProc)
  })

  it('resolves with stdout on zero exit code', async () => {
    mockProc.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'close') cb(0)
    })

    const { runPythonScript } = await import('../../ai/pythonRunner.js')
    const result = await runPythonScript('/path/to/script.py', ['arg1'])
    expect(result).toBe('hello world')
  })

  it('rejects with Error on non-zero exit code', async () => {
    mockProc.stderr.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'data') cb(Buffer.from('error message'))
    })
    mockProc.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'close') cb(1)
    })

    const { runPythonScript } = await import('../../ai/pythonRunner.js')
    await expect(runPythonScript('/path/to/script.py')).rejects.toThrow()
  })

  it('rejects on spawn error', async () => {
    mockProc.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'error') cb(new Error('ENOENT'))
    })

    const { runPythonScript } = await import('../../ai/pythonRunner.js')
    await expect(runPythonScript('/path/to/script.py')).rejects.toThrow('ENOENT')
  })
})

describe('runOpencode', () => {
  let mockProc: any

  beforeEach(() => {
    mockProc = {
      stdout: { on: vi.fn((event: string, cb: Function) => { if (event === 'data') cb(Buffer.from('opencode output')) }) },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
      stdin: { end: vi.fn() },
    };
    (spawn as any).mockReturnValue(mockProc)
  })

  it('resolves with stdout on zero exit code', async () => {
    mockProc.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'close') cb(0)
    })

    const { runOpencode } = await import('../../ai/pythonRunner.js')
    const result = await runOpencode('tell me a joke')
    expect(result).toBe('opencode output')
  })

  it('rejects on non-zero exit code', async () => {
    mockProc.stderr.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'data') cb(Buffer.from('error output'))
    })
    mockProc.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'close') cb(1)
    })

    const { runOpencode } = await import('../../ai/pythonRunner.js')
    await expect(runOpencode('some prompt')).rejects.toThrow()
  })

  it('rejects on spawn error', async () => {
    mockProc.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'error') cb(new Error('ENOENT'))
    })

    const { runOpencode } = await import('../../ai/pythonRunner.js')
    await expect(runOpencode('some prompt')).rejects.toThrow('ENOENT')
  })
})

describe('runOpencodeRaw', () => {
  let mockProc: any

  beforeEach(() => {
    mockProc = {
      stdout: { on: vi.fn((event: string, cb: Function) => { if (event === 'data') cb(Buffer.from('stdout data')) }) },
      stderr: { on: vi.fn((event: string, cb: Function) => { if (event === 'data') cb(Buffer.from('stderr data')) }) },
      on: vi.fn(),
      kill: vi.fn(),
      stdin: { end: vi.fn() },
    };
    (spawn as any).mockReturnValue(mockProc)
  })

  it('resolves with stdout, stderr, and code on zero close', async () => {
    mockProc.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'close') cb(0)
    })

    const { runOpencodeRaw } = await import('../../ai/pythonRunner.js')
    const result = await runOpencodeRaw('some prompt')
    expect(result).toEqual({
      stdout: 'stdout data',
      stderr: 'stderr data',
      code: 0,
    })
  })

  it('resolves with non-zero code on error exit', async () => {
    mockProc.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'close') cb(127)
    })

    const { runOpencodeRaw } = await import('../../ai/pythonRunner.js')
    const result = await runOpencodeRaw('bad prompt')
    expect(result.code).toBe(127)
  })

  it('rejects on spawn error', async () => {
    mockProc.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'error') cb(new Error('ENOENT'))
    })

    const { runOpencodeRaw } = await import('../../ai/pythonRunner.js')
    await expect(runOpencodeRaw('some prompt')).rejects.toThrow('ENOENT')
  })
})
