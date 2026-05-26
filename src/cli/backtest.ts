import '../config/env.js'
import { installProcessCrashHandlers, installSignalHandlers } from '../utils/runtime.js'
import { randomUUID } from 'crypto'
import type { MarketOrderBooksSnapshot } from '../market/orderbook/index.js'
import { StrategyRunner } from '../trading/StrategyRunner.js'
import { OrderManager } from '../trading/OrderManager.js'
import { BacktestExecution } from '../trading/execution/BacktestExecution.js'
import { PluginSet } from '../strategy/plugins/PluginSet.js'
import { getStrategyDefinition } from '../strategy/strategyRegistry.js'
import type { Strategy } from '../strategy/Strategy.js'
import { buildStrategyFromCliArgs, printCliArgsError } from './helpers/strategyArgs.js'
import { parseArgs } from './helpers/backtestArgs.js'
import { buildBacktestCmdInline } from './helpers/backtestCmd.js'
import { resolveParquetFilesFromDirs } from './helpers/resolveParquetFilesFromDirs.js'
import { computeMarketStats } from '../backtest/stats/marketStats.js'
import { computeBatchStats } from '../backtest/stats/batchStats.js'
import { computeChunkedBatchStats } from '../backtest/stats/chunkedBatchStats.js'
import type { MarketStats } from '../backtest/stats/marketStats.js'
import {
  parseSlugFromFilename,
  getMarketResolution,
  type MarketResolution,
} from '../backtest/stats/marketResolution.js'
import { getMarketResolution as getTelonexMarketResolution } from '../backtest/stats/telonexMarketResolution.js'
import type { Fill, PositionsSplit } from '../strategy/Strategy.js'
import { Timer } from '../utils/timer.js'
import { closeDb } from '../db/index.js'
import {
  getMarketsBySlugs,
  getMarketBySlug,
  getMarketsBySymbol,
  type Market,
} from '../db/markets.js'
import {
  getMarketsBySlugs as getTelonexMarketsBySlugs,
  getMarketBySlug as getTelonexMarketBySlug,
  getMarketsBySymbol as getTelonexMarketsBySymbol,
  type Market as TelonexMarket,
  type Converter,
  type ReadFrom,
} from '../db/telonexMarkets.js'
import { insertBacktestRun } from '../db/backtests.js'
import { buildGammaMarketMeta, type GammaMarketMeta } from '../polymarket/gammaMarketMeta.js'
import { fetchGammaMarketBySlug } from '../polymarket/gamma.js'
import { replayTelonexDeltaParquetForMarket } from '../parquet/replay/replayTelonexDeltaParquetForMarket.js'
import { replayTelonexPairedParquetForMarket } from '../parquet/replay/replayTelonexPairedParquetForMarket.js'
import {
  replayOrderBookForMarket,
  type ReplayApplyEvent,
} from '../parquet/replay/replayOrderBookForMarket.js'

installProcessCrashHandlers({ prefix: 'backtest' })

