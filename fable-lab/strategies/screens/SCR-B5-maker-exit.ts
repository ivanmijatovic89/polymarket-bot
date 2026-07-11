/**
 * SCR-B5 maker-exit template (`fable-scr-mkx`, BATCH-005 FINAL RUN).
 *
 * Covers SCR-026/SCR-027: one-sided DOWN GTC bid at fair − delta under
 * WORST-QUEUE (fleet-safe; touch mode cannot run on the fleet), with
 * the unswept EXIT axis: every measured maker cell (E16/E17/E19/E26a/
 * E29/E30) held fills to settlement. 'tp' re-asks the fill at
 * fill + tpDelta as a zero-fee maker order (monetize the post-sweep
 * rebound if any); 'sl' taker-sells once the mid runs slDelta beyond
 * the fill (cut the informed tail fast, keep the noise fills).
 *
 * OPERATOR OVERRIDE NOTE: the maker family is closed per E30/
 * SIGNAL-FILLS §6; the FINAL RUN directive (STATE.md 2026-07-11)
 * explicitly overrides frontier closures for this batch. Worst-queue
 * kills stay model-conditional per D14.
 *
 * One quote cycle per market: quote → first fill → exit path → done.
 * Replay-safe: deterministic ids; E6 guard; price bounds.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Resting distance below the DOWN mid-implied fair. */
  delta: z.coerce.number().finite().gt(0).lt(0.2).default(0.01),
  startSec: z.coerce.number().finite().nonnegative().max(899).default(30),
  endSec: z.coerce.number().finite().positive().max(899).default(840),
  requoteDelta: z.coerce.number().finite().gt(0).default(0.01),
  minPrice: z.coerce.number().finite().gt(0).lt(1).default(0.02),
  maxPrice: z.coerce.number().finite().gt(0).lt(1).default(0.98),
  /** Exit structure for the filled shares. */
  exit: z.enum(['settle', 'tp', 'sl']).default('tp'),
  tpDelta: z.coerce.number().finite().gt(0).lt(0.5).default(0.02),
  slDelta: z.coerce.number().finite().gt(0).lt(0.5).default(0.03),
  shares: z.coerce.number().finite().positive().max(1500).default(100),
})
export type Config = z.infer<typeof ConfigSchema>

type Quote = { clientOrderId: string; price: number }

export const definition: StrategyDefinition<Config> = {
  id: 'fable-scr-mkx',
  title: 'SCR-B5 maker-exit template (worst-queue bid + tp/sl exit)',
  description:
    'One-sided DOWN bid at fair − delta (worst-queue); on fill, maker take-profit re-ask or taker stop-loss instead of settling.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let seq = 0
    let quote: Quote | null = null
    let filled = false
    let exited = false
    let fillPrice = 0
    let heldShares = 0
    let downAsset: string | null = null

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
        filled = false
        exited = false
        fillPrice = 0
        heldShares = 0
        downAsset = downAssetId
      }
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
      const fair = (dnBid + dnAsk) / 2

      // Post-fill: stop-loss monitoring (tp/settle need no tick work).
      if (filled) {
        cancelQuote('filled — one cycle per market')
        if (!exited && cfg.exit === 'sl' && fair <= fillPrice - cfg.slDelta) {
          let depth = 0
          for (const lvl of down.bids) {
            if (lvl.price < dnBid) break
            depth += lvl.size
          }
          const size = Math.min(heldShares, depth)
          if (size > 0) {
            exited = true
            intents.push({
              kind: 'place_limit',
              clientOrderId: `scrmkxs:${slug}:sl`,
              assetId: downAssetId,
              side: 'SELL',
              price: dnBid,
              size,
              orderType: 'FOK',
              meta: { exp: 'SCR-B5-mkx', leg: 'stop', fillPrice, stopBid: dnBid },
              reason: 'stop-loss taker exit',
            })
          }
        }
        return intents
      }

      // Quoting window.
      if (elapsedSec < cfg.startSec || elapsedSec > cfg.endSec) {
        cancelQuote('outside window')
        return intents
      }
      const target = Math.round((fair - cfg.delta) * 100) / 100
      if (target < cfg.minPrice || target > cfg.maxPrice || target >= dnAsk) {
        cancelQuote('target out of bounds')
        return intents
      }
      if (quote != null && Math.abs(quote.price - target) < cfg.requoteDelta) return intents
      cancelQuote('requote')
      const clientOrderId = `scrmkxq:${slug}:${seq++}`
      quote = { clientOrderId, price: target }
      intents.push({
        kind: 'place_limit',
        clientOrderId,
        assetId: downAssetId,
        side: 'BUY',
        price: target,
        size: cfg.shares,
        orderType: 'GTC',
        meta: { exp: 'SCR-B5-mkx', leg: 'quote', fair, target },
        reason: 'maker bid below fair',
      })
      return intents
    }

    const strategy: Strategy = {
      name: 'fable-scr-mkx',
      onMarketTick,
      onAccountEvent: (ev) => {
        if (ev.kind !== 'fill') return []
        const fill = ev.fill
        if (!fill.clientOrderId?.startsWith('scrmkxq:')) return []
        filled = true
        fillPrice = fill.price
        heldShares += fill.size
        quote = null // fully filled resting order
        if (cfg.exit !== 'tp' || exited || downAsset == null) return []
        const tpPrice = Math.min(Math.round((fill.price + cfg.tpDelta) * 100) / 100, 0.99)
        exited = true
        return [
          {
            kind: 'place_limit',
            clientOrderId: `scrmkxs:${stateSlug}:tp`,
            assetId: downAsset,
            side: 'SELL',
            price: tpPrice,
            size: fill.size,
            orderType: 'GTC',
            meta: { exp: 'SCR-B5-mkx', leg: 'tp', fillPrice: fill.price, tpPrice },
            reason: 'maker take-profit re-ask',
          },
        ]
      },
    }
    return { strategy }
  },
}
