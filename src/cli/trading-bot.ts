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
import { ExternalFeedsPlugin } from '../strategy/plugins/ExternalFeedsPlugin.js'
import { PluginSet } from '../strategy/plugins/PluginSet.js'
import { ExternalFeedsRequestPlugin } from '../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { computePositionMetricsFromMarket } from '../trading/positionMetrics.js'
import { computeOrderbookMetricsFromMarket } from '../trading/orderbookMetrics.js'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  consoleSink,
  createLogger,
  ringBufferSequencedLinesSink,
  formatRecordToLine,
  jsonlFileSink,
  patchConsole,
} from '../utils/logger.js'
import { createTradingBotWebUiServer, type BotUiCommand, type TradingBotWebUiServer } from './webui/createTradingBotWebUiServer.js'
import type { GammaMarketMeta } from '../polymarket/gammaMarketMeta.js'
import type { CancelAllIntent, CancelOrderIntent, Intent } from '../strategy/Strategy.js'
import type { WarmupSnapshot } from '../strategy/StrategyContext.js'

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
  const enableWebUi = (process.env.ENABLE_WEB_UI ?? 'false').toLowerCase() === 'true'
  const logToFile = (process.env.LOG_TO_FILE ?? 'false').toLowerCase() === 'true'
  const logLevelEnv = (process.env.LOG_LEVEL ?? 'info').toLowerCase()
  const logLevel =
    logLevelEnv === 'debug' || logLevelEnv === 'info' || logLevelEnv === 'warn' || logLevelEnv === 'error'
      ? (logLevelEnv as 'debug' | 'info' | 'warn' | 'error')
      : 'info'

  const fmtRunStamp = (d: Date): string => {
    const iso = d.toISOString() // YYYY-MM-DDTHH:mm:ss.sssZ (UTC)
    const ymd = iso.slice(0, 10).replaceAll('-', '')
    const hms = iso.slice(11, 19).replaceAll(':', '')
    const ms = iso.slice(20, 23)
    return `${ymd}-${hms}-${ms}`
  }

  const sanitizeFilePart = (s: string): string => s.replaceAll(/[^a-zA-Z0-9._-]/g, '_')

  const ringLines = enableWebUi
    ? ringBufferSequencedLinesSink({ maxLines: 5000, format: (r) => formatRecordToLine(r) })
    : null

  const origConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    table: console.table.bind(console),
  }

  const teeConsoleToWebUi = enableWebUi && !!ringLines

  // Important: if we patch console.*, we must NOT use consoleSink() (it would double-log into rings).
  const rawConsoleSink =
    () =>
    (r: { tsMs: number; level: 'debug' | 'info' | 'warn' | 'error'; msg: string; fields?: Record<string, unknown>; data?: unknown; err?: unknown }) => {
      // Match Node's default console output in the terminal.
      // Keep extra structured info as a second arg (so it's inspectable without prefixes).
      const meta: Record<string, unknown> = {}
      if (r.fields && Object.keys(r.fields).length > 0) meta.fields = r.fields
      if (r.data !== undefined) meta.data = r.data
      if (r.err !== undefined) meta.err = r.err
      const haveMeta = Object.keys(meta).length > 0

      if (r.level === 'error') {
        if (haveMeta) origConsole.error(r.msg, meta)
        else origConsole.error(r.msg)
      } else if (r.level === 'warn') {
        if (haveMeta) origConsole.warn(r.msg, meta)
        else origConsole.warn(r.msg)
      } else {
        if (haveMeta) origConsole.log(r.msg, meta)
        else origConsole.log(r.msg)
      }
    }

  let webUi: TradingBotWebUiServer | null = null
  let restoreConsole: (() => void) | null = null
  let closeJsonl: (() => void) | null = null
  let jsonlSink: ((r: unknown) => void) | null = null
  let logFilePath: string | null = null

  // Keep these available for the TUI status bar.
  let totalWsEvents = 0
  // Best-effort attempt tracking from WS status events (used in MarketEngine source metadata).
  let wsAttempt = 1

  const dryRun = (process.env.DRY_RUN ?? 'false').toLowerCase() !== 'false'

  const intentExecutionModeEnv = (process.env.INTENT_EXECUTION_MODE ?? 'immediate').toLowerCase()
  const intentExecutionMode =
    intentExecutionModeEnv === 'queued' || intentExecutionModeEnv === 'immediate'
      ? (intentExecutionModeEnv as 'queued' | 'immediate')
      : 'immediate'
  const maxEventsPerDrainRaw = process.env.MAX_EVENTS_PER_DRAIN
  const maxEventsPerDrainParsed = maxEventsPerDrainRaw ? Number(maxEventsPerDrainRaw) : NaN
  const maxEventsPerDrain =
    Number.isFinite(maxEventsPerDrainParsed) && Number.isInteger(maxEventsPerDrainParsed)
      ? Math.max(1, maxEventsPerDrainParsed)
      : 100
  let shouldStop = false
  let isRotating = false
  let currentSlug: string | undefined
  let currentMarket: GammaMarketMeta | undefined
  let currentAssetsIds: string[] | undefined
  let currentTokenMap: Record<string, string> | undefined
  let currentWarmup: WarmupSnapshot | undefined

  const built = (() => {
    try {
      return buildStrategyFromCliArgs({ argv: process.argv.slice(2), script: 'trading-bot' })
    } catch (err) {
      printCliArgsError({ script: 'trading-bot', err })
      process.exit(2)
    }
  })()
  const strategy = built.strategy
  let pluginSet = built.pluginSet ?? null
  if (!pluginSet && Array.isArray(built.plugins) && built.plugins.length > 0) {
    pluginSet = new PluginSet()
    for (const p of built.plugins) pluginSet.register(p)
  }
  const logTrades = (process.env.LOG_TRADES ?? 'false').toLowerCase() === 'true'

  // Optional per-run JSONL logging
  if (logToFile) {
    const dir = join(process.cwd(), 'logs', 'trading-bot')
    await mkdir(dir, { recursive: true })
    const stamp = fmtRunStamp(new Date())
    const strategyIdSafe = sanitizeFilePart(built.strategyId)
    const filePath = join(dir, `${stamp}-${strategyIdSafe}.jsonl`)
    logFilePath = filePath
    const jsonl = jsonlFileSink({ filePath })
    closeJsonl = jsonl.close
    jsonlSink = (r: unknown) => {
      try {
        jsonl.sink(r as never)
      } catch {
        // ignore
      }
    }
  }

  const logger = createLogger({
    level: logLevel,
    sinks: [
      ...(teeConsoleToWebUi || logToFile ? [rawConsoleSink()] : [consoleSink()]),
      ...(enableWebUi ? [ringLines!.sink] : []),
      ...(jsonlSink ? [jsonlSink as never] : []),
    ],
  })
  const intentLogger = logger.child({ type: 'intent' })

  // When we patch console.*, keep terminal output identical to Node's default by teeing
  // to the original console, but capture into WebUI/jsonl using a logger with NO terminal sink.
  const consoleCaptureLogger =
    teeConsoleToWebUi || logToFile
      ? createLogger({
          level: logLevel,
          sinks: [
            ...(enableWebUi ? [ringLines!.sink] : []),
            ...(jsonlSink ? [jsonlSink as never] : []),
          ],
        })
      : null

  // Patch early so logs from deep modules (e.g. blockchain balance checks) show up in WebUI/jsonl too.
  if (teeConsoleToWebUi || logToFile) {
    restoreConsole = patchConsole(consoleCaptureLogger ?? logger, {
      teeToOrigConsole: true,
    })

    // Best-effort cleanup even on fatal exits.
    process.on('exit', () => {
      restoreConsole?.()
      closeJsonl?.()
    })
  }

  if (logFilePath) {
    logger.info(`[trading-bot][⚙️] LOG_TO_FILE enabled -> ${logFilePath}`)
  }

  logger.info(`[trading-bot][⚙️] symbol=${symbol}`)
  logger.info(`[trading-bot][⚙️] wsUrl=${wsUrl}`)
  logger.info(`[trading-bot][⚙️] dryRun=${dryRun}`)
  logger.info(`[trading-bot][⚙️] intentExecutionMode=${intentExecutionMode}`)
  logger.info(`[trading-bot][⚙️] maxEventsPerDrain=${maxEventsPerDrain}`)
  logger.info(`[trading-bot][⚙️] strategy=${built.strategyId}`)

  // Optional external feeds (live-only). Enabled only if strategy opts in.
  const externalFeedsReqPlugin = pluginSet?.list().find((p) => p instanceof ExternalFeedsRequestPlugin) as
    | ExternalFeedsRequestPlugin
    | undefined
  const requiredFeeds = externalFeedsReqPlugin?.config ?? strategy.requiredFeeds

  const rtdsReq = requiredFeeds?.rtdsCryptoPrices
  const rtdsBinanceSymbols = rtdsReq?.binanceSymbols ?? []
  // NOTE: Chainlink symbols are slash-separated in RTDS docs (e.g. "btc/usd").
  const rtdsChainlinkSymbols = rtdsReq?.chainlinkSymbols ?? []
  const rtdsEnabled = rtdsBinanceSymbols.length > 0 || rtdsChainlinkSymbols.length > 0

  if (rtdsReq && !rtdsEnabled) {
    logger.warn(
      '[trading-bot] rtdsCryptoPrices requested but no symbols configured; RTDS feed disabled (no prices will be available)',
    )
  }

  const binanceWsReq = requiredFeeds?.binanceWsSpotPrice
  const binanceWsSymbol = (binanceWsReq?.symbol ?? '').toLowerCase().trim()
  const binanceWsEnabled = binanceWsSymbol.length > 0
  if (binanceWsReq && !binanceWsEnabled) {
    logger.warn(
      '[trading-bot] binanceWsSpotPrice requested but no symbol configured; Binance WS feed disabled (no prices will be available)',
    )
  }

  const priceToBeatReq = requiredFeeds?.polymarketPriceToBeat
  const priceToBeatEnabled = priceToBeatReq?.enabled === true

  const feedsEnabled =
    (rtdsReq && rtdsEnabled) || (binanceWsReq && binanceWsEnabled) || priceToBeatEnabled
  const feedsStore = feedsEnabled ? createExternalFeedsStore() : null
  if (feedsStore) {
    if (!pluginSet) pluginSet = new PluginSet()
    if (externalFeedsReqPlugin) {
      externalFeedsReqPlugin.fulfill(() => feedsStore.snapshot())
    } else {
      pluginSet.register(new ExternalFeedsPlugin(() => feedsStore.snapshot()))
    }
  }

  const rtdsClient =
    rtdsReq && rtdsEnabled
      ? createRtdsCryptoPricesClient({
          binanceSymbols: rtdsBinanceSymbols,
          chainlinkSymbols: rtdsChainlinkSymbols,
          onBinanceUpdate: (u) => feedsStore!.updateBinance(u),
          onChainlinkUpdate: (u) => feedsStore!.updateChainlink(u),
          onStatus: (s) => {
            const extra = s.info ? ` ${s.info}` : ''
            logger.info(`[feeds][rtds_polymarket_ws] ${s.kind} attempt=${s.attempt}${extra}`)
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
            logger.info(`[trading-bot][binance_ws] ${s.kind} attempt=${s.attempt}${extra}`)
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
        if (s.kind === 'polling') logger.info(`[feeds][polymarket_price_to_beat][🔄] polling`)
        if (s.kind === 'resolved')
          logger.info(
            `[feeds][polymarket_price_to_beat][🟢] resolved openPrice=${feedsStore.snapshot().polymarketPriceToBeat?.openPrice}`,
          )
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

  // Check balance and approval before starting (only if not dry run)
  if (!dryRun) {
    const rpcUrl = process.env.POLYGON_RPC_URL ?? 'https://polygon-rpc.com'
    const splitMode = (process.env.POLYMARKET_TX_MODE_SPLIT ?? 'direct').toLowerCase()
    const safeFunder = cfg.clob.funder

    if (splitMode === 'relayer' && !safeFunder) {
      throw new Error('[trading-bot] POLYMARKET_TX_MODE_SPLIT=relayer requires CLOB_FUNDER')
    }

    let eoaOk = true
    let safeOk = true

    if (!cfg.privateKey) {
      eoaOk = false
      logger.error('[trading-bot] missing private key; cannot check EOA balance/approval')
    } else {
      try {
        await logBalanceAndApproval({
          rpcUrl,
          privateKey: cfg.privateKey,
          chainId: cfg.clob.chainId,
          clobHost: cfg.clob.host,
          addressLabel: 'EOA',
        })
      } catch (err) {
        eoaOk = false
        logger.error('[trading-bot] EOA balance/approval check failed', { err })
      }
    }

    if (safeFunder) {
      try {
        await logBalanceAndApproval({
          rpcUrl,
          chainId: cfg.clob.chainId,
          clobHost: cfg.clob.host,
          addressOverride: safeFunder,
          addressLabel: 'SAFE',
        })
      } catch (err) {
        safeOk = false
        logger.error('[trading-bot] SAFE balance/approval check failed', { err })
      }
    }

    if (splitMode === 'relayer' && (!eoaOk || !safeOk)) {
      logger.error('[trading-bot] Exiting. Fix EOA/SAFE approvals and balances before starting.')
      process.exit(1)
    }
  }


  const exec = dryRun
    ? {
        placeLimit: async () => ({ events: [] }),
        placeBatch: async () => ({ events: [] }),
        cancelOrder: async () => ({ events: [] }),
        cancelAll: async () => ({ events: [] }),
        mergePositions: async () => ({ events: [] }),
        splitPositions: async () => ({ events: [] }),
        onMarketTick: async () => ({ events: [] }),
      }
    : new LiveExecution({
        config: cfg,
      })
  const orderManager = new OrderManager({
    execution: exec,
    dryRun,
    log: (msg, extra) => logger.info(msg, ...(extra !== undefined ? [{ data: extra }] : [])),
  })
  const runner = new StrategyRunner({
    strategyId: built.strategyId,
    strategyParams: built.params,
    externalFeedsEnabled: {
      ...(rtdsReq ? { rtdsCryptoPrices: rtdsEnabled } : {}),
      ...(binanceWsReq ? { binanceWsSpotPrice: binanceWsEnabled } : {}),
      ...(priceToBeatReq ? { polymarketPriceToBeat: priceToBeatEnabled } : {}),
    },
    strategy,
    orderManager,
    ...(pluginSet ? { pluginSet } : {}),
    getMarket: () => currentMarket,
    getWarmup: () => currentWarmup,
    intentExecutionMode,
    maxEventsPerDrain,
    ...(enableWebUi
      ? { intentLog: (msg, extra) => intentLogger.info(msg, ...(extra !== undefined ? [{ data: extra }] : [])) }
      : {}),
    ...(logTrades ? { log: (msg, extra) => logger.info(msg, ...(extra !== undefined ? [{ data: extra }] : [])) } : {}),
  })

  const marketEngine = new MarketEngine({
    onTick: ({ source, msg, snapshot }) => {
      // Drive shared runner on the same cadence live/backtest.
      void runner.onMarketTick({ source, msg, snapshot })
    },
  })

  const resolveAssetsIds = async (): Promise<{ assetsIds: string[]; label?: string }> => {
    const r = await resolveCurrentUpDown15mAssets({ symbol, date: new Date() })

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
    currentAssetsIds = r.assetsIds
    currentTokenMap = r.tokenMap

    // Warmup token metadata caches on startup and on market change.
    // Strategies can gate order placement via ctx.warmup.
    // Note: warmup is live-only; in dry-run exec is a stub.
    if (prevSlug !== r.slug) {
      const assetIds = Array.isArray(r.assetsIds) ? r.assetsIds.slice(0, 2) : []
      const startedAtMs = Date.now()
      currentWarmup = {
        status: 'warming',
        slug: r.slug,
        assetIds,
        startedAtMs,
      }

      if (!dryRun && exec instanceof LiveExecution && assetIds.length > 0) {
        void (async () => {
          try {
            await exec.warmupMarket({ assetIds, slug: r.slug })
            const finishedAtMs = Date.now()
            console.log('[trading-bot][warmup-market][🟢] warmed', {
              slug: r.slug,
              assetIds,
              durationMs: finishedAtMs - startedAtMs,
            })
            currentWarmup = {
              status: 'warmed',
              slug: r.slug,
              assetIds,
              startedAtMs,
              finishedAtMs,
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            console.warn('[trading-bot][warmup-market][⚠️] warmupMarket failed', {
              slug: r.slug,
              assetIds,
              err: msg,
            })
            currentWarmup = {
              status: 'error',
              slug: r.slug,
              assetIds,
              startedAtMs,
              finishedAtMs: Date.now(),
              error: msg,
            }
          }
        })()
      } else {
        // No warmup available (dry-run or non-live execution). Treat as warmed.
        currentWarmup = {
          status: 'warmed',
          slug: r.slug,
          assetIds,
          startedAtMs,
          finishedAtMs: Date.now(),
        }
      }
    }


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
        console.warn('[feeds][polymarket_price_to_beat][⛔️] enabled but missing eventStartTime/endDate on currentMarket')
      }
    }

    if (prevSlug !== r.slug) {
      const id = typeof r.market.id === 'string' ? r.market.id : undefined
      const q = typeof r.market.question === 'string' ? r.market.question : undefined
      const active = typeof r.market.active === 'boolean' ? r.market.active : undefined
      const closed = typeof r.market.closed === 'boolean' ? r.market.closed : undefined
      console.log('[trading-bot][🔄] market changed', {
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
    console.warn('[trading-bot][⛔️] missing POLYMARKET_API_* creds; account streams disabled')
  }

  const emitTradeFillsAtStatusEnv = (process.env.USER_WS_FILL_AT_STATUS ?? '').toUpperCase()
  const emitTradeFillsAtStatus =
    emitTradeFillsAtStatusEnv === 'MATCHED' ||
    emitTradeFillsAtStatusEnv === 'MINED' ||
    emitTradeFillsAtStatusEnv === 'CONFIRMED'
      ? (emitTradeFillsAtStatusEnv as 'MATCHED' | 'MINED' | 'CONFIRMED')
      : undefined
  if (emitTradeFillsAtStatus) {
    console.log(`[trading-bot][⚙️] user ws fills emitAt=${emitTradeFillsAtStatus} (USER_WS_FILL_AT_STATUS)`)
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
            console.log('[ws-user][🟢] User WS stably connected (10s+) - disabling REST poller')
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
                `[ws-user][🔴] User WS disconnected (was stably connected for ${Math.round(connectedDuration / 1000)}s) - enabling REST poller fallback`,
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

  // Debug: track when currentMarket is missing
  let warnedMissingCurrentMarket = false

  source.onEvent((ev) => {
    if (shouldStop || isRotating) return

    // Debug: log when currentMarket is missing (only once per "missing" period)
    if (!currentMarket) {
      if (!warnedMissingCurrentMarket) {
        logger.warn('[trading-bot][⚠️] tick received but currentMarket is undefined', {
          data: { currentSlug, hasCurrentMarket: false },
        })
        warnedMissingCurrentMarket = true
      }
      // Skip tick - strategy can't work without market metadata
      return
    }
    // Reset warning when market becomes available
    if (warnedMissingCurrentMarket) {
      logger.info('[trading-bot][🟢] currentMarket now available', { data: { slug: currentSlug } })
      warnedMissingCurrentMarket = false
    }

    totalWsEvents += 1

    void marketEngine
      .handleRaw({
        rawJson: ev.raw,
        source: { kind: 'live', attempt: wsAttempt },
      })
      .catch((err) => {
        logger.error('[trading-bot] MarketEngine.handleRaw failed', { err })
        // If we somehow see a different market than expected, reset and keep going.
        marketEngine.reset()
        pluginSet?.reset()
      })
  })

  source.onStatus((s) => {
    if (shouldStop || isRotating) return
    if (s.kind === 'connected') {
      wsAttempt = s.attempt
      // New websocket session / potential new market: reset local orderbook state.
      marketEngine.reset()
      pluginSet?.reset()
      // External feeds are independent of market WS; do NOT reset them here.
      logger.info(`[trading-bot] 🟢 connected (${s.info ?? 'ws'})`)
      return
    }
    if (s.kind === 'reconnecting') {
      wsAttempt = s.attempt
      const extra = s.info ? ` (${s.info})` : ''
      logger.info(`[trading-bot] 🔄 reconnecting in ${s.delayMs}ms${extra}`)
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
      logger.info(`[trading-bot] 🔴 disconnected${extra}`)
    }
  })

  let statsInterval: NodeJS.Timeout | undefined
  if (!enableWebUi) {
    statsInterval = setInterval(() => {
      const candleLeft = msUntilNextBoundary(Date.now(), FIFTEEN_MIN_MS)
      logger.info(
        `[trading-bot] stats ws_events_total=${totalWsEvents} candle_left_ms=${candleLeft} slug=${currentSlug ?? 'n/a'}`,
      )
    }, 10_000)
  }

  const rotateAndReconnect = (): void => {
    void (async () => {
      if (shouldStop) return
      if (isRotating) return
      isRotating = true
      source.stop()
      // No stateful resources yet (strategy/order manager will flush here).
      marketEngine.reset()
      pluginSet?.reset()
      isRotating = false
      source.start()
    })().catch((err) => {
      console.error('[trading-bot][⛔️] rotate failed', err)
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
    logger.info(`[trading-bot] ${signal} received, shutting down...`)
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
    webUi?.stop()
    restoreConsole?.()
    closeJsonl?.()
    process.exit(0)
  }
  installSignalHandlers({ onSignal: shutdown })

  if (enableWebUi) {
    const pickAssetId = (kind: 'up' | 'down'): string | undefined => {
      const tokenMap = currentTokenMap
      if (tokenMap) {
        const entries = Object.entries(tokenMap)
        const key = entries.find(([k]) => k.toLowerCase().includes(kind))?.[0]
        const id = key ? tokenMap[key] : undefined
        if (typeof id === 'string' && id.length > 0) return id
      }
      const a = currentAssetsIds
      if (!a || a.length < 2) return undefined
      return kind === 'up' ? a[0] : a[1]
    }

    // Default to 0.0.0.0 to allow network access in development.
    // This enables accessing the UI from other machines on the same LAN.
    // For production/security, explicitly set WEB_UI_HOST=127.0.0.1 if needed.
    const host = (process.env.WEB_UI_HOST ?? '0.0.0.0').trim() || '0.0.0.0'
    const portRaw = process.env.WEB_UI_PORT
    const portParsed = portRaw ? Number(portRaw) : NaN
    if (!Number.isFinite(portParsed) || !Number.isInteger(portParsed) || portParsed <= 0) {
      throw new Error('[trading-bot] ENABLE_WEB_UI=true requires WEB_UI_PORT to be a valid integer port')
    }
    const port = portParsed
    const refreshMsRaw = process.env.WEB_UI_REFRESH_MS
    const refreshMsParsed = refreshMsRaw ? Number(refreshMsRaw) : NaN
    const refreshMs =
      Number.isFinite(refreshMsParsed) && Number.isInteger(refreshMsParsed) ? Math.max(50, refreshMsParsed) : 250

    const levelsRaw = process.env.WEB_UI_ORDERBOOK_LEVELS
    const levelsParsed = levelsRaw ? Number(levelsRaw) : NaN
    const orderbookLevels =
      Number.isFinite(levelsParsed) && Number.isInteger(levelsParsed) ? Math.max(1, levelsParsed) : 8

    const instanceId = (process.env.BOT_INSTANCE_ID ?? '').trim()
    const title = `polymarket-bot trading-bot${instanceId ? ` (${instanceId})` : ''} [${symbol}]`

    webUi = createTradingBotWebUiServer({
      title,
      host,
      port,
      getState: () => {
        const slug = currentSlug
        const market = runner.getLastMarketSnapshot()// if marketEngine.snapshot()
        const upAssetId = pickAssetId('up')
        const downAssetId = pickAssetId('down')
        const strategyMeta = (() => {
          try {
            return runner.getStrategyMeta()
          } catch {
            return undefined
          }
        })()
        const portfolio = (() => {
          try {
            return runner.getPortfolio().snapshot()
          } catch {
            return undefined
          }
        })()
        const positionMetrics = (() => {
          try {
            return portfolio
              ? computePositionMetricsFromMarket({ portfolio, ...(currentMarket ? { market: currentMarket } : {}) })
              : undefined
          } catch {
            return undefined
          }
        })()
        const orderbookMetrics = (() => {
          try {
            return market
              ? computeOrderbookMetricsFromMarket({ marketBooks: market, ...(currentMarket ? { market: currentMarket } : {}) })
              : undefined
          } catch {
            return undefined
          }
        })()
        const metrics =
          positionMetrics || orderbookMetrics
            ? {
                ...(positionMetrics ? { position: positionMetrics } : {}),
                ...(orderbookMetrics ? { orderbook: orderbookMetrics } : {}),
              }
            : undefined
        const plugins = (() => {
          try {
            return pluginSet?.snapshot()
          } catch {
            return undefined
          }
        })()
        return {
          symbol: String(symbol),
          candleLeftMs: msUntilNextBoundary(Date.now(), FIFTEEN_MIN_MS),
          wsAttempt,
          wsEventsTotal: totalWsEvents,
          ...(typeof slug === 'string' ? { slug } : {}),
          ...(market ? { market } : {}),
          ...(typeof upAssetId === 'string' ? { upAssetId } : {}),
          ...(typeof downAssetId === 'string' ? { downAssetId } : {}),
          ...(strategyMeta ? { strategy: strategyMeta } : {}),
          ...(portfolio ? { portfolio } : {}),
          ...(metrics ? { metrics } : {}),
          ...(typeof plugins !== 'undefined' ? { plugins } : {}),
        }
      },
      getLogLinesWindow: () => ringLines!.snapshotWindow(),
      onCommand: async (cmd: BotUiCommand) => {
        const nowMs = Date.now()
        const lastMarket = runner.getLastMarketSnapshot()
        const portfolio = runner.getPortfolio().snapshot()

        const ctx = {
          nowMs,
          ...(lastMarket ? { lastMarket } : {}),
          portfolio,
        }

        if (cmd.kind === 'cancel_all') {
          const intent: CancelAllIntent = { kind: 'cancel_all', reason: 'webui' }
          const intents: Intent[] = [intent]
          const events = await orderManager.handleIntents(intents, ctx, { mode: 'immediate' })
          for (const ev of events) await runner.onAccountEvent(ev)
          return
        }

        // cancel_order
        const clientOrderId =
          typeof cmd.clientOrderId === 'string' && cmd.clientOrderId.length > 0 ? cmd.clientOrderId : undefined
        let orderId = typeof cmd.orderId === 'string' && cmd.orderId.length > 0 ? cmd.orderId : undefined

        // If UI only provided clientOrderId, attempt to resolve orderId from the Portfolio.
        if (!orderId && clientOrderId) {
          try {
            const o = runner.getPortfolio().getOpenOrderByClientId(clientOrderId)
            if (typeof o?.orderId === 'string' && o.orderId.length > 0) orderId = o.orderId
          } catch {
            // ignore
          }
        }

        if (!orderId && !clientOrderId) return

        const intent: CancelOrderIntent = {
          kind: 'cancel_order',
          ...(clientOrderId ? { clientOrderId } : {}),
          ...(orderId ? { orderId } : {}),
          reason: 'webui',
        }
        const intents: Intent[] = [intent]
        const events = await orderManager.handleIntents(intents, ctx, { mode: 'immediate' })
        for (const ev of events) await runner.onAccountEvent(ev)
      },
      orderbookLevels,
      refreshMs,
    })
    webUi.start()
    logger.info(`[trading-bot][⚙️] web-ui http://${host}:${port} ws=ws://${host}:${port}/ws`)
  }

  source.start()
  boundaryScheduler.start()
  userWs?.start()
  poller?.start()
  rtdsClient?.start()
  binanceWsClient?.start()
}

main().catch((err) => {
  console.error('[trading-bot][⛔️] fatal error', err)
  process.exit(1)
})
