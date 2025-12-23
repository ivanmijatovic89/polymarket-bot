import { ClobClient } from '@polymarket/clob-client'
import { Wallet } from 'ethers'

import type { AccountEvent, Fill } from '../strategy/Strategy.js'

export type RestPollAccountSourceOptions = {
  host?: string
  chainId?: number
  privateKey?: string
  creds: { apiKey: string; secret: string; passphrase: string }
  pollIntervalMs?: number
  enabled?: boolean
}

export type RestPollAccountSource = {
  start: () => void
  stop: () => void
  onAccountEvent: (cb: (ev: AccountEvent) => void) => () => void
  setEnabled: (enabled: boolean) => void
}

function env(name: string): string | undefined {
  const v = process.env[name]
  return v && v.trim() !== '' ? v : undefined
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = env(name)
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function asMsFromSecString(raw: unknown): number | null {
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    if (!Number.isFinite(n)) return null
    return Math.trunc(n * 1000)
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw * 1000)
  return null
}

export function createRestPollAccountSource(opts: RestPollAccountSourceOptions): RestPollAccountSource {
  const host = opts.host ?? env('CLOB_API_URL') ?? 'https://clob.polymarket.com'
  const chainId = opts.chainId ?? parseIntEnv('CLOB_CHAIN_ID', 137)
  const pk = opts.privateKey ?? env('PRIVATE_KEY') ?? env('POLYMARKET_PRIVATE_KEY')
  if (!pk) throw new Error('[restPollAccountSource] missing PRIVATE_KEY (or POLYMARKET_PRIVATE_KEY)')
  const wallet = new Wallet(pk)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new (ClobClient as any)(host, chainId, wallet, opts.creds)

  const listeners = new Set<(ev: AccountEvent) => void>()
  let running = false
  let enabled = opts.enabled ?? true
  let timer: NodeJS.Timeout | undefined

  // Dedup trade IDs so we can emit fills only once.
  const seenTradeIds = new Set<string>()
  let lastAfterSec: number | undefined

  const emit = (ev: AccountEvent): void => {
    for (const cb of listeners) cb(ev)
  }

  const pollOnce = async (): Promise<void> => {
    if (!running || !enabled) return
    const nowMs = Date.now()
    emit({ kind: 'account_stream_status', tsMs: nowMs, source: 'rest_poll', status: 'connected' })

    // Pull recent trades. Prefer incremental `after` by seconds.
    try {
      const after = lastAfterSec !== undefined ? String(lastAfterSec) : undefined
      // clob-client getTrades supports params; we keep minimal.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const trades: any[] = await client.getTrades(after ? { after } : undefined)
      for (const t of trades) {
        const id = typeof t?.id === 'string' ? t.id : undefined
        if (!id || seenTradeIds.has(id)) continue
        seenTradeIds.add(id)

        const tsMs =
          asMsFromSecString(t?.match_time) ??
          asMsFromSecString(t?.matchtime) ??
          asMsFromSecString(t?.timestamp) ??
          nowMs

        const assetId = typeof t?.asset_id === 'string' ? t.asset_id : undefined
        const market = typeof t?.market === 'string' ? t.market : undefined
        const side = t?.side === 'BUY' || t?.side === 'SELL' ? t.side : undefined
        const price = Number(t?.price)
        const size = Number(t?.size)

        if (!assetId || !side || !Number.isFinite(price) || !Number.isFinite(size)) continue

        const fill: Fill = {
          id,
          tsMs,
          market,
          assetId,
          side,
          price,
          size,
          orderId: typeof t?.taker_order_id === 'string' ? t.taker_order_id : undefined,
          liquidity: 'TAKER',
        }
        emit({ kind: 'fill', fill })

        const sec = Math.floor(tsMs / 1000)
        if (lastAfterSec === undefined || sec > lastAfterSec) lastAfterSec = sec
      }
    } catch (err) {
      emit({
        kind: 'account_stream_status',
        tsMs: Date.now(),
        source: 'rest_poll',
        status: 'disconnected',
        info: `getTrades failed: ${err instanceof Error ? err.message : String(err)}`,
      })
    }

    // Open orders can be reconciled later; v1 focuses on fills for portfolio correctness.
  }

  const loop = (): void => {
    if (!running) return
    const interval = Math.max(250, opts.pollIntervalMs ?? parseIntEnv('CLOB_POLL_INTERVAL_MS', 1_000))
    timer = setTimeout(() => {
      void pollOnce().finally(() => loop())
    }, interval)
  }

  return {
    start: () => {
      if (running) return
      running = true
      void pollOnce().finally(() => loop())
    },
    stop: () => {
      running = false
      if (timer) clearTimeout(timer)
      timer = undefined
      emit({ kind: 'account_stream_status', tsMs: Date.now(), source: 'rest_poll', status: 'disconnected' })
    },
    onAccountEvent: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    setEnabled: (v) => {
      enabled = v
    },
  }
}

