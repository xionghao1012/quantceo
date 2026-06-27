import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router, { addPluginRoutes } from './router'
import { pluginManager } from './plugin'
import { corePlugin } from './plugins/core'

pluginManager.register(corePlugin)

if (import.meta.env.VITE_LICENSE_KEY) {
  try {
    const m = await import('./plugins/pro')
    const { proPlugin } = m
    pluginManager.register(proPlugin)
  } catch {
    // Pro plugin not available in OSS build
  }
}

addPluginRoutes(pluginManager.routes)

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