function formatDurationHuman(ms: number): string {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0
  const totalSeconds = Math.round(safeMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}min ${seconds} sec`
}

function converterForInputMode(inputMode: 'telonex-delta' | 'telonex-paired'): Converter {
  return inputMode === 'telonex-delta' ? 'delta-typed' : 'paired'
}

function buildMetaFromTokenMap(
  slug: string,
  tokenMap: Record<string, string>,
): GammaMarketMeta | undefined {
  const upAssetId = tokenMap['UP']
  const downAssetId = tokenMap['DOWN']
  if (!upAssetId || !downAssetId) return undefined
  return {
    slug,
    outcomes: ['UP', 'DOWN'],
    clobTokenIds: [upAssetId, downAssetId],
    outcomeTokenMap: { up: upAssetId, down: downAssetId },
    upAssetId,
    downAssetId,
  } as GammaMarketMeta
}

async function main(): Promise<void> {
  const timer = new Timer()
  const args = process.argv.slice(2)
  const parsed = parseArgs(args)
  const batchUid = parsed.batchUid ?? randomUUID()
  const cmd = buildBacktestCmdInline(args)
  const built = (() => {
    try {
      return buildStrategyFromCliArgs({ argv: args, script: 'backtest' })
    } catch (err) {
      printCliArgsError({ script: 'backtest', err })
      process.exit(2)
    }
  })()

  const isTelonex = parsed.inputMode !== 'recorded'
  const converter: Converter | null = isTelonex
    ? converterForInputMode(parsed.inputMode as 'telonex-delta' | 'telonex-paired')
    : null
  const readFrom: ReadFrom | null = isTelonex ? (parsed.readFrom as ReadFrom) : null

  let filePaths: string[] = []
  const recordedBySlug = new Map<string, Market>()
  const telonexBySlug = new Map<string, TelonexMarket>()

  if (!isTelonex) {
    // ---- recorded flow: query `markets` table ----
    if (parsed.slugs && parsed.slugs.length > 0) {
      try {
        const uniqueSlugs = Array.from(new Set(parsed.slugs))
        const results = await getMarketsBySlugs(uniqueSlugs)
        const marketMap = new Map(results.map((m) => [m.slug, m] as const))
        const foundMarkets = uniqueSlugs
          .map((slug) => marketMap.get(slug))
          .filter((m): m is Market => m !== undefined)
        for (const m of foundMarkets) recordedBySlug.set(m.slug, m)
        const missingSlugs = uniqueSlugs.filter((slug) => !marketMap.has(slug))
        if (missingSlugs.length > 0) {
          console.warn(`[backtest] Missing markets for slugs: ${missingSlugs.join(', ')}`)
        }
        filePaths = foundMarkets
          .map((m) => m.dataset)
          .filter((d): d is string => d !== null && d.trim() !== '')
        if (filePaths.length === 0) {
          console.error(
            `[backtest] No markets found in database for slugs: ${uniqueSlugs.join(', ')}`,
          )
          process.exit(2)
        }
        console.log(
          `[backtest] Loaded ${filePaths.length} file(s) from database for slugs: ${uniqueSlugs.join(', ')}`,
        )
      } catch (err) {
        console.error('[backtest] Failed to load markets from database:', err)
        process.exit(2)
      }
    } else if (parsed.symbol) {
      try {
        const marketRecords = await getMarketsBySymbol(parsed.symbol, {
          ...(parsed.limit !== undefined && { limit: parsed.limit }),
          ...(parsed.random ? { random: true } : {}),
          ...(parsed.latest ? { latest: true } : {}),
          onlyWithDataset: true,
        })
        for (const m of marketRecords) recordedBySlug.set(m.slug, m)
        filePaths = marketRecords
          .map((m) => m.dataset)
          .filter((d): d is string => d !== null && d.trim() !== '')
        if (filePaths.length === 0) {
          console.error(`[backtest] No markets found in database for symbol: ${parsed.symbol}`)
          process.exit(2)
        }
        console.log(
          `[backtest] Loaded ${filePaths.length} file(s) from database for symbol: ${parsed.symbol}`,
        )
      } catch (err) {
        console.error(`[backtest] Failed to load markets from database:`, err)
        process.exit(2)
      }
    } else {
      try {
        const fromDirs =
          parsed.dirs && parsed.dirs.length > 0
            ? await resolveParquetFilesFromDirs(parsed.dirs)
            : []
        if (parsed.dirs && parsed.dirs.length > 0) {
          console.log(
            `[backtest] Loaded ${fromDirs.length} parquet file(s) from dirs: ${parsed.dirs.join(', ')}`,
          )
        }
        filePaths = [...parsed.filePaths, ...fromDirs]
        if (filePaths.length > 0) {
          filePaths = Array.from(new Set(filePaths)).sort()
        }
      } catch (err) {
        console.error('[backtest] Failed to load parquet files from --dir:', err)
        process.exit(2)
      }
    }
  } else {
    // ---- telonex flow: query `telonex_markets` ⋈ `telonex_market_conversions` ----
    const conv = converter!
    const rf = readFrom!
    if (parsed.slugs && parsed.slugs.length > 0) {
      try {
        const uniqueSlugs = Array.from(new Set(parsed.slugs))
        const results = await getTelonexMarketsBySlugs(uniqueSlugs, {
          converter: conv,
          readFrom: rf,
        })
        const marketMap = new Map(results.map((m) => [m.slug, m] as const))
        const found = uniqueSlugs
          .map((slug) => marketMap.get(slug))
          .filter((m): m is TelonexMarket => m !== undefined)
        for (const m of found) telonexBySlug.set(m.slug, m)
        const missing = uniqueSlugs.filter((slug) => !marketMap.has(slug))
        if (missing.length > 0) {
          console.warn(
            `[backtest] no ${conv} conversion for slug(s): ${missing.join(', ')}, skipping`,
          )
        }
        filePaths = found
          .map((m) => m.dataset)
          .filter((d): d is string => d !== null && d.trim() !== '')
        if (filePaths.length === 0) {
          console.error(
            `[backtest] No telonex markets found for slugs: ${uniqueSlugs.join(', ')} (converter=${conv}, readFrom=${rf})`,
          )
          process.exit(2)
        }
        console.log(
          `[backtest] Loaded ${filePaths.length} file(s) from telonex_markets for slugs: ${uniqueSlugs.join(', ')}`,
        )
      } catch (err) {
        console.error('[backtest] Failed to load telonex markets:', err)
        process.exit(2)
      }
    } else if (parsed.symbol) {
      try {
        const results = await getTelonexMarketsBySymbol(parsed.symbol, {
          converter: conv,
          readFrom: rf,
          timeframe: parsed.timeframe,
          ...(parsed.limit !== undefined && { limit: parsed.limit }),
          ...(parsed.random ? { random: true } : {}),
          ...(parsed.latest ? { latest: true } : {}),
        })
        const withDataset = results.filter((m) => m.dataset !== null && m.dataset.trim() !== '')
        const missingDataset = results.length - withDataset.length
        if (missingDataset > 0) {
          console.warn(
            `[backtest] ${missingDataset} telonex market(s) missing ${rf} dataset path, skipping`,
          )
        }
        for (const m of withDataset) telonexBySlug.set(m.slug, m)
        filePaths = withDataset.map((m) => m.dataset).filter((d): d is string => d !== null)
        if (filePaths.length === 0) {
          console.error(
            `[backtest] No telonex markets found for symbol=${parsed.symbol} timeframe=${parsed.timeframe} (converter=${conv}, readFrom=${rf})`,
          )
          process.exit(2)
        }
        console.log(
          `[backtest] Loaded ${filePaths.length} file(s) from telonex_markets for symbol=${parsed.symbol} timeframe=${parsed.timeframe}`,
        )
      } catch (err) {
        console.error('[backtest] Failed to load telonex markets:', err)
        process.exit(2)
      }
    } else {
      // dir / explicit file paths — same as recorded
      try {
        const fromDirs =
          parsed.dirs && parsed.dirs.length > 0
            ? await resolveParquetFilesFromDirs(parsed.dirs)
            : []
        if (parsed.dirs && parsed.dirs.length > 0) {
          console.log(
            `[backtest] Loaded ${fromDirs.length} parquet file(s) from dirs: ${parsed.dirs.join(', ')}`,
          )
        }
        filePaths = [...parsed.filePaths, ...fromDirs]
        if (filePaths.length > 0) {
          filePaths = Array.from(new Set(filePaths)).sort()
        }
      } catch (err) {
        console.error('[backtest] Failed to load parquet files from --dir:', err)
        process.exit(2)
      }
    }
  }

  if (filePaths.length === 0) {
    console.error(
      'Usage:\n' +
        '  Recorded (WS replay, markets table):\n' +
        '    tsx src/cli/backtest.ts --strategy <id> [--param key=value ...] <file1.parquet> [file2.parquet ...] [--order recorded|exchange_time] [--time-driven]\n' +
        '    tsx src/cli/backtest.ts --strategy <id> --symbol <btc|eth|sol|...> [--limit N] [--random|--latest]\n' +
        '    tsx src/cli/backtest.ts --strategy <id> --slug <slug1[,slug2,...]>\n' +
        '    tsx src/cli/backtest.ts --strategy <id> --dir <dir1> [--dir <dir2> ...]\n' +
        '  Telonex (telonex_markets table, requires --read-from local|r2):\n' +
        '    tsx src/cli/backtest.ts --strategy <id> --input-mode telonex-delta --read-from local --symbol btc [--timeframe 15m] [--limit N]\n' +
        '    tsx src/cli/backtest.ts --strategy <id> --input-mode telonex-paired --read-from r2 --slug <slug>\n',
    )
    process.exit(2)
  }

  console.log(`[backtest] mode=${parsed.inputMode} files=${filePaths.length}`)
  if (isTelonex) {
    console.log(
      `[backtest] converter=${converter} readFrom=${readFrom} timeframe=${parsed.timeframe}`,
    )
  } else {
    console.log(`[backtest] order=${parsed.order}`)
    console.log(`[backtest] timeDriven=${parsed.timeDriven}`)
  }
  if (parsed.latest) console.log(`[backtest] latest=true`)

  let shouldStop = false
  const shutdown = (signal: 'SIGINT' | 'SIGTERM'): void => {
    console.log(`[backtest] ${signal} received, stopping...`)
    shouldStop = true
  }
  installSignalHandlers({ onSignal: shutdown })

  let events = 0
  const byType = new Map<string, number>()

  const mkRunner = (opts?: {
    getMarket?: () => GammaMarketMeta | undefined
  }): {
    strategy: Strategy
    runner: StrategyRunner
  } => {
    const def = getStrategyDefinition(built.strategyId)
    const builtStrategy = def.create(built.params as never)
    const strategy = builtStrategy.strategy
    const pluginSet = (() => {
      if (builtStrategy.pluginSet) return builtStrategy.pluginSet
      if (Array.isArray(builtStrategy.plugins) && builtStrategy.plugins.length > 0) {
        const s = new PluginSet()
        for (const p of builtStrategy.plugins) s.register(p)
        return s
      }
      return undefined
    })()
    const latencyMs = Math.max(
      0,
      Math.trunc(Number(process.env.BACKTEST_LATENCY_DELAY ?? '0') || 0),
    )
    const jitterMs = Math.max(
      0,
      Math.trunc(Number(process.env.BACKTEST_LATENCY_JITTER ?? '20') || 0),
    )

    const exec = new BacktestExecution({
      latencyMs,
      jitterMs: latencyMs > 0 ? jitterMs : 0,
      cancelLatency: true,
      makerFillMode: 'worst_queue',
    })
    const orderManager = new OrderManager({
      execution: exec,
      dryRun: false,
      log: (msg, extra) => console.log(msg, extra ?? ''),
    })
    const runner = new StrategyRunner({
      strategyId: built.strategyId,
      strategyParams: built.params as Record<string, unknown>,
      strategy,
      orderManager,
      intentExecutionMode: 'immediate',
      ...(pluginSet ? { pluginSet } : {}),
      ...(opts?.getMarket ? { getMarket: opts.getMarket } : {}),
      log: (msg, extra) => console.log(msg, extra ?? ''),
    })
    return { strategy, runner }
  }

  console.log(`[backtest] strategy=${built.strategyId}`)

  const initialCapital = parseFloat(process.env.INITIAL_CAPITAL ?? '1000')
  const marketStats: MarketStats[] = []

  const totalMarkets = filePaths.length
  const backtestStartMs = Date.now()
  let completedMarkets = 0
  let completedMarketsMsTotal = 0

  for (let idx = 0; idx < filePaths.length; idx += 1) {
    const fp = filePaths[idx]!
    if (shouldStop) break
    const marketIdx = idx + 1
    console.log(`[backtest][${marketIdx}/${totalMarkets}] replay file=${fp}`)
    const marketStartMs = Date.now()

    const slug = parseSlugFromFilename(fp)
    let marketResolution: MarketResolution | null = null
    let marketMeta: GammaMarketMeta | undefined

    if (isTelonex) {
      // Telonex: row already fetched in the bulk query (or lookup on demand for dir/file paths)
      let row = slug ? (telonexBySlug.get(slug) ?? null) : null
      if (!row && slug) {
        row = await getTelonexMarketBySlug(slug, { converter: converter!, readFrom: readFrom! })
        if (row) telonexBySlug.set(slug, row)
      }
      if (row) {
        marketResolution = getTelonexMarketResolution(row)
        if (marketResolution) {
          marketMeta = buildMetaFromTokenMap(slug!, marketResolution.tokenMap)
          if (marketMeta && row.question) {
            ;(marketMeta as Record<string, unknown>).question = row.question
          }
        }
      } else if (slug) {
        console.warn(`[backtest] no telonex_markets row for slug=${slug}, skipping stats`)
      }
    } else {
      // Recorded: keep existing Gamma fallback + DB upsert behavior
      let dbMarket =
        slug && recordedBySlug.size > 0
          ? (recordedBySlug.get(slug) ?? null)
          : slug
            ? await getMarketBySlug(slug)
            : null
      marketResolution = slug ? await getMarketResolution(slug, fp) : null
      if (slug) {
        const refreshed = await getMarketBySlug(slug)
        if (refreshed) {
          dbMarket = refreshed
          recordedBySlug.set(slug, refreshed)
        }
      }
      marketMeta = (() => {
        if (!slug) return undefined
        if (!dbMarket) return undefined
        const raw = dbMarket.rawJson
        if (!raw || typeof raw !== 'object') return undefined
        const built = buildGammaMarketMeta(raw as Record<string, unknown>, slug)
        return built ?? undefined
      })()
      if (!marketMeta && slug) {
        try {
          const raw = await fetchGammaMarketBySlug({ slug })
          if (raw && typeof raw === 'object') {
            const built = buildGammaMarketMeta(raw, slug)
            if (built) marketMeta = built
          }
        } catch {
          // best-effort; fall through to tokenMap-based meta below
        }
      }
      if (!marketMeta && slug && marketResolution) {
        marketMeta = buildMetaFromTokenMap(slug, marketResolution.tokenMap)
      }
    }

    if (slug && marketMeta) {
      const id = typeof marketMeta.id === 'string' ? marketMeta.id : undefined
      const q = typeof marketMeta.question === 'string' ? marketMeta.question : undefined
      console.log('[backtest] market meta', {
        slug,
        ...(id ? { id } : {}),
        ...(q ? { question: q } : {}),
      })
    }
    if (slug && !marketMeta) {
      console.warn(`[backtest] market meta unavailable for slug: ${slug}`)
    }

    const active = mkRunner({ getMarket: () => marketMeta })
    const runner = active.runner

    let currentMarketId: string | undefined
    const currentMarketTrades: Fill[] = []
    const seenFillIds = new Set<string>()
    const currentMarketSplits: PositionsSplit[] = []
    const seenSplitIds = new Set<string>()

    const onSnapshot = async (snap: MarketOrderBooksSnapshot, raw: ReplayApplyEvent) => {
      if (shouldStop) return
      events += 1
      byType.set(raw.msg.event_type, (byType.get(raw.msg.event_type) ?? 0) + 1)

      if (!currentMarketId) {
        currentMarketId = snap.market
      }

      await runner.onMarketTick({ source: raw.source, msg: raw.msg, snapshot: snap })

      if (currentMarketId) {
        const portfolio = runner.getPortfolio().snapshot()
        for (const fill of portfolio.recentFills) {
          if (fill.market === currentMarketId && !seenFillIds.has(fill.id)) {
            const orderMeta = fill.clientOrderId
              ? portfolio.ordersByClientId[fill.clientOrderId]?.meta
              : undefined
            currentMarketTrades.push(orderMeta ? { ...fill, intentMeta: orderMeta } : fill)
            seenFillIds.add(fill.id)
          }
        }
        for (const s of portfolio.recentSplits ?? []) {
          if (s.market === currentMarketId && !seenSplitIds.has(s.id)) {
            currentMarketSplits.push(s)
            seenSplitIds.add(s.id)
          }
        }
      }
    }

    if (parsed.inputMode === 'telonex-paired') {
      await replayTelonexPairedParquetForMarket({
        filePath: fp,
        shouldStop: () => shouldStop,
        onSnapshot,
      })
    } else if (parsed.inputMode === 'telonex-delta') {
      await replayTelonexDeltaParquetForMarket({
        filePath: fp,
        shouldStop: () => shouldStop,
        onSnapshot,
      })
    } else {
      await replayOrderBookForMarket({
        filePaths: [fp],
        order: parsed.order,
        timeDriven: parsed.timeDriven,
        shouldStop: () => shouldStop,
        onSnapshot,
      })
    }

    if (slug && currentMarketId && marketResolution) {
      const portfolio = runner.getPortfolio().snapshot()
      const finalPositions = portfolio.positionsByAssetId
      const realizedPnl = portfolio.realizedPnlTotal ?? 0

      const upAssetId = marketResolution.tokenMap['UP']
      const downAssetId = marketResolution.tokenMap['DOWN']
      const hasPositions =
        (upAssetId && finalPositions[upAssetId] && finalPositions[upAssetId]!.qty > 0) ||
        (downAssetId && finalPositions[downAssetId] && finalPositions[downAssetId]!.qty > 0)

      if ((hasPositions || currentMarketTrades.length > 0) && marketResolution.outcome !== null) {
        const stats = computeMarketStats({
          marketId: currentMarketId,
          slug,
          trades: currentMarketTrades,
          splits: currentMarketSplits,
          finalPositions,
          realizedPnl,
          finalOutcome: marketResolution.outcome,
          tokenMap: marketResolution.tokenMap,
        })

        marketStats.push(stats)
        const pnlColor = stats.pnl >= 0 ? '\x1b[32m' : '\x1b[31m'
        const resetColor = '\x1b[0m'
        console.log(
          `${pnlColor}[backtest] market=${currentMarketId} slug=${slug} outcome=${stats.finalOutcome} pnl=${stats.pnl} trades=${stats.tradeCount}${resetColor}`,
        )
      } else if (marketResolution.outcome === null) {
        console.warn(`[backtest] Market not resolved yet for slug: ${slug}, skipping stats`)
      } else {
        console.log(`[backtest] slug=${slug} no positions or trades, skipping stats`)
      }
    } else if (!slug) {
      console.warn(`[backtest] Could not parse slug from filename: ${fp}, skipping stats`)
    } else if (!marketResolution) {
      console.warn(`[backtest] Could not get market resolution for slug: ${slug}, skipping stats`)
    }

    const marketElapsedMs = Date.now() - marketStartMs
    completedMarkets += 1
    completedMarketsMsTotal += marketElapsedMs
    const avgPerMarketMs = completedMarketsMsTotal / Math.max(1, completedMarkets)
    const remainingMarkets = Math.max(0, totalMarkets - completedMarkets)
    const etaMs = avgPerMarketMs * remainingMarkets
    const totalElapsedMs = Date.now() - backtestStartMs
    console.log(
      `[backtest][${completedMarkets}/${totalMarkets}] finished in ${formatDurationHuman(marketElapsedMs)} | elapsed ${formatDurationHuman(
        totalElapsedMs,
      )} | eta ${formatDurationHuman(etaMs)}`,
    )
  }

  const batchStats = computeBatchStats(marketStats, initialCapital)
  const chunkedBatchStats = computeChunkedBatchStats(marketStats, initialCapital, [96, 200, 300])

  await insertBacktestRun({
    batchUid,
    baselineId: parsed.baselineId ?? null,
    cmd,
    comment: parsed.comment ?? null,
    strategy: built.strategyId,
    params: built.params as Record<string, unknown>,
    symbol: parsed.symbol ?? null,
    slugs: parsed.slugs ?? null,
    limit: parsed.limit ?? null,
    random: parsed.random ?? false,
    latest: parsed.latest ?? false,
    batchStats: batchStats as unknown as Record<string, unknown>,
    chunkedBatchStats: chunkedBatchStats as unknown as Record<string, unknown>,
    marketStats: marketStats as unknown as unknown[],
  })

  if (marketStats.length > 0) {
    console.log('\n[backtest] ===== MARKET STATS =====')
    for (const stats of marketStats) {
      console.log(JSON.stringify(stats, null, 2))
    }
  }

  console.log('\n[backtest] ===== BATCH STATS =====')
  console.log(JSON.stringify(batchStats, null, 2))

  console.log('\n[backtest] orderbook summary', {
    events,
    byType: Object.fromEntries([...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    ...timer.summary(),
  })

  await closeDb()
}

main().catch(async (err) => {
  console.error('[backtest] failed', err)
  await closeDb()
  process.exit(1)
})
