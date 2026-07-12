/**
 * RESCUE-025 variant template (`fable-rsc-025`) — the operator-directed
 * SCR-025 rescue program (FINAL RUN v2 directive, 2026-07-12).
 *
 * Mechanism (E22 reversal mirror, unchanged): a big UP-mid up-segment
 * (t0→t1) followed by a down-segment (t1→t2) leaves the UP ask
 * stale-high; buy DOWN taker at t2. This template parameterizes the
 * mechanism-faithful variant axes frozen in
 * protocol/registry/screens/RESCUE-025.md:
 *   - offsets t0/t1/t2 and segment thresholds (shape placement/strength)
 *   - ratioMin: |down segment| ≥ ratioMin × up segment ("bigger down")
 *   - entryDelaySec: staleness-persistence entry shift (signal still
 *     evaluated at t2; entry attempted at the first tick ≥ t2+delay)
 *   - exit: settle (baseline) | tp (maker re-ask on DOWN at entry+tpDelta,
 *     GTC, zero fee, worst-queue fill) | sl (taker sell at bid once it
 *     drops slDelta below entry)
 *   - minAsk/maxAsk entry band on the DOWN ask
 *
 * With defaults (ratioMin=0, entryDelaySec=0, exit=settle) this
 * reproduces the SCR-025 cell of SCR-B5-stale-mirror.ts (shape=updn)
 * exactly: same offset convention (first UP book state at-or-after each
 * offset, one evaluation at the first tick ≥ t2), same E6 guards, same
 * depth-clamped FOK entry, one entry per market.
 *
 * IN-SAMPLE DISCLOSURE (binding): the sweep runs on the discovery
 * window that produced E22 AND the SCR-025 screen numbers. Sweep
 * readouts select a variant; they confirm nothing. Belief comes only
 * from the pre-committed reserve confirmation (RESCUE-025.md).
 *
 * Replay-safe: deterministic; time from tick.snapshot.timestamp only.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Offsets (episode seconds): t0 < t1 < t2. */
  t0Sec: z.coerce.number().finite().nonnegative().max(880).default(450),
  t1Sec: z.coerce.number().finite().positive().max(880).default(600),
  t2Sec: z.coerce.number().finite().positive().max(895).default(750),
  /** Up segment mid(t1)−mid(t0) must be ≥ +segThresh1. */
  segThresh1: z.coerce.number().finite().gt(0).lt(1).default(0.02),
  /** Down segment mid(t2)−mid(t1) must be ≤ −segThresh2. */
  segThresh2: z.coerce.number().finite().gt(0).lt(1).default(0.02),
  /** Gate: |down segment| ≥ ratioMin × up segment (0 = off). */
  ratioMin: z.coerce.number().finite().nonnegative().default(0),
  /** Entry shift: attempt entry at the first tick ≥ t2 + delay (0 = at t2). */
  entryDelaySec: z.coerce.number().finite().nonnegative().max(120).default(0),
  /** Exit structure. */
  exit: z.enum(['settle', 'tp', 'sl']).default('settle'),
  tpDelta: z.coerce.number().finite().gt(0).lt(0.5).default(0.03),
  slDelta: z.coerce.number().finite().gt(0).lt(0.5).default(0.03),
  /** DOWN entry ask bounds. */
  minAsk: z.coerce.number().finite().gt(0).lt(1).default(0.03),
  maxAsk: z.coerce.number().finite().gt(0).lt(1).default(0.97),
  shares: z.coerce.number().finite().positive().max(1500).default(100),
})
export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'fable-rsc-025',
  title: 'RESCUE-025 variant template (E22 reversal mirror axes)',
  description:
    'Buy DOWN taker after an up-then-down UP-mid reversal at fixed offsets; variant axes: offsets, thresholds, seg ratio, entry delay, settle/tp/sl exits.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let evaluated = false
    let signalArmed = false
    let entryDone = false
    let exited = false
    let entryPrice = 0
    let heldShares = 0
    let mid0: number | null = null
    let mid1: number | null = null
    let armedSeg2 = 0

    const tryEntry = (tick: MarketTick, downAssetId: string, slug: string): Intent[] => {
      entryDone = true // one attempt per market (baseline one-shot semantics)
      const down = tick.snapshot.byAssetId[downAssetId]
      const ask = down?.bestAsk
      const bid = down?.bestBid
      if (down == null || ask == null || ask < cfg.minAsk || ask > cfg.maxAsk) return []
      if (bid != null && bid >= ask) return [] // E6 guard
      let depth = 0
      for (const lvl of down.asks) {
        if (lvl.price > ask) break
        depth += lvl.size
      }
      const size = Math.min(cfg.shares, depth)
      if (size <= 0) return []
      entryPrice = ask
      return [
        {
          kind: 'place_limit',
          clientOrderId: `rsc025:${slug}:entry`,
          assetId: downAssetId,
          side: 'BUY',
          price: ask,
          size,
          orderType: 'FOK',
          meta: { exp: 'RESCUE-025', seg2: armedSeg2, entryAsk: ask, exit: cfg.exit },
          reason: 'reversal mirror entry',
        },
      ]
    }

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
        evaluated = false
        signalArmed = false
        entryDone = false
        exited = false
        entryPrice = 0
        heldShares = 0
        mid0 = null
        mid1 = null
        armedSeg2 = 0
      }
      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const elapsedMs = tick.snapshot.timestamp - Number(epochMatch[1]) * 1000

      // Stop-loss monitoring for an open position (exit=sl).
      if (entryDone && heldShares > 0 && !exited && cfg.exit === 'sl') {
        const down = tick.snapshot.byAssetId[downAssetId]
        const bid = down?.bestBid
        const ask = down?.bestAsk
        if (down != null && bid != null && ask != null && bid < ask && bid <= entryPrice - cfg.slDelta) {
          let depth = 0
          for (const lvl of down.bids) {
            if (lvl.price < bid) break
            depth += lvl.size
          }
          const size = Math.min(heldShares, depth)
          if (size > 0) {
            exited = true
            return [
              {
                kind: 'place_limit',
                clientOrderId: `rsc025:${slug}:sl`,
                assetId: downAssetId,
                side: 'SELL',
                price: bid,
                size,
                orderType: 'FOK',
                meta: { exp: 'RESCUE-025', leg: 'stop', entryPrice, stopBid: bid },
                reason: 'stop-loss taker exit',
              },
            ]
          }
        }
        return []
      }
      if (entryDone) return []

      // Delayed entry: signal armed at t2, entry at first tick ≥ t2+delay.
      if (signalArmed) {
        if (elapsedMs < (cfg.t2Sec + cfg.entryDelaySec) * 1000) return []
        return tryEntry(tick, downAssetId, slug)
      }
      if (evaluated) return []

      const up = tick.snapshot.byAssetId[upAssetId]
      const upBid = up?.bestBid
      const upAsk = up?.bestAsk
      if (upBid == null || upAsk == null || upBid >= upAsk) return [] // E6 guard
      const upMid = (upBid + upAsk) / 2

      // First book state at-or-after each offset (CAL convention, identical
      // to SCR-B5-stale-mirror.ts).
      if (mid0 == null && elapsedMs >= cfg.t0Sec * 1000 && elapsedMs < cfg.t1Sec * 1000) mid0 = upMid
      if (mid1 == null && elapsedMs >= cfg.t1Sec * 1000 && elapsedMs < cfg.t2Sec * 1000) mid1 = upMid
      if (elapsedMs < cfg.t2Sec * 1000) return []
      // At/after t2: evaluate once on the first such tick.
      evaluated = true
      if (mid0 == null || mid1 == null) return []
      const seg1 = mid1 - mid0
      const seg2 = upMid - mid1
      if (seg1 < cfg.segThresh1) return []
      if (seg2 > -cfg.segThresh2) return []
      if (cfg.ratioMin > 0 && -seg2 < cfg.ratioMin * seg1) return []
      armedSeg2 = seg2
      signalArmed = true
      if (cfg.entryDelaySec > 0) return [] // enter on a later tick
      return tryEntry(tick, downAssetId, slug)
    }

    const strategy: Strategy = {
      name: 'fable-rsc-025',
      onMarketTick,
      onAccountEvent: (ev) => {
        if (ev.kind !== 'fill') return []
        const fill = ev.fill
        if (!fill.clientOrderId?.startsWith(`rsc025:${stateSlug}:entry`)) return []
        heldShares += fill.size
        entryPrice = fill.price
        if (cfg.exit !== 'tp' || exited) return []
        const tpPrice = Math.min(Math.round((fill.price + cfg.tpDelta) * 100) / 100, 0.99)
        exited = true // one TP order per market; rests until filled or settlement
        return [
          {
            kind: 'place_limit',
            clientOrderId: `rsc025:${stateSlug}:tp`,
            assetId: fill.assetId,
            side: 'SELL',
            price: tpPrice,
            size: fill.size,
            orderType: 'GTC',
            meta: { exp: 'RESCUE-025', leg: 'tp', entryPrice: fill.price, tpPrice },
            reason: 'maker take-profit re-ask',
          },
        ]
      },
    }
    return { strategy }
  },
}
