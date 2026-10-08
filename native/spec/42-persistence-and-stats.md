# 42 — Persistence and statistics

Purpose: define every MySQL change the native engine needs (engine provenance,
ModelConfig, seed, candidate-group columns, the exchange-rules snapshot table
and its resolver, per-market rules and fee-era provenance, failure classes,
artifact and conversion versioning), how migrations are written and when they
may be applied under the branch policy, which derivations stay in TypeScript,
how per-market values are quantized at the output boundary, where ledgers and
calibration sets are stored, and how storage grows. The Rust engine emits
exactly the per-market contract TS consumes today
(21-job-and-output-contract.md); everything after that boundary stays TS.
Binding inputs: D08, D09, D11, D13, D15, D21 in 02-decisions.md.

## 1. Evidence

| Fact | Evidence |
|---|---|
| `backtest_runs` has no engine, profile, engine version, seed or model columns; extend and the simulator re-parse `cmd` | `src/db/schema.ts:96-181`; `src/cli/backtest.ts:745-757`; `src/backtest/simulator/resolveMarket.ts:98-111` |
| Per-market rows: money `decimal(14,4)`, avg prices `decimal(10,6)`, shares `decimal(18,6)`, `skip_reason` enum with one value | `schema.ts:199-214` |
| Segment kinds are an enum `all`, `last_n`, `daily`, `weekly`, `monthly` | `schema.ts:250-277`; `src/backtest/stats/backtestSegments.ts:24` |
| One run is inserted in one transaction; one bad value loses the whole run | `src/db/backtests.ts:403-501` |
| `insertBacktestRun` throws if the submission uid exists | `backtests.ts:382-395` |
| Decimals are written as `String(value)` | `backtests.ts:139-141` |
| TS rounds money and shares to 2 dp, avg prices to 4 dp with `Math.round` | `src/backtest/stats/marketStats.ts:186-198` |
| Extension recomputes segments over the chronologically sorted union of DB rows | `backtests.ts:1039-1045` |
| Migrations since 0030 are hand-written SQL plus a hand-appended journal entry; `db:generate` is broken | `drizzle/0034_strategy_artifacts.sql`, `drizzle/0038_backtest_feed_eligibility.sql`, `drizzle/meta/_journal.json` (last idx 40) |
| Drizzle's MySQL migrator applies only migrations whose `when` is later than the newest applied one | `node_modules/drizzle-orm/mysql-core/dialect.js:39-55` |
| Dashboard keeps its own mirror of the backtest tables | `dashboard/src/lib/schema.ts:27-200` |
| `telonex_markets` has no tick, min size, fee schedule or taker-delay data; conversions have no format version and no sha256 | `schema.ts:380-476`, `:504-526` |
| `strategy_artifacts` has no kind, target, toolchain or source hash; it already has `engine_commit`, `format_version`, `built_with` | `schema.ts:673-701` |
| Siblings hold read-only R2 keys and no `DATABASE_*` | `docs/backtest/fleet/overview.md:114-131` |
| A Gamma market body is about 6 KB | `src/research-data/fixtures/july-01-merge.json` (`market.raw_json`) |
| Sizes (read-only query, 2026-10-08): `backtest_run_markets` ≈ 5.73 M rows, 7.76 GB, ≈ 1.42 KB/row; 2.14 M rows written in the last 7 days; average `intent_meta` 279 B; MySQL 8.4.10 | `information_schema.tables`, `COUNT(*)` on `finished_at_ms` |

## 2. Migration rules

1. Migrations MUST follow the repo convention: hand-written
   `drizzle/00NN_<descriptive_name>.sql` with backtick identifiers and
   `--> statement-breakpoint` separators, plus a hand-appended entry in
   `drizzle/meta/_journal.json` (`idx`, `version: "5"`, `when`, `tag`,
   `breakpoints: true`), with `src/db/schema.ts` updated in the same commit.
   Do not try to repair `db:generate`.
2. Every column used by a dashboard query MUST be mirrored in
   `dashboard/src/lib/schema.ts` in the same PR.
3. Column additions to large tables MUST use `ALGORITHM=INSTANT` (supported on
   MySQL 8.4; precedent `drizzle/0038_backtest_feed_eligibility.sql`,
   `0039_recorder_v4_replay_provenance.sql`). No index and no foreign key may be
   added to `backtest_run_markets` (a 7.8 GB rebuild). Before adding instant
   columns the author MUST check
   `INFORMATION_SCHEMA.INNODB_TABLES.TOTAL_ROW_VERSIONS` for the table and stay
   below the InnoDB instant row-version limit. Adding members at the end of an
   `ENUM` is also instant and is the only allowed enum change.
