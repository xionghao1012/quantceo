import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'

let wss: WebSocketServer | null = null
const subscribers = new Map<WebSocket, Set<string>>()

interface AlertMessage {
  type: 'price_update' | 'alert_triggered' | 'volume_spike' | 'breakout'
  code: string
  name?: string
  price?: number
  change?: number
  volume?: number
  message?: string
  timestamp: string
}

export function initWebSocket(server: Server) {
  wss = new WebSocketServer({ server, path: '/ws' })

  // ws 会把 http server 的 'error' 事件转发到 WebSocketServer 上。
  // 这里不接住的话，EventEmitter 会抛 "Unhandled 'error' event"，
  // 连带把 http server 自己的 error 处理（端口占用重试等）也一起顶掉。
  wss.on('error', (err: Error) => {
    console.error('[WS] server error:', err.message)
  })

  wss.on('connection', (ws) => {
    subscribers.set(ws, new Set())

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'subscribe' && Array.isArray(msg.codes)) {
          const codes = subscribers.get(ws)!
          msg.codes.forEach((c: string) => codes.add(c))
          ws.send(JSON.stringify({ type: 'subscribed', codes: [...codes] }))
        } else if (msg.type === 'unsubscribe' && Array.isArray(msg.codes)) {
          const codes = subscribers.get(ws)!
          msg.codes.forEach((c: string) => codes.delete(c))
          ws.send(JSON.stringify({ type: 'unsubscribed', codes: [...codes] }))
        }
      } catch {}
    })

    ws.on('close', () => {
      subscribers.delete(ws)
    })

    ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connected' }))
  })

  console.log('[WS] WebSocket server initialized on /ws')
}

export function broadcast(alert: AlertMessage) {
  if (!wss) return
  const data = JSON.stringify(alert)
  for (const [ws, codes] of subscribers) {
    if (ws.readyState === WebSocket.OPEN) {
      if (!codes.size || codes.has(alert.code)) {
        ws.send(data)
      }
    }
  }
}

export function broadcastAll(message: any) {
  if (!wss) return
  const data = JSON.stringify(message)
  for (const [ws] of subscribers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data)
    }
  }
}

export function getSubscriberCount(): number {
  return subscribers.size
}
