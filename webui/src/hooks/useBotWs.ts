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

    // In dev, use the Vite proxy for WebSocket connections.
    // This ensures WebSocket works whether accessed locally or from the network,
    // as the proxy handles routing to the bot server correctly.
    // The proxy is configured in vite.config.ts to forward /ws to the bot server.
    const sameOrigin = `${proto}//${window.location.host}/ws`

    // Always use same-origin (via Vite proxy) in dev mode for consistent behavior
    // regardless of whether accessed locally or from network.
    return sameOrigin
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


