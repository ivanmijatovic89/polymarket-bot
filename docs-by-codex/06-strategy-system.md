# Strategy System

## Contracts

Core types: `src/strategy/Strategy.ts`

- `onMarketTick(tick, portfolio, ctx?) => Intent[]`
- `onAccountEvent(event, portfolio, lastMarket?, ctx?) => Intent[]`

## Strategy Registration

- definitions are declared in `src/strategies/**`
- all runtime-available strategies must be registered in `src/strategy/strategyRegistry.ts`

## Param Validation

- strategies define strict Zod schema
- CLI params come from repeated `--param key=value`
- unknown/malformed params fail fast

Builder path:

- `src/cli/helpers/strategyArgs.ts`
- `src/strategy/strategyDefinition.ts`

## Intents

Primary intent kinds:

- `place_limit`
- `place_batch`
- `cancel_order`
- `cancel_all`
- `split_positions`
- `merge_positions`

All intents pass through `OrderManager` risk/validation + execution adapter.

## Strategy Families in Repo

- basic examples (`basicFak`, `winnerLimit`, `buyBoth...`)
- latency and diagnostics (`measureLatency`)
- plugin examples (`readVolatilityIndicator`, `readExternalFeedsExample`)
- signal strategies (`signals/Orderbook.v1`)
- split family (`SplitSellRedeem.*` variants and gates)
- templates (`templates/*`) for new strategy bootstrapping

## How to Add a New Strategy

1. Create `src/strategies/<YourStrategy>.ts` with `definition`.
2. Add strict schema with defaults.
3. Register in `strategyRegistry.ts`.
4. Verify with `npm run backtest` first.
5. Then run live dry-run.
6. Document strategy params and behavior.
