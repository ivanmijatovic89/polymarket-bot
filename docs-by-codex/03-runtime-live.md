# Live Runtime

Entry point: `src/cli/trading-bot.ts`

## Startup Sequence

1. Load env + polymarket config.
2. Resolve symbol (`TRADING_SYMBOL` or fallback semantics).
3. Resolve active 15m market via Gamma (`resolveCurrentUpDown15mAssets`).
4. Build strategy from CLI args (`--strategy`, `--param`).
5. Build `StrategyRunner` + `OrderManager` + `LiveExecution` + `Portfolio`.
6. Connect market WS source (`createLiveMarketEventSource`).
7. Connect user account WS (`createUserWsAccountSource`).
8. Keep REST poll source available as fallback (`createRestPollAccountSource`).
9. Optionally start web UI server if `ENABLE_WEB_UI=true`.

## Runtime Loops

### Market Loop

- raw market WS JSON -> `MarketEngine.handleRaw()`
- orderbook updates -> market ticks (`book`, `price_change`)
- ticks -> `StrategyRunner.onMarketTick()`

### Account Loop

- user WS trade/order updates -> `AccountEvent`
- account events -> `StrategyRunner.onAccountEvent()`
- portfolio updates + optional follow-up intents

### Market Rotation Loop

- aligned to 15m boundaries
- bot rotates to new up/down market slug
- warmup and source re-subscription happen per window

## Live-Specific Behaviors

- Dry run support (`DRY_RUN=true`)
- warmup support (`warmupMarket`) to reduce first-order latency
- external feed clients started only if requested by selected strategy
- optional balance tracker and approval checks
- optional JSONL logging + Web UI snapshots

## Failure Handling

- WS reconnect logic with status events
- fallback between user WS and REST poll
- guarded signal/crash handlers via `src/utils/runtime.ts`
