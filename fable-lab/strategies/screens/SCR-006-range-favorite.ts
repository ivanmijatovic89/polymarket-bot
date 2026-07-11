/**
 * SCR-006 — late favorite in wide-range windows (`screens`, BATCH-002).
 *
 * Mechanism: after a WIDE intra-window range, the late favorite's ask may
 * still under-price resolution certainty (the loser side stays stale per
 * the E21/E22/Z1-Z3 adverse family; this buys the OTHER side of that
 * staleness as a fee-paying taker).
 *
 * Aim (disclosed): SIGNAL-001 warm mirror cells — DOWN o850 HI range q4
 * d=+4.51c z=+3.10 n=255 (sub-bar WARM, not a candidate; SIGNAL-MAP §3).
 * IN-SAMPLE OVERLAP DISCLOSED: the screen re-samples the same discovery
 * window that generated the hypothesis; a screen survival is therefore
 * NOT independent confirmation — graduation (full lifecycle + reserve)
 * is the real out-of-sample. Kill-biased as all screens.
 *
 * Escape argument vs dead classes: EXP-001/E14 killed unconditional
 * tail-buying (minAsk 0.95); CAL-001/E20 scanned fixed-time state
 * unconditional on path. This conditions on realized RANGE (a path
 * feature no CAL scan expressed) and buys the 0.65-0.98 stratum, not the
 * 0.95+ tail.
 *
 * Replay-safety: deterministic; late-start guard (first observed tick
 * must be ≤ maxFirstTickSec so the running range is genuine); E6 crossed
 * guard; one FOK entry per market; hold to resolution.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Minimum running UP-mid range (max − min) at entry time. */
  minRange: z.coerce.number().finite().gt(0).lt(1).default(0.3),
  /** Entry at first valid tick at-or-after this episode second. */
  entrySec: z.coerce.number().finite().positive().max(899).default(850),
  /** Entry ask must sit in the HI stratum (favorite, not extreme tail). */
  minAsk: z.coerce.number().finite().gt(0).lt(1).default(0.65),
  maxAsk: z.coerce.number().finite().gt(0).lt(1).default(0.98),
  /** Range is only trusted if we observed the window from (near) its start. */
  maxFirstTickSec: z.coerce.number().finite().positive().max(600).default(60),
  shares: z.coerce.number().finite().positive().max(1500).default(100),
})
export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'fable-scr-006',
  title: 'SCR-006 late favorite after wide range',
  description: 'FOK-buy the ≥850s favorite (ask 0.65-0.98) when the running UP-mid range is wide; hold to resolution.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let firstTickSec: number | null = null
    let rngMin: number | null = null
    let rngMax: number | null = null
    let entered = false

    const onMarketTick = (
      tick: MarketTick,
      _portfolio: PortfolioSnapshot,
      ctx?: StrategyContext,
    ): Intent[] => {
      if (!isWarmed(ctx)) return []
      const meta = ctx?.market
      const slug = meta?.slug
      const upAssetId = meta?.upAssetId
      const downAssetId = meta?.downAssetId
      if (!slug || !upAssetId || !downAssetId) return []
      if (stateSlug !== slug) {
        stateSlug = slug
        firstTickSec = null
        rngMin = rngMax = null
        entered = false
      }
      if (entered) return []
      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const elapsedSec = (tick.snapshot.timestamp - Number(epochMatch[1]) * 1000) / 1000

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      const upBid = up?.bestBid
      const upAsk = up?.bestAsk
      if (up == null || down == null || upBid == null || upAsk == null || upBid >= upAsk) return []
      const upMid = (upBid + upAsk) / 2

      if (firstTickSec === null) firstTickSec = elapsedSec
      rngMin = rngMin === null ? upMid : Math.min(rngMin, upMid)
      rngMax = rngMax === null ? upMid : Math.max(rngMax, upMid)

      if (elapsedSec < cfg.entrySec) return []
      if (firstTickSec > cfg.maxFirstTickSec) return [] // range not trusted
      const range = rngMax - rngMin
      if (range < cfg.minRange) return []

      const favSide = upMid >= 0.5 ? 'UP' : 'DOWN'
      const book = favSide === 'UP' ? up : down
      const assetId = favSide === 'UP' ? upAssetId : downAssetId
      const ask = book.bestAsk
      const bid = book.bestBid
      if (ask == null || bid == null || bid >= ask) return []
      if (ask < cfg.minAsk || ask > cfg.maxAsk) return []
      let depth = 0
      for (const lvl of book.asks) {
        if (lvl.price > ask) break
        depth += lvl.size
      }
      const size = Math.min(cfg.shares, depth)
      if (size <= 0) return []

      entered = true
      return [
        {
          kind: 'place_limit',
          clientOrderId: `scr006:${slug}`,
          assetId,
          side: 'BUY',
          price: ask,
          size,
          orderType: 'FOK',
          meta: {
            exp: 'SCR-006',
            side: favSide,
            entryAsk: ask,
            range,
            upMid,
            firstTickSec,
            elapsedSec: Math.floor(elapsedSec),
          },
          reason: 'late favorite after wide range',
        },
      ]
    }

    const strategy: Strategy = {
      name: 'fable-scr-006',
      onMarketTick,
      onAccountEvent: () => [],
    }
    return { strategy }
  },
}
