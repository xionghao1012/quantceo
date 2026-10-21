import type { Express, Router, RequestHandler } from 'express'

export interface QuantPlugin {
  name: string
  routes: { prefix: string, router: Router }[]
}

type Layer = { handle?: unknown, route?: { stack?: Layer[] } }

/**
 * Express 4 不会把 async 处理器的 rejection 转给错误中间件——
 * 路由里一次 await 抛错（数据库外键冲突、JSON 解析失败、连接抖动……）
 * 就是一次 unhandledRejection，Node 24 默认直接让整个 API 进程退出。
 * 实测：一次 401 之后的告警创建就能把 dev API 打挂。
 *
 * 这里在路由挂载时把每一层的 handler 包一层：rejection 交给 Express 的错误
 * 中间件，请求得到 500，而不是整站宕机。
 */
export function asyncRouter(router: Router): Router {
  const stack = (router as any).stack as Layer[] | undefined
  if (!Array.isArray(stack)) return router
  for (const layer of stack) {
    const routeStack = layer.route?.stack
    if (!Array.isArray(routeStack)) continue
    for (const r of routeStack) {
      r.handle = wrapHandler(r.handle)
    }
  }
  return router
}

function wrapHandler(handler: unknown): unknown {
  // 错误中间件（4 个参数）保持原样
  if (typeof handler !== 'function' || (handler as RequestHandler).length === 4) return handler
  return function (req: any, res: any, next: any) {
    try {
      const result = (handler as any)(req, res, next)
      if (result && typeof result.then === 'function') {
        result.catch(next)
      }
    } catch (e) {
      next(e)
    }
  }
}

export function registerPlugins(app: Express, plugins: QuantPlugin[]) {
  for (const p of plugins) {
    for (const r of p.routes) {
      app.use(r.prefix, asyncRouter(r.router))
    }
  }
}
