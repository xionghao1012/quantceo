import type { RouteRecordRaw } from 'vue-router'
import { reactive } from 'vue'

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
  private _plugins = reactive<FrontendPlugin[]>([])

  register(plugin: FrontendPlugin) {
    this._plugins.push(plugin)
  }

  get routes(): RouteRecordRaw[] {
    return this._plugins.flatMap(p => p.routes)
  }

  get navGroups(): NavGroup[] {
    // 按 title 合并同名分组，避免多个插件产生重复的「分析」「交易」分组
    const merged = new Map<string, NavGroup>()
    for (const p of this._plugins) {
      for (const g of p.navGroups) {
        const existing = merged.get(g.title)
        if (existing) existing.items.push(...g.items)
        else merged.set(g.title, { title: g.title, items: [...g.items] })
      }
    }
    return [...merged.values()]
  }
}

export const pluginManager = new FrontendPluginManager()
