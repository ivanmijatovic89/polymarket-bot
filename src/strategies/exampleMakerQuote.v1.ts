import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import * as z from 'zod'

export const MakerQuoteConfigSchema = z.strictObject({
  assetId: z.string().min(1).optional(),
  size: z.coerce.number().finite().default(5),
  improveBy: z.coerce.number().finite().default(0.001),
  maxSpread: z.coerce.number().finite().default(0.05),
  orderType: z.enum(['GTC', 'GTD']).default('GTC'),
  gtdTtlMs: z.coerce.number().finite().default(120_000),
})

export type MakerQuoteConfig = z.infer<typeof MakerQuoteConfigSchema>

export const definition: StrategyDefinition<MakerQuoteConfig> = {
  id: 'exampleMakerQuote.v1',
  title: 'Example maker quote v1',
  description: 'Places bid/ask quotes inside the spread (plumbing validation).',
  schema: MakerQuoteConfigSchema,
  create: (params) => createExampleMakerQuoteStrategy(params),
}

function pickAssetId(tick: MarketTick, preferred?: string): string | null {
  if (preferred && tick.snapshot.byAssetId[preferred]) return preferred
  const ids = Object.keys(tick.snapshot.byAssetId)
  return ids[0] ?? null
}

function clampPrice(p: number): number {
  // Polymarket probabilities: [0,1]. Keep safe.
  if (!Number.isFinite(p)) return 0
  return Math.max(0, Math.min(1, p))
}

export function createExampleMakerQuoteStrategy(cfg: MakerQuoteConfig): Strategy {
  const name = 'example_maker_quote'

  const clientBidId = (assetId: string) => `${name}:${assetId}:bid`
  const clientAskId = (assetId: string) => `${name}:${assetId}:ask`

  const onMarketTick = (tick: MarketTick, portfolio: PortfolioSnapshot): Intent[] => {
    const assetId = pickAssetId(tick, cfg.assetId)
    if (!assetId) return []

    const book = tick.snapshot.byAssetId[assetId]
    if (!book || book.bestBid === null || book.bestAsk === null || book.spread === null) return []

    // If spread is too wide (or book is weird), pull quotes.
    if (book.spread <= 0 || book.spread > cfg.maxSpread) {
      return [
        {
          kind: 'cancel_order',
          clientOrderId: clientBidId(assetId),
          reason: 'spread_out_of_bounds',
        },
        {
          kind: 'cancel_order',
          clientOrderId: clientAskId(assetId),
          reason: 'spread_out_of_bounds',
        },
      ]
    }

    const bidPrice = clampPrice(book.bestBid + cfg.improveBy)
    const askPrice = clampPrice(book.bestAsk - cfg.improveBy)

    // Don't cross ourselves.
    if (bidPrice >= askPrice) {
      return [
        { kind: 'cancel_order', clientOrderId: clientBidId(assetId), reason: 'crossing_quote' },
        { kind: 'cancel_order', clientOrderId: clientAskId(assetId), reason: 'crossing_quote' },
      ]
    }

    const intents: Intent[] = []

    const existingBid = portfolio.openOrdersByClientId[clientBidId(assetId)]
    if (!existingBid || Math.abs(existingBid.price - bidPrice) > 1e-9) {
      if (existingBid)
        intents.push({ kind: 'cancel_order', clientOrderId: existingBid.clientOrderId })
      intents.push({
        kind: 'place_limit',
        clientOrderId: clientBidId(assetId),
        assetId,
        side: 'BUY',
        price: bidPrice,
        size: cfg.size,
        orderType: cfg.orderType ?? 'GTC',
        ...(cfg.orderType === 'GTD' && cfg.gtdTtlMs
          ? { expireAtMs: Date.now() + cfg.gtdTtlMs }
          : {}),
        reason: 'quote_bid',
      })
    }

    const existingAsk = portfolio.openOrdersByClientId[clientAskId(assetId)]
    if (!existingAsk || Math.abs(existingAsk.price - askPrice) > 1e-9) {
      if (existingAsk)
        intents.push({ kind: 'cancel_order', clientOrderId: existingAsk.clientOrderId })
      intents.push({
        kind: 'place_limit',
        clientOrderId: clientAskId(assetId),
        assetId,
        side: 'SELL',
        price: askPrice,
        size: cfg.size,
        orderType: cfg.orderType ?? 'GTC',
        ...(cfg.orderType === 'GTD' && cfg.gtdTtlMs
          ? { expireAtMs: Date.now() + cfg.gtdTtlMs }
          : {}),
        reason: 'quote_ask',
      })
    }

    return intents
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { name, onMarketTick, onAccountEvent }
}

