import { loadPolymarketConfigFromEnv } from '../polymarket/config.js'
import { requireUpDown15mSymbolFromEnv } from '../polymarket/symbols.js'
import { createLiveMarketEventSource } from '../polymarket/liveMarketEventSource.js'
import { createMarketEventHandler } from '../market/marketEventHandler.js'
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

  const dryRun = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false'
  console.log(`[trading-bot] dryRun=${dryRun}`)

  let shouldStop = false
  let isRotating = false
  let currentSlug: string | undefined

  const handler = createMarketEventHandler()

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
  console.log(`[trading-bot] strategy=${built.strategyId}`)
  const logTrades = (process.env.LOG_TRADES ?? 'false').toLowerCase() === 'true'

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

  const exec = dryRun
    ? {
        placeLimit: async () => ({ events: [] }),
        cancelOrder: async () => ({ events: [] }),
        cancelAll: async () => ({ events: [] }),
        onMarketTick: async () => ({ events: [] }),
      }
    : new LiveExecution({
        host: cfg.clob.host,
        chainId: cfg.clob.chainId,
        privateKey: cfg.privateKey!,
        creds: cfg.creds!,
        signatureType: cfg.clob.signatureType,
        ...(cfg.clob.funder ? { funder: cfg.clob.funder } : {}),
      })
  const orderManager = new OrderManager({
    execution: exec,
    dryRun,
    log: (msg, extra) => console.log(msg, extra ?? ''),
  })
  const runner = new StrategyRunner({
    strategy,
    orderManager,
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
    currentSlug = r.slug
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

  const userWs = haveCreds
    ? createUserWsAccountSource({
        url: cfg.ws.userUrl,
        auth: cfg.creds!,
      })
    : null
  const poller =
    haveCreds && havePrivateKey
      ? createRestPollAccountSource({
          host: cfg.clob.host,
          chainId: cfg.clob.chainId,
          privateKey: cfg.privateKey!,
          pollIntervalMs: cfg.clob.pollIntervalMs,
          creds: cfg.creds!,
          // Start disabled; enable only when user WS disconnects.
          enabled: false,
        })
      : null

  userWs?.onAccountEvent((ev) => {
    // If user WS disconnects, enable polling fallback; if connected, disable it.
    if (ev.kind === 'account_stream_status' && poller) {
      if (ev.source === 'user_ws' && ev.status === 'disconnected') poller.setEnabled(true)
      if (ev.source === 'user_ws' && ev.status === 'connected') poller.setEnabled(false)
    }
    void runner.onAccountEvent(ev)
  })
  poller?.onAccountEvent((ev) => {
    void runner.onAccountEvent(ev)
  })

  source.onEvent((ev) => {
    if (shouldStop || isRotating) return
    handler.handle(ev)

    void marketEngine
      .handleRaw({
        rawJson: ev.raw,
        source: { kind: 'live', attempt: wsAttempt },
      })
      .catch((err) => {
        console.error('[trading-bot] MarketEngine.handleRaw failed', err)
        // If we somehow see a different market than expected, reset and keep going.
        marketEngine.reset()
      })
  })

  source.onStatus((s) => {
    if (shouldStop || isRotating) return
    if (s.kind === 'connected') {
      wsAttempt = s.attempt
      // New websocket session / potential new market: reset local orderbook state.
      marketEngine.reset()
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
      marketEngine.reset()
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
    process.exit(0)
  }
  installSignalHandlers({ onSignal: shutdown })

  source.start()
  boundaryScheduler.start()
  userWs?.start()
  poller?.start()
}

main().catch((err) => {
  console.error('[trading-bot] fatal error', err)
  process.exit(1)
})
