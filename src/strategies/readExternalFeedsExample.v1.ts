import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import type { StrategyContext } from '../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import type { ExternalFeedsSnapshot } from '../trading/feeds/externalFeeds.js'
import { ExternalFeedsRequestPlugin } from '../strategy/plugins/ExternalFeedsRequestPlugin.js'
import * as z from 'zod'

const optionalFeedFlag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true')
  .default(false)

export const ConfigSchema = z.strictObject({
  /**
   * Log throttling. Keeps the strategy cheap even at high tick rates.
   */
  logEveryMs: z.coerce.number().finite().int().positive().default(1000),
  priceToBeatSource: z.enum(['website', 'chainlink-opening-twap']).default('website'),
  /** Opt-in V4 feeds; historical runtimes retain the existing default request. */
  binanceBookTicker: optionalFeedFlag,
  chainlinkTwap: optionalFeedFlag,
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'readExternalFeedsExample.v1',
  title: 'Read external feed BTC price (Binance + Chainlink) v1',
  description:
    'Example strategy: logs Binance and Chainlink prices with an explicit website or recorded opening TWAP reference.',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

export function createStrategy(cfg: Config): {
  strategy: Strategy
  plugins: ExternalFeedsRequestPlugin[]
} {
  const name = 'read_external_feed_binance_chainlink_btc_price'
  let lastLogAtMs = 0

  const log = (label: string, nowMs: number, ctx?: StrategyContext): void => {
    // remove decimal places and format ( add comma as thousands separator)
    const feeds =
      (ctx?.plugins?.['externalFeeds'] as ExternalFeedsSnapshot | undefined) ?? undefined
    const b = feeds?.rtdsPolymarketCryptoPrices?.binance
    const c = feeds?.rtdsPolymarketCryptoPrices?.chainlink
    const bw = feeds?.binanceWsSpotPrice
    const ptb = feeds?.polymarketPriceToBeat
    const ptbSource = ptb ? (ptb.source ?? 'website') : 'unavailable'
    const ptbComparison = feeds?.openingReference?.comparison ?? 'unavailable'

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

    const bookTicker = cfg.binanceBookTicker
      ? ` binanceBid=${feeds?.binanceBookTicker?.bidPrice ?? 'n/a'} binanceAsk=${feeds?.binanceBookTicker?.askPrice ?? 'n/a'}`
      : ''
    const twap = cfg.chainlinkTwap ? ` chainlinkTwap=${feeds?.chainlinkTwap?.value ?? 'n/a'}` : ''

    console.log(
      `[feed > ] ${label} nowMs=${nowMs} binanceWsSpotPrice=${bwStr} rtdsBinance=${bStr} rtdsChainlink=${cStr} priceToBeatOpen=${ptbStr} priceToBeatRequestedSource=${cfg.priceToBeatSource} priceToBeatSource=${ptbSource} priceToBeatComparison=${ptbComparison} diff=${priceDiff}${bookTicker}${twap}`,
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
    onMarketTick,
    onAccountEvent,
  }

  return {
    strategy,
    plugins: [
      new ExternalFeedsRequestPlugin({
        // V4 provides Chainlink here; Binance comes from the direct Binance feed.
        rtdsCryptoPrices:
          cfg.binanceBookTicker ||
          cfg.chainlinkTwap ||
          cfg.priceToBeatSource === 'chainlink-opening-twap'
            ? { binanceSymbols: [] }
            : {},
        binanceWsSpotPrice: {}, // pair follows the traded market (TRADING_SYMBOL live, slug in backtests)
        polymarketPriceToBeat: { enabled: true, source: cfg.priceToBeatSource },
        ...(cfg.binanceBookTicker ? { binanceBookTicker: {} } : {}),
        ...(cfg.chainlinkTwap ? { chainlinkTwap: { windowSeconds: 60 } } : {}),
      }),
    ],
  }
}
