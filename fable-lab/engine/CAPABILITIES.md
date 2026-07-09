# Engine Capabilities — ground truth for the Fable protocol

Every design element of the Fable protocol must trace to a claim in this file.
Every claim here carries a file citation. Detailed evidence lives in
`fable-lab/engine/notes/*` (raw subagent audits, session 1); this file is the
authoritative synthesis. Where this file and the old
`strategy-research-protocol/ENGINE.md` disagree, this file was checked against
source and wins (known ENGINE.md staleness: intent execution mode, see §4).

Scope note: everything below is stated for the operator-fixed research scope —
BTC 15m up/down markets, `--input-mode telonex-delta --converter delta-typed
--read-from local-or-download-from-r2-to-local` (CHARTER.md).

---

## 1. What a strategy sees (tick semantics)

- A strategy tick fires ONLY on `book` and `price_change` events
  (`src/market/MarketEngine.ts:76-78`; replay
  `src/parquet/replay/replayOrderBookForMarket.ts:110-117`).
- Each tick carries **both token books (UP and DOWN) at full depth**:
  `snapshot.byAssetId: Record<assetId, OrderBookSnapshot>`
  (`src/market/orderbook/types.ts:133-145`). Per-asset snapshot: `bestBid`,
  `bestAsk`, `mid`, `spread`, all `bids`/`asks` levels, top-10 cumulative
  depth arrays (`src/market/orderbook/types.ts:27-53`,
  `src/market/orderbook/OrderBookEngine.ts:50-70`).
- Tick timestamp = **exchange timestamp** of the last applied message
  (`OrderBookEngine.ts:59, 82, 88`). Local receive time is NOT propagated to
  strategies (`MarketEngine.ts:5-7`). Backtest `nowMs` (fills, GTD expiry) is
  this exchange timestamp (`docs/engine/backtest-execution.md:119-124`).
- **In telonex-delta replay the ONLY event types are `book` and
  `price_change`** — no `last_trade_price`, no `tick_size_change`
  (`src/parquet/io/eventSchema.ts:53-70`,
  `src/parquet/replay/replayTelonexDeltaParquetForMarket.ts:97-145`). Last
  trade is never in the tick snapshot even in recorded mode
  (`OrderBookEngine.ts:26, 50-70, 138-158`).
- `price_change` size is the new aggregate at a level; `<= 0` deletes
  (`OrderBookEngine.ts:104-113`).
- No book integrity enforcement at runtime: hashes stored/blanked but unused;
  validation mode off by default (`docs/engine/orderbook-engine.md:39`,
  `MarketOrderBookEngine.ts:29`, delta-typed blanks hashes:
  `replayTelonexDeltaParquetForMarket.ts:108, 132-134`).

### Feature inputs available to a BTC-15m backtest strategy
1. Both books, full depth, per tick (above).
2. `ctx.market` = `GammaMarketMeta`: `slug`, `upAssetId`, `downAssetId`,
   `outcomes`, `question` (`src/polymarket/gammaMarketMeta.ts:11-22`, wired at
   `src/backtest/runSingleMarket.ts:203`).
3. Window start/end derivable from the slug epoch
   (`btc-updown-15m-<epochStart>`; end = start + 900s).
4. Own account/order/fill events from the simulator (§4).
5. Backtest-safe plugins (§3).

### NOT available to a backtest strategy (decisive)
- **The price-to-beat / strike price.** It is not in any parquet schema
  (`eventSchema.ts:10-70`), not in WS payloads
  (`orderbook/types.ts:55-107`), and is a live-only HTTP feed
  (`src/trading/feeds/polymarketPriceToBeatClient.ts:23-30, 70-86`, started
  only in `src/cli/trading-bot.ts:334-371`). Backtests never fulfill external
  feeds (`src/strategy/plugins/ExternalFeedsRequestPlugin.ts:24-25, 46-49`).
  ⇒ Strategies must work from market-implied state (the books themselves);
  the UP/DOWN mid IS the market's probability estimate.
- Trade stream (`last_trade_price` absent from telonex-delta entirely).
- External prices (Binance spot, Chainlink, Deribit vol) as recorded data.
- Own-order market impact, queue position, maker/taker identity of book
  changes.
- Local receive timestamps.

## 2. Episode model

- One market = one parquet file = one 15m episode; replayed start-to-finish
  with a fresh engine (`runSingleMarket.ts:164-302`). Episode ends when rows
  are exhausted — no explicit 15m clock boundary.
