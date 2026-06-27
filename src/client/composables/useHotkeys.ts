import { ref, onMounted, onUnmounted } from 'vue'

export interface Hotkey {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  handler: () => void
  label: string
  when?: () => boolean
}

const enabledHotkeys = ref<Hotkey[]>([])

export function useHotkeys(hotkeys: Hotkey[]) {
  function onKeyDown(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) {
      return
    }
    for (const hk of enabledHotkeys.value) {
      if (hk.when && !hk.when()) continue
      const ctrlMatch = !!hk.ctrl === (e.ctrlKey || e.metaKey)
      const shiftMatch = !!hk.shift === e.shiftKey
      const altMatch = !!hk.alt === e.altKey
      const keyMatch = e.key.toLowerCase() === hk.key.toLowerCase()
      if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
        e.preventDefault()
        hk.handler()
        return
      }
    }
  }

  enabledHotkeys.value.push(...hotkeys)

  onMounted(() => document.addEventListener('keydown', onKeyDown))
  onUnmounted(() => {
    document.removeEventListener('keydown', onKeyDown)
    for (const hk of hotkeys) {
      const idx = enabledHotkeys.value.indexOf(hk)
      if (idx !== -1) enabledHotkeys.value.splice(idx, 1)
    }
  })
}

export const hotkeyDescriptions = [
  { key: '/', label: '聚焦搜索' },
  { key: 'n', label: '打开通知' },
  { key: 'Escape', label: '关闭通知' },
  { key: 'g h', label: '首页/看板' },
  { key: 'g s', label: '选股筛选' },
  { key: 'g b', label: '策略回测' },
  { key: 'g l', label: '收益排行' },
  { key: 'g w', label: '自选股' },
  { key: 'g d', label: '当前股票详情' },
]
