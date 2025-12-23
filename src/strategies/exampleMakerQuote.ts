import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'

export type MakerQuoteConfig = {
  /** Which assetId (tokenID) to trade. If omitted, picks the first available in snapshot. */
  assetId?: string
  /** Order size (shares). */
  size: number
  /** Quote one tick inside best bid/ask by this amount (in price units). */
  improveBy: number
  /** Max spread allowed to quote; if spread is wider, cancel orders and wait. */
  maxSpread: number
  /** Order type for resting quotes. */
  orderType?: 'GTC' | 'GTD'
  /** GTD expiry offset (ms) when orderType=GTD. */
  gtdTtlMs?: number
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

    // Don’t cross ourselves.
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
