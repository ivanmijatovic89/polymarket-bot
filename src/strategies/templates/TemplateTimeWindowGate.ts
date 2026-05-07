import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../strategy/Strategy.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import type { Plugin } from '../../strategy/plugins/PluginSet.js'
import { TimeWindowGatePlugin } from '../../strategy/plugins/TimeWindowGatePlugin.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  timeFilterAllowTradingAfterSeconds: z.coerce.number().finite().nonnegative().default(180),
  timeFilterDisableTradingAfterSeconds: z.coerce.number().finite().nonnegative().default(600),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'TemplateTimeWindowGate',
  title: 'Template time window gate',
  description: 'Template time window gate',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

export function createStrategy(cfg: Config): { strategy: Strategy; plugins: Plugin[] } {
  const name = 'TemplateTimeWindowGate'
  const plugins: Plugin[] = [
    new TimeWindowGatePlugin({
      allowAfterMs: cfg.timeFilterAllowTradingAfterSeconds * 1000,
      disableAfterMs: cfg.timeFilterDisableTradingAfterSeconds * 1000,
    }),
  ]

  const onMarketTick = (
    tick: MarketTick,
    portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    const nowMs = tick.snapshot.timestamp
    void nowMs
    void portfolio

    const withinWindow =
      (ctx?.plugins?.['timeWindowGate'] as { withinWindow?: unknown } | undefined)?.withinWindow ===
      true

    if (withinWindow) {
      console.log(`🟢 inside time window`)
    } else {
      console.log(`🔴 outside time window`)
    }

    return []
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { strategy: { name, onMarketTick, onAccountEvent }, plugins }
}
