# 42 — Persistence and statistics

Purpose: define every MySQL change the native engine needs (engine provenance,
ModelConfig, seed, candidate-group columns, the exchange-rules snapshot table
and its selection module, per-market rules and fee provenance, failure
classes, artifact and conversion versioning), how migrations are written and
when they are applied, which derivations stay in TypeScript, how per-market
values are quantized at the output boundary, where ledgers and calibration
sets are stored, and how storage grows. The Rust engine emits exactly the
per-market contract TS consumes today (21-job-and-output-contract.md);
everything after that boundary stays TS. Binding inputs: D08, D09, D11, D13,
D15, D21, D50, D51 in 02-decisions.md.

## 1. Evidence

| Fact | Evidence |
|---|---|
| `backtest_runs` has no engine, profile, engine version, seed or model columns; extend and the simulator re-parse `cmd` | `src/db/schema.ts:96-181`; `src/cli/backtest.ts:745-757`; `src/backtest/simulator/resolveMarket.ts:98-111` |
| Per-market rows: money `decimal(14,4)`, avg prices `decimal(10,6)`, shares `decimal(18,6)`, `skip_reason` enum with one value | `schema.ts:199-214` |
| Segment kinds are an enum `all`, `last_n`, `daily`, `weekly`, `monthly`; `segment_key` is `varchar(32)` | `schema.ts:250-277`; `src/backtest/stats/backtestSegments.ts:24` |
| One run is inserted in one transaction; one bad value loses the whole run | `src/db/backtests.ts:403-501` |
| `insertBacktestRun` throws if the submission uid exists | `backtests.ts:382-395` |
| Decimals are written as `String(value)` | `backtests.ts:139-141` |
| TS rounds money and shares to 2 dp, avg prices to 4 dp with `Math.round` | `src/backtest/stats/marketStats.ts:186-198` |
| Extension recomputes segments over the chronologically sorted union of DB rows | `backtests.ts:1039-1045` |
| Migrations since 0030 are hand-written SQL plus a hand-appended journal entry; `db:generate` is broken | `drizzle/0034_strategy_artifacts.sql`, `drizzle/0038_backtest_feed_eligibility.sql`, `drizzle/meta/_journal.json` (last idx 40 on main) |
| Drizzle's MySQL migrator applies only migrations whose `when` is later than the newest applied one | `node_modules/drizzle-orm/mysql-core/dialect.js:39-55` |
| Dashboard keeps its own mirror of the backtest tables | `dashboard/src/lib/schema.ts:27-200` |
| `telonex_markets` has no tick, min size, fee schedule or taker-delay data; conversions have no format version and no sha256 | `schema.ts:380-476`, `:504-526` |
| `strategy_artifacts` has no kind, target, toolchain or source hash; it already has `engine_commit`, `format_version`, `built_with` | `schema.ts:673-701` |
| Siblings hold read-only R2 keys and no `DATABASE_*` | `docs/backtest/fleet/overview.md:114-131` |
| A Gamma market body is about 5 KB | `src/research-data/fixtures/july-01-merge.json:17` (5,343 bytes) |
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
4. **Timing (01 §8).** Nothing native is persisted before G2 and there is no
   branch dev schema. The migrations of §3 land as small PRs on main after G2:
   §3.1, §3.3 and §3.5-§3.9 in M3a, §3.2 in M4. The pre-G2 rules-capture PR
   (D37, 11 §13.2.1) adds no migration. Each migration PR appends its journal entry
   with a `when` later than every entry on main at merge time; a PR that races
   another migration is rebased and renumbered before merging, because the
   migrator silently skips an entry older than the newest applied one
   (`dialect.js:39-55`).
5. **Application (D50).** After each such PR merges, the agent runs
   `npm run db:migrate` from a checkout at the merged main commit with the
   production database credentials (worker-1 hosts MySQL) and records the
   result in STATUS.md. The agent applies only additive changes (new tables,
   instant columns, appended enum members, indexes on tables other than
   `backtest_run_markets`); a drop, rewrite or any other destructive change
   needs the user's explicit approval. None is planned.
6. `AGGREGATE_JOB_PROTOCOL_VERSION` (`src/backtest/jobTypes.ts`, today 6) MUST be
   bumped when `insertMeta` gains the provenance fields of §3, so an old
   aggregator fails loudly instead of dropping them.