4. **Branch phase (before gate 2).** Branch migrations MUST NOT be applied to
   the shared production schema. If a branch migration with a later `when`
   were applied there, a main migration with an earlier `when` merged afterwards
   would be skipped silently by the migrator (`dialect.js:39-55`). Branch-phase
   runs write to a separate schema (e.g. `<DATABASE_NAME>_native_dev`) created
   by a branch-only script: `CREATE TABLE … LIKE` for every table, a read-only
   copy of the catalog tables needed for selection (`telonex_markets`,
   `telonex_market_conversions`, `recorder_v4_recordings`, `strategy_artifacts`,
   `__drizzle_migrations`), empty `backtest_*` tables, then the branch
   migrations. 40-fleet-integration.md §13 points the branch producer at it.
5. **At the gate-2 merge** the branch migrations are renumbered to the next free
   `idx` on main and given `when` = merge time (later than every existing entry),
   then applied to production once, manually on the producer as today
   (`docs/backtest/fleet/overview.md`, "Run database schema migrations manually").
6. `AGGREGATE_JOB_PROTOCOL_VERSION` (`src/backtest/jobTypes.ts:60`, today 6) MUST be
   bumped when `insertMeta` gains the provenance fields of §3, so an old
   aggregator fails loudly instead of dropping them.

## 3. Migrations

Numbers are placeholders; final numbers are assigned at merge (§2.5). Before
gate 2 these migrations exist only in the branch dev schema (§2.4); they reach
production with the gate-2 merge, and M3 starts by using them (01). §3.9
additionally ships with the converter change of 15 I-14.

### 3.1 `backtest_runs` engine provenance (D09, D12)

```sql
ALTER TABLE `backtest_runs`
  ADD COLUMN `engine` enum('ts','native-ts-compat','native-realistic') NOT NULL DEFAULT 'ts',
  ADD COLUMN `engine_version` varchar(32),
  ADD COLUMN `engine_commit` varchar(40),
  ADD COLUMN `model_config` json,
  ADD COLUMN `seed` bigint unsigned,
  ADD COLUMN `producer_commit_sha` varchar(40),
  ADD COLUMN `producer_dirty` boolean,
  ADD COLUMN `ledger_uri` varchar(500),
  ALGORITHM=INSTANT;
--> statement-breakpoint
CREATE INDEX `idx_backtest_runs_engine_created_at` ON `backtest_runs` (`engine`, `created_at`);
```

Before applying, a query MUST confirm that no existing row references a native
artifact (`strategy_artifact_meta->>'$.r2Url' LIKE '%/native/%'`); any such row
is set to `native-ts-compat` in the same migration.

### 3.2 `backtest_runs` candidate groups (D13)

```sql
ALTER TABLE `backtest_runs`
  ADD COLUMN `candidate_group_uid` varchar(255),
  ADD COLUMN `candidate_index` smallint unsigned,
  ADD COLUMN `candidate_group_size` smallint unsigned,
  ADD COLUMN `candidate_label` varchar(100),
  ALGORITHM=INSTANT;
--> statement-breakpoint
CREATE INDEX `idx_backtest_runs_candidate_group` ON `backtest_runs` (`candidate_group_uid`, `candidate_index`);
```

### 3.3 `exchange_rules_snapshots` (D21, 11 §13)

The table implements 11 §13.1: append-only, one row per fetch and source,
several rows per market.

```sql
CREATE TABLE `exchange_rules_snapshots` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `condition_id` varchar(66) NOT NULL,
  `slug` varchar(100) NOT NULL,
  `market_start_ms` bigint NOT NULL,
  `source` enum('gamma','clob','v4_bootstrap','live') NOT NULL,
  `phase` enum('pre_start','post_start') NOT NULL,
  `fetched_at_ms` bigint NOT NULL,
  `last_fetched_at_ms` bigint NOT NULL,
  `raw_sha256` char(64) NOT NULL,
  `raw_json` mediumtext NOT NULL,
  `parser_version` int NOT NULL,
  `tick_micros` int,
  `min_size_micros` bigint,
  `fees_enabled` boolean,
  `fee_type` varchar(64),
  `fee_schedule` json,
  `taker_delay_enabled` boolean,
  `seconds_delay` int,
  `min_order_age_s` int,
  `neg_risk` boolean,
  `market_version` varchar(8),
  `accepting_orders_ms` bigint,
  `parse_warnings` json,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `exchange_rules_snapshots_id` PRIMARY KEY(`id`),
  CONSTRAINT `uniq_exchange_rules_snapshots_fetch` UNIQUE(`condition_id`,`source`,`phase`,`raw_sha256`)
);
--> statement-breakpoint
CREATE INDEX `idx_exchange_rules_snapshots_slug` ON `exchange_rules_snapshots` (`slug`);
--> statement-breakpoint
CREATE INDEX `idx_exchange_rules_snapshots_start` ON `exchange_rules_snapshots` (`market_start_ms`);
```

