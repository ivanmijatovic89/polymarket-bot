# Engine Capability Map — what the backtest infrastructure can ALREADY test

Lane 05 of the 2026-07-09 research dossier. Ground truth from source, not
docs: every claim below is anchored to a file (and line where load-bearing).
Purpose: keep future family proposals inside what
`src/backtest/runSingleMarket.ts` + the shared engine can actually replay.

Contract docs cross-checked: [`strategy-research-protocol/ENGINE.md`](../../ENGINE.md),
[`strategy-research-protocol/SCOPE.md`](../../SCOPE.md),
[`strategy-research-protocol/tools/runBacktest.md`](../../tools/runBacktest.md).

---

## 1. Event / data surface — what a strategy SEES

### 1.1 Tick cadence

`MarketEngine` (`src/market/MarketEngine.ts:5-60`) decodes one raw market
message, applies it to `MarketOrderBookEngine`, and emits a strategy tick
ONLY for `book` and `price_change` events. `tick_size_change` and
`last_trade_price` mutate engine metadata but do not tick.
`price_change` size is the NEW aggregate size at the level (`size 0` deletes);
bids DESC, asks ASC (`src/market/orderbook/types.ts:65-80`).

One tick = one post-update snapshot of **both legs** of the episode.

### 1.2 The tick payload

`MarketTick = EngineTick & { snapshot: MarketOrderBooksSnapshot }`
(`src/strategy/Strategy.ts:19-22`). The strategy also gets the raw decoded
`msg` (so it can tell `book` vs `price_change` and read `price_changes[]`
including `side`, `best_bid`, `best_ask` per change).

`MarketOrderBooksSnapshot` (`src/market/orderbook/types.ts:133-145`):

- `market` (condition id), `timestamp` (exchange ms of last applied message)
- `byAssetId: Record<string, OrderBookSnapshot>` — **UP and DOWN books in the
  same snapshot**; cross-leg logic within an episode is free.

Per-asset `OrderBookSnapshot` (`src/market/orderbook/types.ts:27-53`):

- `bestBid`, `bestAsk`, `mid`, `spread` (nullable)
- `bids` / `asks`: **ALL levels** (not truncated), sorted
- `depthLevels = 10` and cumulative `bidsDepthByLevel` / `asksDepthByLevel`
  (index 0 = L1 cumulative)

So depth features beyond 10 levels are computable directly from the full
`bids`/`asks` arrays — the 10-level cap only applies to the precomputed
cumulative arrays.

### 1.3 Portfolio snapshot (2nd argument)

`PortfolioSnapshot` (`src/strategy/Strategy.ts:305-334`): positions keyed by
CLOB token id (`qty`, `avgEntryPrice`, `costBasis`), `realizedPnlTotal`,
`openOrdersByClientId` (full lifecycle state incl. `remaining`/`filled`),
`ordersByClientId` (normalized `OrderSnapshot` with `tradeStatusRank`
MATCHED=1/MINED=2/CONFIRMED=3), `recentFills`, `recentSplits`,
`marketByAssetId`.

### 1.4 StrategyContext (3rd argument)

`src/strategy/StrategyContext.ts:17-24`, built per tick by `StrategyRunner`
(`src/trading/StrategyRunner.ts:285-294`):

- `ctx.market: GammaMarketMeta` — `slug`, `upAssetId`, `downAssetId` + raw
  Gamma fields (`src/polymarket/gammaMarketMeta.ts:11-20`). Available in
  backtest (resolved by the producer, passed via `getMarket` in
  `runSingleMarket.ts:203`). This is how strategies map `byAssetId` to
  UP/DOWN and derive window boundaries from the slug epoch.
- `ctx.metrics.position: PositionMetrics` — computed EVERY tick by the runner
  (`src/trading/positionMetrics.ts` via `StrategyRunner.ts:183`):
  `shares_mergeable`, `pair_avg`, `total_cost`, `pnl_merge`,
  `pnl_if_up_wins`, `pnl_if_down_wins`, `imbalance`.
- `ctx.metrics.orderbook: OrderbookMetrics` — per-level weak-side
  classification across the pair: `weakBidSideByLevel[]`,
  `weakBidRatioByLevel[]`, same for asks (`src/trading/orderbookMetrics.ts`).
- `ctx.plugins: PluginsSnapshot` — see §4.
- `ctx.warmup`, `ctx.balance` — live-only; backtests omit them and
  `isWarmed()` (`src/strategy/strategyToolkit.ts:51-56`) returns true when
  absent.

### 1.5 Timing signals available

- `tick.snapshot.timestamp` = exchange time (drives all backtest clocks; the
  replay never uses wall time for fills).
