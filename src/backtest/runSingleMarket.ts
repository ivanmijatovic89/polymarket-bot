import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Repo root, derived from this file's location (src/backtest/runSingleMarket.ts).
// Used to anchor relative parquet paths (e.g. `data/events/telonex/...` stored
// by `src/telonex/convert.ts`) so backtests work regardless of CWD — cron jobs,
// systemd units, and cross-machine workers don't have to `cd` into the repo.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
import { isR2Url } from '../r2/parseR2Url.js'
import { downloadR2ToLocal, fileExists } from '../telonex/fetchConvertedToLocal.js'
import type { MarketOrderBooksSnapshot } from '../market/orderbook/index.js'
import { StrategyRunner } from '../trading/StrategyRunner.js'
import { OrderManager } from '../trading/OrderManager.js'
import { BacktestExecution } from '../trading/execution/BacktestExecution.js'
import { PluginSet } from '../strategy/plugins/PluginSet.js'
import { getStrategyDefinition } from '../strategy/strategyRegistry.js'
import type { Strategy, Fill, PositionsSplit } from '../strategy/Strategy.js'
import { computeMarketStats } from './stats/marketStats.js'
import type { MarketStats, MarketExecutionMeta } from './stats/marketStats.js'
import type { MarketResolution } from './stats/marketResolution.js'
import type { GammaMarketMeta } from '../polymarket/gammaMarketMeta.js'
import { replayTelonexDeltaParquetForMarket } from '../parquet/replay/replayTelonexDeltaParquetForMarket.js'
import { replayTelonexPairedParquetForMarket } from '../parquet/replay/replayTelonexPairedParquetForMarket.js'
import {
  replayOrderBookForMarket,
  type ReplayApplyEvent,
} from '../parquet/replay/replayOrderBookForMarket.js'
import { wireBacktestBinanceFeed } from './feeds/wireBacktestExternalFeeds.js'

export type RunSingleMarketInputMode = 'recorded' | 'telonex-delta' | 'telonex-paired'

export type RunSingleMarketLatency = {
  delayMs: number
  jitterMs: number
}

export type RunSingleMarketInput = {
  /** Position in the original input list. Used by aggregator to restore order. */
  idx: number
  /** Path to the parquet file (local or fetched). */
  filePath: string
  /**
   * `--read-from local-or-download-from-r2-to-local` only: r2:// URL to download to `filePath` if that
   * local file is missing. Absent for `local` / `r2` modes.
   */
  r2Fallback?: string
  /** Market slug. May be null if filename doesn't parse — in that case stats are skipped. */
  slug: string | null
  /** Resolved Gamma metadata for the market. May be undefined if unavailable. */
  marketMeta: GammaMarketMeta | undefined
  /** Resolved tokenMap + final outcome. Null if not resolvable; stats are then skipped. */
  marketResolution: MarketResolution | null
  /** Strategy id (key in strategyRegistry). */
  strategyId: string
  /** Strategy params already parsed/validated by `buildStrategyFromCliArgs`. */
  strategyParams: Record<string, unknown>
  /** Which replay path to use. */
  inputMode: RunSingleMarketInputMode
  /** Recorded-mode replay ordering. Unused for telonex modes. */
  order: 'recorded' | 'exchange_time'
  /** Recorded-mode time-driven replay. Unused for telonex modes. */
  timeDriven: boolean
  /** BacktestExecution latency simulation. */
  latency: RunSingleMarketLatency
  /**
   * Optional time window (ms) during which `runner.onMarketTick` is invoked.
   * Snapshots outside the window still update event counters but are skipped
   * for strategy logic and fill collection. Used for telonex modes where
   * the parquet may contain out-of-window rows.
   */
  strategyWindow?: { startMs: number; endMs: number } | null
  /** Stable per-machine id from `getMachineId()`. Persisted with the row. */
  machineId: string
  /** Forked market worker child id on that machine. Null for sequential/legacy paths. */
  workerChildId?: number | null
  /** Git SHA the worker is running on. Stored in execution metadata. */
  commitSha: string
  /**
   * Optional cooperative cancellation. When it returns true, the replay
   * stops accepting new snapshots (matches legacy `backtest.ts` SIGINT behavior).
   * For deterministic re-runs (verification, distributed workers), leave undefined.
   */
  shouldStop?: () => boolean
}

export type RunSingleMarketOutput = {
  idx: number
  slug: string | null
  /**
   * Null when:
   *  - filename slug could not be parsed
   *  - market resolution unavailable (no UP/DOWN outcome)
   *  - no positions and no trades after replay
   */
  marketStats: MarketStats | null
  /** Total events emitted by the replay (book + price_change snapshots). */
  eventsProcessed: number
  /** Event-type histogram (e.g. `{ book: 1, price_change: 4823 }`). */
  eventsByType: Record<string, number>
  /** Wall-clock duration of replay + collection (ms). */
  durationMs: number
  /** Optional reason string when `marketStats` is null. */
  skipReason?: 'no_slug' | 'no_resolution' | 'unresolved_outcome' | 'no_activity'
}