Column rules:

- `raw_json` holds the verbatim response body (or, for `v4_bootstrap`, the
  frozen `RecordedMarket.rawJson` text) as text, not a MySQL `json` value,
  because MySQL re-serializes `json` and the body must stay byte-exact.
  `raw_sha256` is the sha256 of those bytes.
- `phase` is `pre_start` iff `fetched_at_ms < market_start_ms` (11 §13.1).
- Parsed columns hold what this one source reported, parsed by the parser of
  `parser_version`; NULL means the source did not carry the field (for example
  Gamma has no `itode`, V4 bootstrap has no CLOB fields). Prices and sizes are
  fixed-point micros (10-domain-model.md). `fee_schedule` is the parsed
  schedule object (`exponent`, `rate`, `takerOnly`, `rebateRate`).
  `parse_warnings` lists fields that were present but unparseable.
- Dedupe: an identical body from the same source in the same phase updates
  only `last_fetched_at_ms` (`INSERT … ON DUPLICATE KEY UPDATE
  last_fetched_at_ms = GREATEST(…)`). The phase is part of the key, so a
  pre-start and a post-start fetch are never merged.
- Writers are TS only: the pre-start capture (40 §16), the historical Gamma
  backfill (11 §13.2), Recorder V4 catalog ingestion, and TS ingestion of
  live-runtime journals (50-live-runtime.md). The binary never touches the DB.
- Re-parsing with a new `parser_version` updates the parsed columns in place;
  `raw_json` never changes.

### 3.4 Resolver: `src/db/exchangeRules.ts`

1. All reads and writes of `exchange_rules_snapshots` MUST go through this one
   module, following the single-source rule CLAUDE.md sets for
   `src/db/telonexMarkets.ts`.
2. `resolveMarketRules(conditionId, marketStartMs, rulesVersion)` MUST
   implement 11 §13.3 RS1-RS4 exactly: per field the newest `pre_start` value
   (by `last_fetched_at_ms`); for time-invariant fields only, else the newest
   `post_start` value; the initial tick only from `pre_start`; Gamma-vs-CLOB
   conflicts per RS3 (CLOB wins tick, minimum size, fee parameters, delay flag;
   Gamma wins `version`, `negRisk`, `feeType`), each disagreement logged and
   counted; then the dated fallback. It returns the job's rules envelope
   (21 §7): the resolved initial rules, `rulesSource`
   (`snapshot` | `partial` | `fallback`, RS4), a per-field provenance map, the
   ids of the rows used, and `rulesVersion`.
3. A golden test MUST cover: pre-start only; post-start only (tick not taken);
   Gamma and CLOB disagreeing on each RS3 field; an identical body seen in both
   phases; a body that reappears after a different one; no rows (fallback).
4. The pre-gate-2 JSONL files of 40 §16.6 are imported by
   `rules:import-jsonl` through the same module, idempotently.

### 3.5 `backtest_run_markets` rules and fee-era provenance (D21, 11 FT1, 11 §14)

```sql
ALTER TABLE `backtest_run_markets`
  ADD COLUMN `rules_source` enum('snapshot','partial','fallback'),
  ADD COLUMN `rules_snapshot_ids` json,
  ADD COLUMN `fee_era` varchar(8),
  ADD COLUMN `unverified_rules` json,
  ALGORITHM=INSTANT;
```

No index, no foreign key (§2.3). All four are NULL for `ts` and
`native-ts-compat` rows, which use the fixed rules of 11 §4. For
`native-realistic` rows:

