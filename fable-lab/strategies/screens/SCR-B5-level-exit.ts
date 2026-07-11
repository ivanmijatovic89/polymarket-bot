/**
 * SCR-B5 level-entry template (`fable-scr-lvl`, BATCH-005 FINAL RUN).
 *
 * Covers SCR-020..SCR-023: buy the side whose ask sits in a frozen
 * price band at the first opportunity inside the elapsed window,
 * with the unswept EXIT axis (maker take-profit / taker stop-loss /
 * settle) and an optional early-activity subpopulation gate (tick
 * count in the first activityWindowSec seconds — a per-market
 * liquidity/attention proxy no prior cell conditioned on).
 *
 * Level entries held to settlement are measured fair (EXP-001, E14;
 * CAL-001 plane, E20). These cells change the PAYOFF SHAPE (truncate
 * the loss tail or monetize convergence early at zero maker fee) or
 * the POPULATION (low-activity markets), not the entry story.
 *
 * Replay-safe: deterministic; time from tick.snapshot.timestamp; E6
 * guard; depth-clamped FOK entry; one entry per market.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Entry band on the chosen side's ask. */
  entryMinAsk: z.coerce.number().finite().gt(0).lt(1).default(0.9),
  entryMaxAsk: z.coerce.number().finite().gt(0).lt(1).default(0.95),
  minElapsedSec: z.coerce.number().finite().nonnegative().max(880).default(600),
  maxElapsedSec: z.coerce.number().finite().positive().max(899).default(870),
  /** Exit structure. */
  exit: z.enum(['settle', 'tp', 'sl']).default('settle'),
  tpDelta: z.coerce.number().finite().gt(0).lt(0.5).default(0.03),
  tpCap: z.coerce.number().finite().gt(0).lt(1).default(0.99),
  slDelta: z.coerce.number().finite().gt(0).lt(0.5).default(0.05),
  /** Early-quiet gate: UP-mid RANGE in the first activityWindowSec (0 = off). */
  activityWindowSec: z.coerce.number().finite().positive().max(600).default(300),
  activityMaxRange: z.coerce.number().finite().nonnegative().default(0),
  activityMinRange: z.coerce.number().finite().nonnegative().default(0),
  shares: z.coerce.number().finite().positive().max(1500).default(100),
})
export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'fable-scr-lvl',
  title: 'SCR-B5 level-entry template (exit structures + activity subpop)',
  description:
    'Buy the side whose ask is inside a frozen band after minElapsedSec; settle/tp/sl exits; optional early-activity gate.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let entered = false
    let exited = false
    let entryAssetId: string | null = null
    let entryPrice = 0
    let heldShares = 0
    let earlyLo = Infinity
    let earlyHi = -Infinity
    let sawEarlyStart = false

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
        entered = false
        exited = false
        entryAssetId = null
        entryPrice = 0
        heldShares = 0
        earlyLo = Infinity
        earlyHi = -Infinity
        sawEarlyStart = false
      }
      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const elapsedMs = tick.snapshot.timestamp - Number(epochMatch[1]) * 1000

      const gateActive = cfg.activityMaxRange > 0 || cfg.activityMinRange > 0
      if (elapsedMs < cfg.activityWindowSec * 1000) {
        const upEarly = tick.snapshot.byAssetId[upAssetId]
        if (
          upEarly?.bestBid != null &&
          upEarly?.bestAsk != null &&
          upEarly.bestBid < upEarly.bestAsk
        ) {
          const m = (upEarly.bestBid + upEarly.bestAsk) / 2
          if (m < earlyLo) earlyLo = m
          if (m > earlyHi) earlyHi = m
        }
        if (elapsedMs <= 60_000) sawEarlyStart = true
      }

      // Stop-loss monitoring.
      if (entered && !exited && cfg.exit === 'sl' && entryAssetId != null) {
        const book = tick.snapshot.byAssetId[entryAssetId]
        const bid = book?.bestBid
        const ask = book?.bestAsk
        if (book != null && bid != null && ask != null && bid < ask && bid <= entryPrice - cfg.slDelta) {
          let depth = 0
          for (const lvl of book.bids) {
            if (lvl.price < bid) break
            depth += lvl.size
          }
          const size = Math.min(heldShares, depth)
          if (size > 0) {
            exited = true
            return [
              {
                kind: 'place_limit',
                clientOrderId: `scrlvl:${slug}:sl`,
                assetId: entryAssetId,
                side: 'SELL',
                price: bid,
                size,
                orderType: 'FOK',
                meta: { exp: 'SCR-B5-lvl', leg: 'stop', entryPrice, stopBid: bid },
                reason: 'stop-loss taker exit',
              },
            ]
          }
        }
        return []
      }
      if (entered) return []
      if (elapsedMs < cfg.minElapsedSec * 1000 || elapsedMs > cfg.maxElapsedSec * 1000) return []

      if (gateActive) {
        // The range is only meaningful when we observed the early window
        // from (near) the start and entry begins after it closed.
        if (!sawEarlyStart || !(earlyHi >= earlyLo)) return []
        const range = earlyHi - earlyLo
        if (cfg.activityMaxRange > 0 && range > cfg.activityMaxRange) return []
        if (cfg.activityMinRange > 0 && range < cfg.activityMinRange) return []
      }

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      const pick = (side: 'UP' | 'DOWN'): { assetId: string; ask: number; depth: number } | null => {
        const book = side === 'UP' ? up : down
        const assetId = side === 'UP' ? upAssetId : downAssetId
        const ask = book?.bestAsk
        const bid = book?.bestBid
        if (book == null || ask == null) return null
        if (bid != null && bid >= ask) return null // E6 guard
        if (ask < cfg.entryMinAsk || ask > cfg.entryMaxAsk) return null
        let depth = 0
        for (const lvl of book.asks) {
          if (lvl.price > ask) break
          depth += lvl.size
        }
        return { assetId, ask, depth }
      }
      const chosen = pick('UP') ?? pick('DOWN')
      if (chosen == null) return []
      const size = Math.min(cfg.shares, chosen.depth)
      if (size <= 0) return []

      entered = true
      entryAssetId = chosen.assetId
      entryPrice = chosen.ask
      return [
        {
          kind: 'place_limit',
          clientOrderId: `scrlvl:${slug}:entry`,
          assetId: chosen.assetId,
          side: 'BUY',
          price: chosen.ask,
          size,
          orderType: 'FOK',
          meta: { exp: 'SCR-B5-lvl', entryAsk: chosen.ask, earlyRange: earlyHi >= earlyLo ? earlyHi - earlyLo : null },
          reason: 'level band entry',
        },
      ]
    }

    const strategy: Strategy = {
      name: 'fable-scr-lvl',
      onMarketTick,
      onAccountEvent: (ev) => {
        if (ev.kind !== 'fill') return []
        const fill = ev.fill
        if (!fill.clientOrderId?.startsWith(`scrlvl:${stateSlug}:entry`)) return []
        heldShares += fill.size
        if (cfg.exit !== 'tp' || exited) return []
        const tpPrice = Math.min(Math.round((fill.price + cfg.tpDelta) * 100) / 100, cfg.tpCap)
        if (tpPrice <= fill.price) return []
        exited = true
        return [
          {
            kind: 'place_limit',
            clientOrderId: `scrlvl:${stateSlug}:tp`,
            assetId: fill.assetId,
            side: 'SELL',
            price: tpPrice,
            size: fill.size,
            orderType: 'GTC',
            meta: { exp: 'SCR-B5-lvl', leg: 'tp', entryPrice: fill.price, tpPrice },
            reason: 'maker take-profit re-ask',
          },
        ]
      },
    }
    return { strategy }
  },
}
