import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router, { addPluginRoutes } from './router'
import { pluginManager } from './plugin'
import { corePlugin } from './plugins/core'
import { proPlugin } from './plugins/pro'

pluginManager.register(corePlugin)
pluginManager.register(proPlugin)

async function main() {
  addPluginRoutes(pluginManager.routes)

  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  app.mount('#app')
}

main()