| Column | Source | Value |
|---|---|---|
| `rules_source` | the job's rules envelope, echoed by the engine (21 §10) | RS4 value; identical for every candidate of a market |
| `rules_snapshot_ids` | resolver (§3.4), carried by the job | JSON array of `exchange_rules_snapshots.id` used, `[]` for `fallback`. With the append-only table this reproduces the per-field provenance. |
| `fee_era` | engine output `feeEra` (11 FT1) | fee row id of 11 §5.3 (`F0`-`F3`, later rows by `rulesVersion`); identical for every candidate of a market |
| `unverified_rules` | engine output `unverifiedRules` (11 S2, §14) | JSON array of verification-registry rule ids that this candidate's orders touched, `[]` when none; per candidate |

21 §11 MUST add `feeEra` and `unverifiedRules` to `EngineMarketOutput` with
the egress validation of 21 §19 (§9). The insert path writes them from
`MarketStats` fields of the same names.

**Fee-era aggregation (D21 "no pooling across fee eras").** A realistic run
over Dec 2025-Oct 2026 crosses rows F0-F3. Until the user answers Open
question 1, the rule is:

1. The producer computes each selected market's fee era from
   `market_start_ms` and the fee rows of the run's `rulesVersion`. A
   `native-realistic` run whose markets span more than one era is refused with
   a message naming the eras and the `--from-ms` boundary, unless
   `--allow-mixed-fee-eras` is given. Most runs (`--latest --limit 1000`) stay
   inside one era and are unaffected.
2. With `--allow-mixed-fee-eras`, segments gain kind `fee_era` (one segment per
   era, key = era id), the run's `fee_eras` lists the eras present (§3.8), and
   the dashboard shows a "mixed fee eras" badge. Comparison surfaces (§6.2)
   flag comparisons between runs whose `fee_eras` differ.
3. `--extend` recomputes `fee_eras` and the `fee_era` segments from the union
   of market rows; it refuses to add a new era to a single-era run unless the
   parent was created with `--allow-mixed-fee-eras`.

```sql
ALTER TABLE `backtest_run_segments`
  MODIFY COLUMN `segment_kind` enum('all','last_n','daily','weekly','monthly','fee_era') NOT NULL,
  ALGORITHM=INSTANT;
```

`computeBacktestSegments` (TS) gains the `fee_era` kind, computed from the
persisted `fee_era` column, so the §7.2 invariant holds.

### 3.6 `backtest_run_failures` failure class

```sql
ALTER TABLE `backtest_run_failures`
  ADD COLUMN `failure_class` varchar(32),
  ADD COLUMN `failure_detail` varchar(64),
  ALGORITHM=INSTANT;
```

Closed vocabulary for `failure_class`, validated in TS: the error classes of
20-binary-protocol.md §4 except `canceled` (never persisted), plus three
aggregator classes:

| Value | Written for |
|---|---|
| `runtime`, `invalid_input`, `data_missing`, `data_defect`, `timeout`, `invalid_output`, `strategy_fault`, `engine_fault`, `killed` | native job or candidate failures (20 §4; shim mapping in 40 §8.1) |
| `market_skip` | null-stats skips (`no_slug`, `no_resolution`, `unresolved_outcome`, `no_activity`, `incomplete_capture`; 21 §13), both engines |
| `missing_child_result` | a child with no result (`aggregateProcessor.ts:138-147`), both engines |
| `invalid_market_stats` | a row rejected by the aggregator's DB-contract check (21 §19), both engines |

`failure_detail` holds the detail or cause code (14 §10 causes such as
`upstream_hole`, shim details such as `oom_budget`, `echo_mismatch`). Legacy
rows and TS-engine job failures keep both NULL. `reason` keeps the full
one-line text.

### 3.7 `strategy_artifacts` native columns (31 §6.2)

