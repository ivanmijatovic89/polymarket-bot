/**
 * Permanent loader fixture (see ../README.md): proves that
 * tools/run-backtest.ts injects fable-lab strategies into the registry.
 * Places no orders. Never quote its results.
 */
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../../src/strategy/Strategy.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'

export const ConfigSchema = z.strictObject({})
export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'fable-fixture-noop',
  title: 'Fable wrapper fixture (noop)',
  description: 'Loader fixture for fable-lab/tools/run-backtest.ts. Places no orders.',
  schema: ConfigSchema,
  create: () => {
    const strategy: Strategy = {
      name: 'fable-fixture-noop',
      onMarketTick: (_tick: MarketTick, _portfolio: PortfolioSnapshot): Intent[] => [],
      onAccountEvent: (): Intent[] => [],
    }
    return { strategy }
  },
}
