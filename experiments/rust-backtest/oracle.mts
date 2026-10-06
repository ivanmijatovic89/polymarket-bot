import path from 'node:path'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { config } from 'dotenv'
import { ensureArtifactLoaded } from '../../src/strategy/artifacts/loader.js'
import { buildRunnerForMarket, runSingleMarket } from '../../src/backtest/runSingleMarket.js'
import { replayTelonexDeltaParquetForMarket } from '../../src/parquet/replay/replayTelonexDeltaParquetForMarket.js'
import { createBacktestExternalFeedsProvider } from '../../src/backtest/feeds/backtestExternalFeedsProvider.js'
import {
  buildSyntheticTickSchedule,
  createSyntheticFlusher,
} from '../../src/backtest/feeds/syntheticTickSchedule.js'
import { buildSyntheticFeedTick } from '../../src/market/syntheticTick.js'
import { feedClockMs } from '../../src/backtest/feeds/wireBacktestExternalFeeds.js'
import { isExternalFeedsRequestPlugin } from '../../src/strategy/plugins/ExternalFeedsRequestPlugin.js'
import { Portfolio } from '../../src/trading/Portfolio.js'
import { computePositionMetricsFromMarket } from '../../src/trading/positionMetrics.js'
import { computeOrderbookMetricsFromMarket } from '../../src/trading/orderbookMetrics.js'
import { computeMarketStats } from '../../src/backtest/stats/marketStats.js'
import type {
  MarketTick,
  Fill,
  Intent,
  AccountEvent,
  PortfolioSnapshot,
} from '../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../src/strategy/StrategyContext.js'
import type { ExternalFeedsSnapshot } from '../../src/trading/feeds/externalFeeds.js'
import type { MarketOrderBooksSnapshot } from '../../src/market/orderbook/index.js'
import {
  Digest,
  loadManifest,
  seededRandom,
  marketMeta,
  type Feeds,
  type Market,
} from './common.mjs'

const [manifestPath, outputPath, mode = 'prepared', traceFlag = 'no-trace', indexArg] =
  process.argv.slice(2)
if (!manifestPath || !outputPath || !['prepared', 'production'].includes(mode))
  throw new Error(
    'Usage: oracle.mts manifest output [prepared|production] [trace|no-trace] [market-index]',
  )
const trace = traceFlag === 'trace'
const manifest = await loadManifest(manifestPath)
const root =
  process.env.BENCHMARK_DATA_ROOT ??
  path.resolve(path.dirname(manifest.markets[0]!.filePath), '../../../../../..')
config({ path: `${root}/.env` })
process.env.BINANCE_DATA_BASE_DIR = `${root}/data/binance`
process.env.TELONEX_CRYPTO_PRICES_BASE_DIR = `${root}/data/telonex/crypto_prices`
for (const [name, value] of Object.entries({
  BACKTEST_BINANCE_FEED_LATENCY_MS: manifest.settings.binanceLatencyMs,
  BACKTEST_RTDS_CHAINLINK_LATENCY_MS: manifest.settings.chainlinkLatencyMs,
  BACKTEST_PRICE_TO_BEAT_LATENCY_MS: manifest.settings.priceToBeatLatencyMs,
}))
  process.env[name] = String(value)
const def = await ensureArtifactLoaded({
  sha256: manifest.artifactSha256,
  r2Url: manifest.artifactMeta.r2Url,
})
const s = manifest.settings
// Output logging costs are excluded consistently. No live execution adapter is constructed.
console.log = () => {}
const progressEvery = Number(process.env.BENCHMARK_PROGRESS_EVERY ?? 0)
let observedPortfolio: PortfolioSnapshot | undefined
const originalSnapshot = Portfolio.prototype.snapshot
if (trace)
  Portfolio.prototype.snapshot = function () {
    observedPortfolio = originalSnapshot.call(this)
    return observedPortfolio
  }