- Window start/end: derived from the slug (`btc-updown-15m-<epochStart>`).
  Idiom: `parseWindowEndMsFromSlug` in
  `src/strategies/research/spread-capture/001-pair-completion.ts:49-56`;
  the backtest itself computes the same window and **filters ticks to it**
  (`src/cli/backtest.ts:670-681` → `runSingleMarket.ts:224-233`), so a
  strategy never sees out-of-window rows in telonex mode.
- `parseGammaMarketStartMs(ctx.market)` for Gamma-declared start
  (`src/strategy/strategyToolkit.ts:16-27`).

---

## 2. Action surface — what a strategy can DO

### 2.1 Intents (`src/strategy/Strategy.ts:113-119`)

| Intent            | Notes                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `place_limit`     | `FOK` \| `GTC` \| `GTD` (GTD needs `expireAtMs`, ≥60s live), price/size/side per assetId, `meta` echoed back on fills |
| `place_batch`     | up to 15 orders live; simulated per-order in backtest (`BacktestExecution.ts:289`)                                    |
| `cancel_order`    | by clientOrderId; no-op if already gone (`BacktestExecution.ts:567-591`)                                              |
| `cancel_all`      | cancels all resting sim orders                                                                                        |
| `split_positions` | $1 collateral → 1 UP + 1 DOWN share; **immediate** in backtest, no latency (`BacktestExecution.ts:205-261`)           |
| `merge_positions` | clamped to min(qtyA, qtyB); immediate (`BacktestExecution.ts:263-287`)                                                |

There is no market-order intent; taker = marketable limit (FOK or GTC that
crosses).

### 2.2 Runner sequence per tick (`src/trading/StrategyRunner.ts:155-302`)

1. `orderManager.onMarketTick` — due latency ops + GTD expiry + maker-fill
   checks against the fresh book (`BacktestExecution.ts:637-704`),
2. resulting account events applied to `Portfolio`, each routed through
   strategy `onAccountEvent` (which may emit more intents; cascade cap 100
   events per drain, overflow DROPS the queue — `StrategyRunner.ts:395-422`),
3. plugins updated, snapshot cached,
4. strategy `onMarketTick` → intents → `OrderManager.handleIntents`.

