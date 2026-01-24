import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../strategy/Strategy.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import type { Plugin } from '../../strategy/plugins/PluginSet.js'
import { isWarmed } from '../../strategy/strategyToolkit.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({

  size: z.coerce.number().finite().positive().default(10),
  buyPrice: z.coerce.number().finite().positive().default(0.30),
  sellPrice: z.coerce.number().finite().positive().default(0.35),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'scalp.v1',
  title: 'Scalp v1',
  description:
    'Scalp strategy: placeholder for new strategies.',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

export function createStrategy(_cfg: Config): {
  strategy: Strategy,
  plugins: Plugin[]
} {
  void _cfg
  const name = 'scalp.v1'

  const onMarketTick = (
    tick: MarketTick,
    _portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    void _portfolio

    // Live-only warmup gate (recommended for any strategy that places orders).
    if (!isWarmed(ctx)) return []


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

  return { strategy, plugins: [] }
}