```sql
ALTER TABLE `strategy_artifacts`
  ADD COLUMN `kind` enum('js','native') NOT NULL DEFAULT 'js',
  ADD COLUMN `variant` enum('standard','real-orders'),
  ADD COLUMN `parent_sha256` varchar(64),
  ADD COLUMN `target` varchar(64),
  ADD COLUMN `rustc` varchar(64),
  ADD COLUMN `engine_version` varchar(32),
  ADD COLUMN `engine_source_hash` char(64),
  ADD COLUMN `engine_dirty` boolean,
  ADD COLUMN `sdk_version` varchar(32),
  ADD COLUMN `protocol_version` int,
  ADD COLUMN `source_hash` char(64),
  ADD COLUMN `lock_hash` char(64),
  ADD COLUMN `build_profile` varchar(32),
  ADD COLUMN `package_name` varchar(128),
  ADD COLUMN `bin_name` varchar(128),
  ADD COLUMN `engine_rel_path` varchar(255),
  ADD COLUMN `capabilities` json,
  ADD COLUMN `params_schema` json,
  ADD COLUMN `rebuilt_from_sha256` varchar(64),
  ALGORITHM=INSTANT;
--> statement-breakpoint
CREATE INDEX `idx_strategy_artifacts_source_hash` ON `strategy_artifacts` (`source_hash`, `target`, `variant`, `build_profile`);
--> statement-breakpoint
CREATE TABLE `strategy_artifact_builds` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `artifact_sha256` varchar(64) NOT NULL,
  `kind` enum('publish_observation','verified_rebuild') NOT NULL,
  `host` varchar(64) NOT NULL,
  `built_at_ms` bigint NOT NULL,
  `built_sha256` varchar(64) NOT NULL,
  `matches` boolean NOT NULL,
  `toolchain` json NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `strategy_artifact_builds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_strategy_artifact_builds_sha` ON `strategy_artifact_builds` (`artifact_sha256`);
```

Semantics, dedupe and the live trust gate are in 31-artifacts-build-publish.md
(§5.5 variants, §5.6 dedupe on the index above, §7.4 rebuilds). `variant` is
NULL for `js` rows. `built_with` (`schema.ts:690`) widens its TS type to
`{ rustc, macosSdk, ld, cc, host }` for native rows; `engine_commit` and
`format_version` keep their columns with the meanings of 31 §6.2.

### 3.8 `backtest_runs` fee eras

```sql
ALTER TABLE `backtest_runs` ADD COLUMN `fee_eras` json, ALGORITHM=INSTANT;
```

JSON array of the distinct `fee_era` values of the run's market rows,
recomputed by TS on insert and extend; NULL for `ts` and `native-ts-compat`.

### 3.9 `telonex_market_conversions` format version and sha256 (15 I-14)

```sql
ALTER TABLE `telonex_market_conversions`
  ADD COLUMN `format_version` int,
  ADD COLUMN `sha256` char(64),
  ALGORITHM=INSTANT;
```

Both are filled at conversion time and copied by the producer into the job's
`input` (21 §4); the reader refuses unknown versions (15 I-13). Until this
lands, the producer sends version 1 and `sha256: null` (15 I-14).

## 4. Write rules

| Column | Written by | Value |
|---|---|---|
| `engine` | producer | `ts` for registry and JS-artifact strategies; `native-ts-compat` / `native-realistic` from the run's profile. The shim checks the binary's echoed profile per job (40 §5.2). |
| `engine_version`, `engine_commit` | producer | from `describe` at submit; NULL for `ts` |
| `model_config` | producer | the exact canonical ModelConfig JSON the jobs carried (schema in 21 §6, versioned by `modelConfigVersion`); required for native rows, NULL for `ts` rows in v1 |
| `seed` | producer | the run seed. The producer draws it in `[0, 2^53 − 1]` so TS can hold it as a number; ModelConfig carries it as a decimal string (21 §6, N2) and the insert path asserts that both are equal. Required for native rows. |
| `producer_commit_sha`, `producer_dirty` | producer | for every new run (D12 provenance) |
| `ledger_uri` | aggregate host | R2 prefix of the opt-in ledger (§7.5) |
| `candidate_*` | group aggregate | 41-candidate-groups.md §9 |
| `fee_eras` | aggregator, extend | §3.8 |
| `rules_source`, `rules_snapshot_ids`, `fee_era`, `unverified_rules` | from the job and the binary output, through the shim | §3.5 |
| `failure_class`, `failure_detail` | aggregator | §3.6 |

`engine` defaults to `ts`, so every existing TS writer (aggregator, research run
synthesis, `src/cli/research/insert-in-db-backtest-feature-tests.ts`) keeps
working unchanged. The insert-time validator (`coerceMarketStatsRow`,
`backtests.ts:186-198`) MUST also check closed vocabularies and numeric ranges
for native rows as a last line of defense; the per-market check in the shim
(40 §5.2) is what turns a bad value into one failure row instead of a failed
transaction.

## 5. Extend with provenance

1. For rows with a non-NULL `model_config`, `--extend` MUST build its jobs from
   the row's `engine`, `model_config`, `seed`, `strategy_artifact_sha256` and
   normalized `params`, not from parsing `cmd`. Rows without `model_config`
   (all TS rows) keep today's `cmd` parsing (`src/cli/backtest.ts:745-757`).