**Execution-mode reality check:** ENGINE.md ("Backtests use queued intent
execution … flushed at tick N+1") is STALE. Every current backtest path —
worker (`src/backtest/marketProcessor.ts:35`) and `--sequential`
(`src/cli/backtest.ts:746`) — goes through `runSingleMarket`, which builds the
runner with `intentExecutionMode: 'immediate'`
(`src/backtest/runSingleMarket.ts:145`, unchanged since the BullMQ migration,
commit 71681ee). With the protocol-default zero latency, an intent emitted on
tick N executes **against the exact snapshot the strategy just observed** —
optimistic zero-latency taker fills. Latency realism must come from
`BACKTEST_LATENCY_DELAY`/`JITTER` (see §2.4), not from queued mode.

### 2.3 Backtest fill model (`src/trading/execution/BacktestExecution.ts`)

- **Taker** (`buildFillsFromBook`, :116-167): walks opposite levels up to the
  limit price, partial fills per level, taker fee attached at
  `BACKTEST_TAKER_FEE_BPS` (default 156). FOK killed if fillable < size
  (checked against summed displayed depth, :33-48).
- **Maker** (`buildMakerFillTouchCross`, :50-114): default mode
  `worst_queue` — a resting BUY fills only when `bestAsk` moves strictly
  BELOW the resting price (price trades _through_ the level), at the resting
  price, **full remaining size in one fill, no partials, no queue position,
  no fee**. `touch_or_better` mode exists in code but `runSingleMarket`
  hardcodes `worst_queue` (`runSingleMarket.ts:133`) — not selectable per run
  without a code change.
- GTC/GTD first take whatever is immediately marketable, rest the remainder
  (:533-553). GTD expires by replay exchange time (:671-683).
- Status simulation: resting orders show `MATCHED`; FOK full fills jump to
  `CONFIRMED` (:515-529). `MINED` never simulated — strategies gating on
  `isOrderTradeStatusAtLeast(…, 'MINED')` never exercise that path.

### 2.4 Latency & risk rails

- `BACKTEST_LATENCY_DELAY` / `BACKTEST_LATENCY_JITTER` delay place/batch/
  cancel ops into a pending queue executed on later ticks
  (`BacktestExecution.ts:180-203`, :644-668). Splits/merges are never
  delayed. Jitter uses `Math.random()` — set 0 for determinism.
- `enforceRiskLimits` (`src/trading/riskLimits.ts:24-28`) is always on:
  `maxOpenOrders=20`, `maxOrderSize=2000`, `maxAbsPosition=2000` shares,
  `maxLossStop=500` realized. Hardcoded — a large-size experiment silently
  hits `order_rejected` events.
- `clientOrderId` dedupe in OrderManager: an id is reusable only after its
  order is done/rejected (`src/trading/OrderManager.ts:161`, :330). Ids must
  be deterministic (no randomness/Date.now()).

### 2.5 Settlement / lifecycle

There is **no resolution hook**. The strategy is never told the episode
ended or who won. Settlement is post-hoc accounting in `computeMarketStats`
(`src/backtest/stats/marketStats.ts:150-169`): remaining shares redeemed at
$1/$0 by `finalOutcome`, `pnl = realized + merge + redeem − remainingCostBasis
− splitCost`. Redemption is free (no fee, no latency) — "hold to resolution"
is a legitimate single-fee exit, which is exactly the imbalance-hold champion
mechanism.

---

## 3. Strategy idioms (from the research families)

Read end-to-end: `src/strategies/research/imbalance-hold/002-flow-trigger.ts`
(champion, taker one-shot), `spread-capture/001-pair-completion.ts` (maker
quoting + split + cancel/reprice), `maker-favorite/000-baseline.ts` (single
resting maker bid).

Common skeleton (all three):

1. `export const ConfigSchema = z.strictObject({ … })` with `.default()` per
   param + `export const definition: StrategyDefinition<Config>` with id
   `<family>.<experiment-id>` — the registry auto-discovers any file under
   `src/strategies/**` whose source matches `^export const definition`
   (`src/strategy/strategyRegistry.ts:36-50`). No registration list.
2. Closure state inside `createStrategy(cfg)`, with an explicit
   `resetEpisode()` triggered by `marketKey !== lastMarketKey`
   (e.g. `002-flow-trigger.ts:112-114`) — belt-and-braces; in backtests every
   market gets a **fresh strategy instance anyway** (`runSingleMarket.ts:110-151`).
3. Guards first: `isWarmed(ctx)`, `ctx.market.upAssetId/downAssetId` present,
   `validBook()` (bestBid/bestAsk/mid finite), `Number.isFinite(timestamp)`.
4. Deterministic `clientOrderId`:
   `` `${name}:${marketKey}:${side}` `` (+ a sequence counter when re-quoting,
   `001-pair-completion.ts:184`).
5. Prices clamped via `safeProbabilityPrice(round2(...))`, entries capped to
   [0.01, 0.99].
6. `onAccountEvent: () => []` unless reacting to fills — spread-capture reads
   `portfolio.openOrdersByClientId` on the next tick instead of tracking
   events (open-order scan idiom, `001-pair-completion.ts:81-89`).

Feature computation seen in-family: cumulative-depth bid ratio per leg,
imbalance differential UP−DOWN, first derivative over a time window with an
episode-local `(ts, imb)` sample buffer and anchor pruning
(`002-flow-trigger.ts:128-152`) — a good template for any rolling in-episode
signal.

**Parameter sweeps** are NOT in code: each experiment file exposes scalar
params with defaults; the sweep is expressed as CLI submissions, one run per
value, coordinate descent one param per pass, shared pass `batchUid`
(`strategy-research-protocol/tools/runBacktest.md:66-86`), recorded in
`FAMILY.json` `search.passes[]` with `defaults`, `values`, `best`, `note`.
No grid/product runner exists — sweeps are O(values) submissions, deliberate.

Stage sizes: smoke 10 sequential → screen 1000 latest → confirm 3000 →
robustness 9000, by EXTENDING the winning run
([`strategy-research-protocol/STAGE-GATES.md`](../../STAGE-GATES.md)).

---

## 4. Plugin / derived-data mechanisms

`Plugin` interface: `{ id, onMarketTick(tick, ctx), snapshot?(), reset?() }`
(`src/strategy/plugins/PluginSet.ts:6-12`). Runner updates plugins every
tick, caches one snapshot per tick, resets on market rotation
(`StrategyRunner.ts:161-169`, :248). A strategy ships plugins by returning
`{ strategy, plugins: [...] }` from `create()` (`runSingleMarket.ts:119-127`).

Existing plugins (`src/strategy/plugins/`):

| Plugin                                                                        | Snapshot                                                                                                                                                                                   | Backtest-usable?                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TechnicalIndicatorsPlugin`                                                   | pre-window Binance BTCUSDT context as-of slug start − 1ms: 1h ATR%, BB width, ADX, realized vol 20/80 + ratio, 15m ATR/RV, session/hour/day-of-week (`TechnicalIndicatorsPlugin.ts:10-34`) | **YES** — fetches historical klines over HTTP per market (:236-249); deterministic because candles are immutable; requires `BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS=1` or values are silently absent on early ticks |
| `TimeWindowVolatility`                                                        | rolling mid/spread stats per asset over configurable windows, updated per tick from the replayed book                                                                                      | YES — pure function of tick stream                                                                                                                                                                                 |
| `DwellGatePlugin`                                                             | tracks how long the favorite leg has dwelt above a threshold                                                                                                                               | YES                                                                                                                                                                                                                |
| `TimeWindowGatePlugin`                                                        | elapsed-time gate snapshot                                                                                                                                                                 | YES                                                                                                                                                                                                                |
| `DeribitVolatilityIndexPlugin`                                                | DVOL as-of window start (HTTP)                                                                                                                                                             | YES with network caveat                                                                                                                                                                                            |
| `ExternalFeedsPlugin` / RTDS / `binanceWsSpotPrice` / `polymarketPriceToBeat` | live WS feeds                                                                                                                                                                              | **NO** — live-only; `requiredFeeds` ignored by backtests                                                                                                                                                           |

The plugin snapshot is the sanctioned channel for "derived data computed once
per episode or per tick" — SCOPE.md allows it when the source is recorded or
replayable with identical semantics.

---

## 5. Limits — what a strategy CANNOT see or do, and the plumbing cost

| #   | Limit                                                                                                                                                                                                                                 | Where it bites                                                                             | Plumbing to lift                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | **No trade prints.** `last_trade_price` is recorded into `OrderBookEngine.recentTrades` (cap 200, `OrderBookEngine.ts:26-46`, :138-157) but `OrderBookSnapshot` does not expose it and the event emits no tick                        | Any trade-flow / aggressor-imbalance / volume strategy                                     | SMALL-MODERATE: add `recentTrades` to the snapshot type + optionally emit ticks for `last_trade_price`; same engine live/backtest so parity holds; touches core types, needs commit + fleet sync                                                                                                            |
| L2  | **No price-to-beat in backtest.** The window strike is a live-only feed (`Strategy.ts:450-453`); replayed data has no reference price                                                                                                 | Distance-to-strike / moneyness strategies                                                  | MODERATE: fetch historical Binance close at slug epoch inside a plugin (same pattern as TechnicalIndicatorsPlugin) — replayable; needs a live/backtest-parity check that Polymarket's official openPrice ≈ derived value                                                                                    |
| L3  | **No queue position / partial maker fills.** `worst_queue` fills full size only when price trades through (`BacktestExecution.ts:59-113`); `touch_or_better` exists but is not wired to any flag (`runSingleMarket.ts:133` hardcodes) | Queue-sensitive MM, fill-rate-calibrated quoting                                           | MODERATE for flag exposure (thread `makerFillMode` through CLI/job types); LARGE for real queue modeling (needs per-level queue simulation fed by trade prints → depends on L1)                                                                                                                             |
| L4  | **No own-order market impact.** Taker fills consume a copy of the displayed book for that fill only; future ticks are replayed data — own trades never move the market, and multiple own orders can eat the same displayed liquidity  | Sizing studies, capacity estimates                                                         | LARGE: impact model inside BacktestExecution (persistent shadow book netting own fills); protocol currently compensates with small sizes + risk rails                                                                                                                                                       |
| L5  | **No cross-episode memory.** Fresh Strategy/Runner/Portfolio per market (`runSingleMarket.ts:106-151`); markets run as independent unordered jobs on different workers                                                                | Regime carryover, streak/momentum-across-windows, adaptive parameters                      | MODERATE via offline feature store: precompute per-slug features (prior-episode outcome, realized vol, close location) into a file/DB keyed by slug, load in a plugin — deterministic and worker-friendly. BLOCKED as true online state (would serialize the whole run and break the BullMQ parallel model) |
| L6  | **No adjacent-market visibility.** One parquet file = one episode; the replay never has two condition ids loaded (`MarketOrderBookEngine` asserts single market)                                                                      | Trading the 15m window using the overlapping 1h/hourly market, or the _next_ window's book | LARGE: paired-file replay + multi-market engine + portfolio; also out of SCOPE.md (single timeframe)                                                                                                                                                                                                        |
| L7  | **No intra-tick timing.** Strategy acts only at book-change instants; cannot wake on a timer between ticks                                                                                                                            | Precise time-based exits in quiet books                                                    | SMALL workaround: act on first tick after deadline (spread-capture idiom); real fix = synthetic clock ticks in replay (moderate)                                                                                                                                                                            |
| L8  | **No MINED/CONFIRMED progression** for resting orders (backtest stops at MATCHED except FOK; `BacktestExecution.ts:460-476`)                                                                                                          | Live strategies that must gate sells on on-chain settlement                                | Accept as known live/backtest divergence; ENGINE.md documents it                                                                                                                                                                                                                                            |
| L9  | **Hardcoded risk rails and fee** (`riskLimits.ts:24-28`; fee env-var only)                                                                                                                                                            | Size sweeps > 2000 shares, >20 open orders (dense ladders), fee-sensitivity sweeps per run | SMALL: make limits/fee per-run params through jobTypes; until then, treat as experiment constraints                                                                                                                                                                                                         |
| L10 | **Account-event cascade cap 100 with silent drop** (`StrategyRunner.ts:400-411`)                                                                                                                                                      | Strategies emitting long intent chains from `onAccountEvent`                               | Design around it: keep event-reaction logic shallow                                                                                                                                                                                                                                                         |

Not limits (commonly misassumed): cross-LEG state is fully available (both
books in every snapshot, §1.2); full book depth is available beyond 10 levels
(§1.2); window boundaries are derivable and enforced (§1.5); split/merge is
simulated (§2.1); maker+taker mixed strategies work.

---

## 6. Idea categories: CHEAP / MODERATE / BLOCKED today

### CHEAP — pure function of the in-episode two-leg book stream (zero plumbing)

- Depth/imbalance level, flow (derivative), persistence signals at any level
  count 1–10 (or deeper via raw arrays) — proven template exists
  (imbalance-hold).
- Spread/mid dynamics: spread-capture quoting, mid-reversion, tick-frequency
  ("book heat") signals, dwell/stability gates.
- Cross-leg consistency: UP+DOWN price sum deviation, weak-side metrics
  (already precomputed in `ctx.metrics.orderbook`), leg-lag reactions.
- Time-of-window structure: entry windows, late-window cutoffs, elapsed-time
  gates (slug-derived clock).
- Execution variants: FOK vs GTC-with-remainder, GTD auto-expiry ladders,
  cancel/reprice policies, split→quote-both-legs, merge-based exits,
  hold-to-redemption vs sell-before-end.
- Latency-sensitivity of any of the above (`BACKTEST_LATENCY_*`).
- Session/hour-of-day conditioning (computable from timestamp alone).

### MODERATE — one plugin, one small engine change, or an offline feature file

- BTC spot context conditioning (vol regime, trend filter) — plugin already
  exists (TechnicalIndicatorsPlugin); just consume its snapshot.
- Price-to-beat / distance-to-strike strategies — new plugin fetching the
  slug-epoch Binance price (L2).
- Trade-print / aggressor-flow signals — expose `recentTrades` in the
  snapshot (L1); highest ROI single engine change on this list.
- Prior-episode features (previous window outcome/return, streaks, day
  profile) — offline per-slug feature store + loader plugin (L5).
- Maker fill-mode sensitivity (`touch_or_better` vs `worst_queue`) — thread
  the existing flag through CLI/jobTypes (L3-lite).
- Per-run fee/risk-limit overrides for capacity/fee sweeps (L9).

### BLOCKED — needs engine architecture work or out of scope

- Real queue-position maker modeling and partial maker fills (L3 full, needs
  L1 first).
- Own-order market impact / capacity beyond token sizes (L4).
- Cross-market (adjacent window, other timeframe, other symbol) strategies
  (L6 + SCOPE.md forbids).
- True online cross-episode adaptive state (bandit-style parameter updating
  across a run) — incompatible with unordered distributed jobs (L5 hard
  form).
- Anything needing live-only feeds absent from replay (RTDS, user-WS
  microstructure, unrecorded fields) — SCOPE.md forbidden inputs.

---

## 7. Corrections to keep in mind when reading ENGINE.md

- ENGINE.md "Backtests use queued intent execution" is stale: all current
  paths run `intentExecutionMode: 'immediate'`
  (`src/backtest/runSingleMarket.ts:145`). Same-tick execution against the
  observed snapshot; combine with explicit latency envs when realism matters.
- ENGINE.md "Backtests emit MATCHED … MINED and CONFIRMED are not simulated"
  is almost right: FOK full fills DO emit a synthetic `CONFIRMED`
  (`BacktestExecution.ts:515-529`); resting orders stop at MATCHED.
- ENGINE.md implies plugin data must be "optional"; TechnicalIndicators is
  the exception pattern — backtest-usable but network-dependent and gated by
  `BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS=1`.
