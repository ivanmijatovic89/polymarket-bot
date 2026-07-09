# Raw study notes — data + results pipeline (telonex, DB schema, stats, submission)

_Source: fresh-context Explore subagent, session 1. Input notes for
`engine/CAPABILITIES.md`; the synthesized doc is authoritative._

## 1. Telonex dataset

- A backtested telonex market = `telonex_markets` row ⋈ `telonex_market_conversions` row (converter `delta-typed`).
- `telonex_markets` (`src/db/schema.ts:345-416`): slug-derived `symbol`, `timeframe`, `marketStartMs` (`:356-358`); outcome fields `outcome0/1`, `assetId0/1`, `telonexStatus`, `resultId`, `settledAtUs` (`:366-372`); per-channel data ranges (`:379-390`). `start_date_us` NOT the window start (creation time, ~22h earlier, 100% of rows); `end_date_us` = slug epoch + timeframe (`schema.ts:338-344`; `telonexMarkets.ts:8-17, 81-84`).
- `telonex_market_conversions` (`schema.ts:444-466`): one row per `(market_id, converter)` unique (`:463`); `status`, `r2Url`, `localPath`, `sizeBytes`, `etag`.
- Converters: `delta` (raw_json, replays in recorded mode, not in `markets` table); `delta-typed` (typed columns, same book/price_change cadence, `--input-mode telonex-delta`); `paired` (orderbook_pair rows, carry-forward staleness on one side, `--input-mode telonex-paired`) (`overview.md:104-126, 146-156`; `backtest.md:17, 77-99`).
- Telonex collector is an independent WS session from our recorder — different reconnect gaps (`overview.md:170-171`); uses `book_snapshot_full` (`overview.md:162-169`).

### Eligibility (single source of truth `src/db/telonexEligibility.ts:41-76` via `telonexMarkets.ts:203-225`)
1. converter match; 2. `status='done'`; 3. dataset path non-empty (`local_path` for local; `r2_url` for r2 and local-or-download); 4. `market_start_ms >= fromMs` (default `TELONEX_DATASET_ELIGIBLE_FROM_MS`, env `TELONEX_DATASET_ELIGIBLE_FROM`, default `2025-12-01T00:00:00Z`, `src/config/telonex.ts:8-30`); 5. optional symbol/timeframe/toMs/slugs/excludeSlugs; 6. `resolvedOnly` default TRUE → `telonex_status='resolved'` AND `result_id IS NOT NULL` (`:71-74`).
- `result_id`: 0 → UP won, 1 → DOWN won (`backtest.md:136-148`). No Gamma fallback in telonex modes.
- **No "verified" gate** — `telonex:verify` is stateless/out-of-band; a converted file that reconstructs a wrong book still passes eligibility (`overview.md:29-31, 132-144`).
- Ordering `market_start_ms ASC`; default limit 1000; `latest` = last N via offset (`telonexMarkets.ts:236-253`).

## 2. backtest_runs schema (`src/db/schema.ts:88-147`)

- `id` PK; `batch_uid` (label, NOT unique, defaults to submissionUid); `submission_uid` (unique, auto-UUID, keys BullMQ flow); `status` enum completed|partial|failed; `strategy`; `params` json; `symbol`; `timeframe`; `input_mode`; `converter`; `read_from`; `slugs` json; `limit`; `random`; `latest`; `baseline_id`; `cmd` (permanent launch record); `comment`; `input_markets_total` (best-effort, `backtests.ts:412`); `markets_persisted`; `failures_count`; `capital_initial`; `extending_at` (extend lock); timestamps.
- Stats live on `backtest_run_segments`, NOT on runs (`schema.ts:83-87`; `run-statistics.md:8-29`).

## 3. backtest_run_markets (per-market rows, `schema.ts:149-211`)

- Identity: `run_id` FK cascade, `idx`, `market_id`, `slug`, `market_start_ms` (denormalized).
- Outcome: `final_outcome` UP|DOWN, `skip_reason` enum(`no_in_window_activity`).
- Economics: `pnl` dec(14,4), `trade_count`, `trade_as_maker`, `trade_as_taker`, `fees_paid`, `avg_entry_price_up/down`, `up_shares`, `down_shares`, `mergable_shares`, `cost`, `split_cost`, `intent_meta` json.
- Execution meta: `machine_id`, `worker_child_id`, `started_at_ms`, `finished_at_ms`, `duration_ms`, `events_processed`, `events_by_type`, `commit_sha`.
- **No individual fills persisted** — counts only. No volume field. Unique `(run_id, idx)` and `(run_id, slug)`.
- Failures: `backtest_run_failures` (`schema.ts:310-327`): run_id, job_id, idx, slug, reason.

## 4. backtest_run_segments (`schema.ts:213-308`; `backtest-segments.md`)