2. Extend MUST refuse when the artifact sha or engine version is blocklisted
   (40 §11), when the producer does not support the row's
   `modelConfigVersion`, or when the fee-era rule of §3.5 forbids the new
   markets.
3. Extend never modifies the parent's provenance columns, as it never modifies
   `cmd` today; it recomputes only the derived `fee_eras` and segments.
   `applyExtensionToRun` and its union recompute (`backtests.ts:838-1088`,
   `:1039-1045`) stay unchanged apart from the `fee_era` segment kind.
4. Extension of a candidate run: 41-candidate-groups.md §9.3.

## 6. Dashboard and tooling

1. Run views show an engine badge (`ts`, `native ts-compat`, `native realistic`)
   and `engine_version`; run detail shows `model_config`; realistic runs show
   the share of markets by `rules_source` and any `unverified_rules`, and the
   mixed-fee-era badge (§3.5).
2. Every comparison surface (baseline comparison, batch comparison, directional
   game, `backtest:verify-diff`) MUST flag or refuse comparisons between
   different `engine` values; `verify-backtest-diff` refuses unless
   `--allow-cross-engine` is passed. Protocol evaluators SHOULD filter by
   `engine`.
3. Runs whose artifact sha or `engine_version` is on the blocklist are flagged.
4. The Market Simulator refuses rows with `engine <> 'ts'` with a clear message
   (D10), replacing the silent registry fallback at `resolveMarket.ts:106`.
5. Group view and leaderboard de-duplication: 41-candidate-groups.md §11.

## 7. What stays in TypeScript

### 7.1 TS-owned derivations (MUST NOT be ported to Rust)

| Derivation | Where |
|---|---|
| `market_start_ms = slugTs(slug)`, also on extend | `aggregateProcessor.ts:169`, `backtests.ts:449` |
| `computeBatchStats` (only `capital_initial` is persisted from it) | `src/backtest/stats/batchStats.ts`, `backtests.ts:433` |
| `computeBacktestSegments` (`all`, `last_n` 500/1000/3000/6000, daily, weekly, monthly, `fee_era`; sorted by `market_start_ms`) | `src/backtest/stats/backtestSegments.ts` |
| Wall clock = `unionBusyMs` of per-market intervals, shared with the dashboard | `src/backtest/stats/wallClock.ts`, `batchStats.ts:286-295` |
| `status`, `markets_persisted`, `failures_count`, `input_markets_total`, `fee_eras` | `backtests.ts:403-430` |
| Failure rows (null stats, failed and missing children) and their `failure_class` | `aggregateProcessor.ts:104-147` |
| Extension merge and lock | `backtests.ts:803-1088` |
| `rebuild-backtest-segments`, `walkForwardRank`, research run synthesis | `src/cli/rebuild-backtest-segments.ts`, `src/backtest/stats/walkForwardRank.ts`, `src/cli/research/insert-in-db-backtest-feature-tests.ts` |
| Market resolution (shipped in the job; Rust only deserializes it) | `src/backtest/stats/marketResolution.ts`, `telonexMarketResolution.ts` |
| Exchange-rules resolution (shipped in the job) | `src/db/exchangeRules.ts` (§3.4) |
| Execution metadata and `recorderV4Capture` stamping | the shim, 40 §7.1 |
| Group aggregation and per-candidate persistence | 41-candidate-groups.md §7 |

### 7.2 Invariant

Segments MUST stay recomputable from `backtest_run_markets` rows alone. Every
input of batch and segment stats (`pnl`, `fees_paid`, `trade_count`,
`trade_as_maker`, `trade_as_taker`, `skip_reason`, `slug` → `market_start_ms`,
`duration_ms`, `started_at_ms`, `finished_at_ms`, `fee_era`) is a persisted
per-market column; a new stats input needs a per-market column first.

### 7.3 Quantization at the output boundary (D08)

| Field | Emitted precision | Column | Rule |
|---|---|---|---|
| `pnl`, `feesPaid`, `cost`, `splitCost` | 2 dp | `decimal(14,4)` | half away from zero, applied once to the exact fixed-point value |
| `upShares`, `downShares`, `mergableShares` | 2 dp | `decimal(18,6)` | same |
| `avgEntryPriceUp`, `avgEntryPriceDown` | 4 dp or `null` | `decimal(10,6)` | rounded once from the exact rational `Σ(price·qty) / Σqty` in `i128`, never through an intermediate 1e6 value |
| counts (`tradeCount`, `tradeAsMaker`, `tradeAsTaker`, `eventsProcessed`) | integer | `int` | — |