## 3. Migrations

Numbers are placeholders; final numbers are assigned at merge (§2.4). §3.9's
columns land in M3a; they are filled once the converter change of 15 I-14
ships.

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

### 3.3 `exchange_rules_snapshots` (D21, 11 §13.1)

Append-only, one row per distinct fetched body per origin and phase, several
rows per market.

```sql
CREATE TABLE `exchange_rules_snapshots` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `condition_id` varchar(66) NOT NULL,
  `slug` varchar(100) NOT NULL,
  `market_start_ms` bigint NOT NULL,
  `origin` enum('gamma','clob','v4_bootstrap','live_gamma','live_clob') NOT NULL,
  `fetched_at_ms` bigint NOT NULL,
  `last_fetched_at_ms` bigint NOT NULL,
  `phase` enum('pre_start','post_start')
    GENERATED ALWAYS AS (IF(`fetched_at_ms` < `market_start_ms`, 'pre_start', 'post_start')) STORED,
  `raw_sha256` char(64) NOT NULL,
  `raw_json` mediumtext NOT NULL,
  `parsed` json NOT NULL,
  `snapshot_parser_version` int NOT NULL,
  `parse_warnings` json,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `exchange_rules_snapshots_id` PRIMARY KEY(`id`),
  CONSTRAINT `uniq_exchange_rules_snapshots_body` UNIQUE(`condition_id`,`origin`,`phase`,`raw_sha256`)
);
--> statement-breakpoint
CREATE INDEX `idx_exchange_rules_snapshots_slug` ON `exchange_rules_snapshots` (`slug`);
--> statement-breakpoint
CREATE INDEX `idx_exchange_rules_snapshots_start` ON `exchange_rules_snapshots` (`market_start_ms`);
```

Column rules:

- `origin` values and the body format each implies are those of 11 §13.1.
- `raw_json` holds the verbatim response body (for `v4_bootstrap`, the frozen
  `RecordedMarket.rawJson` text) as text, not a MySQL `json` value, because
  MySQL re-serializes `json` and the body must stay byte-exact. `raw_sha256` is
  the sha256 of those bytes.
- `phase` is derived, never written (11 §13.1). It is part of the unique key,
  so a pre-start and a post-start sighting of the same body stay separate rows
  and RS2 ("initial tick only from `pre_start`") keeps the evidence of both.
- Dedupe: an identical body from the same origin in the same phase updates
  only `last_fetched_at_ms` (`INSERT … ON DUPLICATE KEY UPDATE
  last_fetched_at_ms = GREATEST(last_fetched_at_ms, VALUES(fetched_at_ms))`).
  "Newest" in RS1 orders rows of one phase by `last_fetched_at_ms`.
- `parsed` holds the normalized §13.4 fields this body provides (absent when
  the body lacks the field), produced by the parser of
  `snapshot_parser_version` (11 §13.4 JC4, §13.5). `parse_warnings` lists
  fields that were present but unparseable. Money and rates are decimal
  strings.
- Writers are TS only, through §3.4: RC1-RC6 of 11 §13.2 (pre-start capture,
  V4 import, historical Gamma and CLOB backfill, the price-to-beat sync hook,
  live journal ingestion) and the import of the D37 JSONL files. The binary
  never touches the DB.
- A parser change re-parses in place (`npm run rules:reparse`, 11 VR5):
  `parsed` and `snapshot_parser_version` change; `raw_json` never does.

### 3.4 Selection module: `src/db/exchangeRules.ts`

1. All reads and writes of `exchange_rules_snapshots` MUST go through this one
   module, following the single-source rule CLAUDE.md sets for
   `src/db/telonexMarkets.ts`.
2. `selectCapturedRules(conditionId, marketStartMs)` implements RS1-RS3 of
   11 §13.3 exactly and returns the job's `market.rules` record (11 §13.4,
   21 §7): `snapshotParserVersion`, `captured` (per field: value, origin, phase,
   `snapshotId`) and `disagreements`. It never fills a fallback value and keeps
   no copy of the dated tables (11 JC1); the engine fills the gaps and
   classifies the market (RS4, JC2).
3. Tests: the shared raw-body fixture suite of 11 JC4 (`native/fixtures/rules/`)
   plus golden selection cases: pre-start only; post-start only (no tick
   sent); Gamma and CLOB disagreeing on each RS3 field; an identical body seen
   in both phases; a body that reappears after a different one; no rows
   (empty `captured`).
