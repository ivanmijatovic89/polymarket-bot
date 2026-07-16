import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../strategy/Strategy.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import type { Plugin } from '../../strategy/plugins/PluginSet.js'
import { TimeWindowVolatility } from '../../strategy/plugins/TimeWindowVolatility.js'
import { isWarmed } from '../../strategy/strategyToolkit.js'
import type { ExternalFeedsSnapshot } from '../../trading/feeds/externalFeeds.js'
import { ExternalFeedsRequestPlugin } from '../../strategy/plugins/ExternalFeedsRequestPlugin.js'
import * as z from 'zod'
import { DwellGatePlugin } from '../../strategy/plugins/DwellGatePlugin.js'
import { TimeWindowGatePlugin } from '../../strategy/plugins/TimeWindowGatePlugin.js'

export const ConfigSchema = z.strictObject({
  logEveryMs: z.coerce.number().finite().int().positive().default(1000),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'template.v1',
  title: 'Template v1',
  description: 'Template strategy: placeholder for new strategies.',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

export function createStrategy(_cfg: Config): {
  strategy: Strategy
  plugins: Plugin[]
} {
  void _cfg
  const name = 'template.v1'

  const windows = {
    '1s': 1_000,
    '5s': 5_000,
    '10s': 10_000,
    '60s': 60_000,
  } as const

  const plugins = [
    new TimeWindowVolatility({ windows }),
    new ExternalFeedsRequestPlugin({
      rtdsCryptoPrices: { binanceSymbols: ['btcusdt'], chainlinkSymbols: ['btc/usd'] },
      binanceWsSpotPrice: {}, // pair follows the traded market (TRADING_SYMBOL live, slug in backtests)
      polymarketPriceToBeat: { enabled: true },
    }),
    new DwellGatePlugin({
      from: 0.1,
      to: 0.45,
      requiredMs: 60 * 1000,
      trackPrice: 'bid',
      log: true,
    }),
    new TimeWindowGatePlugin({
      allowAfterMs: 100 * 1000,
      disableAfterMs: 800 * 1000,
      log: true,
    }),
  ]

  const onMarketTick = (
    tick: MarketTick,
    _portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    void _portfolio

    // Live-only warmup gate (recommended for any strategy that places orders).
    if (!isWarmed(ctx)) return []

    // feeds
    const feeds =
      (ctx?.plugins?.['externalFeeds'] as ExternalFeedsSnapshot | undefined) ?? undefined
    const _b = feeds?.rtdsPolymarketCryptoPrices?.binance
    const _c = feeds?.rtdsPolymarketCryptoPrices?.chainlink
    const _bw = feeds?.binanceWsSpotPrice
    const _ptb = feeds?.polymarketPriceToBeat
    void _b
    void _c
    void _bw
    void _ptb

    // console.log('upAskBestPrice', upAskBestPrice, 'downAskBestPrice', downAskBestPrice)
    // console.log(fmtCents(upAskBestPrice ?? 0) + ' - ' + fmtCents(downAskBestPrice ?? 0) + ' ..... ' + fmtCents(upBidBestPrice ?? 0) + ' - ' + fmtCents(downBidBestPrice ?? 0))
    // const diff = bw?.value && b?.value ? bw.value - b.value : undefined;
    // if(diff && (diff > 1 || diff < -1)) {
    //   console.log('diff', diff?.toFixed(0), 'UP:'+ upAskBestPrice, ' DOWN:'+ downAskBestPrice)
    // }
    // console.log('feeds', b, c, bw, ptb)

    // plugins
    // const vol = ctx?.plugins?.['timeWindowVolatility']
    // console.log('plugins', vol)
    return []
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev, _portfolio, _lastMarket, _ctx) => {
    void _portfolio
    void _lastMarket
    void ev
    void _ctx

    return []
  }

  const strategy: Strategy = {
    name,
    onMarketTick,
    onAccountEvent,
  }

  return { strategy, plugins }
}
