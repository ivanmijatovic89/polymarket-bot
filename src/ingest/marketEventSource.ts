export type MarketEvent = {
  /**
   * Local timestamp when the event entered the process.
   * - Live WS: Date.now() at message receipt
   * - Replay: row.ts_local_ms from parquet (original capture time)
   */
  tsLocalMs: bigint
  /** Raw JSON WS message payload */
  raw: string
}

export type MarketEventStatus =
  | { kind: 'connected'; attempt: number; info?: string }
  | { kind: 'reconnecting'; attempt: number; delayMs: number; info?: string }
  | { kind: 'disconnected'; attempt: number; code?: number; reason?: string; info?: string }

export type MarketEventSource = {
  start: () => void
  stop: () => void
  onEvent: (cb: (ev: MarketEvent) => void) => () => void
  onStatus: (cb: (s: MarketEventStatus) => void) => () => void
}
