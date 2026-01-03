import { useEffect, useMemo, useRef, useState } from 'react'
import type { BotUiSnapshot, WsSnapshotMsg } from '../types'

export type WsStatus = 'connecting' | 'open' | 'closed' | 'error'

export function useBotWs(): {
  status: WsStatus
  snapshot: BotUiSnapshot | null
  logLines: string[]
  clearLogs: () => void
} {
  const [status, setStatus] = useState<WsStatus>('connecting')
  const [snapshot, setSnapshot] = useState<BotUiSnapshot | null>(null)
  const [logLines, setLogLines] = useState<string[]>([])

  const wsUrl = useMemo(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'

    // Allow explicit override (useful in dev without relying on Vite proxy).
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}
    const explicit = (env['VITE_BOT_UI_WS_URL'] ?? '').trim()
    if (explicit) return explicit

    // In dev, Vite runs on :5173 but the bot UI server runs on :3001.
    // Connecting directly avoids noisy ws-proxy EPIPE logs in the Vite dev server.
    const devHost = (env['VITE_BOT_UI_HOST'] ?? window.location.hostname).trim() || window.location.hostname
    const devPort = (env['VITE_BOT_UI_PORT'] ?? '3001').trim() || '3001'
    const devDirect = `${proto}//${devHost}:${devPort}/ws`

    const sameOrigin = `${proto}//${window.location.host}/ws`
    return window.location.port === '5173' ? devDirect : sameOrigin
  }, [])

  const keepLastLines = 5000
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let stopped = false
    let retry = 0
    let retryTimer: number | undefined

    const connect = () => {
      if (stopped) return
      setStatus('connecting')
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        retry = 0
        setStatus('open')
      }

      ws.onerror = () => {
        setStatus('error')
      }

      ws.onclose = () => {
        setStatus('closed')
        if (stopped) return
        const delay = Math.min(10_000, 250 * Math.pow(2, retry))
        retry += 1
        retryTimer = window.setTimeout(connect, delay)
      }

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as WsSnapshotMsg
          if (!msg || msg.type !== 'snapshot') return
          setSnapshot(msg.snapshot)
          if (msg.logsText?.lines && msg.logsText.lines.length > 0) {
            setLogLines((prev) => {
              const next = prev.concat(msg.logsText!.lines)
              return next.length > keepLastLines ? next.slice(next.length - keepLastLines) : next
            })
          }
        } catch {
          // ignore
        }
      }
    }

    connect()

    return () => {
      stopped = true
      if (retryTimer) window.clearTimeout(retryTimer)
      try {
        wsRef.current?.close()
      } catch {
        // ignore
      }
      wsRef.current = null
    }
  }, [wsUrl])

  return {
    status,
    snapshot,
    logLines,
    clearLogs: () => {
      setLogLines([])
    },
  }
}


