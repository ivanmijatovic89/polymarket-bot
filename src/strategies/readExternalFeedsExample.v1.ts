import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import type { StrategyContext } from '../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  /**
   * Log throttling. Keeps the strategy cheap even at high tick rates.
   */
  logEveryMs: z.coerce.number().finite().int().positive().default(1000),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'readExternalFeedsExample.v1',
  title: 'Read external feed BTC price (Binance + Chainlink) v1',
  description:
    'Example strategy: opts into RTDS crypto prices and logs BTC price from Binance (btcusdt) and Chainlink (btc/usd).',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

export function createStrategy(cfg: Config): {
  strategy: Strategy
} {
  const name = 'read_external_feed_binance_chainlink_btc_price'
  let lastLogAtMs = 0

  const log = (label: string, nowMs: number, ctx?: StrategyContext): void => {
    // remove decimal places and format ( add comma as thousands separator)
    const b = ctx?.feeds?.rtdsPolymarketCryptoPrices?.binance
    const c = ctx?.feeds?.rtdsPolymarketCryptoPrices?.chainlink
    const bw = ctx?.feeds?.binanceWsSpotPrice
    const ptb = ctx?.feeds?.polymarketPriceToBeat

    const priceDiff =
      ptb && c && Number.isFinite(ptb.openPrice) && Number.isFinite(c.value)
        ? (c.value - ptb.openPrice).toFixed(2)
        : 'n/a'

    // add comma as thousands separator without regex
    const bStr =
      b && Number.isFinite(b.value)
        ? `${b.value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
        : 'n/a'
    const cStr =
      c && Number.isFinite(c.value)
        ? `${c.value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
        : 'n/a'
    const bwStr =
      bw && Number.isFinite(bw.value)
        ? `${bw.value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
        : 'n/a'
    const ptbStr =
      ptb && Number.isFinite(ptb.openPrice)
        ? `${ptb.openPrice.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
        : 'n/a'

    console.log(
      `[feed > ] ${label} nowMs=${nowMs} binanceWsSpotPrice=${bwStr} rtdsBinance=${bStr} rtdsChainlink=${cStr} priceToBeatOpen=${ptbStr} diff=${priceDiff}`,
    )
  }

  const onMarketTick = (
    tick: MarketTick,
    _portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    void _portfolio
    const nowMs = tick.snapshot.timestamp || Date.now()
    if (nowMs - lastLogAtMs < cfg.logEveryMs) return []
    lastLogAtMs = nowMs
    log('tick', nowMs, ctx)
    return []
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev, _portfolio, _lastMarket, ctx) => {
    void _portfolio
    void _lastMarket
    const nowMs = (ev as { tsMs?: number }).tsMs ?? Date.now()
    // Account events can be bursty; do not throttle here—strategy can adjust if needed.
    log(`account:${ev.kind}`, nowMs, ctx)
    return []
  }

  const strategy: Strategy = {
    name,
    requiredFeeds: {
      rtdsCryptoPrices: {
        // RTDS docs:
        // - Binance symbol: "btcusdt"
        // - Chainlink symbol format is slash-separated, e.g. "btc/usd"
        binanceSymbols: ['btcusdt'],
        chainlinkSymbols: ['btc/usd'],
      },
      binanceWsSpotPrice: {
        symbol: 'btcusdt',
      },
      polymarketPriceToBeat: {
        enabled: true,
      },
    },
    onMarketTick,
    onAccountEvent,
  }

  return { strategy }
}