- Recording starts at the first `book` snapshot — possible late-start gap
  after true window open (`src/parquet/io/eventWriter.ts:68-74, 214-241`).
  Mid-window WS gaps exist; the book carries stale state across them, no
  reset, no gap markers at the strategy layer (decoder drops synthetic rows,
  `src/market/marketChannelDecoder.ts:3-8, 31`).
- No resolution event in the stream. Outcome comes from
  `telonex_markets.result_id` (0=UP, 1=DOWN) after the fact
  (`docs/datasets/telonex/backtest.md:136-148`).
- **Backtest isolation**: fresh Strategy + PluginSet + OrderManager +
  BacktestExecution + Portfolio per market (`runSingleMarket.ts:106-151`).
  Nothing persists across markets in a batch. (Live is different: one
  strategy instance spans markets and must self-reset — a live/backtest
  asymmetry to design for, `StrategyRunner.ts:161-170`.)

## 3. Strategy interface

- Exactly two hooks: `onMarketTick(tick, portfolio, ctx?)` and
  `onAccountEvent(ev, portfolio, lastMarket?, ctx?)`, both → `Intent[]`
  (`src/strategy/Strategy.ts:418-465`). No episode lifecycle hooks; detect
  market change by comparing `tick.snapshot.market`.
- Intents (6): `place_limit`, `place_batch`, `cancel_order`,
  `cancel_all`, `split_positions`, `merge_positions`
  (`Strategy.ts:113-119`). Order types `FOK | GTC | GTD`; GTD `expireAtMs`
  ≥ now + 60s (`src/trading/OrderManager.ts:496-501`). No modify/replace, no
  IOC/FAK, no redeem intent.
- **Batch size ≤15 is live-only, NOT engine-enforced**: the limit exists only
  as a comment (`Strategy.ts:93`); OrderManager checks only for empty batches
  and risk limits validate per order. A 30-order batch passes in backtest and
  fails live — strategies must self-enforce ≤15 (live/backtest asymmetry).
- Registration: `export const definition = { id, schema (Zod), create }`;
  auto-discovered under `src/strategies/**`
  (`src/strategy/strategyRegistry.ts:23-50, 68`); duplicate id throws
  (`:89-91`). `--param` values arrive as strings ⇒ `z.coerce` +
  `z.strictObject` idiom (`src/strategies/templates/Template.v1.ts:13-14`).
- Plugins usable in backtest: `timeWindowVolatility`, `dwellGate`,
  `timeWindowGate` (pure, data-only); `technicalIndicators` and
  `deribitVolatilityIndex` work but fetch over the network keyed by slug
  epoch — deterministic given data, non-deterministic presence on early ticks
  (fire-and-forget compute, `TechnicalIndicatorsPlugin.ts:197`;
  `BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS=1` polls up to 3s then proceeds
  anyway, `StrategyRunner.ts:250-280`). `externalFeeds` is absent in
  backtests (`ExternalFeedsRequestPlugin.ts:26`).
- Portfolio: positions keyed by assetId; no cash field; cumulative
  `realizedPnlTotal` only; frozen snapshot per tick
  (`src/trading/Portfolio.ts:90, 104-119`). Split mints shares with
  `costBasis: 0` (later sells look like pure proceeds); merge does not touch
  realized PnL (`Portfolio.ts:566-597, 366-394`).
- Replay-safety rules for strategy code: no `Math.random()`; time only from
  `tick.snapshot.timestamp`; decisions a pure function of
  `(tick, portfolio, ctx)` + deterministic closure state; deterministic
  `clientOrderId` (dedupe is by clientOrderId,
  `OrderManager.ts:85, 276-277`).

## 4. Execution simulation (what backtest PnL actually measures)

- **Intent execution is `'immediate'` in backtest** — intents execute and emit
  account events synchronously within the same tick
  (`runSingleMarket.ts:145`; verified this session; the old ENGINE.md
  "queued next tick" claim is outdated).
- Taker fills: walk opposite book levels to the limit price; partial fills
  per level; fee attached (`BacktestExecution.ts:116-167`).
- Maker fills: `worst_queue`, hardcoded (`runSingleMarket.ts:133`) — resting
  BUY at P fills only when `bestAsk < P` strictly; **always full remaining
  size in one shot regardless of traded volume**; at the resting price; zero
  fee (`BacktestExecution.ts:50-114`). `touch_or_better` exists but is
  unreachable from the CLI.
