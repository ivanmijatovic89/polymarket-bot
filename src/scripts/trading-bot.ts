import { getCurrentUpDown15mMarket, type UpDown15mSymbol } from '../polymarket/upDown15m.js'
import { parseOptionalAuth } from '../polymarket/auth.js'
import { createLiveMarketEventSource } from '../polymarket/liveMarketEventSource.js'
import { createRawMarketEventLogger } from '../ingest/rawMarketEventLogger.js'
import { createWindowBoundaryScheduler, msUntilNextBoundary } from '../utils/windowBoundary.js'
import { FIFTEEN_MIN_MS as FIFTEEN_MIN_MS_CONST } from '../utils/timeWindows.js'

process.on('unhandledRejection', (reason) => {
  console.error('[trading-bot] unhandledRejection', reason)
})

process.on('uncaughtException', (err) => {
  console.error('[trading-bot] uncaughtException', err)
  process.exit(1)
})

// Keep a local alias for readability in logs/schedulers.
const FIFTEEN_MIN_MS = FIFTEEN_MIN_MS_CONST

async function main(): Promise<void> {
  const wsUrl =
    process.env.POLYMARKET_WS_URL ?? 'wss://ws-subscriptions-clob.polymarket.com/ws/market'

  const rawSymbol = process.env.TRADING_SYMBOL ?? process.env.RECORD_SYMBOL
  if (!rawSymbol) {
    throw new Error('[trading-bot] TRADING_SYMBOL is required (BTC|ETH|SOL|XRP)')
  }
  const symbol = rawSymbol.trim().toLowerCase() as UpDown15mSymbol
  if (symbol !== 'btc' && symbol !== 'eth' && symbol !== 'sol' && symbol !== 'xrp') {
    throw new Error(`[trading-bot] invalid TRADING_SYMBOL=${rawSymbol} (expected BTC|ETH|SOL|XRP)`)
  }

  const auth = parseOptionalAuth()
  console.log(`[trading-bot] symbol=${symbol}`)
  console.log(`[trading-bot] wsUrl=${wsUrl}`)

  let shouldStop = false
  let isRotating = false
  let currentSlug: string | undefined

  const logger = createRawMarketEventLogger()

  const resolveAssetsIds = async (): Promise<{ assetsIds: string[]; label?: string }> => {
    const m = await getCurrentUpDown15mMarket(symbol, new Date())
    if (!m)
      throw new Error(
        `[trading-bot] No current ${symbol.toUpperCase()} 15m Up/Down market found on Gamma`,
      )
    currentSlug = m.slug
    const assetsIds = m.clobTokenIds.slice(0, 2)
    return { assetsIds, label: `gamma:${m.slug}` }
  }

  const source = createLiveMarketEventSource({
    url: wsUrl,
    ...(auth ? { auth } : {}),
    resolveAssetsIds,
  })

  source.onEvent((ev) => {
    if (shouldStop || isRotating) return
    // Strategy pipeline will eventually go here:
    // raw_json -> decoder -> orderbook -> Tick -> strategy -> orders
    logger.onEvent(ev)
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
        typeof s.code === 'number' ? ` code=${s.code} reason=${s.reason ?? ''}` : s.info ? ` ${s.info}` : ''
      console.log(`[trading-bot] disconnected${extra}`)
    }
  })

  let statsInterval: NodeJS.Timeout | undefined
  statsInterval = setInterval(() => {
    const snap = logger.snapshot()
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

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  source.start()
  boundaryScheduler.start()
}

main().catch((err) => {
  console.error('[trading-bot] fatal error', err)
  process.exit(1)
})

