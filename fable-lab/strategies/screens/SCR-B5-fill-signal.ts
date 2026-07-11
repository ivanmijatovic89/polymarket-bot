/**
 * SCR-B5 fill-as-signal template (`fable-scr-fsig`, BATCH-005 FINAL RUN).
 *
 * Covers SCR-028: a worst-queue punch-through fill is, by E16/E17, the
 * footprint of INFORMED flow. Every measured maker cell held the toxic
 * side of that information. This screen inverts the role: rest a tiny
 * 1-share DOWN probe bid below touch purely as a detector, and when it
 * fills (the DOWN ask punched down = the market is repricing toward
 * UP), taker-buy the UP side and ride WITH the information. The probe
 * loss is bounded (~1 share); the bet is that punch-through moves
 * continue by more than spread + fee — which no prior cell measured
 * (EXP-003/SCR-001 conditioned on price moves, not on the sweep event
 * itself; the fill trigger is not expressible in the CAL scans).
 *
 * Replay-safe: deterministic; E6 guards; one signal per market;
 * hold both legs to settlement.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Probe bid distance below the DOWN best bid. */
  probeDelta: z.coerce.number().finite().gt(0).lt(0.2).default(0.01),
  probeShares: z.coerce.number().finite().positive().max(10).default(1),
  /** Main taker size on the UP side after the probe fills. */
  mainShares: z.coerce.number().finite().positive().max(1500).default(100),
  startSec: z.coerce.number().finite().nonnegative().max(899).default(30),
  endSec: z.coerce.number().finite().positive().max(899).default(840),
  requoteDelta: z.coerce.number().finite().gt(0).default(0.01),
  minPrice: z.coerce.number().finite().gt(0).lt(1).default(0.02),
  maxPrice: z.coerce.number().finite().gt(0).lt(1).default(0.98),
  /** Bound on the UP entry ask after the signal. */
  maxAsk: z.coerce.number().finite().gt(0).lt(1).default(0.97),
})
export type Config = z.infer<typeof ConfigSchema>

type Quote = { clientOrderId: string; price: number }

export const definition: StrategyDefinition<Config> = {
  id: 'fable-scr-fsig',
  title: 'SCR-B5 fill-as-signal (probe bid → taker momentum)',
  description:
    'Tiny DOWN probe bid below touch as a sweep detector; on probe fill, taker-buy UP and hold to settlement.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let seq = 0
    let quote: Quote | null = null
    let signaled = false

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
        seq = 0
        quote = null
        signaled = false
      }
      if (signaled) return []
      const epochMatch = slug.match(/-(\d+)$/)
      if (!epochMatch) return []
      const elapsedSec = (tick.snapshot.timestamp - Number(epochMatch[1]) * 1000) / 1000

      const intents: Intent[] = []
      const cancelQuote = (reason: string): void => {
        if (!quote) return
        intents.push({ kind: 'cancel_order', clientOrderId: quote.clientOrderId, reason })
        quote = null
      }

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      const upCrossed = up?.bestBid != null && up?.bestAsk != null && up.bestBid >= up.bestAsk
      const dnBid = down?.bestBid
      const dnAsk = down?.bestAsk
      if (down == null || dnBid == null || dnAsk == null || dnBid >= dnAsk || upCrossed) {
        cancelQuote('book unavailable/crossed')
        return intents
      }
      if (elapsedSec < cfg.startSec || elapsedSec > cfg.endSec) {
        cancelQuote('outside window')
        return intents
      }
      const target = Math.round((dnBid - cfg.probeDelta) * 100) / 100
      if (target < cfg.minPrice || target > cfg.maxPrice) {
        cancelQuote('target out of bounds')
        return intents
      }
      if (quote != null && Math.abs(quote.price - target) < cfg.requoteDelta) return intents
      cancelQuote('requote')
      const clientOrderId = `scrfsigp:${slug}:${seq++}`
      quote = { clientOrderId, price: target }
      intents.push({
        kind: 'place_limit',
        clientOrderId,
        assetId: downAssetId,
        side: 'BUY',
        price: target,
        size: cfg.probeShares,
        orderType: 'GTC',
        meta: { exp: 'SCR-B5-fsig', leg: 'probe', target },
        reason: 'sweep-detector probe bid',
      })
      return intents
    }

    const strategy: Strategy = {
      name: 'fable-scr-fsig',
      onMarketTick,
      onAccountEvent: (ev, _portfolio, lastMarket, ctx) => {
        if (ev.kind !== 'fill') return []
        const fill = ev.fill
        if (!fill.clientOrderId?.startsWith('scrfsigp:')) return []
        if (signaled) return []
        signaled = true
        quote = null
        const upAssetId = ctx?.market?.upAssetId
        if (!upAssetId || !lastMarket) return []
        const upBook = lastMarket.byAssetId[upAssetId]
        const ask = upBook?.bestAsk
        if (upBook == null || ask == null || ask > cfg.maxAsk) return []
        if (upBook.bestBid != null && upBook.bestBid >= ask) return [] // E6 guard
        let depth = 0
        for (const lvl of upBook.asks) {
          if (lvl.price > ask) break
          depth += lvl.size
        }
        const size = Math.min(cfg.mainShares, depth)
        if (size <= 0) return []
        return [
          {
            kind: 'place_limit',
            clientOrderId: `scrfsigm:${stateSlug}:main`,
            assetId: upAssetId,
            side: 'BUY',
            price: ask,
            size,
            orderType: 'FOK',
            meta: { exp: 'SCR-B5-fsig', leg: 'main', probePrice: fill.price, entryAsk: ask },
            reason: 'ride the sweep information',
          },
        ]
      },
    }
    return { strategy }
  },
}
