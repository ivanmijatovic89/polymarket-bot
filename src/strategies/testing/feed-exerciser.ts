import type { Intent, Strategy } from '../../strategy/Strategy.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import type { Plugin } from '../../strategy/plugins/PluginSet.js'
import { DwellGatePlugin } from '../../strategy/plugins/DwellGatePlugin.js'
import { ExternalFeedsRequestPlugin } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import { TechnicalIndicatorsPlugin } from '../../strategy/plugins/TechnicalIndicatorsPlugin.js'
import { TimeWindowGatePlugin } from '../../strategy/plugins/TimeWindowGatePlugin.js'
import { TimeWindowVolatility } from '../../strategy/plugins/TimeWindowVolatility.js'
import { createExerciser } from './engine-exerciser.js'
import * as z from 'zod'

/**
 * Feed exerciser — parity-test strategy, NOT a trading strategy
 * (native/spec/60-verification.md §5.8, 14 V-3; TS twin of
 * `feed-exerciser.rs`, D20).
 *
 * Requests every historical feed (Binance aggTrades, Chainlink when
 * `chainlink`, price to beat) with `tickOnUpdate` per the param, and the
 * plugins TimeWindowVolatility, DwellGate, TimeWindowGate and, only when
 * `ta`, TechnicalIndicators (D19 as amended). The parity trace at level
 * `feeds` records what the strategy sees on every tick (22 §3.2).
 *
 * - `trade: false` returns no intents (the T15 tick-stream checkpoint).
 * - `trade: true` runs the engine exerciser schedule on real ticks only
 *   (60 §5.1: synthetic feed ticks never count), so both twins follow the
 *   engine exerciser's `EXERCISER_SCHEDULE_VERSION`.
 *
 * Plugin configurations are fixed and identical in both twins
 * (`FEED_EXERCISER_PLUGIN_CONFIG`).
 */

export const FEED_EXERCISER_ID = 'feed-exerciser'

const flag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true')

/** 60 §5.8: `{tickOnUpdate, trade, ta, chainlink}`; only `chainlink` has a default (true). */
export const ConfigSchema = z.strictObject({
  tickOnUpdate: flag,
  trade: flag,
  ta: flag,
  chainlink: flag.default(true),
})

export type Config = z.infer<typeof ConfigSchema>

/**
 * Fixed plugin configurations shared by both twins.
 */
// D-PENDING: 60 §5.8 names the plugins but not their configs; chose fixed configs that exercise each plugin inside a 15m window (volatility windows 10 s and 60 s on mid, dwell band [0.40, 0.60] for 5 s on bid, gate open 60 s–840 s after start).
export const FEED_EXERCISER_PLUGIN_CONFIG = {
  timeWindowVolatility: { windows: { '10s': 10_000, '60s': 60_000 }, trackPrice: 'mid' as const },
  dwellGate: { from: 0.4, to: 0.6, requiredMs: 5_000, trackPrice: 'bid' as const },
  timeWindowGate: { allowAfterMs: 60_000, disableAfterMs: 840_000 },
} as const

export const definition: StrategyDefinition<Config> = {
  id: FEED_EXERCISER_ID,
  title: 'Feed exerciser (parity test)',
  description:
    'Deterministic parity-test strategy that requests every historical feed and the v1 plugins and records what it sees (native/spec/60-verification.md §5.8). Not a trading strategy.',
  schema: ConfigSchema,
  create: (cfg) => createFeedExerciser(cfg),
}

export function feedExerciserPlugins(cfg: Config): Plugin[] {
  const pc = FEED_EXERCISER_PLUGIN_CONFIG
  const plugins: Plugin[] = [
    new ExternalFeedsRequestPlugin({
      // Symbols follow the traded market (slug in backtests).
      binanceWsSpotPrice: { tickOnUpdate: cfg.tickOnUpdate },
      ...(cfg.chainlink ? { rtdsCryptoPrices: { tickOnUpdate: cfg.tickOnUpdate } } : {}),
      polymarketPriceToBeat: { enabled: true },
    }),
    new TimeWindowVolatility({
      windows: { ...pc.timeWindowVolatility.windows },
      trackPrice: pc.timeWindowVolatility.trackPrice,
    }),
    new DwellGatePlugin({ ...pc.dwellGate }),
    new TimeWindowGatePlugin({ ...pc.timeWindowGate }),
  ]
  if (cfg.ta) plugins.push(new TechnicalIndicatorsPlugin())
  return plugins
}

export function createFeedExerciser(cfg: Config): { strategy: Strategy; plugins: Plugin[] } {
  const engine = cfg.trade ? createExerciser() : null
  const strategy: Strategy = {
    name: FEED_EXERCISER_ID,
    onMarketTick: (tick, portfolio, ctx): Intent[] | Promise<Intent[]> =>
      engine ? engine.onMarketTick(tick, portfolio, ctx) : [],
    onAccountEvent: (ev, portfolio, lastMarket, ctx): Intent[] | Promise<Intent[]> =>
      engine ? engine.onAccountEvent(ev, portfolio, lastMarket, ctx) : [],
  }
  return { strategy, plugins: feedExerciserPlugins(cfg) }
}
