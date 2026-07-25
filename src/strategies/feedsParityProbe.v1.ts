import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod'
import type { MarketTick, PortfolioSnapshot, Strategy, Intent } from '../strategy/Strategy.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import type { StrategyContext } from '../strategy/StrategyContext.js'
import type { Plugin } from '../strategy/plugins/PluginSet.js'
import { ExternalFeedsRequestPlugin } from '../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { isSyntheticFeedTick } from '../market/syntheticTick.js'
import type { ExternalFeedsSnapshot } from '../trading/feeds/externalFeeds.js'

/**
 * Observability probe for the feeds parity harness (`feeds:parity`).
 *
 * Emits ZERO intents, ever. On each tick it records what a strategy actually
 * sees — `ctx.plugins.externalFeeds` (binance / chainlink / priceToBeat) plus
 * the top-of-book per asset — as a JSONL row to the file named by the
 * FEEDS_PARITY_OUT env var. The same strategy runs in the LIVE bot
 * (DRY_RUN=true) and in REPLAY over a parallel recording; the harness compares
 * the two logs to measure and tune backtest fidelity.
 *
 * Clock semantics (the whole point of the harness):
 * - live: `seenAtMs = Date.now()` at tick entry — when the bot actually
 *   processed the tick.
 * - replay: `seenAtMs = tick.source.tsLocalMs ?? tick.snapshot.timestamp` —
 *   the recorded local receive time (mirrors the feed wiring's `feedClockMs`).
 *
 * Sampling: a row is written when any feed value / key-presence changed since
 * the last written row, or when `heartbeatMs` elapsed (keeps files small while
 * capturing every feed transition boundary). `logEveryTick=true` disables
 * sampling for deep dives.
 *
 * Without FEEDS_PARITY_OUT the probe warns once and runs inert, so it is safe
 * to select anywhere.
 */
export const ConfigSchema = z.strictObject({
  heartbeatMs: z.coerce.number().finite().positive().default(1000),
  logEveryTick: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .default(false),
  /** Opt into synthetic ticks on BOTH feeds (binance trades + chainlink rounds) — measuring them needs logEveryTick=true. */
  tickOnUpdate: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .default(false),
})

export type Config = z.infer<typeof ConfigSchema>

type FeedSample = {
  binance: { tsMs: number; value: number } | null
  chainlink: { tsMs: number; value: number } | null
  ptb: { openPrice: number; receivedAtMs: number } | null
}

export function createStrategy(cfg: Config): { strategy: Strategy; plugins: Plugin[] } {
  const outPath = process.env.FEEDS_PARITY_OUT?.trim()
  let warned = false
  let dirReady = false

  // SYNCHRONOUS append — deliberate. A promise-chained async writer only
  // flushes when the host yields to the event loop AND survives until the
  // chain drains; the backtest CLI ends with process.exit(), which discards
  // whatever is still queued. Sync writes make the probe's output independent
  // of the replayer's yielding behavior, stay ordered by construction, and
  // are cheap at probe volumes (~4 rows/s live; replay bursts land in the OS
  // page cache).
  const writeRow = (row: Record<string, unknown>): void => {
    if (!outPath) return
    try {
      if (!dirReady) {
        mkdirSync(path.dirname(outPath), { recursive: true })
        dirReady = true
      }
      appendFileSync(outPath, `${JSON.stringify(row)}\n`)
    } catch (err) {
      console.error('[feedsParityProbe] write failed:', err)
    }
  }

  let lastWrittenAtMs = Number.NEGATIVE_INFINITY
  let lastSampleKey = ''

  const externalFeedsPlugin = new ExternalFeedsRequestPlugin({
    // pair follows the traded market; tickOnUpdate opts into synthetic ticks
    // on BOTH feeds (binance trades + chainlink rounds)
    binanceWsSpotPrice: { ...(cfg.tickOnUpdate ? { tickOnUpdate: true } : {}) },
    rtdsCryptoPrices: { ...(cfg.tickOnUpdate ? { tickOnUpdate: true } : {}) }, // chainlink symbol follows the traded market
    polymarketPriceToBeat: { enabled: true },
  })

  const onMarketTick = (
    tick: MarketTick,
    _portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    const liveMode = tick.source.kind === 'live'
    const seenAtMs = liveMode
      ? Date.now()
      : ((tick.source.kind === 'parquet' ? tick.source.tsLocalMs : undefined) ??
        tick.snapshot.timestamp)

    if (!outPath) {
      if (!warned) {
        warned = true
        console.warn(
          '[feedsParityProbe] FEEDS_PARITY_OUT is not set — probe runs inert (no rows written)',
        )
      }
      return []
    }

    const feeds = ctx?.plugins?.['externalFeeds'] as ExternalFeedsSnapshot | undefined
    const sample: FeedSample = {
      binance: feeds?.binanceWsSpotPrice
        ? { tsMs: feeds.binanceWsSpotPrice.tsMs, value: feeds.binanceWsSpotPrice.value }
        : null,
      chainlink: feeds?.rtdsPolymarketCryptoPrices?.chainlink
        ? {
            tsMs: feeds.rtdsPolymarketCryptoPrices.chainlink.tsMs,
            value: feeds.rtdsPolymarketCryptoPrices.chainlink.value,
          }
        : null,
      ptb: feeds?.polymarketPriceToBeat
        ? {
            openPrice: feeds.polymarketPriceToBeat.openPrice,
            receivedAtMs: feeds.polymarketPriceToBeat.receivedAtMs,
          }
        : null,
    }
    // Change detection covers values AND key presence; ptb is static per
    // market so its appearance is the interesting transition.
    const sampleKey = `${sample.binance?.value ?? 'x'}|${sample.chainlink?.value ?? 'x'}|${sample.ptb?.openPrice ?? 'x'}`
    const heartbeatDue = seenAtMs - lastWrittenAtMs >= cfg.heartbeatMs
    if (!cfg.logEveryTick && sampleKey === lastSampleKey && !heartbeatDue) return []
    lastSampleKey = sampleKey
    lastWrittenAtMs = seenAtMs

    const books = Object.entries(tick.snapshot.byAssetId).map(([assetId, b]) => ({
      assetId,
      bid: b.bestBid,
      ask: b.bestAsk,
    }))

    writeRow({
      v: 1,
      mode: liveMode ? 'live' : 'parquet',
      seenAtMs,
      exchangeTsMs: tick.snapshot.timestamp,
      eventType: tick.msg.event_type,
      ...(isSyntheticFeedTick(tick.msg) ? { synthetic: true } : {}),
      slug: ctx?.market?.slug,
      ...(sample.binance ? { binance: sample.binance } : {}),
      ...(sample.chainlink ? { chainlink: sample.chainlink } : {}),
      ...(sample.ptb ? { ptb: sample.ptb } : {}),
      books,
    })
    return []
  }

  const strategy: Strategy = {
    name: 'feedsParityProbe.v1',
    onMarketTick,
    onAccountEvent: () => [],
  }
  return { strategy, plugins: [externalFeedsPlugin] }
}

export const definition: StrategyDefinition<Config> = {
  id: 'feedsParityProbe.v1',
  title: 'Feeds parity probe (observability only)',
  description:
    'Logs the per-tick ctx.plugins.externalFeeds view + top-of-book to FEEDS_PARITY_OUT (JSONL). Emits no intents. Used by the feeds:parity harness to compare live vs replay.',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}
