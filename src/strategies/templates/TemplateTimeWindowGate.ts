import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../strategy/Strategy.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import * as strategyToolkit from '../../strategy/strategyToolkit.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  timeFilterAllowTradingAfterSeconds: z.coerce.number().finite().nonnegative().default(180),
  timeFilterDisableTradingAfterSeconds: z.coerce.number().finite().nonnegative().default(600),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'TemplateTimeWindowGate',
  title: 'Template time window gate',
  description:
    'Template time window gate',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'TemplateTimeWindowGate'
  // Gates
  const timeGate = strategyToolkit.createTimeWindowGate({
    allowAfterMs: cfg.timeFilterAllowTradingAfterSeconds * 1000,
    disableAfterMs: cfg.timeFilterDisableTradingAfterSeconds * 1000,
  })

  const onMarketTick = (tick: MarketTick, portfolio: PortfolioSnapshot, ctx?: StrategyContext): Intent[] => {
    const nowMs = tick.snapshot.timestamp

    // Time window check
    const withinWindow = timeGate.check({
      nowMs,
      market: ctx?.market,
    })

    if( withinWindow ) {
      console.log(`🟢 inside time window`);
    } else {
      console.log(`🔴 outside time window`);
    }

    return [];
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { name, onMarketTick, onAccountEvent }
}
