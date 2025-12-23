import { parseOptionalAuth } from '../polymarket/auth.js'
import { requireUpDown15mSymbolFromEnv } from '../polymarket/symbols.js'
import { createLiveMarketEventSource } from '../polymarket/liveMarketEventSource.js'
import { createMarketEventHandler } from '../engine/marketEventHandler.js'
import { createWindowBoundaryScheduler, msUntilNextBoundary } from '../utils/windowBoundary.js'
import { FIFTEEN_MIN_MS as FIFTEEN_MIN_MS_CONST } from '../utils/timeWindows.js'
import { resolveCurrentUpDown15mAssets } from '../polymarket/resolveUpDown15mAssets.js'
import { installProcessCrashHandlers, installSignalHandlers } from '../utils/runtime.js'
import { MarketOrderBookEngine } from '../orderbook/OrderBookEngine.js'
import type { AnyMarketMessage, MarketOrderBooksSnapshot } from '../orderbook/OrderBookEngine.js'

installProcessCrashHandlers({ prefix: 'trading-bot' })

// Keep a local alias for readability in logs/schedulers.
const FIFTEEN_MIN_MS = FIFTEEN_MIN_MS_CONST

function parseBoolEnv(name: string, fallback = false): boolean {
  const raw = process.env[name]
  if (!raw) return fallback
  const s = raw.trim().toLowerCase()
  if (s === '1' || s === 'true' || s === 'yes' || s === 'y') return true
  if (s === '0' || s === 'false' || s === 'no' || s === 'n') return false
  return fallback
}

function tryParseWsMessage(raw: string): AnyMarketMessage | null {
  try {
    const obj: unknown = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return null
    const rec = obj as Record<string, unknown>
    const t = rec.event_type
    if (
      t === 'book' ||
      t === 'price_change' ||
      t === 'tick_size_change' ||
      t === 'last_trade_price'
    ) {
      return obj as AnyMarketMessage
    }
    return null
  } catch {
    return null
  }
}

function bestsByAsset(
  snap: MarketOrderBooksSnapshot,
): Record<string, { bestBid: number | null; bestAsk: number | null }> {
  const out: Record<string, { bestBid: number | null; bestAsk: number | null }> = {}
  for (const [assetId, book] of Object.entries(snap.byAssetId)) {
    out[assetId] = { bestBid: book.bestBid, bestAsk: book.bestAsk }
  }
  return out
}

