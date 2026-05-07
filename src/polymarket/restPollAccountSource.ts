import type { ClobClient } from '@polymarket/clob-client'
import { Wallet } from 'ethers'

import type { AccountEvent, Fill } from '../strategy/Strategy.js'
import { loadPolymarketConfigFromEnv, type PolymarketConfig } from './config.js'
import { createClobClient } from './clobClient.js'

export type RestPollAccountSourceOptions = {
  /**
   * Optional config override. If not provided, config will be loaded from environment variables.
   */
  config?: PolymarketConfig
  /**
   * Optional overrides for specific config values.
   */
  overrides?: {
    host?: string
    chainId?: number
    privateKey?: string
    creds?: PolymarketConfig['creds']
    signatureType?: number
    funder?: string
  }
  pollIntervalMs?: number
  enabled?: boolean
}

export type RestPollAccountSource = {
  start: () => void
  stop: () => void
  onAccountEvent: (cb: (ev: AccountEvent) => void) => () => void
  setEnabled: (enabled: boolean) => void
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

export function createRestPollAccountSource(
  opts: RestPollAccountSourceOptions = {},
): RestPollAccountSource {
  // Lazy initialization: only create ClobClient when we actually need it (when enabled)
  let client: ClobClient | undefined = undefined
  let wallet: Wallet | undefined = undefined

  const getClient = (): ClobClient => {
    if (!client) {
      // Get wallet address for logging (create wallet temporarily if needed)
      if (!wallet) {
        const config = opts.config ?? loadPolymarketConfigFromEnv()
        const privateKey = opts.overrides?.privateKey ?? config.privateKey
        if (!privateKey) {
          throw new Error('[rest-poll] Missing privateKey')
        }
        wallet = new Wallet(privateKey)
      }

      console.log('[rest-poll] Initializing ClobClient', {
        walletAddress: wallet.address,
      })

      try {
        client = createClobClient({
          ...(opts.config !== undefined ? { config: opts.config } : {}),
          ...(opts.overrides !== undefined ? { overrides: opts.overrides } : {}),
        })
        console.log('[rest-poll] ClobClient initialized successfully')
      } catch (err) {
        console.error('[rest-poll] Failed to initialize ClobClient:', err)
        throw err
      }
    }
    return client
  }

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
    if (!running || !enabled) {
      // Safety check: if somehow pollOnce is called when disabled, log it
      if (running && !enabled) {
        console.warn('[rest-poll] pollOnce called but poller is disabled - this should not happen')
      }
      return
    }
    const nowMs = Date.now()
    emit({ kind: 'account_stream_status', tsMs: nowMs, source: 'rest_poll', status: 'connected' })

    // Pull recent trades. Prefer incremental `after` by seconds.
    try {
      const clobClient = getClient()
      const after = lastAfterSec !== undefined ? String(lastAfterSec) : undefined
      console.log('[rest-poll] Fetching trades', { after, lastAfterSec })

      // clob-client getTrades supports params; we keep minimal.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const trades: any[] = await clobClient.getTrades(after ? { after } : undefined)

      console.log('[rest-poll] Received trades', { count: trades?.length ?? 0, trades })
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
      const errorMsg = err instanceof Error ? err.message : String(err)
      const isAuthError =
        errorMsg.includes('401') ||
        errorMsg.includes('Unauthorized') ||
        errorMsg.includes('Invalid api key')

      if (isAuthError) {
        console.error(
          '[rest-poll] Authentication failed when fetching trades. ' +
            'Check your POLYMARKET_API_KEY, POLYMARKET_API_SECRET, and POLYMARKET_API_PASSPHRASE credentials. ' +
            'The API key may be invalid or expired. Disabling REST poller to avoid repeated errors.',
        )
        // Disable poller on auth error to avoid spamming errors
        enabled = false
        if (timer) {
          clearTimeout(timer)
          timer = undefined
        }
      }

      emit({
        kind: 'account_stream_status',
        tsMs: Date.now(),
        source: 'rest_poll',
        status: 'disconnected',
        info: `getTrades failed: ${errorMsg}`,
      })
    }

    // Open orders can be reconciled later; v1 focuses on fills for portfolio correctness.
  }

  const loop = (): void => {
    if (!running) return
    const interval = Math.max(250, opts.pollIntervalMs ?? 1_000)
    timer = setTimeout(() => {
      void pollOnce().finally(() => loop())
    }, interval)
  }

  return {
    start: () => {
      if (running) return
      running = true
      // Only start polling if enabled, otherwise just mark as running but don't poll
      if (enabled) {
        void pollOnce().finally(() => loop())
      }
    },
    stop: () => {
      running = false
      if (timer) clearTimeout(timer)
      timer = undefined
      emit({
        kind: 'account_stream_status',
        tsMs: Date.now(),
        source: 'rest_poll',
        status: 'disconnected',
      })
    },
    onAccountEvent: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    setEnabled: (v) => {
      const wasEnabled = enabled
      enabled = v
      // If we're running and just got enabled, start polling
      if (running && enabled && !wasEnabled) {
        console.log('[rest-poll] Poller enabled and starting to poll')
        void pollOnce().finally(() => loop())
      } else if (running && !enabled && wasEnabled) {
        console.log('[rest-poll] Poller disabled - stopping polling loop')
        if (timer) {
          clearTimeout(timer)
          timer = undefined
        }
      }
    },
  }
}
