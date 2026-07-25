import WebSocket, { type ClientOptions, type RawData } from 'ws'

export type WsHeartbeatOptions = {
  /**
   * If set, send ws pings on this interval (keep NAT/proxies warm).
   * Set to undefined/0 to disable.
   */
  pingIntervalMs?: number
  /**
   * If set, terminate the socket when no activity has been observed for this
   * long. If omitted (or 0), we will NOT terminate due to inactivity (quiet
   * streams are allowed — e.g. the user WS).
   *
   * The dead-check runs on its OWN timer, independent of `pingIntervalMs` —
   * a client that disables ws-level pings (both feed clients do) still gets
   * stall protection. Sockets have twice been observed going silent WITHOUT
   * a close event (RTDS, 2026-07-21 and 2026-07-25 — the second froze the
   * chainlink feed for 28 minutes with zero log output). Recovery uses
   * `terminate()`, not `close()`: a graceful close handshake on a stale
   * socket only completes after ws's ~30s close timeout, long after the
   * consumer's reconnect built a healthy replacement.
   */
  deadAfterMs?: number
  /**
   * Whether incoming messages count as "activity" for deadAfterMs.
   * Defaults to true.
   */
  treatMessagesAsActivity?: boolean
  /**
   * When messages count as activity, only those for which this predicate
   * returns true do. Lets a client key liveness on DATA frames only — e.g.
   * the RTDS client excludes text "PONG" replies and non-data topics, so a
   * server that keeps answering pings while the subscription is stalled
   * still trips the dead-check. Default: every message counts.
   */
  isActivity?: (raw: string) => boolean
  /**
   * Observability hook: called once, just before the dead-check terminates
   * the socket. The subsequent `onClose` is the normal teardown path.
   */
  onDead?: (info: { idleMs: number }) => void
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

/** Dead-check poll cadence: fine-grained for short thresholds (tests), capped at 5s. */
export function deadCheckIntervalMs(deadAfterMs: number): number {
  return Math.max(50, Math.min(5_000, Math.trunc(deadAfterMs / 4)))
}

export function createWsConnection(opts: WsConnectionOptions): WsConnection {
  const ws = new WebSocket(opts.url, opts.wsOptions)

  const treatMessagesAsActivity = opts.heartbeat?.treatMessagesAsActivity ?? true
  const pingIntervalMs = opts.heartbeat?.pingIntervalMs ?? 0
  const deadAfterMs = opts.heartbeat?.deadAfterMs ?? 0
  const isActivity = opts.heartbeat?.isActivity

  let pingTimer: NodeJS.Timeout | undefined
  let deadTimer: NodeJS.Timeout | undefined
  let lastActivityMs = Date.now()

  const bump = (): void => {
    lastActivityMs = Date.now()
  }

  const clearTimers = (): void => {
    if (pingTimer) clearInterval(pingTimer)
    pingTimer = undefined
    if (deadTimer) clearInterval(deadTimer)
    deadTimer = undefined
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
        safePing()
      }, pingIntervalMs)
    }

    // Dead-check on its own timer — deliberately NOT coupled to the ping
    // interval (the old coupling made deadAfterMs silently inert for every
    // client with pingIntervalMs: 0).
    if (deadAfterMs > 0) {
      deadTimer = setInterval(() => {
        const idleMs = Date.now() - lastActivityMs
        if (idleMs > deadAfterMs) {
          clearTimers()
          opts.heartbeat?.onDead?.({ idleMs })
          try {
            ws.terminate()
          } catch {
            // ignore
          }
        }
      }, deadCheckIntervalMs(deadAfterMs))
    }
  })

  ws.on('pong', () => {
    bump()
  })

  ws.on('message', (data: RawData) => {
    // Some servers send JSON as "binary" frames. We still try to decode as UTF-8 text.
    const s = rawDataToString(data)
    if (treatMessagesAsActivity && (s === null || !isActivity || isActivity(s))) bump()
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