Rules:

1. Rust quantizes fixed-point integers (10-domain-model.md) exactly once per
   field and serializes the result directly as JSON decimal text: no `f64`
   round trip, no exponent notation, no negative zero.
2. Emitted precision is at or below the column scale, so a fresh run (doubles
   parsed from the JSON) and an extended run (doubles parsed from DB decimals
   written with `String(value)`, `backtests.ts:139-141`) present identical values
   to the segment code.
3. Known intended difference: JS `Math.round` sends negative ties toward +∞
   (`marketStats.ts:186-198`); Rust sends them away from zero. Recorded in
   PARITY.md (D08); parity is judged on unrounded trace values
   (60-verification.md).
4. Before emission Rust checks ranges: `|pnl|`, `|cost|`, `feesPaid`,
   `splitCost` < 10^10; shares < 10^12; average prices in `[0, 1]`. A violation
   is `invalid_output` (20 §4). NaN and infinity cannot occur in fixed point.
5. Batch and segment stats keep classifying won, lost and flat by the sign of
   the rounded `pnl` (`batchStats.ts:194-235`), unchanged.
6. The per-market allowance (`startingCapital`, engine-enforced, in
   `model_config`) and the aggregate `INITIAL_CAPITAL` (`capital_initial`, batch
   and segment stats only, `src/cli/backtest.ts:737`) stay separate.

### 7.4 Live and paper results (D11)

1. Live and paper windows are stored as ordinary runs with `input_mode` `live`
   or `paper` and `engine = 'native-realistic'`. TS ingests the live runtime's
   per-window `market_result` (50-live-runtime.md): the first window through
   `insertBacktestRun`, later windows through `applyExtensionToRun`, so
   segments stay recomputable and every live market is comparable per slug
   with its Recorder V4 backtest. `input_mode` is a `varchar(32)`; no migration
   is needed.
2. `strategy_artifact_sha256` MUST hold the `standard` artifact sha (31 §5.5):
   the binary itself for paper, the `parent_sha256` of the `real-orders`
   variant for live. This is the sha the fleet backtests carry, so per-slug
   comparison joins on it.
3. The runtime provenance goes to `strategy_artifact_meta.runtime` (the
   existing JSON column; a TS type widening, no migration):
   `{ mode, variant, binarySha256, configSha256, instanceId, sessionIds }`.
   `model_config` stays exactly the canonical ModelConfig.

### 7.5 Ledger (D11)

The opt-in per-order and per-fill ledger is gzipped JSONL in R2, record layout
in 22-trace-ledger-journal.md §4.2. Transport (this document owns it; 22 §4.1
must match, 40 §18):

1. The binary writes the ledger to its job temp dir (`outputs.ledgerPath`).
   The shim attaches it to the job result as base64 gzip, per market-candidate,
   capped at 4 MiB. Above the cap the shim drops that ledger and marks the
   candidate result `ledgerDropped: 'too_large'`.
