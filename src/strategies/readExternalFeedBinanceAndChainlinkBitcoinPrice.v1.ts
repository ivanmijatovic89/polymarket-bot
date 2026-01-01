import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import type { StrategyContext } from '../indicators/IndicatorSet.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import * as z from 'zod'

export const ReadExternalFeedBinanceAndChainlinkBitcoinPriceSchema = z.strictObject({
  /**
   * Log throttling. Keeps the strategy cheap even at high tick rates.
   */
  logEveryMs: z.coerce.number().finite().int().positive().default(1000),
})

export type ReadExternalFeedBinanceAndChainlinkBitcoinPriceConfig = z.infer<
  typeof ReadExternalFeedBinanceAndChainlinkBitcoinPriceSchema
>

export const definition: StrategyDefinition<ReadExternalFeedBinanceAndChainlinkBitcoinPriceConfig> = {
  id: 'readExternalFeedBinanceAndChainlinkBitcoinPrice.v1',
  title: 'Read external feed BTC price (Binance + Chainlink) v1',
  description:
    'Example strategy: opts into RTDS crypto prices and logs BTC price from Binance (btcusdt) and Chainlink (btc/usd).',
  schema: ReadExternalFeedBinanceAndChainlinkBitcoinPriceSchema,
  create: (cfg) => createReadExternalFeedBinanceAndChainlinkBitcoinPriceStrategy(cfg),
}

export function createReadExternalFeedBinanceAndChainlinkBitcoinPriceStrategy(
  cfg: ReadExternalFeedBinanceAndChainlinkBitcoinPriceConfig,
): { strategy: Strategy } {
  const name = 'read_external_feed_binance_chainlink_btc_price'
  let lastLogAtMs = 0

  const log = (label: string, nowMs: number, ctx?: StrategyContext): void => {
    const b = ctx?.feeds?.cryptoPrices?.binance
    const c = ctx?.feeds?.cryptoPrices?.chainlink

    const bStr =
      b && Number.isFinite(b.value) ? `${b.value} (sym=${b.symbol} ts=${b.tsMs} recv=${b.receivedAtMs})` : 'n/a'
    const cStr =
      c && Number.isFinite(c.value) ? `${c.value} (sym=${c.symbol} ts=${c.tsMs} recv=${c.receivedAtMs})` : 'n/a'

    console.log(`[${definition.id}] ${label} nowMs=${nowMs} binance=${bStr} chainlink=${cStr}`)
  }

  const onMarketTick = (tick: MarketTick, _portfolio: PortfolioSnapshot, ctx?: StrategyContext): Intent[] => {
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
    },
    onMarketTick,
    onAccountEvent,
  }

  return { strategy }
}


