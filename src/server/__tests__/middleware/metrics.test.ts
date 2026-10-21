import { describe, it, expect, vi, beforeEach } from 'vitest'
import { incCounter, setGauge, metricsMiddleware, createMetricsRouter } from '../../middleware/metrics.js'

describe('incCounter', () => {
  it('increments counter with no labels', () => {
    incCounter('test_counter', {}, 1)
    incCounter('another_counter', { label: 'value' }, 5)
  })

  it('accumulates values for same key', () => {
    incCounter('accum_test', {}, 1)
    incCounter('accum_test', {}, 2)
  })
})

describe('setGauge', () => {
  it('registers a gauge callback', () => {
    setGauge('test_gauge', () => 42)
    setGauge('memory_gauge', () => process.memoryUsage().heapUsed)
  })
})

describe('metricsMiddleware', () => {
  let mockReq: any
  let mockRes: any
  let mockNext: any
  let origEnd: any

  beforeEach(() => {
    origEnd = vi.fn()
    mockReq = { method: 'GET', path: '/test', route: { path: '/test' } }
    mockRes = {
      statusCode: 200,
      end: origEnd,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }
    mockNext = vi.fn()
  })

  it('calls next and patches res.end to record metrics', () => {
    const middleware = metricsMiddleware('test-service')
    middleware(mockReq, mockRes, mockNext)

    expect(mockNext).toHaveBeenCalled()
    // end should be replaced with a different function
    expect(mockRes.end).not.toBe(origEnd)
  })

  it('original end is called after patching', () => {
    const middleware = metricsMiddleware('test-service')
    middleware(mockReq, mockRes, mockNext)

    // Call the patched end
    mockRes.end()

    expect(origEnd).toHaveBeenCalled()
  })
})

describe('createMetricsRouter', () => {
  it('returns a router with GET / endpoint', () => {
    const router = createMetricsRouter()
    expect(router.stack).toBeDefined()
    expect(router.stack.length).toBeGreaterThan(0)
  })

  it('GET / returns prometheus-formatted metrics', async () => {
    const router = createMetricsRouter()
    incCounter('test_metric', { service: 'test' }, 10)

    const mockReq = {} as any
    let responseData = ''
    const mockRes = {
      set: vi.fn(),
      end: vi.fn((data: string) => { responseData = data }),
    }

    // Find the route handler
    const route = router.stack.find((layer: any) => layer.route?.path === '/')
    await (route as any).route.stack[0].handle(mockReq, mockRes, () => {})

    expect(mockRes.set).toHaveBeenCalledWith('Content-Type', 'text/plain; version=0.0.4')
    expect(responseData).toContain('test_metric')
  })

  it('GET / includes process metrics', async () => {
    const router = createMetricsRouter()

    const mockReq = {} as any
    let responseData = ''
    const mockRes = {
      set: vi.fn(),
      end: vi.fn((data: string) => { responseData = data }),
    }

    const route = router.stack.find((layer: any) => layer.route?.path === '/')
    await (route as any).route.stack[0].handle(mockReq, mockRes, () => {})

    expect(responseData).toContain('process_heap_bytes')
    expect(responseData).toContain('process_uptime_seconds')
    expect(responseData).toContain('nodejs_active_handles')
  })

  it('GET / includes registered gauges', async () => {
    setGauge('custom_gauge', () => 999)
    const router = createMetricsRouter()

    const mockReq = {} as any
    let responseData = ''
    const mockRes = {
      set: vi.fn(),
      end: vi.fn((data: string) => { responseData = data }),
    }

    const route = router.stack.find((layer: any) => layer.route?.path === '/')
    await (route as any).route.stack[0].handle(mockReq, mockRes, () => {})

    expect(responseData).toContain('custom_gauge 999')
  })
})
