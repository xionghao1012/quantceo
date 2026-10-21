import { Router } from 'express'

const metrics: Record<string, number> = {}
const gauges: Record<string, () => number> = {}

export function incCounter(name: string, labels: Record<string, string> = {}, value = 1) {
  const key = `${name}{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')}}`
  metrics[key] = (metrics[key] || 0) + value
}

export function setGauge(name: string, fn: () => number) {
  gauges[name] = fn
}

export function metricsMiddleware(serviceName: string) {
  return (req: any, _res: any, next: any) => {
    const start = Date.now()
    const origEnd = _res.end
    _res.end = function (...args: any[]) {
      const duration = (Date.now() - start) / 1000
      const route = req.route?.path || req.path
      const status = String(_res.statusCode)
      incCounter('http_requests_total', { service: serviceName, method: req.method, route, status })
      incCounter('http_request_duration_seconds', { service: serviceName, method: req.method, route }, duration)
      return origEnd.apply(this, args)
    }
    next()
  }
}

export function createMetricsRouter() {
  const router = Router()
  router.get('/', (_req, res) => {
    const lines: string[] = []

    for (const [key, value] of Object.entries(metrics)) {
      lines.push(`${key} ${value}`)
    }

    const mem = process.memoryUsage()
    lines.push(`process_heap_bytes ${mem.heapUsed}`)
    lines.push(`process_heap_total_bytes ${mem.heapTotal}`)
    lines.push(`process_rss_bytes ${mem.rss}`)
    lines.push(`process_external_bytes ${mem.external}`)
    lines.push(`process_cpu_user_seconds_total ${process.cpuUsage().user / 1e6}`)
    lines.push(`process_cpu_system_seconds_total ${process.cpuUsage().system / 1e6}`)
    lines.push(`process_uptime_seconds ${process.uptime()}`)
    lines.push(`nodejs_active_handles ${(process as any)._getActiveHandles?.()?.length || 0}`)
    lines.push(`nodejs_active_requests ${(process as any)._getActiveRequests?.()?.length || 0}`)

    for (const [name, fn] of Object.entries(gauges)) {
      lines.push(`${name} ${fn()}`)
    }

    res.set('Content-Type', 'text/plain; version=0.0.4')
    res.end(lines.join('\n') + '\n')
  })
  return router
}
