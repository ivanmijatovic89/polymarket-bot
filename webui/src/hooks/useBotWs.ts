import { useEffect, useMemo, useRef, useState } from 'react'
import type { BotUiCommand, BotUiSnapshot, WsClientMsg, WsCommandAckMsg, WsServerMsg, WsSnapshotMsg } from '../types'

export type WsStatus = 'connecting' | 'open' | 'closed' | 'error'

export function useBotWs(): {
  status: WsStatus
  snapshot: BotUiSnapshot | null
  logLines: string[]
  sendCommand: (cmd: BotUiCommand) => Promise<WsCommandAckMsg>
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
  const idSeqRef = useRef<number>(0)
  const pendingRef = useRef<Map<string, { resolve: (v: WsCommandAckMsg) => void; reject: (e: Error) => void; t: number }>>(
    new Map(),
  )

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
        // Reject all pending command promises on disconnect.
        for (const [, p] of pendingRef.current.entries()) {
          window.clearTimeout(p.t)
          try {
            p.reject(new Error('ws_closed'))
          } catch {
            // ignore
          }
        }
        pendingRef.current.clear()
        if (stopped) return
        const delay = Math.min(10_000, 250 * Math.pow(2, retry))
        retry += 1
        retryTimer = window.setTimeout(connect, delay)
      }

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as WsServerMsg
          if (!msg) return
          if (msg.type === 'snapshot') {
            const snapMsg = msg as WsSnapshotMsg
            setSnapshot(snapMsg.snapshot)
            if (snapMsg.logsText?.lines && snapMsg.logsText.lines.length > 0) {
              setLogLines((prev) => {
                const next = prev.concat(snapMsg.logsText!.lines)
                return next.length > keepLastLines ? next.slice(next.length - keepLastLines) : next
              })
            }
            return
          }
          if (msg.type === 'command_ack') {
            const ack = msg as WsCommandAckMsg
            const p = pendingRef.current.get(ack.id)
            if (!p) return
            pendingRef.current.delete(ack.id)
            window.clearTimeout(p.t)
            p.resolve(ack)
            return
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
    sendCommand: async (cmd: BotUiCommand) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error('ws_not_open')
      }
      const id = `${Date.now()}-${(idSeqRef.current += 1)}`
      const msg: WsClientMsg = { type: 'command', id, command: cmd }
      return await new Promise<WsCommandAckMsg>((resolve, reject) => {
        const t = window.setTimeout(() => {
          pendingRef.current.delete(id)
          reject(new Error('command_timeout'))
        }, 10_000)
        pendingRef.current.set(id, { resolve, reject, t })
        try {
          ws.send(JSON.stringify(msg))
        } catch (err) {
          window.clearTimeout(t)
          pendingRef.current.delete(id)
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      })
    },
    clearLogs: () => {
      setLogLines([])
    },
  }
}


