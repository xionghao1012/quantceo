import type { RouteRecordRaw } from 'vue-router'

export interface NavItem {
  label: string
  icon: string
  route: string
  check: () => boolean
  disable?: boolean
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

export interface FrontendPlugin {
  name: string
  routes: RouteRecordRaw[]
  navGroups: NavGroup[]
}

class FrontendPluginManager {
  private _plugins: FrontendPlugin[] = []

  register(plugin: FrontendPlugin) {
    this._plugins.push(plugin)
  }

  get routes(): RouteRecordRaw[] {
    return this._plugins.flatMap(p => p.routes)
  }

  get navGroups(): NavGroup[] {
    return this._plugins.flatMap(p => p.navGroups)
  }
}

export const pluginManager = new FrontendPluginManager()