const results = []
const start = performance.now()
const cpuStart = process.cpuUsage()
for (const m of indexArg === undefined ? manifest.markets : [manifest.markets[Number(indexArg)]!]) {
  if (!m) throw new Error('Invalid market index')
  const started = performance.now()
  const rng = seededRandom(s.seed)
  const oldRandom = Math.random
  Math.random = rng
  let current: MarketTick | undefined
  const digest = new Digest(),
    feedDigest = new Digest(),
    contextDigest = new Digest()
  let finalContext: StrategyContext | undefined
  const events: unknown[] = []
  const decisions: unknown[] = []
  let finalState: PortfolioSnapshot | undefined
  const observer = trace
    ? {
        onContext: (ctx: StrategyContext | undefined) => {
          finalContext = ctx
          feedDigest.feeds(ctx?.plugins?.externalFeeds as ExternalFeedsSnapshot | undefined)
          const p = ctx?.metrics?.position
          for (const key of [
            'shares_mergeable',
            'pair_avg',
            'total_cost',
            'pnl_merge',
            'pnl_if_up_wins',
            'pnl_if_down_wins',
            'imbalance',
          ] as const)
            contextDigest.number(p?.[key])
          const b = ctx?.metrics?.orderbook
          contextDigest.number(b ? 1 : 0)
          if (b) {
            contextDigest.number(b.depthLevels)
            for (let i = 0; i < b.depthLevels; i++) {
              contextDigest.number(['NONE', 'UP', 'DOWN'].indexOf(b.weakBidSideByLevel[i]!))
              contextDigest.number(b.weakBidRatioByLevel[i])
              contextDigest.number(['NONE', 'UP', 'DOWN'].indexOf(b.weakAskSideByLevel[i]!))
              contextDigest.number(b.weakAskRatioByLevel[i])
            }
          }
        },
        onDecision: (origin: 'market' | 'account', intents: readonly Intent[]) => {
          for (const i of intents) {
            if (i.kind !== 'place_limit' || i.side !== 'BUY' || i.orderType !== 'FOK')
              throw new Error('Unsupported strategy intent')
            decisions.push({ origin, tsMs: current!.snapshot.timestamp, intent: i })
          }
        },
        onAccountEvent: (ev: AccountEvent, p: PortfolioSnapshot) => {
          events.push(
            JSON.parse(
              JSON.stringify({
                event: ev,
                portfolio: p,
                metrics: {
                  position: computePositionMetricsFromMarket({
                    portfolio: p,
                    market: marketMeta(m),
                  }),
                  ...(computeOrderbookMetricsFromMarket({
                    marketBooks: current!.snapshot,
                    market: marketMeta(m),
                  })
                    ? {
                        orderbook: computeOrderbookMetricsFromMarket({
                          marketBooks: current!.snapshot,
                          market: marketMeta(m),
                        }),
                      }
                    : {}),
                },
              }),
            ),
          )
          finalState = p
        },
        onTickStart: (t: MarketTick) => {
          current = t
          digest.tick(t, m)
        },
        onTickEnd: () => {},
      }
    : undefined
  try {
    let stats: unknown,
      eventsProcessed = 0
    const counts: Record<string, number> = {}
    if (mode === 'production') {
      const out = await runSingleMarket({
        idx: 0,
        filePath: m.filePath,
        slug: m.slug,
        marketMeta: marketMeta(m),
        marketResolution: { tokenMap: { UP: m.upId, DOWN: m.downId }, outcome: m.outcome },
        strategyId: manifest.strategy,
        strategyParams: manifest.params,
        strategyDefinition: def,
        inputMode: 'telonex-delta',
        order: 'recorded',
        timeDriven: false,
        latency: { delayMs: s.delayMs, jitterMs: s.jitterMs },
        strategyWindow: { startMs: m.startMs, endMs: m.endMs },
        startingCapital: s.startingCapital,
        gammaPriceToBeat: { priceToBeat: m.priceToBeat, syncedAtMs: m.gammaSyncedAtMs },
        machineId: 'rust-experiment',
        commitSha: '42bcc992',
        ...(observer ? { observer } : {}),
      })
      if (!out.marketStats) throw new Error(`Production replay failed: ${out.skipReason}`)
      stats = out.marketStats
      eventsProcessed = out.eventsProcessed
      Object.assign(counts, out.eventsByType)
    } else {
      const f: Feeds = JSON.parse(await readFile(m.feeds, 'utf8'))
      const bin = {
        tsMs: Float64Array.from(f.binance, (x) => x[0]),
        value: Float64Array.from(f.binance, (x) => x[1]),
        length: f.binance.length,
      }
      const cl = {
        tsMs: Float64Array.from(f.chainlink, (x) => x[0]),
        visibleAtMs: Float64Array.from(f.chainlink, (x) => x[1]),
        value: Float64Array.from(f.chainlink, (x) => x[2]),
        length: f.chainlink.length,
      }
      const providerArgs = {
        binanceWsSpotPrice: { symbol: 'btcusdt', series: bin, latencyOffsetMs: s.binanceLatencyMs },
        rtdsChainlink: { symbol: 'btc/usd', series: cl, latencyOffsetMs: s.chainlinkLatencyMs },
        polymarketPriceToBeat: {
          symbol: 'BTC',
          eventStartTimeIso: new Date(m.startMs).toISOString(),
          endDateIso: new Date(m.endMs).toISOString(),
          openPrice: m.priceToBeat,
          availableAtMs: m.startMs + s.priceToBeatLatencyMs,
        },
      }
      const provider = createBacktestExternalFeedsProvider(providerArgs)
      const { runner, pluginSet } = buildRunnerForMarket({
        strategyId: manifest.strategy,
        strategyParams: manifest.params,
        strategyDefinition: def,
        startingCapital: s.startingCapital,
        latency: { delayMs: s.delayMs, jitterMs: s.jitterMs },
        getMarket: () => marketMeta(m),
        ...(observer ? { observer } : {}),
      })
      const plugin = pluginSet!.list().find(isExternalFeedsRequestPlugin)!
      plugin.fulfill((t?: MarketTick) => provider.snapshotAt(t ? feedClockMs(t) : NaN))
      const fills: Fill[] = []
      const seen = new Set<string>()
      const dispatch = async (t: MarketTick) => {
        eventsProcessed++
        counts[t.msg.event_type] = (counts[t.msg.event_type] ?? 0) + 1
        if (t.snapshot.timestamp < m.startMs || t.snapshot.timestamp > m.endMs) return
        observer?.onTickStart(t)
        await runner.onMarketTick(t)
        // Match runSingleMarket's per-tick harvesting, including zero-trade ticks.
        for (const fill of runner.getPortfolio().snapshot().recentFills) {
          if (fill.market === m.marketId && !seen.has(fill.id)) {
            fills.push(fill)
            seen.add(fill.id)
          }
        }
      }
      let last: MarketOrderBooksSnapshot | undefined
      const schedule = buildSyntheticTickSchedule({
        binance: providerArgs.binanceWsSpotPrice,
        chainlink: providerArgs.rtdsChainlink,
        windowStartMs: m.startMs,
        windowEndMs: m.endMs,
      })
      const flusher = createSyntheticFlusher({
        schedule,
        hasBaseSnapshot: () => last !== undefined,
        dispatch: async (ev) =>
          dispatch(
            buildSyntheticFeedTick({
              eventType: ev.eventType,
              symbol: ev.symbol,
              visibilityMs: ev.visibilityMs,
              baseSnapshot: last!,
              source: {
                kind: 'parquet',
                filePath: m.filePath,
                ingestSeq: 0n,
                tsLocalMs: ev.visibilityMs,
              },
            }),
          ),
      })
      await replayTelonexDeltaParquetForMarket({
        filePath: m.filePath,
        onSnapshot: async (snap, raw) => {
          const t: MarketTick = { source: raw.source, msg: raw.msg, snapshot: snap }
          await flusher.flushUpTo(feedClockMs(t))
          last = snap
          await dispatch(t)
        },
      })
      await flusher.flushTail()
      const p = runner.getPortfolio().snapshot()
      finalState = p
      const rest = computeMarketStats({
        slug: m.slug,
        marketId: m.marketId,
        trades: fills,
        finalPositions: p.positionsByAssetId,
        realizedPnl: p.realizedPnlTotal ?? 0,
        finalOutcome: m.outcome,
        tokenMap: { UP: m.upId, DOWN: m.downId },
      })
      stats = { ...rest, ...(!fills.length ? { skipReason: 'no_in_window_activity' } : {}) }
    }
    results.push({
      slug: m.slug,
      eventsProcessed,
      eventsByType: counts,
      stats,
      durationMs: performance.now() - started,
      ...(trace
        ? {
            tickDigest: digest.value,
            feedDigest: feedDigest.value,
            tickSha256: digest.sha256(),
            feedSha256: feedDigest.sha256(),
            decisions,
            events,
            finalState: observedPortfolio ?? finalState,
            finalContext,
            contextDigest: contextDigest.value,
            contextSha256: contextDigest.sha256(),
          }
        : {}),
    })
    if (progressEvery > 0 && results.length % progressEvery === 0)
      console.error(
        `Progress: ${results.length} markets, ${((performance.now() - start) / 1000).toFixed(1)} s, last=${m.slug}`,
      )
  } finally {
    Math.random = oldRandom
  }
}
const cpu = process.cpuUsage(cpuStart)
await writeFile(
  outputPath,
  JSON.stringify({
    engine: 'typescript',
    manifestSha256: createHash('sha256')
      .update(await readFile(manifestPath))
      .digest('hex'),
    mode,
    node: process.version,
    trace,
    durationMs: performance.now() - start,
    cpuMs: (cpu.user + cpu.system) / 1000,
    maxRssBytes: process.resourceUsage().maxRSS * 1024,
    results,
  }),
)
