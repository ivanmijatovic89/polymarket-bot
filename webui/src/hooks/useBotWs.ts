import { useEffect, useMemo, useRef, useState } from 'react'
import type { BotUiSnapshot, LogRecord, WsSnapshotMsg } from '../types'

export type WsStatus = 'connecting' | 'open' | 'closed' | 'error'

export function useBotWs(): {
  status: WsStatus
  snapshot: BotUiSnapshot | null
  logLines: string[]
  logRecords: LogRecord[]
  clearLogs: () => void
} {
  const [status, setStatus] = useState<WsStatus>('connecting')
  const [snapshot, setSnapshot] = useState<BotUiSnapshot | null>(null)
  const [logLines, setLogLines] = useState<string[]>([])
  const [logRecords, setLogRecords] = useState<LogRecord[]>([])

  const wsUrl = useMemo(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}/ws`
  }, [])

  const keepLastLines = 5000
  const keepLastRecords = 2000
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
          if (msg.logsJson?.records && msg.logsJson.records.length > 0) {
            setLogRecords((prev) => {
              const next = prev.concat(msg.logsJson!.records)
              return next.length > keepLastRecords ? next.slice(next.length - keepLastRecords) : next
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
    logRecords,
    clearLogs: () => {
      setLogLines([])
      setLogRecords([])
    },
  }
}