/**
 * Builds a fresh Strategy + Runner + OrderManager + BacktestExecution for a single market.
 *
 * Each call returns a brand-new isolated set of state — no sharing between markets.
 */
function buildRunnerForMarket(args: {
  strategyId: string
  strategyParams: Record<string, unknown>
  latency: RunSingleMarketLatency
  getMarket?: () => GammaMarketMeta | undefined
}): { strategy: Strategy; runner: StrategyRunner; pluginSet: PluginSet | undefined } {
  const def = getStrategyDefinition(args.strategyId)
  const built = def.create(args.strategyParams as never)
  const strategy = built.strategy
  const pluginSet = (() => {
    if (built.pluginSet) return built.pluginSet
    if (Array.isArray(built.plugins) && built.plugins.length > 0) {
      const s = new PluginSet()
      for (const p of built.plugins) s.register(p)
      return s
    }
    return undefined
  })()

  const exec = new BacktestExecution({
    latencyMs: args.latency.delayMs,
    jitterMs: args.latency.delayMs > 0 ? args.latency.jitterMs : 0,
    cancelLatency: true,
    makerFillMode: 'worst_queue',
  })
  const orderManager = new OrderManager({
    execution: exec,
    dryRun: false,
    log: (msg, extra) => console.log(msg, extra ?? ''),
  })
  const runner = new StrategyRunner({
    strategyId: args.strategyId,
    strategyParams: args.strategyParams,
    strategy,
    orderManager,
    intentExecutionMode: 'immediate',
    ...(pluginSet ? { pluginSet } : {}),
    ...(args.getMarket ? { getMarket: args.getMarket } : {}),
    log: (msg, extra) => console.log(msg, extra ?? ''),
  })
  return { strategy, runner, pluginSet }
}

/**
 * Runs a single market replay end-to-end and returns the per-market stats + execution metadata.
 *
 * No DB lookups, no MySQL writes — all inputs are pre-resolved by the caller
 * (producer in distributed mode). The one network touch is for
 * `--read-from local-or-download-from-r2-to-local`: if the local file is
 * missing it is downloaded from R2 once before replay; otherwise no HTTP.
 *
 * Determinism: with `latency.jitterMs === 0` and no `Math.random()` in strategy code,
 * the output is deterministic for a given input — same call twice yields identical `marketStats`.
 */
