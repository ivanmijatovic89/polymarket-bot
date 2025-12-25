import WebSocket, { type ClientOptions, type RawData } from 'ws'

export type WsHeartbeatOptions = {
  /**
   * If set, send ws pings on this interval (keep NAT/proxies warm).
   * Set to undefined/0 to disable.
   */
  pingIntervalMs?: number
  /**
   * If set, terminate the socket when no activity has been observed for this long.
   * If omitted, we will NOT terminate due to inactivity (quiet streams are allowed).
   */
  deadAfterMs?: number
  /**
   * Whether incoming messages count as "activity" for deadAfterMs.
   * Defaults to true.
   */
  treatMessagesAsActivity?: boolean
}

export type WsConnectionOptions = {
  url: string
  wsOptions?: ClientOptions
  heartbeat?: WsHeartbeatOptions
  onOpen?: () => void
  onMessageText?: (raw: string) => void
  onClose?: (code: number, reason: Buffer) => void
  onError?: (err: Error) => void
}

export type WsConnection = {
  send: (text: string) => void
  ping: () => void
  close: () => void
  terminate: () => void
}

function rawDataToString(d: RawData): string | null {
  if (typeof d === 'string') return d
  if (Buffer.isBuffer(d)) return d.toString('utf8')
  if (Array.isArray(d)) return Buffer.concat(d).toString('utf8')
  try {
    // ArrayBuffer / TypedArray / other objects supported by Buffer.from
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Buffer.from(d as any).toString('utf8')
  } catch {
    try {
      return d.toString()
    } catch {
      return null
    }
  }
}

export function createWsConnection(opts: WsConnectionOptions): WsConnection {
  const ws = new WebSocket(opts.url, opts.wsOptions)

  const treatMessagesAsActivity = opts.heartbeat?.treatMessagesAsActivity ?? true
  const pingIntervalMs = opts.heartbeat?.pingIntervalMs ?? 0
  const deadAfterMs = opts.heartbeat?.deadAfterMs

  let pingTimer: NodeJS.Timeout | undefined
  let lastActivityMs = Date.now()

  const bump = (): void => {
    lastActivityMs = Date.now()
  }

  const clearTimers = (): void => {
    if (pingTimer) clearInterval(pingTimer)
    pingTimer = undefined
  }

  const safePing = (): void => {
    try {
      // Only ping when open; otherwise `ws` may throw.
      if (ws.readyState === WebSocket.OPEN) ws.ping()
    } catch {
      // ignore
    }
  }

  ws.on('open', () => {
    bump()
    opts.onOpen?.()

    if (pingIntervalMs > 0) {
      pingTimer = setInterval(() => {
        if (deadAfterMs !== undefined) {
          const now = Date.now()
          if (now - lastActivityMs > deadAfterMs) {
            try {
              ws.terminate()
            } catch {
              // ignore
            }
            return
          }
        }
        safePing()
      }, pingIntervalMs)
    }
  })

  ws.on('pong', () => {
    bump()
  })

  ws.on('message', (data: RawData, isBinary: boolean) => {
    if (isBinary) return
    if (treatMessagesAsActivity) bump()
    const s = rawDataToString(data)
    if (s === null) return
    opts.onMessageText?.(s)
  })

  ws.on('error', (err: Error) => {
    opts.onError?.(err)
  })

  ws.on('close', (code: number, reason: Buffer) => {
    clearTimers()
    opts.onClose?.(code, reason)
  })

  return {
    send: (text: string) => {
      ws.send(text)
    },
    ping: () => {
      safePing()
    },
    close: () => {
      clearTimers()
      ws.close()
    },
    terminate: () => {
      clearTimers()
      ws.terminate()
    },
  }
}
