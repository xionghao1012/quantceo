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
  if (to.meta.requirePlan && !auth.user) {
    try { await auth.fetchUser() } catch {}
  }
  if (to.meta.requirePlan) {
    const plan = to.meta.requirePlan as string
    const role = auth.user?.role || 'free'
    const planOrder = ['free', 'pro', 'premium']
    if (!planOrder.includes(role) || planOrder.indexOf(role) < planOrder.indexOf(plan)) {
      return { name: 'upgrade', query: { reason: 'plan_required' } }
    }
  }
})

export default router