export async function runSingleMarket(input: RunSingleMarketInput): Promise<RunSingleMarketOutput> {
  const startedAtMs = Date.now()
  const eventsByType: Record<string, number> = {}
  let eventsProcessed = 0

  const buildExecutionMeta = (extra?: Partial<MarketExecutionMeta>): MarketExecutionMeta => {
    const finishedAtMs = Date.now()
    return {
      machineId: input.machineId,
      workerChildId: input.workerChildId ?? null,
      startedAtMs,
      finishedAtMs,
      durationMs: finishedAtMs - startedAtMs,
      eventsProcessed,
      eventsByType: { ...eventsByType },
      commitSha: input.commitSha,
      ...extra,
    }
  }

  // Early exits for inputs that can't produce stats. We still run the replay
  // so that the engine state and event counters are exercised consistently,
  // but the final marketStats is null.
  if (!input.slug) {
    return {
      idx: input.idx,
      slug: null,
      marketStats: null,
      eventsProcessed: 0,
      eventsByType: {},
      durationMs: Date.now() - startedAtMs,
      skipReason: 'no_slug',
    }
  }

  const { runner, pluginSet } = buildRunnerForMarket({
    strategyId: input.strategyId,
    strategyParams: input.strategyParams,
    latency: input.latency,
    getMarket: () => input.marketMeta,
  })

  // Strategy-driven external feeds (same contract as live): if the strategy
  // registers ExternalFeedsRequestPlugin with a binance request, fulfill it
  // from historical data before any tick is replayed. Strategies without the
  // plugin return immediately — no behavior change for them.
  await wireBacktestBinanceFeed({
    pluginSet,
    slug: input.slug,
    strategyWindow: input.strategyWindow ?? null,
  })

  let currentMarketId: string | undefined
  const currentMarketTrades: Fill[] = []
  const seenFillIds = new Set<string>()
  const currentMarketSplits: PositionsSplit[] = []
  const seenSplitIds = new Set<string>()

  const onSnapshot = async (
    snap: MarketOrderBooksSnapshot,
    raw: ReplayApplyEvent,
  ): Promise<void> => {
    if (input.shouldStop?.()) return
    eventsProcessed += 1
    eventsByType[raw.msg.event_type] = (eventsByType[raw.msg.event_type] ?? 0) + 1

    if (!currentMarketId) {
      currentMarketId = snap.market
    }

    if (input.strategyWindow) {
      const ts = snap.timestamp
      if (
        !Number.isFinite(ts) ||
        ts < input.strategyWindow.startMs ||
        ts > input.strategyWindow.endMs
      ) {
        return
      }
    }

    await runner.onMarketTick({ source: raw.source, msg: raw.msg, snapshot: snap })

    if (!currentMarketId) return
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

  // Relative paths are anchored at REPO_ROOT (not process.cwd()) so workers
  // launched from any CWD — service managers, cross-machine queue runners,
  // ad-hoc `cd /tmp && npx tsx …` — find dataset files identically.
  // r2:// URLs must pass through untouched: path.resolve() would mangle
  // `r2://bucket/key` into `<repo>/r2:/bucket/key`, defeating the isR2Url check
  // in openParquetReaderWithEpermFallback (that broke `--read-from r2`).
  const filePath = isR2Url(input.filePath)
    ? input.filePath
    : path.isAbsolute(input.filePath)
      ? input.filePath
      : path.resolve(REPO_ROOT, input.filePath)

  // `--read-from local-or-download-from-r2-to-local`: read the canonical local file if present, else
  // download it from R2 to that path once and read locally thereafter. The
  // producer set `filePath` to the local path and `r2Fallback` to the r2:// URL.
  // The `[read-from]` log makes the local-vs-R2 decision auditable per market.
  if (input.r2Fallback) {
    if (await fileExists(filePath)) {
      console.log(`[read-from] LOCAL hit slug=${input.slug} ${filePath}`)
    } else {
      console.log(`[read-from] R2 download slug=${input.slug} <- ${input.r2Fallback}`)
      const { bytes } = await downloadR2ToLocal(input.r2Fallback, filePath)
      console.log(`[read-from] R2 done slug=${input.slug} bytes=${bytes} -> ${filePath}`)
    }
  }

  if (input.inputMode === 'telonex-paired') {
    await replayTelonexPairedParquetForMarket({
      filePath,
      ...(input.shouldStop ? { shouldStop: input.shouldStop } : {}),
      onSnapshot,
    })
  } else if (input.inputMode === 'telonex-delta') {
    await replayTelonexDeltaParquetForMarket({
      filePath,
      ...(input.shouldStop ? { shouldStop: input.shouldStop } : {}),
      onSnapshot,
    })
  } else {
    await replayOrderBookForMarket({
      filePaths: [filePath],
      order: input.order,
      timeDriven: input.timeDriven,
      ...(input.shouldStop ? { shouldStop: input.shouldStop } : {}),
      onSnapshot,
    })
  }

  // If we couldn't resolve, skip stats but report counts/timing.
  if (!input.marketResolution) {
    return {
      idx: input.idx,
      slug: input.slug,
      marketStats: null,
      eventsProcessed,
      eventsByType: { ...eventsByType },
      durationMs: Date.now() - startedAtMs,
      skipReason: 'no_resolution',
    }
  }
  if (input.marketResolution.outcome === null) {
    return {
      idx: input.idx,
      slug: input.slug,
      marketStats: null,
      eventsProcessed,
      eventsByType: { ...eventsByType },
      durationMs: Date.now() - startedAtMs,
      skipReason: 'unresolved_outcome',
    }
  }
  if (!currentMarketId) {
    return {
      idx: input.idx,
      slug: input.slug,
      marketStats: null,
      eventsProcessed,
      eventsByType: { ...eventsByType },
      durationMs: Date.now() - startedAtMs,
      skipReason: 'no_activity',
    }
  }

  const portfolio = runner.getPortfolio().snapshot()
  const finalPositions = portfolio.positionsByAssetId
  const realizedPnl = portfolio.realizedPnlTotal ?? 0

  const upAssetId = input.marketResolution.tokenMap['UP']
  const downAssetId = input.marketResolution.tokenMap['DOWN']
  const hasPositions =
    (!!upAssetId && !!finalPositions[upAssetId] && finalPositions[upAssetId]!.qty > 0) ||
    (!!downAssetId && !!finalPositions[downAssetId] && finalPositions[downAssetId]!.qty > 0)

  if (!hasPositions && currentMarketTrades.length === 0) {
    // Keep market denominator stable across modes/runs: emit explicit 0-trade
    // market stats with `skipReason: 'no_in_window_activity'`.
    const zeroStats = computeMarketStats({
      marketId: currentMarketId,
      slug: input.slug,
      trades: [],
      splits: currentMarketSplits,
      finalPositions,
      realizedPnl,
      finalOutcome: input.marketResolution.outcome,
      tokenMap: input.marketResolution.tokenMap,
    })
    const taggedZero: MarketStats = {
      ...zeroStats,
      skipReason: 'no_in_window_activity',
      execution: buildExecutionMeta(),
    }
    return {
      idx: input.idx,
      slug: input.slug,
      marketStats: taggedZero,
      eventsProcessed,
      eventsByType: { ...eventsByType },
      durationMs: taggedZero.execution!.durationMs,
      skipReason: 'no_activity',
    }
  }

  const stats = computeMarketStats({
    marketId: currentMarketId,
    slug: input.slug,
    trades: currentMarketTrades,
    splits: currentMarketSplits,
    finalPositions,
    realizedPnl,
    finalOutcome: input.marketResolution.outcome,
    tokenMap: input.marketResolution.tokenMap,
  })

  stats.execution = buildExecutionMeta()

  return {
    idx: input.idx,
    slug: input.slug,
    marketStats: stats,
    eventsProcessed,
    eventsByType: { ...eventsByType },
    durationMs: stats.execution.durationMs,
  }
}