- One row per `(run_id, segment_kind, segment_key)`. Kinds: `all` (source of truth), `last_n` (buckets 500/1000/3000/6000; supersets, emitted only when total ≥ N), `daily`/`weekly`/`monthly` (UTC calendar buckets; **capital resets per bucket** — no carry-over).
- Carries full BatchStatsFields + `from_ms`/`to_ms` + `segment_ord` + duration columns.
- No train/validation flag; time-slicing via calendar buckets + last_n + cross-run compare on fixed `segment_key` (index `(segment_kind, segment_key)`).
- All write paths sort markets by `market_start_ms` ASC first (streaks order-sensitive) (`backtestSegments.ts:116-118, 172`).

## 5. Stats computed (`src/backtest/stats/`)

- Per market (`marketStats.ts:75-201`): pnl, tradeCount, maker/taker counts, feesPaid, avgEntryPriceUp/Down, shares, mergableShares, cost, splitCost, intentMeta, skipReason, execution meta.
- Per segment (`batchStats.ts:172-337`): capitalInitial/Final; pnlTotal, totalFeesPaid, pnlAvgWin/Lose, pnlMaxWin/Lose; **evPerMarketPlayed = pnlTotal/marketsPlayed; evPerMarketTotal = pnlTotal/marketsTotal**; **qualitySystem = mean/std of all market pnls (skipped=0); qualityTrade = mean/std over decisive nonzero markets** (nullable, `batchStats.ts:160-167`); market counts (total, skipped, noInWindowActivity, flatWithTrades, played, won, lost); winRate; trade totals; streaks (maxWin/maxLose count + pnl, maxSkipped); duration stats.
- **NOT computed:** max drawdown / equity curve (capital resets per calendar bucket); annualized Sharpe/Sortino; per-trade stats; profit factor; return series.

## 6. Querying results

- DB helpers (`src/db/backtests.ts`): `listBacktestRunSummariesByBatchUid` (:220), `getBacktestRunSummaryBySubmissionUid` (:238), `getBacktestRunById` (:483), `getBacktestRunByBatchUid` (:496, throws if ambiguous), `getCoveredSlugsForRun` (:619), `getCoveredRangeForRun` (:637), `getRunForExtension` (:677), `listSegmentsForRun` (:1036). Telonex eligibility only via `telonexMarkets.ts`.
- Dashboard API (Next.js, force-dynamic):
  - `GET /api/batches/history?limit&strategy&symbol&status` — runs + `all`-segment stats.
  - `GET /api/batches/filter-options`, `/api/batches/active`, `/api/batches/[batchUid]` (runs + active).
  - `GET /api/backtests/[id]` — run summary + all-segment stats + executionSummary + **marketStats per-market array** + failedMarkets.
  - `GET /api/backtests/[id]/chunks?kind=` — segments.
  - `GET /api/backtests/[id]/coverage` — eligible vs covered, gaps, daily buckets (`coverage.ts:88-251`).
  - `GET /api/backtests/datasets`, `/api/leaderboard`, `/api/workers`, `/api/queues`, `/api/health`.
- No dedicated compare endpoint; use `baseline_id` + SQL over segments on fixed `segment_key`.

## 7. Extension (--extend)

- Same run row; `id`/`batch_uid`/`submission_uid`/`cmd` preserved. Per-market rows appended (idx continues); ALL segments deleted + rewritten over union sorted chronologically — bit-identical-to-fresh invariant (`backtests.ts:788-1022, 977-1007`; `extending-a-run.md:283-289`).
- Inherits strategy/params/symbol/timeframe/input_mode/converter/read_from; passing them errors. Direction default backward (older); `--latest` forward.
- `extending_at` lock; partial-overlap slugs → hard error; full overlap → no-op. Telonex-only (recorded runs rejected).

## 8. Submission paths

- Default: BullMQ flow — producer enqueues per-market child jobs; worker daemons (multi-process supervisors) consume; aggregate worker finalizes MySQL rows (`parallelization.md:5-6, 101-164`). Requires Redis + workers.
- `--sequential`: in-process, no Redis; smoke/parity/debug only.
- Sweeps: `src/backtest/generate-jobs.ts` — JSON grid → Cartesian product of backtest commands under `generated/backtest-jobs/` (`generate-backtest-jobs.md`).
- **Workers run committed code only**: producer records commit SHA; dirty tree blocks enqueue (`BACKTEST_ALLOW_DIRTY=1` override); workers self-update and track `origin/main` (`extending-a-run.md:16-21`; `parallelization.md:144-148`; `tools/syncWorkerFleet.md`). ⇒ a non-main branch cannot use the fleet.
- Speed anchor (from ENGINE.md, unverified tonight): ~1.5s/market per worker slot.

## Skeptical gaps

- Eligibility ≠ verified correctness of converted files.
- No drawdown/equity metrics persisted anywhere.
- Trade-level analysis impossible from DB (no fills persisted).
- Calendar segments reset capital — no compounding representation.
- `input_markets_total` best-effort only.
