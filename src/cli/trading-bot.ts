import { loadPolymarketConfigFromEnv } from '../polymarket/config.js'
import { requireUpDown15mSymbolFromEnv } from '../polymarket/symbols.js'
import { createLiveMarketEventSource } from '../polymarket/liveMarketEventSource.js'
import { MarketEngine } from '../market/MarketEngine.js'
import { createWindowBoundaryScheduler, msUntilNextBoundary } from '../utils/windowBoundary.js'
import { FIFTEEN_MIN_MS as FIFTEEN_MIN_MS_CONST } from '../utils/timeWindows.js'
import { resolveCurrentUpDown15mAssets } from '../polymarket/resolveUpDown15mAssets.js'
import { installProcessCrashHandlers, installSignalHandlers } from '../utils/runtime.js'
import { StrategyRunner } from '../trading/StrategyRunner.js'
import { OrderManager } from '../trading/OrderManager.js'
import { LiveExecution } from '../trading/execution/LiveExecution.js'
import { createUserWsAccountSource } from '../polymarket/ws/userWsAccountSource.js'
import { createRestPollAccountSource } from '../polymarket/restPollAccountSource.js'
import { buildStrategyFromCliArgs, printCliArgsError } from './helpers/strategyArgs.js'
import { logBalanceAndApproval } from '../blockchain/checkBalanceAndApproval.js'
import { throwIfPreviousWindowSlug } from '../polymarket/upDown15mWindowGuard.js'
import { createExternalFeedsStore } from '../trading/feeds/externalFeeds.js'
import { createRtdsCryptoPricesClient } from '../trading/feeds/rtdsCryptoPricesClient.js'
import { createBinanceWsSpotPriceClient } from '../trading/feeds/binanceWsSpotPriceClient.js'
import { createPolymarketPriceToBeatClient } from '../trading/feeds/polymarketPriceToBeatClient.js'
import type { GammaMarketMeta } from '../polymarket/gammaMarketMeta.js'

installProcessCrashHandlers({ prefix: 'trading-bot' })

// Keep a local alias for readability in logs/schedulers.
const FIFTEEN_MIN_MS = FIFTEEN_MIN_MS_CONST