- No market impact: own orders never consume or appear in the replayed book.
  No self-trade modeling. No partial maker fills. No queue position.
- Latency: `BACKTEST_LATENCY_DELAY` (default 0) + `BACKTEST_LATENCY_JITTER`
  (default 20 but inert when delay=0, `runSingleMarket.ts:131`);
  `executeAtMs = max(now, now + delay ± jitter)`; jitter uses
  `Math.random()` — the ONLY engine nondeterminism
  (`BacktestExecution.ts:200-203`). Applies to place/cancel, NOT split/merge.
  Latency is tick-quantized (an op executes on the first tick past its
  executeAtMs).
- Fees: taker-only, default `BACKTEST_TAKER_FEE_BPS=156`;
  `fee = (bps/1e4) · min(p, 1−p) · size` shape (BUY in shares, SELL in
  collateral) (`src/trading/fees.ts:14-49`). Maker fee zero. **These are
  hardcoded model assumptions, not live schedules.** No gas costs modeled.
- Settlement: pure end-of-episode arithmetic in stats — mergable pairs at $1,
  winning shares $1, losing $0;
  `pnl = realized + merge + redeem − remainingCost − splitCost`
  (`src/backtest/stats/marketStats.ts:105, 141-169`). No redeem lifecycle,
  timing, or cost. Unresolved markets are skipped entirely (`marketStats:
  null` + skip reason, `runSingleMarket.ts:305-326`).
- Trade status: **MINED is never emitted** (`BacktestExecution.ts:333, 384,
  472, 525`); the MATCHED→CONFIRMED progression exists only on the
  *placement* path (immediate taker/FOK fills). **Resting maker fills emit
  only `fill` + `order_done` — no `ws_order_update` status at all**
  (`BacktestExecution.ts:689-700`). Strategies must gate on `fill` events,
  not on order status; status gates silently miss maker fills in backtest.
- Risk limits are hardcoded and ACTIVE in backtest: maxOpenOrders 20,
  maxOrderSize 2000, maxAbsPosition 2000, maxLossStop 500
  (`src/trading/riskLimits.ts:24-29`) — silent `order_rejected` if exceeded.
  `maxLossStop` blocks only NEW placements; cancels, splits, merges, and
  exits still pass (`riskLimits.ts:84-86, 158-176`).
- **Mid-episode `merge_positions` is a PnL leak in backtest accounting**:
  merge reduces both legs with no realized credit
  (`src/trading/Portfolio.ts:366-394`), and settlement values
  `mergableShares` from FINAL positions only (`marketStats.ts:105`). The $1
  per merged pair is credited nowhere — holding pairs to episode end is
  strictly better in measured PnL. Strategies should not emit
  `merge_positions` in backtests expecting merge proceeds.
- Account-event cascade cap 100/drain; overflow is DROPPED with a warning
  (`StrategyRunner.ts:401-411`).
- Determinism: with delay=0 (default) a run is deterministic; same input →
  same stats (`runSingleMarket.ts:161-163`).

### Systematic biases of the simulator (evidence-quality model)
Optimistic: full-size maker fills on a touch-through (overstates maker volume
capacity); no market impact; free instant split/merge; costless perfect
settlement. Pessimistic: worst-queue (no fill at touch), taker fee on every
taker fill at 156 bps. Any protocol verdict must state which side of these
biases the strategy's edge lives on — an edge that depends on optimistic-side
mechanics (e.g. large maker fills in thin books) is suspect by construction.

## 5. Dataset (telonex, BTC 15m)

- Eligibility (single source of truth `src/db/telonexEligibility.ts:41-76`):
  conversion `status='done'` + dataset path present + `market_start_ms >=
  TELONEX_DATASET_ELIGIBLE_FROM_MS` (env default `2025-12-01T00:00:00Z`,
  `src/config/telonex.ts:8-30`) + `telonex_status='resolved'` +
  `result_id IS NOT NULL` (default `resolvedOnly`). Query ONLY through
  `src/db/telonexMarkets.ts` (repo rule).
- `market_start_ms` is ground truth for window time; `start_date_us` is NOT
  (`schema.ts:338-344`).
- "Eligible" ≠ "verified": `telonex:verify` is stateless and out-of-band; a
  wrong-book conversion can pass eligibility
  (`docs/datasets/telonex/overview.md:29-31, 132-144`).
