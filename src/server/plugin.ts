import type { Express, Router } from 'express'

export interface QuantPlugin {
  name: string
  routes: { prefix: string, router: Router }[]
}

export function registerPlugins(app: Express, plugins: QuantPlugin[]) {
  for (const p of plugins) {
    for (const r of p.routes) {
      app.use(r.prefix, r.router)
    }
  }
}