4. `npm run rules:import-jsonl` imports the pre-start capture files of
   11 §13.2.1 (PC10) through this module, idempotently by the unique key;
   40 §16 runs it periodically from M3a.

### 3.5 `backtest_run_markets` rules and fee provenance (D21, 11 FT1, §13.8, §14)

```sql
ALTER TABLE `backtest_run_markets`
  ADD COLUMN `rules_source` enum('snapshot','partial','fallback'),
  ADD COLUMN `rules_snapshot_ids` json,
  ADD COLUMN `fee_era` varchar(8),
  ADD COLUMN `fee_curve` varchar(32),
  ADD COLUMN `unverified_rules` json,
  ALGORITHM=INSTANT;
--> statement-breakpoint
ALTER TABLE `backtest_run_segments`
  MODIFY COLUMN `segment_kind` enum('all','last_n','daily','weekly','monthly','fee_era','fee_curve') NOT NULL,
  ALGORITHM=INSTANT;
```

No index, no foreign key on `backtest_run_markets` (§2.3). The five columns are
NULL for `ts` and `native-ts-compat` rows (ts-compat outputs `rules: null`,
11 §13.8). For `native-realistic` rows:

| Column | Source | Value |
|---|---|---|
| `rules_source` | `MarketStats.rules.source` (21 §11) | RS4 value; identical for every candidate of a market |
| `rules_snapshot_ids` | the shim, from the job's `captured[*].snapshotId` (21 §11) | JSON array of the distinct `exchange_rules_snapshots.id` used, `[]` when nothing was captured |
| `fee_era` | `MarketStats.rules.feeEra` | fee row id of 11 §5.3 under the run's `rulesTableVersion` (`F0`-`F3`, later rows by table version); identical for every candidate |
| `fee_curve` | `MarketStats.rules.feeCurve` | canonical curve text of 11 FT1 (e.g. `symmetric:0.07:1:5`), at most 32 characters; identical for every candidate |
| `unverified_rules` | `MarketStats.rules.unverifiedRules` | JSON array of 11 §14 rule ids this candidate's orders touched, `[]` when none; per candidate |

`rulesTableVersion` and `snapshotParserVersion` are not market columns: the
first is in `model_config` (`$.rules.rulesTableVersion`), the second is
recoverable from `rules_snapshot_ids`.

**Fee mix (D51, amending D21; 11 FT2).** A realistic run may span several fee
eras and fee curves; no flag is needed.

1. At submit the producer prints the market count per `feeEra` and per
   `feeCurve` of the selection (11 FT2) and warns when more than one era or
   curve is present.
2. Segments: when a run's market rows hold more than one distinct `fee_era`,
   TS adds one `fee_era` segment per era (key = era id); when they hold more
   than one distinct `fee_curve`, one `fee_curve` segment per curve (key = the
   curve text). `segment_ord` is the first `market_start_ms` of the group.
   These are the per-era and per-curve statistics of 11 FT2.
3. The run's `fee_eras` and `fee_curves` (§3.8) list the distinct values. A run
   with more than one era shows a "mixed fee eras" badge listing eras and
   curves; a run with more than one curve is `mixedFeeCurves`, and its pooled
   segments (`all`, `last_n`, date kinds) are marked as pooling different fee
   curves. Comparison surfaces (§6.2) warn when two runs' `fee_curves` differ.
4. `--extend` recomputes `fee_eras`, `fee_curves` and both segment kinds from
   the union of market rows; a fee mix never refuses an extension.
5. Gate-3 evidence (51) selects markets by these columns and
   `market_start_ms`: markets touched by the third-party taker-delay rows
   appear in `unverified_rules` (11 §14), and only markets from 2026-08-17
   11:00 UTC on count (D52).

### 3.6 `backtest_run_failures` failure class

```sql
ALTER TABLE `backtest_run_failures`
  ADD COLUMN `failure_class` varchar(32),
  ADD COLUMN `failure_detail` varchar(64),
  ALGORITHM=INSTANT;
```

Closed vocabulary for `failure_class`, validated in TS (21 §14): the error
classes of 20-binary-protocol.md §4 except `canceled` (never persisted), plus
three aggregator classes:

