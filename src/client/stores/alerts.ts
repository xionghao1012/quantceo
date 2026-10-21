import { ref } from 'vue'

export interface AlertMessage {
  type: string
  code: string
  name: string
  message: string
  timestamp: string
  price?: number
  change?: number
  category?: string
}

const alertPopupQueue = ref<AlertMessage[]>([])
const recentPopups = ref<Map<string, number>>(new Map()) // code -> last shown timestamp
const POPUP_INTERVAL = 10_000 // 10 秒内同股票不重复弹窗
let ws: WebSocket | null = null

export function useAlertWebSocket() {
  function connect() {
    if (ws) return
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(`${proto}//${location.host}/ws`)

    ws.onopen = () => console.log('[AlertWS] connected')
    ws.onclose = () => { ws = null; setTimeout(connect, 3000) }
    ws.onerror = () => { ws?.close() }
    ws.onmessage = (e) => {
      try {
        const msg: AlertMessage = JSON.parse(e.data)
        if (msg.type === 'alert_triggered') {
          onAlertTriggered(msg)
        }
      } catch {}
    }
  }

  function disconnect() {
    ws?.close()
    ws = null
  }

  return { connect, disconnect }
}

function onAlertTriggered(msg: AlertMessage) {
  const now = Date.now()
  const last = recentPopups.value.get(msg.code) || 0
  if (now - last < POPUP_INTERVAL) return // 10 秒防抖
  recentPopups.value.set(msg.code, now)
  alertPopupQueue.value.push(msg)
}

export function useAlertPopupQueue() {
  function consume(): AlertMessage | undefined {
    return alertPopupQueue.value.shift()
  }

  function peek(): AlertMessage | undefined {
    return alertPopupQueue.value[0]
  }

  return { queue: alertPopupQueue, consume, peek }
}