2. The aggregate host uploads each ledger to
   `backtest-ledgers/<submissionUid>/<slug>.jsonl.gz` (in a group, under each
   candidate's own `submissionUid`) plus a `manifest.json` listing counts and
   dropped or truncated slugs, skip-if-exists, before the run's DB transaction,
   so a failed upload retries the idempotent aggregate cleanly. It then writes
   `ledger_uri`.
3. Market workers never get R2 write credentials (siblings hold read-only R2
   keys, `docs/backtest/fleet/overview.md:114-131`).
4. Calibration rejects runs with dropped or truncated ledgers (22 §4.2).
5. Redis volume: the producer refuses `--ledger` when markets × candidates
   exceeds 10,000 unless `--max-ledger-markets` is raised; M3 measures typical
   ledger sizes and revises the bound.

### 7.6 Calibration sets (51 §13, 13 §6.8)

1. A calibration set is a committed JSON file
   `native/calibration/<calibrationId>.json`, validated by a schema in the
   contract bundle (21 §3). It holds the 51 §13 fields: id, date range, live
   host, stack (binary sha256 and source hash), input mode, validity envelope
   (sizes, prices, timeframes), sample sizes, CIs, the fitted parameters,
   per-metric verdicts, the pre-registration commit and deviations. The
   placeholder set `uncalibrated-2026-10` (13 §6.8) is the first file.
2. The producer resolves `execution.latency.calibrationId` into explicit
   component distributions in the job (13 §6.8) and refuses an unknown id.
   Runs reference the set through `model_config`
   (`$.execution.latency.calibrationId`).
3. No DB table in v1. A read-only index table MAY be added later if the
   dashboard needs to list sets; the files stay the source of truth. The
   gate-3 report lives under `native/reports/`.

## 8. Storage growth and the later retention script

Measured on 2026-10-08 (read-only): `backtest_run_markets` ≈ 5.73 M rows and
7.76 GB (≈ 1,088 B data + 333 B index per row), growing by ≈ 2.14 M rows
(≈ 3.0 GB) per week; `backtest_run_segments` 123 k rows / 49 MB;
`backtest_runs` 7.7 k rows / 60 MB.

Projection:

| Scenario | Rows | Size |
|---|---|---|
| one 100-candidate × 1,000-market group | 100 k | ≈ 142 MB |
| one 100-candidate × 5,523-market group | 552 k | ≈ 785 MB |
| today's weekly volume at ~6x throughput, same fleet utilization | ≈ 13 M / week | ≈ 18 GB / week |
| `exchange_rules_snapshots`: 384 BTC 5m/15m markets per day × (Gamma + CLOB) pre-start rows, deduplicated, ≈ 6 KB each | ≈ 770 / day | ≈ 4.6 MB / day, ≈ 1.7 GB / year |

The new per-market columns (§3.5) add about 40 bytes per realistic row (none
for `ts` and ts-compat rows). Per-market CPU and RSS are deliberately not
persisted.

Required now:

1. The DB host's free disk and `backtest_run_markets` size and weekly growth MUST
   be visible (dashboard health page or `fleet:status`) with a warning threshold.
2. The M6 benchmark reports rows and bytes written per run.

Constraints for the later retention script (D15: rows for every candidate now,
cleanup later):

1. It deletes only per-market and failure rows of runs that are older than a
   configured age, not referenced by another run's `baseline_id`, not promoted,
   and not live or paper runs. Run rows and segment rows are never deleted.
   `exchange_rules_snapshots` and calibration sets are never deleted.
2. It records pruning on the run (a future `markets_pruned_at` column, added with
   the script), and extend, `rebuild-backtest-segments` and `verify-diff` refuse
   pruned runs, because the §7.2 invariant no longer holds for them.
3. It deletes in bounded primary-key batches. InnoDB returns disk space only after
   a table rebuild, which on this table needs a maintenance window.
4. Because native replay is deterministic, a pruned candidate run can be rebuilt
   by re-running its standalone `cmd` with the same artifact, ModelConfig and
   seed (41-candidate-groups.md §9.2).
5. R2 traces, ledgers and the native artifact cache get their own age policies in
   the same script; live journal retention is decided in 22-trace-ledger-journal.md
   and 50-live-runtime.md.

## 9. Dependencies on other documents

| Owner | Required change |
|---|---|
| 21 §7 | `rules.source` vocabulary = 11 RS4 (`snapshot`, `partial`, `fallback`); carry the provenance map and `snapshotIds` (§3.4). |
| 21 §11 | Add `feeEra` and `unverifiedRules` to `EngineMarketOutput`, validated at egress (21 §19). |
| 22 §4.1 | Ledger transport per §7.5. |
| 50 §1, 51 §13 | Calibration sets are committed files per §7.6, not a DB table. |
| 02 D21 | Amend "no pooling across fee eras" with the user's answer to Open question 1. |

## Open questions

1. The decision log says backtest results must not be pooled across fee eras.
   A realistic backtest over Dec 2025 to Oct 2026 crosses four fee periods.
   Should such a run be (a) refused (today's default in §3.5), (b) split
   automatically into one run per fee period, or (c) allowed with extra
   per-period statistics and a "mixed fee periods" badge (what
   `--allow-mixed-fee-eras` does)? Recommended: (c) as the default.
2. May the aggregate host (worker-1 today) hold an R2 write credential, ideally
   limited to a separate ledger bucket, for ledger uploads (§7.5)? If not,
   ledgers can only be uploaded by the producer host, which then has to wait
   for the run (no `--detach` with `--ledger`).
3. Should TS-engine runs also get a `model_config` (with the worker-env knobs
   marked as env-sourced) so every new run has structured provenance, or stay on
   `cmd` parsing as this spec keeps them in v1?
4. For the later retention script: what counts as a promoted run, and after what
   age may unpromoted per-market rows be pruned?