| Value | Written for |
|---|---|
| `runtime`, `invalid_input`, `data_missing`, `data_defect`, `timeout`, `invalid_output`, `strategy_fault`, `engine_fault`, `killed` | native job or candidate failures (20 §4; shim mapping in 40 §8.1) |
| `market_skip` | null-stats skips (`no_slug`, `no_resolution`, `unresolved_outcome`, `no_activity`, `incomplete_capture`; 21 §13), both engines |
| `missing_child_result` | a child with no result (`aggregateProcessor.ts:138-147`), both engines |
| `invalid_market_stats` | a row rejected by the aggregator's DB-contract check (21 §19), both engines |

`failure_detail` holds the cause (20 §4.1, for example `upstream_hole`,
`oom_budget`, `echo_mismatch`). Legacy rows and TS-engine job failures keep
both NULL. `reason` keeps the full one-line text.

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
NULL for `js` rows; `real-orders` rows exist only for builds made on the live
host (31 §5.5, option (b)). `built_with` (`schema.ts:690`) widens its TS type to
`{ rustc, macosSdk, ld, cc, host }` for native rows; `engine_commit` and
`format_version` keep their columns with the meanings of 31 §6.2.

### 3.8 `backtest_runs` fee mix

```sql
ALTER TABLE `backtest_runs`
  ADD COLUMN `fee_eras` json,
  ADD COLUMN `fee_curves` json,
  ALGORITHM=INSTANT;
```

JSON arrays of the distinct `fee_era` and `fee_curve` values of the run's
market rows, sorted, recomputed by TS on insert and extend (§3.5); NULL for
`ts` and `native-ts-compat`.

### 3.9 `telonex_market_conversions` format version and sha256 (15 I-14)

```sql
ALTER TABLE `telonex_market_conversions`
  ADD COLUMN `format_version` int,
  ADD COLUMN `sha256` char(64),
  ALGORITHM=INSTANT;
```

Both are filled at conversion time and copied by the producer into the job's
`input` (21 §4); the reader refuses unknown versions (15 I-13). Until the
converter change lands, the producer sends version 1 and `sha256: null`
(15 I-14).

## 4. Write rules

| Column | Written by | Value |
|---|---|---|
| `engine` | producer | `ts` for registry and JS-artifact strategies; `native-ts-compat` / `native-realistic` from the run's profile. The shim checks the binary's echoed profile per job (40 §5.2). |
| `engine_version`, `engine_commit` | producer | from `describe` at submit; NULL for `ts` |
| `model_config` | producer | the exact canonical ModelConfig the jobs carried (21 §6, versioned by `modelConfigVersion`); for a variant candidate, with its effective `execution`; required for native rows. TS rows keep it NULL in v1 and stay on `cmd` parsing. |
| `seed` | producer | `model_config.seed` (a JSON integer in `[0, 2^53 − 1]`, 10 RNG-1, default 0); the insert path asserts that both are equal. Required for native rows. |
| `producer_commit_sha`, `producer_dirty` | producer | for every new run (D12 provenance) |
| `ledger_uri` | aggregate host (the producer under `--sequential`) | location of the opt-in ledger (§7.5) |
| `candidate_*` | group aggregate | 41-candidate-groups.md §9 |
| `fee_eras`, `fee_curves` | aggregator, extend | §3.8 |
| `rules_source`, `rules_snapshot_ids`, `fee_era`, `fee_curve`, `unverified_rules` | from the job and the binary output, through the shim | §3.5 |
| `failure_class`, `failure_detail` | aggregator | §3.6 |

`engine` defaults to `ts`, so every existing TS writer (aggregator, research run
synthesis, `src/cli/research/insert-in-db-backtest-feature-tests.ts`) keeps
working unchanged. The insert-time validator (`coerceMarketStatsRow`,
`backtests.ts:186-198`) MUST also check closed vocabularies and numeric ranges
for native rows (21 §19); an invalid row becomes an `invalid_market_stats`
failure row instead of failing the transaction. The per-market check in the
shim (40 §5.2) catches the same defects earlier, per job.

## 5. Extend with provenance

1. For rows with a non-NULL `model_config`, `--extend` MUST build its jobs from
   the row's `engine`, `model_config`, `seed`, `strategy_artifact_sha256` and
   normalized `params`, not from parsing `cmd`. Rows without `model_config`
   (all TS rows) keep today's `cmd` parsing (`src/cli/backtest.ts:745-757`).