async function main(): Promise<void> {
  const wsUrl =
    process.env.POLYMARKET_WS_URL ?? 'wss://ws-subscriptions-clob.polymarket.com/ws/market'

  const symbol = requireUpDown15mSymbolFromEnv({
    primaryEnv: 'TRADING_SYMBOL',
    fallbackEnv: 'RECORD_SYMBOL',
    requiredName: 'TRADING_SYMBOL',
    script: 'trading-bot',
  })

  const auth = parseOptionalAuth()
  console.log(`[trading-bot] symbol=${symbol}`)
  console.log(`[trading-bot] wsUrl=${wsUrl}`)

  let shouldStop = false
  let isRotating = false
  let currentSlug: string | undefined
  let tokenMap: Record<string, string> = {}

  const handler = createMarketEventHandler()

  const resolveAssetsIds = async (): Promise<{ assetsIds: string[]; label?: string }> => {
    const r = await resolveCurrentUpDown15mAssets({ symbol, date: new Date() })
    currentSlug = r.slug
    tokenMap = r.tokenMap
    return { assetsIds: r.assetsIds, label: r.label }
  }

  const source = createLiveMarketEventSource({
    url: wsUrl,
    ...(auth ? { auth } : {}),
    resolveAssetsIds,
  })

  const logFullBook = parseBoolEnv('TRADING_LOG_FULL_BOOK', true)
  const logEveryN = Number(process.env.TRADING_LOG_EVERY_N ?? '100')
  const logEveryNEvents = Number.isFinite(logEveryN) && logEveryN > 0 ? Math.trunc(logEveryN) : 100

  let marketEngine: MarketOrderBookEngine | undefined
  let obEvents = 0

  source.onEvent((ev) => {
    if (shouldStop || isRotating) return
    handler.handle(ev)

    const msg = tryParseWsMessage(ev.raw)
    if (!msg) return

    // Keep the engine market-aligned. On 15m rotation / reconnect, Polymarket will switch markets.
    if (!marketEngine) marketEngine = new MarketOrderBookEngine()
    try {
      marketEngine.applyAny(msg)
    } catch {
      // If the engine throws due to market mismatch, reset and try again.
      marketEngine = new MarketOrderBookEngine()
      try {
        marketEngine.applyAny(msg)
      } catch {
        return
      }
    }

    obEvents += 1

    const snap = marketEngine.snapshot()

    // Periodic summary: show best bid/ask for each asset_id (token).
    if (obEvents % logEveryNEvents === 0) {
      console.log('[trading-bot][orderbook]', {
        n: obEvents,
        market: snap.market,
        ts: snap.timestamp,
        slug: currentSlug ?? 'n/a',
        tokenMap,
        bestsByAsset: bestsByAsset(snap),
      })
    }

    // On snapshot books, optionally print full orderbooks (all levels) for both tokens.
    if (msg.event_type === 'book' && logFullBook) {
      console.log('[trading-bot][orderbook:full]', {
        n: obEvents,
        market: snap.market,
        ts: snap.timestamp,
        slug: currentSlug ?? 'n/a',
        tokenMap,
        byAssetId: snap.byAssetId,
      })
    }
  })

  source.onStatus((s) => {
    if (shouldStop || isRotating) return
    if (s.kind === 'connected') {
      console.log(`[trading-bot] connected (${s.info ?? 'ws'})`)
      return
    }
    if (s.kind === 'reconnecting') {
      const extra = s.info ? ` (${s.info})` : ''
      console.log(`[trading-bot] reconnecting in ${s.delayMs}ms${extra}`)
      return
    }
    if (s.kind === 'disconnected') {
      const extra =
        typeof s.code === 'number'
          ? ` code=${s.code} reason=${s.reason ?? ''}`
          : s.info
            ? ` ${s.info}`
            : ''
      console.log(`[trading-bot] disconnected${extra}`)
    }
  })

  let statsInterval: NodeJS.Timeout | undefined
  statsInterval = setInterval(() => {
    const snap = handler.snapshot()
    const candleLeft = msUntilNextBoundary(Date.now(), FIFTEEN_MIN_MS)
    console.log(
      `[trading-bot] stats total=${snap.total} dropped_no_market=${snap.droppedNoMarket} dropped_bad_json=${snap.droppedBadJson} dropped_unknown_type=${snap.droppedUnknownType} candle_left_ms=${candleLeft} slug=${currentSlug ?? 'n/a'}`,
    )
  }, 10_000)

  const rotateAndReconnect = (): void => {
    void (async () => {
      if (shouldStop) return
      if (isRotating) return
      isRotating = true
      source.stop()
      // No stateful resources yet (strategy/order manager will flush here).
      isRotating = false
      source.start()
    })().catch((err) => {
      console.error('[trading-bot] rotate failed', err)
      isRotating = false
    })
  }

  const boundaryScheduler = createWindowBoundaryScheduler({
    windowMs: FIFTEEN_MIN_MS,
    onBoundary: () => {
      if (shouldStop) return
      rotateAndReconnect()
    },
  })

  const shutdown = (signal: 'SIGINT' | 'SIGTERM'): void => {
    console.log(`[trading-bot] ${signal} received, shutting down...`)
    shouldStop = true
    isRotating = true
    boundaryScheduler.stop()
    if (statsInterval) clearInterval(statsInterval)
    statsInterval = undefined
    source.stop()
    process.exit(0)
  }
  installSignalHandlers({ onSignal: shutdown })

  source.start()
  boundaryScheduler.start()
}

main().catch((err) => {
  console.error('[trading-bot] fatal error', err)
  process.exit(1)
})