- Telonex collector is an independent WS session from our recorder —
  different gap windows (`overview.md:170-171`).

## 6. Results storage & stats

- `backtest_runs` (`src/db/schema.ts:88-147`): identity + config only
  (`batch_uid` label non-unique; `submission_uid` unique; `cmd` permanent;
  `baseline_id`; `extending_at` lock). Stats live on segments.
- `backtest_run_markets` (`schema.ts:149-211`): per-market `pnl`,
  trade counts (maker/taker), `fees_paid`, entry prices, shares,
  `mergable_shares`, `cost`, `split_cost`, `final_outcome` (UP|DOWN),
  `skip_reason`, `intent_meta` json, execution meta incl. `commit_sha`.
  **Individual fills are NOT persisted** — per-trade analysis from the DB is
  impossible; `intent_meta` is the only strategy-authored channel.
- `backtest_run_segments` (`schema.ts:213-308`): one row per
  `(run, kind, key)`; kinds `all` (source of truth), `last_n`
  (500/1000/3000/6000 supersets), `daily`/`weekly`/`monthly` (UTC buckets,
  **capital resets per bucket** — no equity curve/compounding).
- Stats per segment (`src/backtest/stats/batchStats.ts:172-337`): pnlTotal,
  fees, win/lose averages and maxima, `evPerMarketPlayed`,
  `evPerMarketTotal`, `qualitySystem` (mean/std over all markets, skipped=0),
  `qualityTrade` (decisive markets), counts (played/won/lost/skipped/flat),
  winRate, streaks, durations. **NOT computed anywhere: drawdown, annualized
  Sharpe, profit factor, per-trade stats, return series.**
- `--extend <runId>`: appends markets to the same run row; segments deleted
  and recomputed over the union, bit-identical-to-fresh
  (`src/db/backtests.ts:788-1022`); inherits strategy/params/config; lock via
  `extending_at`.

## 7. Query & submission interfaces

- DB read helpers: `src/db/backtests.ts` (`getBacktestRunById:483`,
  `getBacktestRunByBatchUid:496`, `listSegmentsForRun:1036`,
  `getCoveredSlugsForRun:619`, ...); eligibility via `telonexMarkets.ts`.
- Dashboard API (Next.js, port 3051): `/api/batches/history`,
  `/api/batches/[batchUid]`, `/api/backtests/[id]` (incl. per-market
  `marketStats` array + failures), `/api/backtests/[id]/chunks?kind=`,
  `/api/backtests/[id]/coverage`, `/api/backtests/datasets`,
  `/api/leaderboard`, `/api/workers`, `/api/queues`, `/api/health`
  (`dashboard/src/app/api/`). No compare endpoint — use `baseline_id` +
  SQL over segments.
- Submission: default = BullMQ fleet (producer enqueues per-market jobs;
  aggregate worker persists). `--sequential` = in-process (smoke/debug only).
  Param sweeps via `src/backtest/generate-jobs.ts` (Cartesian grid).
- **Workers run committed code only**: jobs gate on the *producer's commit
  SHA*; a dirty tree blocks enqueue (escape hatch `BACKTEST_ALLOW_DIRTY=1` —
  never use it for evidence runs); per-market rows record `commit_sha`
  (`docs/backtest/extending-a-run.md:16-21`). The fleet's checkouts track
  `origin/main` (fleet-sync tooling, `tools/syncWorkerFleet.md`), so in
  practice research strategies must be committed and pushed to main before
  fleet runs; the `fable-protocol` branch cannot drive the fleet.
- Speed anchor (from ENGINE.md, not re-verified tonight):
  ~1.5s/market/worker-slot.

## 8. Hard NOT-supported list (design red lines)

1. No price-to-beat/strike in backtest — strategies cannot condition on it.
2. No trade stream in telonex-delta replay.
3. No market impact / queue position / partial maker fills in simulation.
4. No redeem lifecycle, gas, or settlement timing in backtest.
5. No drawdown or equity-curve metrics in persisted stats.
6. No per-fill persistence — `intent_meta` is the only extra channel.
7. No episode lifecycle hooks in the Strategy interface.
8. No fleet execution for non-main branches or dirty trees.
9. No `--order exchange_time` reordering in practice (heap keys ingest_seq
   first, `src/utils/minHeap.ts:16-21`) — moot single-file, but do not build
   on it.
10. No live external feeds in backtest (and therefore none allowed in
    research strategies, per charter parity).
