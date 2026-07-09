# Raw study notes — strategy subsystem (interface, plugins, portfolio, runner)

_Source: fresh-context Explore subagent, session 1. Input notes for
`engine/CAPABILITIES.md`; the synthesized doc is authoritative._

_Main-session verification: `runSingleMarket.ts:145` sets
`intentExecutionMode: 'immediate'` — confirmed by direct grep. The old
`strategy-research-protocol/ENGINE.md` claim ("backtests use queued intent
execution: tick N intents flush at tick N+1") is OUTDATED for the current
backtest runner._

## 1. Strategy interface

### Hooks — exactly TWO, no lifecycle hooks
`Strategy` type (`src/strategy/Strategy.ts:418-465`):
- `name: string` (`Strategy.ts:419`)
- `requiredFeeds?` (`Strategy.ts:426-453`) — declarative external-feed requirements (live-only)
- `onMarketTick(tick, portfolio, ctx?) => Intent[] | Promise<Intent[]>` (`Strategy.ts:454-458`)
- `onAccountEvent(ev, portfolio, lastMarket?, ctx?) => Intent[] | Promise<Intent[]>` (`Strategy.ts:459-464`)

No `onEpisodeStart`/`onEpisodeEnd`/`onInit`/`onClose`. Episode boundaries handled outside the strategy: runner resets plugin state on market-key change (`StrategyRunner.ts:163-170`); strategies self-detect market change by comparing `tick.snapshot.market` to a remembered key (idiom: `SplitSellRedeem.v5.ts:104-120`). `ctx?` may be `undefined` (`StrategyRunner.ts:285-294`).

### ctx contents — `StrategyContext` (`src/strategy/StrategyContext.ts:17-24`), all optional
- `plugins?: PluginsSnapshot` — `Record<pluginId, unknown>` cached snapshots (`StrategyContext.ts:18`, built `PluginSet.ts:64-75`)
- `market?: GammaMarketMeta` — episode market metadata; source of `upAssetId`/`downAssetId`/`slug` (`StrategyContext.ts:19`)
- `metrics?: Metrics` — derived position + orderbook metrics (`StrategyContext.ts:20`, `Strategy.ts:300-303`, computed `StrategyRunner.ts:183-197`)
- `balance?` — live-only (`StrategyContext.ts:21`)
- `warmup?` — live-only (`StrategyContext.ts:22`)

Strategy gets a frozen read-only `PortfolioSnapshot` (`Portfolio.ts:117`): `nowMs`, `realizedPnlTotal`, `positionsByAssetId`, `openOrdersByClientId`, `wsOpenOrdersByOrderId`, `ordersByClientId`, `recentFills`, `recentSplits`, `marketByAssetId` (`Strategy.ts:305-334`).

### Intent kinds (`Strategy.ts:113-119`), union of 6
1. `place_limit` (`Strategy.ts:24-39`): `clientOrderId`, `assetId`, `side` BUY|SELL, `price`, `size`, `orderType` FOK|GTC|GTD (`Strategy.ts:12`), optional `meta`, `expireAtMs` (required for GTD, `Strategy.ts:37`), `reason`.
2. `place_batch` (`Strategy.ts:89-111`): `orders[]`; Polymarket max 15/batch (`Strategy.ts:93`).
3. `cancel_order` (`Strategy.ts:41-46`): `clientOrderId` OR `orderId`.
4. `cancel_all` (`Strategy.ts:48-51`).
5. `merge_positions` (`Strategy.ts:53-66`): `assetIdA/B`, `size`; actual may be smaller.
6. `split_positions` (`Strategy.ts:68-87`): `size` (1 share == $1 collateral); backtest forces `splitCost = size` ($1/full set, `BacktestExecution.ts:255`).

Field constraints (positivity etc.) NOT enforced on Intent type — only Zod param schema + execution/risk layers. `enforceRiskLimits` runs on intents (`OrderManager.ts:111-115, 138-142`).

## 2. Definition / registration

- `StrategyDefinition` = `{ id, title?, description?, schema: z.ZodType, create(params) => BuiltStrategy }` (`strategyDefinition.ts:21-27`). `BuiltStrategy` = `{ strategy, pluginSet?, plugins? }` (`strategyDefinition.ts:5-9`).
- CLI: `parseStrategyArgs` (`strategyDefinition.ts:66-109`) — repeated `--param key=value`; duplicate keys rejected (`:89-91`). Validation `def.schema.safeParse(rawParams)` (`strategyArgs.ts:75`); failure → `CliArgsError` with flattened Zod errors (`:76-88`).
- `--param` values are strings ⇒ schemas use `z.coerce.number()` + `z.strictObject` (rejects unknown keys) (`Template.v1.ts:13-14`, `Scalp.v1.ts:8-11`).
- Auto-discovery (`strategyRegistry.ts`): walks `src/strategies/**` any depth (`:23-24, 39-50`); loads only files matching `/^export\s+const\s+definition\b/m` via readFileSync pre-check (`:36, 68`); synchronous `require` (`:14, 70-72`); same-extension files only (`:28, 45`); duplicate `id` throws (`:89-91`).

## 3. Plugin system

- Contract: `Plugin = { id, onMarketTick(tick, ctx?), snapshot?(), reset?() }` (`PluginSet.ts:6-11`). Declared via `BuiltStrategy.plugins[]`; `buildRunnerForMarket` wraps into `PluginSet` (`runSingleMarket.ts:119-127`).
- Snapshot built ONCE per tick, reused for all cascaded `onAccountEvent` in that tick (`PluginSet.ts:50-75`, `StrategyRunner.ts:248, 282-283, 469`).

### Plugins and backtest availability
| Plugin (id) | Backtest? | Notes |
|---|---|---|
| TimeWindowVolatility (`timeWindowVolatility`) | YES | pure rolling stats from book (`plugins/TimeWindowVolatility.ts:294`) |
| DwellGatePlugin (`dwellGate`) | YES | time-in-range per UP/DOWN, needs `ctx.market` (`DwellGatePlugin.ts:169, 236-237`) |
| TimeWindowGatePlugin (`timeWindowGate`) | YES | elapsed since market start from slug (`TimeWindowGatePlugin.ts:89`) |
| TechnicalIndicatorsPlugin (`technicalIndicators`) | YES but network | Binance klines keyed by slug 15m epoch (`TechnicalIndicatorsPlugin.ts:220, 227`); fire-and-forget async compute (`:197`) — may be absent on early ticks; once per market (`:192-198`) |
| DeribitVolatilityIndexPlugin (`deribitVolatilityIndex`) | YES but network | same slug-keyed async pattern (`DeribitVolatilityIndexPlugin.ts:119-140, 160`) |
| ExternalFeedsPlugin / ExternalFeedsRequestPlugin (`externalFeeds`) | NO | live-only; in backtest stays absent from `ctx.plugins` (`ExternalFeedsRequestPlugin.ts:26, 38-49`) |

### BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS
- Gated at `StrategyRunner.ts:250`. When `'1'`: after first tick of each market, poll `refreshSnapshot()` until `technicalIndicators` present or timeout (`:250-280`). Timeout 3000ms via `BACKTEST_TECH_IND_TIMEOUT_MS`, poll 10ms via `BACKTEST_TECH_IND_POLL_MS` (`:257-264`). On timeout: warn but PROCEED (`:273-278`) — determinism hazard (network-dependent presence/absence of TA data).

## 4. Portfolio (`src/trading/Portfolio.ts`)

- State: `positionsByAssetId`; `Position = { assetId, qty, avgEntryPrice, costBasis }` (`Strategy.ts:150-160`). **No cash field** — only cumulative `realizedPnlTotal` (`Portfolio.ts:90, 715`). Unrealized PnL derived on demand into `ctx.metrics.position` (`StrategyRunner.ts:183-186`).
- `apply(ev)` is the single mutator; `snapshot()` frozen + cached (`Portfolio.ts:23-35, 104-119, 247-251`).
- Clock: `nowMs` advances monotonically off event timestamps (`Portfolio.ts:252-255`); initial value `Date.now()` (`:37`).
- BUY: `netSize = size − fee.feeBase`; qty adds netSize but costBasis adds full `price*size` (`Portfolio.ts:672-689`). SELL: `sellQty = min(size, qty)`; realizes `netProceeds − avgCost*sellQty` (`:697-715`). Zero-qty positions deleted (`:730-733`). Quantities `round2` (`:210-211, 636-637, 687`).
- Fee applied only when `liquidity === 'TAKER'` and `feeRateBps > 0` (`Portfolio.ts:667`).
- Trade status rank MATCHED=1 MINED=2 CONFIRMED=3, monotonic via `Math.max` (`Portfolio.ts:133-137, 186, 358`). Out-of-order events buffered (`:74-77, 177-190, 299-318`); duplicate fills via `seenFillIds` (`:230-245, 558`).
- Split mints both sides with `avgEntryPrice: null, costBasis: 0`, does NOT touch realizedPnl (`Portfolio.ts:566-597`); merge reduces both by min, no realized-PnL update (`:366-394`).

## 5. Account events in backtest

- place → `order_accepted` → `ws_order_update{MATCHED}` → fills (TAKER w/ fee) + `order_done{filled}` + `ws_order_update{CONFIRMED}` when full; or `order_open` if resting; FOK unfillable → `CANCELED` + `order_done{killed}` (`BacktestExecution.ts:321-418, 458-553`).
- Resting maker fills on later ticks → `fill`(MAKER) + `order_done{filled}` (`:671-701`); GTD expiry → `order_done{expired}` (`:673-682`).
- split → `positions_split`/`split_failed` (`:205-261`); merge → `positions_merged` (`:263-287`); cancels → `order_done{canceled}` (`:567-635`).
- **MINED (rank 2) is NEVER emitted by the simulator** — jumps MATCHED→CONFIRMED (`:333, 384, 472, 525`). A strict `=== MINED` gate diverges; `>= MINED` is satisfied by CONFIRMED.
- Cascade: `drainAccountEvents` FIFO — `portfolio.apply(ev)` then `strategy.onAccountEvent`, new intents execute and enqueue (`StrategyRunner.ts:395-496`). `maxEventsPerDrain` default 100; on exceed the remaining queue is DROPPED with a warning (`:401-411`).
- Backtest `intentExecutionMode: 'immediate'` (`runSingleMarket.ts:145`) — intents execute synchronously same-tick. (`StrategyRunner.ts:125` default is `'queued'` but the backtest runner overrides.)

## 6. Cross-market state

- Backtest: fresh Strategy + PluginSet + OrderManager + BacktestExecution + Portfolio per market (`runSingleMarket.ts:106-151`); batch loop calls per market (`backtest.ts:738-746`). Closure state does not persist across markets.
- Live: ONE strategy instance across successive 15m markets; runner resets only PluginSet + market-key trackers (`StrategyRunner.ts:161-170`) — strategy closures leak unless self-reset. Portfolio is shared and cumulative in live.
- Module-level mutable state would leak even in backtest (module `require`d once) — per-strategy discipline, no engine guarantee.
- Async slug-keyed plugin caches reset on market change; late writes guarded by `lastMarketKey` (`TechnicalIndicatorsPlugin.ts:172-177, 210`).

## 7. Determinism / replay-safety rules

- Engine promise: deterministic with `jitterMs === 0` and no `Math.random()` in strategy (`runSingleMarket.ts:161-162`).
- Strategy rules: time from `tick.snapshot.timestamp` never `Date.now()` (fallbacks exist at `StrategyRunner.ts:175, 299, 368, 485` — safe only if timestamps present); no `Math.random()`; decisions pure function of `(tick, portfolio, ctx)` + deterministic closure state; reset closure state on market-key change.
- Determinism hazards from engine: (a) TA-wait poll is wall-clock + network (`StrategyRunner.ts:250-280`); (b) async plugin fetches may be absent on early ticks depending on network; (c) latency jitter `Math.random()` (`BacktestExecution.ts:201`).
- `maxEventsPerDrain` drop is deterministic but silently lossy.
- Async `onMarketTick` allowed by type but discouraged; audited strategies all synchronous.
