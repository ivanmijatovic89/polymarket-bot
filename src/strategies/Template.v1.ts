import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import type { StrategyContext } from '../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import { IndicatorSet } from '../indicators/IndicatorSet.js'
import { TimeWindowVolatility } from '../indicators/volatility/TimeWindowVolatility.js'
import { isWarmed } from '../strategy/strategyToolkit.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({

  logEveryMs: z.coerce.number().finite().int().positive().default(1000),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'template.v1',
  title: 'Template v1',
  description:
    'Template strategy: placeholder for new strategies.',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

export function createStrategy(cfg: Config): {
  strategy: Strategy,
  indicatorSet: IndicatorSet
} {
  const name = 'template.v1'

  const windows = {
    '1s': 1_000,
    '5s': 5_000,
    '10s': 10_000,
    '60s': 60_000,
  } as const

  const indicatorSet = new IndicatorSet()
  indicatorSet.register(new TimeWindowVolatility({ windows }))

  const onMarketTick = (
    tick: MarketTick,
    _portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    void _portfolio
    void tick

    // Live-only warmup gate (recommended for any strategy that places orders).
    if (!isWarmed(ctx)) return []

    // feeds
    const b = ctx?.feeds?.rtdsPolymarketCryptoPrices?.binance
    const c = ctx?.feeds?.rtdsPolymarketCryptoPrices?.chainlink
    const bw = ctx?.feeds?.binanceWsSpotPrice
    const ptb = ctx?.feeds?.polymarketPriceToBeat
    console.log('feeds', b, c, bw, ptb)

    // indicators
    const vol = ctx?.indicators?.volatility
    console.log('indicators', vol)
    return []
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev, _portfolio, _lastMarket, ctx) => {
    void _portfolio
    void _lastMarket

    return []
  }

  const strategy: Strategy = {
    name,
    requiredFeeds: {
      rtdsCryptoPrices: {
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

  return { strategy, indicatorSet }
}


