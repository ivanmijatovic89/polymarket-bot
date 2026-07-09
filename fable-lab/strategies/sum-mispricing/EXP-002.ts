/**
 * EXP-002 — UP+DOWN dutch-book scan (`sum-mispricing`).
 *
 * Mechanism: if bestAsk(UP) + bestAsk(DOWN) < 1 minus taker fees, buying both
 * sides locks in a riskless $1 settlement per pair. The counterparty is
 * whichever maker quotes the complement lazily after the other book moves.
 *
 * Behavior: on any tick where the net-of-modeled-fee gap at top-of-book
 * exceeds minEdge AND neither book is self-crossed (bestBid >= bestAsk on
 * the same asset — a replay artifact, LESSONS E6), FOK-buy BOTH sides at
 * their bestAsk, sized to the smaller visible top-of-book depth (capped at
 * `shares`), up to maxEntries times per market. Hold to settlement (winning
 * side pays $1; the pair is mergeable at settlement in stats). No exits, no
 * maker orders, no merges.
 *
 * Replay-safety: deterministic; time from tick.snapshot.timestamp only;
 * deterministic clientOrderIds; batch of 2 <= 15.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import { isWarmed } from '../../../src/strategy/strategyToolkit.js'

export const ConfigSchema = z.strictObject({
  /** Minimum net edge per share AFTER modeled taker fees (dollars/share). */
  minEdge: z.coerce.number().finite().gt(0).lt(0.5).default(0.002),
  /** Max shares per leg per entry (also clamped to visible top-of-book depth). */
  shares: z.coerce.number().finite().positive().max(900).default(100),
  /** Max entries per market. */
  maxEntries: z.coerce.number().finite().int().positive().max(9).default(5),
  /** Modeled taker fee bps (mirrors engine default BACKTEST_TAKER_FEE_BPS). */
  feeBps: z.coerce.number().finite().min(0).max(1000).default(156),
})
export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'fable-exp-002',
  title: 'EXP-002 UP+DOWN dutch-book scan',
  description: 'FOK-buy both sides when ask(UP)+ask(DOWN) < 1 minus fees minus minEdge.',
  schema: ConfigSchema,
  create: (cfg) => {
    let stateSlug: string | null = null
    let entries = 0

    const takerFeePerShare = (p: number): number =>
      (cfg.feeBps / 10_000) * Math.min(p, 1 - p)

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
        entries = 0
      }
      if (entries >= cfg.maxEntries) return []

      const up = tick.snapshot.byAssetId[upAssetId]
      const down = tick.snapshot.byAssetId[downAssetId]
      const upAsk = up?.bestAsk
      const downAsk = down?.bestAsk
      if (upAsk == null || downAsk == null) return []

      // Self-crossed book guard (LESSONS E6): bestBid >= bestAsk on the same
      // asset is impossible on a live CLOB — a stale-level replay artifact.
      // Entering against it harvests phantom fills.
      if (up.bestBid != null && up.bestBid >= upAsk) return []
      if (down.bestBid != null && down.bestBid >= downAsk) return []

      const gapGross = 1 - upAsk - downAsk
      if (gapGross <= 0) return []
      const fees = takerFeePerShare(upAsk) + takerFeePerShare(downAsk)
      const edge = gapGross - fees
      if (edge < cfg.minEdge) return []

      const upDepth = up.asks.length > 0 && up.asks[0].price === upAsk ? up.asks[0].size : 0
      const downDepth =
        down.asks.length > 0 && down.asks[0].price === downAsk ? down.asks[0].size : 0
      const size = Math.min(cfg.shares, upDepth, downDepth)
      if (size <= 0) return []

      entries += 1
      const n = entries
      const legMeta = {
        exp: 'EXP-002',
        entry: n,
        upAsk,
        downAsk,
        gapGross,
        edgeNet: edge,
        upDepth,
        downDepth,
      }
      return [
        {
          kind: 'place_batch',
          orders: [
            {
              clientOrderId: `exp002:${slug}:${n}:up`,
              assetId: upAssetId,
              side: 'BUY',
              price: upAsk,
              size,
              orderType: 'FOK',
              meta: { ...legMeta, side: 'UP' },
            },
            {
              clientOrderId: `exp002:${slug}:${n}:down`,
              assetId: downAssetId,
              side: 'BUY',
              price: downAsk,
              size,
              orderType: 'FOK',
              meta: { ...legMeta, side: 'DOWN' },
            },
          ],
          reason: 'dutch-book both-sides entry',
        },
      ]
    }

    const strategy: Strategy = {
      name: 'fable-exp-002',
      onMarketTick,
      onAccountEvent: () => [],
    }
    return { strategy }
  },
}
