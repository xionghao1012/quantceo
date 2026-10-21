import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from './stores/auth'
import type { RouteRecordRaw } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [],
})

export function addPluginRoutes(routes: RouteRecordRaw[]) {
  for (const route of routes) {
    router.addRoute(route)
  }
}

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!to.meta.public && !auth.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.meta.requirePlan) {
    if (!auth.user) {
      try { await auth.fetchUser() } catch {}
    }
    const plan = to.meta.requirePlan as string
    let role = auth.user?.role || 'free'

    // Fallback: if auth role is too low, check subscription API
    const planOrder = ['free', 'pro', 'premium']
    if (!planOrder.includes(role) || planOrder.indexOf(role) < planOrder.indexOf(plan)) {
      try {
        const res = await fetch('/api/subscription/me', { headers: auth.authHeaders() })
        if (res.ok) {
          const data = await res.json()
          if (data.plan) role = data.plan
        }
      } catch {}
    }

    if (!planOrder.includes(role) || planOrder.indexOf(role) < planOrder.indexOf(plan)) {
      return { name: 'pricing', query: { reason: 'plan_required' } }
    }
  }
})

export default router