2. Extend MUST refuse when the artifact sha or engine version is blocklisted
   (40 §11), when the producer does not support the row's
   `modelConfigVersion`, or when the binary does not list the row's
   `rulesTableVersion` (11 VR3).
3. Extend never modifies the parent's provenance columns, as it never modifies
   `cmd` today; it recomputes only the derived `fee_eras`, `fee_curves` and
   segments. `applyExtensionToRun` and its union recompute
   (`backtests.ts:838-1088`, `:1039-1045`) stay unchanged apart from the two
   fee segment kinds.
4. Extension of a candidate run: 41-candidate-groups.md §9.3.

## 6. Dashboard and tooling

1. Run views show an engine badge (`ts`, `native ts-compat`, `native realistic`)
   and `engine_version`; run detail shows `model_config`; realistic runs show
   the share of markets by `rules_source`, any `unverified_rules`, and the fee
   mix badges and segments of §3.5.
2. Every comparison surface (baseline comparison, batch comparison, directional
   game, `backtest:verify-diff`) MUST flag or refuse comparisons between
   different `engine` values; `verify-backtest-diff` refuses unless
   `--allow-cross-engine` is passed. Protocol evaluators SHOULD filter by
   `engine`.
3. Runs whose artifact sha or `engine_version` is on the blocklist are flagged.
4. The Market Simulator refuses rows with `engine <> 'ts'` with a clear message
   (D10), replacing the silent registry fallback at `resolveMarket.ts:106`,
   until M3c adds native replay.
5. Group view and leaderboard de-duplication: 41-candidate-groups.md §11.
6. The DB host's free disk and the size and weekly growth of
   `backtest_run_markets` MUST be visible (dashboard health page or
   `fleet:status`) with a warning threshold.

## 7. What stays in TypeScript

### 7.1 TS-owned derivations (MUST NOT be ported to Rust)

| Derivation | Where |
|---|---|
| `market_start_ms = slugTs(slug)`, also on extend | `aggregateProcessor.ts:169`, `backtests.ts:449` |
| `computeBatchStats` (only `capital_initial` is persisted from it) | `src/backtest/stats/batchStats.ts`, `backtests.ts:433` |
| `computeBacktestSegments` (`all`, `last_n` 500/1000/3000/6000, daily, weekly, monthly, `fee_era`, `fee_curve`; sorted by `market_start_ms`) | `src/backtest/stats/backtestSegments.ts` |
| Wall clock = `unionBusyMs` of per-market intervals, shared with the dashboard | `src/backtest/stats/wallClock.ts`, `batchStats.ts:286-295` |
| `status`, `markets_persisted`, `failures_count`, `input_markets_total`, `fee_eras`, `fee_curves` | `backtests.ts:403-430` |
| Failure rows (null stats, failed and missing children, invalid rows) and their `failure_class` | `aggregateProcessor.ts:104-147` |
| Commit before child cleanup (16 FX-5); incremental fetch of child results if 16 FX-6 is adopted | `aggregateProcessor.ts:202-217` |
| Extension merge and lock | `backtests.ts:803-1088` |
| `rebuild-backtest-segments`, `walkForwardRank`, research run synthesis | `src/cli/rebuild-backtest-segments.ts`, `src/backtest/stats/walkForwardRank.ts`, `src/cli/research/insert-in-db-backtest-feature-tests.ts` |
| Market resolution (shipped in the job; Rust only deserializes it) | `src/backtest/stats/marketResolution.ts`, `telonexMarketResolution.ts` |
| Captured-rules selection (shipped in the job) | `src/db/exchangeRules.ts` (§3.4) |
| Execution metadata, `rules_snapshot_ids` and `recorderV4Capture` stamping | the shim, 40 §5.2, §7.1 |
| Group aggregation and per-candidate persistence | 41-candidate-groups.md §7 |

### 7.2 Invariant

Segments MUST stay recomputable from `backtest_run_markets` rows alone. Every
input of batch and segment stats (`pnl`, `fees_paid`, `trade_count`,
`trade_as_maker`, `trade_as_taker`, `skip_reason`, `slug` → `market_start_ms`,
`duration_ms`, `started_at_ms`, `finished_at_ms`, `fee_era`, `fee_curve`) is a
persisted per-market column; a new stats input needs a per-market column first.

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
4. Before emission Rust checks the ranges of 21 §11 (for example `|pnl|`,
   `|cost|` < 10^10; shares < 10^12; average prices in `(0, 1)`). A violation
   is `invalid_output: self_check` (20 §4). NaN and infinity cannot occur in
   fixed point.
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

