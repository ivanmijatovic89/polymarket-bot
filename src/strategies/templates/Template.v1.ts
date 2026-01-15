import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../strategy/Strategy.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import { IndicatorSet } from '../../indicators/IndicatorSet.js'
import { TimeWindowVolatility } from '../../indicators/volatility/TimeWindowVolatility.js'
import { isWarmed } from '../../strategy/strategyToolkit.js'
import * as z from 'zod'
import { fmtCents } from '../../../webui/src/utils/format.js'

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

export function createStrategy(_cfg: Config): {
  strategy: Strategy,
  indicatorSet: IndicatorSet
} {
  void _cfg
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

    // Live-only warmup gate (recommended for any strategy that places orders).
    if (!isWarmed(ctx)) return []

    // feeds
    const _b = ctx?.feeds?.rtdsPolymarketCryptoPrices?.binance
    const _c = ctx?.feeds?.rtdsPolymarketCryptoPrices?.chainlink
    const _bw = ctx?.feeds?.binanceWsSpotPrice
    const _ptb = ctx?.feeds?.polymarketPriceToBeat
    void _b
    void _c
    void _bw
    void _ptb

    const upAskBestPrice = tick.snapshot.byAssetId[ctx?.market?.upAssetId ?? '']?.bestAsk
    const downAskBestPrice = tick.snapshot.byAssetId[ctx?.market?.downAssetId ?? '']?.bestAsk
    const upBidBestPrice = tick.snapshot.byAssetId[ctx?.market?.upAssetId ?? '']?.bestBid
    const downBidBestPrice = tick.snapshot.byAssetId[ctx?.market?.downAssetId ?? '']?.bestBid
    // console.log('upAskBestPrice', upAskBestPrice, 'downAskBestPrice', downAskBestPrice)
    console.log(fmtCents(upAskBestPrice ?? 0) + ' - ' + fmtCents(downAskBestPrice ?? 0) + ' ..... ' + fmtCents(upBidBestPrice ?? 0) + ' - ' + fmtCents(downBidBestPrice ?? 0))
    // const diff = bw?.value && b?.value ? bw.value - b.value : undefined;
    // if(diff && (diff > 1 || diff < -1)) {
    //   console.log('diff', diff?.toFixed(0), 'UP:'+ upAskBestPrice, ' DOWN:'+ downAskBestPrice)
    // }
    // console.log('feeds', b, c, bw, ptb)

    // indicators
    // const vol = ctx?.indicators?.volatility
    // console.log('indicators', vol)
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