async function main(): Promise<void> {
  const cfg = loadPolymarketConfigFromEnv()
  const wsUrl = cfg.ws.marketUrl

  const symbol = requireUpDown15mSymbolFromEnv({
    primaryEnv: 'TRADING_SYMBOL',
    fallbackEnv: 'RECORD_SYMBOL',
    requiredName: 'TRADING_SYMBOL',
    script: 'trading-bot',
  })

  const auth = cfg.creds
  console.log(`[trading-bot] symbol=${symbol}`)
  console.log(`[trading-bot] wsUrl=${wsUrl}`)

  const dryRun = (process.env.DRY_RUN ?? 'false').toLowerCase() !== 'false'
  console.log(`[trading-bot] dryRun=${dryRun}`)

  const intentExecutionModeEnv = (process.env.INTENT_EXECUTION_MODE ?? 'immediate').toLowerCase()
  const intentExecutionMode =
    intentExecutionModeEnv === 'queued' || intentExecutionModeEnv === 'immediate'
      ? (intentExecutionModeEnv as 'queued' | 'immediate')
      : 'immediate'
  console.log(`[trading-bot] intentExecutionMode=${intentExecutionMode}`)

  const maxEventsPerDrainRaw = process.env.MAX_EVENTS_PER_DRAIN
  const maxEventsPerDrainParsed = maxEventsPerDrainRaw ? Number(maxEventsPerDrainRaw) : NaN
  const maxEventsPerDrain =
    Number.isFinite(maxEventsPerDrainParsed) && Number.isInteger(maxEventsPerDrainParsed)
      ? Math.max(1, maxEventsPerDrainParsed)
      : 100
  console.log(`[trading-bot] maxEventsPerDrain=${maxEventsPerDrain}`)

  let shouldStop = false
  let isRotating = false
  let currentSlug: string | undefined
  let currentMarket: GammaMarketMeta | undefined

  let totalWsEvents = 0

  // Best-effort attempt tracking from WS status events (used in MarketEngine source metadata).
  let wsAttempt = 1

  const built = (() => {
    try {
      return buildStrategyFromCliArgs({ argv: process.argv.slice(2), script: 'trading-bot' })
    } catch (err) {
      printCliArgsError({ script: 'trading-bot', err })
      process.exit(2)
    }
  })()
  const strategy = built.strategy
  const indicatorSet = built.indicatorSet
  console.log(`[trading-bot] strategy=${built.strategyId}`)
  const logTrades = (process.env.LOG_TRADES ?? 'false').toLowerCase() === 'true'

  // Optional external feeds (live-only). Enabled only if strategy opts in.
  const rtdsReq = strategy.requiredFeeds?.rtdsCryptoPrices
  const rtdsBinanceSymbols = rtdsReq?.binanceSymbols ?? []
  // NOTE: Chainlink symbols are slash-separated in RTDS docs (e.g. "btc/usd").
  const rtdsChainlinkSymbols = rtdsReq?.chainlinkSymbols ?? []
  const rtdsEnabled = rtdsBinanceSymbols.length > 0 || rtdsChainlinkSymbols.length > 0

  if (rtdsReq && !rtdsEnabled) {
    console.warn(
      '[trading-bot] rtdsCryptoPrices requested but no symbols configured; RTDS feed disabled (no prices will be available)',
    )
  }

  const binanceWsReq = strategy.requiredFeeds?.binanceWsSpotPrice
  const binanceWsSymbol = (binanceWsReq?.symbol ?? '').toLowerCase().trim()
  const binanceWsEnabled = binanceWsSymbol.length > 0
  if (binanceWsReq && !binanceWsEnabled) {
    console.warn(
      '[trading-bot] binanceWsSpotPrice requested but no symbol configured; Binance WS feed disabled (no prices will be available)',
    )
  }

  const priceToBeatReq = strategy.requiredFeeds?.polymarketPriceToBeat
  const priceToBeatEnabled = priceToBeatReq?.enabled === true

  const feedsEnabled =
    (rtdsReq && rtdsEnabled) || (binanceWsReq && binanceWsEnabled) || priceToBeatEnabled
  const feedsStore = feedsEnabled ? createExternalFeedsStore() : null

  const rtdsClient =
    rtdsReq && rtdsEnabled
      ? createRtdsCryptoPricesClient({
          binanceSymbols: rtdsBinanceSymbols,
          chainlinkSymbols: rtdsChainlinkSymbols,
          onBinanceUpdate: (u) => feedsStore!.updateBinance(u),
          onChainlinkUpdate: (u) => feedsStore!.updateChainlink(u),
          onStatus: (s) => {
            const extra = s.info ? ` ${s.info}` : ''
            console.log(`[trading-bot] rtds ${s.kind} attempt=${s.attempt}${extra}`)
          },
        })
      : null

  const binanceWsClient =
    binanceWsReq && binanceWsEnabled
      ? createBinanceWsSpotPriceClient({
          symbol: binanceWsSymbol,
          onPrice: (u) => feedsStore!.updateBinanceWsSpotPrice(u),
          onStatus: (s) => {
            const extra = s.info ? ` ${s.info}` : ''
            console.log(`[trading-bot] binance_ws ${s.kind} attempt=${s.attempt}${extra}`)
          },
        })
      : null

  let priceToBeatClient: ReturnType<typeof createPolymarketPriceToBeatClient> | null = null
  let priceToBeatSlug: string | null = null

  const restartPriceToBeatIfNeeded = (args: {
    slug: string
    symbolUpper: string
    eventStartTimeIso: string
    endDateIso: string
  }): void => {
    if (!priceToBeatEnabled) return
    if (!feedsStore) return
    if (priceToBeatSlug === args.slug && priceToBeatClient) return

    priceToBeatClient?.stop()
    priceToBeatClient = null
    priceToBeatSlug = args.slug
    // Important: clear previous window's openPrice immediately on market rotation,
    // so strategies don't see stale priceToBeat while polling for the new window.
    feedsStore.clearPolymarketPriceToBeat()

    priceToBeatClient = createPolymarketPriceToBeatClient({
      symbol: args.symbolUpper,
      eventStartTimeIso: args.eventStartTimeIso,
      endDateIso: args.endDateIso,
      variant: 'fifteen',
      pollIntervalMs: 1000,
      onOpenPrice: (u) => {
        feedsStore.updatePolymarketPriceToBeat(u)
      },
      onStatus: (s) => {
        if (s.kind === 'polling') console.log(`[trading-bot] price_to_beat polling`)
        if (s.kind === 'resolved')
          console.log(`[trading-bot] price_to_beat resolved openPrice=${feedsStore.snapshot().polymarketPriceToBeat?.openPrice}`)
      },
    })
    priceToBeatClient.start()
  }

  // In dry-run, don't require PRIVATE_KEY or construct LiveExecution.
  if (!dryRun) {
    if (!cfg.privateKey) {
      throw new Error('[trading-bot] missing PRIVATE_KEY (or POLYMARKET_PRIVATE_KEY)')
    }
    if (!cfg.creds) {
      throw new Error(
        '[trading-bot] missing API creds (need POLYMARKET_API_KEY/POLYMARKET_API_SECRET/POLYMARKET_API_PASSPHRASE or CLOB_* equivalents)',
      )
    }
  }

  // Check balance and approval before starting (only if not dry run and we have private key)
  if (!dryRun && cfg.privateKey) {
    const rpcUrl = process.env.POLYGON_RPC_URL ?? 'https://polygon-rpc.com'
    try {
      await logBalanceAndApproval({
        rpcUrl,
        privateKey: cfg.privateKey,
        chainId: cfg.clob.chainId,
        clobHost: cfg.clob.host,
      })
    } catch (err) {
      console.error('[trading-bot] Balance/approval check failed:', err)
      console.error('[trading-bot] Exiting. Please fix approvals and balance before starting.')
      process.exit(1)
    }
  }


  const exec = dryRun
    ? {
        placeLimit: async () => ({ events: [] }),
        cancelOrder: async () => ({ events: [] }),
        cancelAll: async () => ({ events: [] }),
        mergePositions: async () => ({ events: [] }),
        onMarketTick: async () => ({ events: [] }),
      }
    : new LiveExecution({
        config: cfg,
      })
  const orderManager = new OrderManager({
    execution: exec,
    dryRun,
    log: (msg, extra) => console.log(msg, extra ?? ''),
  })
  const runner = new StrategyRunner({
    strategy,
    orderManager,
    ...(indicatorSet ? { indicatorSet } : {}),
    ...(feedsStore ? { getFeedsSnapshot: () => feedsStore.snapshot() } : {}),
    getMarket: () => currentMarket,
    intentExecutionMode,
    maxEventsPerDrain,
    ...(logTrades ? { log: (msg, extra) => console.log(msg, extra ?? '') } : {}),
  })

  const marketEngine = new MarketEngine({
    onTick: ({ source, msg, snapshot }) => {
      // Drive shared runner on the same cadence live/backtest.
      void runner.onMarketTick({ source, msg, snapshot })
    },
  })

  const resolveAssetsIds = async (): Promise<{ assetsIds: string[]; label?: string }> => {
    const r = await resolveCurrentUpDown15mAssets({ symbol, date: new Date() })

    // console.log(`[trading-bot] resolveCurrentUpDown15mAssets market=${JSON.stringify(r)}`)
    // Avoid subscribing to the previous-window market around boundaries.
    // If Gamma is behind, retry soon instead of connecting to the old slug.
    try {
      throwIfPreviousWindowSlug({
        slug: r.slug,
        symbol,
        windowMs: FIFTEEN_MIN_MS,
        nowMs: Date.now(),
        messagePrefix: '[trading-bot]',
      })
    } catch (err) {
      currentSlug = undefined
      currentMarket = undefined
      throw err
    }

    const prevSlug = currentSlug
    currentSlug = r.slug
    currentMarket = r.market


    if (priceToBeatEnabled) {
      const m = currentMarket as Record<string, unknown> | undefined
      const eventStartTimeIso =
        (typeof m?.eventStartTime === 'string' && m.eventStartTime.length > 0
          ? (m.eventStartTime as string)
          : typeof m?.startDate === 'string' && (m.startDate as string).length > 0
            ? (m.startDate as string)
            : null)
      const endDateIso =
        typeof m?.endDate === 'string' && (m.endDate as string).length > 0 ? (m.endDate as string) : null

      if (eventStartTimeIso && endDateIso) {
        restartPriceToBeatIfNeeded({
          slug: r.slug,
          symbolUpper: symbol.toUpperCase(),
          eventStartTimeIso,
          endDateIso,
        })
      } else {
        console.warn('[trading-bot] price_to_beat enabled but missing eventStartTime/endDate on currentMarket')
      }
    }

    if (prevSlug !== r.slug) {
      const id = typeof r.market.id === 'string' ? r.market.id : undefined
      const q = typeof r.market.question === 'string' ? r.market.question : undefined
      const active = typeof r.market.active === 'boolean' ? r.market.active : undefined
      const closed = typeof r.market.closed === 'boolean' ? r.market.closed : undefined
      console.log('[trading-bot] market changed', {
        from: prevSlug ?? null,
        to: r.slug,
        ...(id ? { id } : {}),
        ...(q ? { question: q } : {}),
        ...(typeof active === 'boolean' ? { active } : {}),
        ...(typeof closed === 'boolean' ? { closed } : {}),
      })
    }

    return { assetsIds: r.assetsIds, label: r.label }
  }

  const source = createLiveMarketEventSource({
    url: wsUrl,
    ...(auth ? { auth } : {}),
    resolveAssetsIds,
  })

  // Account event sources (user WS + REST polling fallback).
  const haveCreds = !!cfg.creds
  const havePrivateKey = !!cfg.privateKey
  if (!haveCreds) {
    console.warn('[trading-bot] missing POLYMARKET_API_* creds; account streams disabled')
  }

  const emitTradeFillsAtStatusEnv = (process.env.USER_WS_FILL_AT_STATUS ?? '').toUpperCase()
  const emitTradeFillsAtStatus =
    emitTradeFillsAtStatusEnv === 'MATCHED' ||
    emitTradeFillsAtStatusEnv === 'MINED' ||
    emitTradeFillsAtStatusEnv === 'CONFIRMED'
      ? (emitTradeFillsAtStatusEnv as 'MATCHED' | 'MINED' | 'CONFIRMED')
      : undefined
  if (emitTradeFillsAtStatus) {
    console.log(`[trading-bot] user ws fills emitAt=${emitTradeFillsAtStatus} (USER_WS_FILL_AT_STATUS)`)
  }

  const userWs = haveCreds
    ? createUserWsAccountSource({
        url: cfg.ws.userUrl,
        auth: cfg.creds!,
        ...(emitTradeFillsAtStatus ? { emitTradeFillsAtStatus } : {}),
      })
    : null
  const poller =
    haveCreds && havePrivateKey
      ? createRestPollAccountSource({
          config: cfg,
          pollIntervalMs: cfg.clob.pollIntervalMs,
          // Disabled by default (enable only when user WS disconnects).
          enabled: false,
        })
      : null

  // Track if user WS has been stably connected (to avoid enabling poller on brief connections)
  let userWsStablyConnected = false
  let userWsConnectedAt: number | undefined
  let stableConnectionTimeout: NodeJS.Timeout | undefined
  let disconnectTimeout: NodeJS.Timeout | undefined

  userWs?.onAccountEvent((ev) => {
    // If user WS disconnects, enable polling fallback; if connected, disable it.
    if (ev.kind === 'account_stream_status' && poller) {
      if (ev.source === 'user_ws') {
        if (ev.status === 'connected') {
          userWsConnectedAt = Date.now()
          // Clear any pending disconnect timeout
          if (disconnectTimeout) {
            clearTimeout(disconnectTimeout)
            disconnectTimeout = undefined
          }
          // Clear any existing stable connection timeout
          if (stableConnectionTimeout) {
            clearTimeout(stableConnectionTimeout)
          }
          // Mark as stably connected only after 10 seconds of stable connection
          stableConnectionTimeout = setTimeout(() => {
            userWsStablyConnected = true
            console.log('[trading-bot] User WS stably connected (10s+) - disabling REST poller')
            poller.setEnabled(false)
            stableConnectionTimeout = undefined
          }, 10_000)
        } else if (ev.status === 'disconnected') {
          // Clear stable connection timeout if connection was too brief
          if (stableConnectionTimeout) {
            clearTimeout(stableConnectionTimeout)
            stableConnectionTimeout = undefined
          }

          if (userWsStablyConnected && userWsConnectedAt) {
            // Only enable poller if user WS was stably connected and then disconnected
            const connectedDuration = Date.now() - userWsConnectedAt
            // Clear any existing timeout
            if (disconnectTimeout) {
              clearTimeout(disconnectTimeout)
            }
            // Wait 3 seconds before enabling poller (in case WS reconnects quickly)
            disconnectTimeout = setTimeout(() => {
              console.log(
                `[trading-bot] User WS disconnected (was stably connected for ${Math.round(connectedDuration / 1000)}s) - enabling REST poller fallback`,
              )
              poller.setEnabled(true)
              disconnectTimeout = undefined
            }, 3000)
            userWsStablyConnected = false
            userWsConnectedAt = undefined
          }
          // If connection was too brief, don't enable poller - just wait for reconnect
        }
      }
    }
    void runner.onAccountEvent(ev)
  })
  poller?.onAccountEvent((ev) => {
    void runner.onAccountEvent(ev)
  })

  source.onEvent((ev) => {
    if (shouldStop || isRotating) return
    totalWsEvents += 1

    void marketEngine
      .handleRaw({
        rawJson: ev.raw,
        source: { kind: 'live', attempt: wsAttempt },
      })
      .catch((err) => {
        console.error('[trading-bot] MarketEngine.handleRaw failed', err)
        // If we somehow see a different market than expected, reset and keep going.
        marketEngine.reset()
        indicatorSet?.reset()
      })
  })

  source.onStatus((s) => {
    if (shouldStop || isRotating) return
    if (s.kind === 'connected') {
      wsAttempt = s.attempt
      // New websocket session / potential new market: reset local orderbook state.
      marketEngine.reset()
      indicatorSet?.reset()
      // External feeds are independent of market WS; do NOT reset them here.
      console.log(`[trading-bot] connected (${s.info ?? 'ws'})`)
      return
    }
    if (s.kind === 'reconnecting') {
      wsAttempt = s.attempt
      const extra = s.info ? ` (${s.info})` : ''
      console.log(`[trading-bot] reconnecting in ${s.delayMs}ms${extra}`)
      return
    }
    if (s.kind === 'disconnected') {
      wsAttempt = s.attempt
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
    const candleLeft = msUntilNextBoundary(Date.now(), FIFTEEN_MIN_MS)
    console.log(
      `[trading-bot] stats ws_events_total=${totalWsEvents} candle_left_ms=${candleLeft} slug=${currentSlug ?? 'n/a'}`,
    )
  }, 10_000)

  const rotateAndReconnect = (): void => {
    void (async () => {
      if (shouldStop) return
      if (isRotating) return
      isRotating = true
      source.stop()
      // No stateful resources yet (strategy/order manager will flush here).
      marketEngine.reset()
      indicatorSet?.reset()
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
    userWs?.stop()
    poller?.stop()
    source.stop()
    rtdsClient?.stop()
    binanceWsClient?.stop()
    priceToBeatClient?.stop()
    process.exit(0)
  }
  installSignalHandlers({ onSignal: shutdown })

  source.start()
  boundaryScheduler.start()
  userWs?.start()
  poller?.start()
  rtdsClient?.start()
  binanceWsClient?.start()
}

main().catch((err) => {
  console.error('[trading-bot] fatal error', err)
  process.exit(1)
})