The opt-in per-order and per-fill ledger is gzipped JSONL, record layout in
22-trace-ledger-journal.md §4.2. Transport (owned here; 22 §4.1 matches):

1. The binary writes the ledger to its job work dir (`outputs.ledgerPath`).
   The shim attaches it to the job result as base64 gzip, per market-candidate,
   capped at 4 MiB. Above the cap the shim drops that ledger and marks the
   candidate result `ledgerDropped: 'too_large'`.
2. The aggregate host (the producer process under `--sequential`) stores each
   ledger as `backtest-ledgers/<submissionUid>/<slug>.jsonl.gz` (in a group,
   under each candidate's own `submissionUid`) plus a `manifest.json` listing
   counts and dropped or truncated slugs, skip-if-exists, before the run's DB
   transaction, so a failed write retries the idempotent aggregate cleanly. It
   then writes `ledger_uri`.
3. **Interim upload rule (01 §12.1 item 1).** Until the gate-4 answer on R2
   tokens, ledgers are uploaded only from worker-1 (the aggregate host and the
   `--sequential` host, 40 §2) with the R2 write credential it already holds.
   If it holds none, the run still persists: ledgers stay in worker-1's
   staging directory `<data root>/backtest-ledgers/` with
   `ledger_uri = local://worker-1/backtest-ledgers/<submissionUid>/`, the
   upload waits under "Waiting on user", and `npm run ledgers:upload-r2` later
   uploads them and rewrites `ledger_uri` (a location, not provenance).
4. Market workers never get R2 write credentials (siblings hold read-only R2
   keys, `docs/backtest/fleet/overview.md:114-131`).
5. Calibration rejects runs with dropped or truncated ledgers (22 §4.2).
6. Volume: the producer refuses `--ledger` when markets × candidates exceeds
   10,000 unless `--max-ledger-markets` is raised; M3b measures typical ledger
   sizes and revises the bound.

### 7.6 Calibration sets

Calibration sets are committed JSON files, not DB rows. Layout and resolution
are owned by 21 §6.3 (`native/contract/calibrations/latency/<id>.json` and
`native/contract/calibrations/feeds/<id>.json`), content by 13 §7.4, 14 §9 and
51 §13. Runs reference them through `model_config`
(`$.execution.latency.calibrationId`, `$.clock.marketData.calibrationId`,
`$.feeds.calibrationId`). No DB table in v1; a read-only index table MAY be
added later if the dashboard needs to list sets. The gate-3 report lives
under `native/reports/`.

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
| `exchange_rules_snapshots`, pre-start: 384 BTC 5m/15m markets per day × (Gamma + CLOB), 1-2 distinct bodies each, ≈ 5 KB | ≈ 770-1,540 / day | ≈ 4-8 MB / day, ≈ 1.5-3 GB / year |
| `exchange_rules_snapshots`, one-time history (11 RC3, ≈ 30 k markets) | ≈ 30 k | ≈ 150 MB |

The new per-market columns (§3.5) add about 60 bytes per realistic row (none
for `ts` and ts-compat rows). Per-market CPU and RSS are deliberately not
persisted. The M6 benchmark reports rows and bytes written per run.

Constraints for the later retention script (01 F3; D15: rows for every
candidate now, cleanup later). What counts as a promoted run and the pruning
age are defined when F3 starts:

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
5. Ledgers, R2 traces and the native artifact cache get their own age policies in
   the same script; live journal retention is decided in 22-trace-ledger-journal.md
   and 50-live-runtime.md.

## 9. Dependencies on other documents

None open: every item was applied in the gate-1 consolidation.

## Open questions

None. Decided: mixed fee eras (D51, §3.5) and agent-run additive migrations
(D50, §2.5). Settled here (02 D56 left them to this document): TS rows keep
`model_config` NULL in v1 (§4), and the retention details belong to F3 (§8).

## Gate-4 questions

1. **R2 tokens for ledgers** (01 §12.1 item 1, shared with 31 and 22): may
   worker-1 hold an R2 write token scoped to a ledger bucket or prefix? Until
   answered, the interim rule of §7.5.3 applies.
