# 41 — Candidate groups (shared candidate replay)

Purpose: define how N candidates (parameter sets, and for internal use
ModelConfig variants) of one native strategy are submitted together, replayed
from one market read per market with fully isolated per-candidate state, and
stored as N ordinary backtest runs. This is the largest throughput lever after
the engine itself: today every sweep cell selects its markets separately and
re-reads every Parquet file, and the Codex prototype measured 3.18x at 10 and
3.98x at 100 candidates against sequential standalone runs
(research/early-audits.md §C). Binding inputs: D13, D14, D15 in 02-decisions.md.
Fleet mechanics are in 40-fleet-integration.md, columns in
42-persistence-and-stats.md, the binary side of `run-group` / `serve` in
20-binary-protocol.md, job and output shapes in 21-job-and-output-contract.md.

## 1. Evidence

| Fact | Evidence |
|---|---|
| Every batch has exactly one run (2,187 batch_uids in 60 days, all with one run) | requirements-sweep `candidate-sweep-cli` (DB read) |
| Coordinate passes submit one run per value under one pass batchUid; screen = `--latest --limit 1000` | `strategy-research-protocol/tools/runBacktest.md:62-80` |
| Grid sweeps expand to one CLI command per cell | `docs/backtest/generate-backtest-jobs.md:1-40`, `src/backtest/generate-jobs.ts` |
| `--latest` drifts and `--random` re-samples per cell, so cells of one sweep see different markets | requirements-sweep `candidate-group-submission` |
| One BullMQ child has exactly one parent; one flow = one aggregate parent = one run row | `src/cli/backtest.ts:1460-1525`, `src/backtest/aggregateProcessor.ts:83-118` |
| `submission_uid` is UNIQUE; `batch_uid` is the non-unique sweep label | `src/db/schema.ts:100-106,168` |
| Today's `run-group` takes N full `MarketJobData` copies and fails the whole group with exit 2 on any bad job | `native/BINARY-PROTOCOL.md:43-51` |
| `insertBacktestRun` throws when the submission uid already exists | `src/db/backtests.ts:382-395` |
| Results stay twice in Redis today: child return value and parent `:processed` hash | `src/backtest/queue.ts:86-91`; BullMQ 5.77.6 `commands/moveToFinished-14.lua:158,169-189`, `commands/includes/updateParentDepsIfNeeded.lua:10-11` |
| Leaderboard sums `events_processed` and `duration_ms` per machine over market rows | `dashboard/src/lib/queries/leaderboard.ts:38-60` |

## 2. Invariants

1. **Isolation.** Each candidate has its own strategy instance, plugin instances,
   OrderManager / ledger / portfolio, execution simulator state, latency
   scheduler, RNG streams, trace and ledger sinks, and MarketStats builder. Only
   immutable decoded market and feed data is shared (§5).
2. **Standalone equivalence.** A candidate's output depends only on (binary,
   shared job context, candidate params, candidate ModelConfig, run seed, slug).
   It MUST NOT depend on candidate index, group size, group composition, thread
   count, scheduling layout or worker. Therefore a group run of candidate k
   produces byte-identical market rows (execution metadata excluded) to a
   standalone run of the same params, ModelConfig and seed over the same markets,
   and a later standalone `--extend` of that candidate equals a fresh standalone
   run over the union.
3. **One run per candidate.** Every candidate becomes its own `backtest_runs` row
   with its own `submission_uid`, its own segments, market rows and failure rows
   (D13, D15).
4. **Compute is never counted N times** (D13, §7.4).

## 3. Submission format

### 3.1 CLI

```bash
npm run backtest -- --strategy-artifact <sha256> --candidates <file.json> \
  --input-mode telonex-delta --read-from local-or-download-from-r2-to-local \
  --symbol btc --timeframe 15m --latest --limit 1000 \
  --batchUid <label> [--candidates-out <map.json>] [--native-profile realistic]
```

`--candidates` accepts every selection, label, latency, capital, profile and
detach flag of a normal native run (flag matrix in 20-binary-protocol.md). It
also works with `--strategy-file` (auto-publish) and with `--sequential`.

### 3.2 File (`schemaVersion: 1`)

Form A, explicit list:

```json
{
  "schemaVersion": 1,
  "candidates": [
    { "label": "thr-0.3", "params": { "enterThreshold": 0.3, "dwellTicks": 3 } },
    { "label": "thr-0.4", "params": { "enterThreshold": 0.4, "dwellTicks": 3 } }
  ]
}
```

Form B, sweep:

```json
{
  "schemaVersion": 1,
  "base": { "enterThreshold": 0.3, "dwellTicks": 3 },
  "sweep": { "enterThreshold": [0.3, 0.4, 0.5], "dwellTicks": [2, 3, 4] },
  "mode": "coordinate"
}
```

Expansion rules (the expanded order defines `candidate_index`, 0-based):

| Mode | Expansion |
|---|---|
| explicit | file order |
| `coordinate` | for each sweep key in file order, for each value in order: `base` with that one key replaced |
| `cartesian` | product over sweep keys in file order, last key varies fastest; keys absent from `sweep` come from `base` |

Labels are optional (max 100 chars, default `c<k>`); in sweep form they are
generated as `<key>=<value>`.

### 3.3 ModelConfig variants (internal)

Per D14, explicit entries MAY carry `"modelConfig": { … }`, a partial override
of the run-level ModelConfig. Allowed keys are the execution-model parameters
listed as variant-safe in 13-execution-models.md (fill model, queue parameter,
latency calibration id). Variants require the internal flag
`--allow-model-variants`; they are meant for calibration and realistic-profile
A/B reports, not for agent sweeps. The profile itself is run-level and MUST NOT
vary inside a group.

### 3.4 Normalization and duplicates

1. Every candidate's params are normalized by the binary's `describe`
   (defaults applied, CLI strings coerced, unknown keys rejected; idempotent,
   30-strategy-sdk.md). The producer SHOULD call a batch form of `describe`
   (20-binary-protocol.md) so 100 candidates cost one process start.
2. Dedup key = canonical JSON (sorted keys) of normalized params plus the
   canonical ModelConfig override.
3. Duplicates among explicit entries → exit 2 listing the clashing indexes (D14).
4. Duplicates produced by `coordinate` expansion (the base point repeats once per
   swept key when the base value is in the list) are collapsed into the first
   occurrence and reported; they are an artifact of expansion, not user intent.

### 3.5 Rejections (exit 2, before anything is enqueued)

| Condition | Reason |
|---|---|
| Strategy is not a native artifact (registry or JS artifact) | the TS engine has no shared replay |
| `--param` together with `--candidates` | ambiguous base; put shared values in `base` |
| `--extend` together with `--candidates` | whole-group extend is a later feature (§9.3) |
| Candidates whose canonical `requiredFeeds` differ (including `tickOnUpdate`) | mixed feed requirements (D14) |
| Candidates whose eligibility-relevant capabilities differ (e.g. required V4 capture feeds) | mixed eligibility (D14) |
| Duplicate normalized candidates (§3.4.3) | D14 |
| More than `maxCandidates` (default 128) candidates, or `candidates × markets > maxCandidateMarkets` (default 300,000) | bounds job duration, executor memory and Redis volume; overridable with `--max-candidates` / `--max-candidate-markets`; defaults revised from the §10 measurements |
| ModelConfig override without `--allow-model-variants`, or with a key outside the allowlist | §3.3 |
| Any flag the binary's capabilities reject | flag matrix |

## 4. Producer flow

1. Resolve the artifact once and ensure the binary locally.
2. Expand candidates (§3.2), normalize and validate (§3.4, §3.5).
3. Resolve the run-level ModelConfig once (21-job-and-output-contract.md) and one
   run seed for the whole group (D14). Apply per-candidate overrides.
4. Select markets once with the shared `requiredFeeds` and resolve every market
   context once (file path, metadata, resolution, window, price-to-beat, the
   resolved rules envelope of 42 §3.4). All candidates get the same market list
   and the same `idx` values.
5. Ids: `groupUid = <label[0..170]>--<uuid>` (or `<uuid>` without a label);
   candidate `submissionUid = <groupUid>-c<k>`; `batchUid = label ?? groupUid`.
   Market jobs `<groupUid>-m-<idx>`, aggregate `<groupUid>-agg`, so the job-id
   grammar of `src/backtest/jobTypes.ts:132-141` and the dashboard regex
   (`dashboard/src/lib/queries/batches.ts:78`) keep working.
6. Print the candidate map before enqueueing (stdout, plus `--candidates-out`
   when given), so an agent captures it even with `--detach`:

   ```json
   { "groupUid": "...", "batchUid": "...", "strategy": "...", "artifactSha256": "...",
     "totalMarkets": 1000, "seed": 123,
     "candidates": [ { "index": 0, "submissionUid": "...-c0", "label": "thr-0.3",
                       "params": { "enterThreshold": 0.3, "dwellTicks": 3 },
                       "modelConfigOverride": null } ] }
   ```

7. Enqueue one flow: the group aggregate parent on `backtest-aggregate`
   (commit-gated, D12) and one native child per market on the native queue
   (40-fleet-integration.md §3), each carrying the shared context once plus the
   candidate list (21-job-and-output-contract.md), not N copies of
   `MarketJobData`.
8. Wait or detach as today; progress is reported in markets and in
   market-candidates.
9. `--sequential` runs the same steps without a queue: the local executor
   replays every market with `T` threads, the shim logic stamps execution
   metadata, and the same group persistence function (§7) writes the N runs.
   This path is mandatory, because before gate 2 groups run only on m1-ivan
   (40-fleet-integration.md §13).

## 5. Executor contract (one read, N isolated candidates)

1. Each market's input is decoded once. Decoded market events, feed series, the
   recorded L2 book per event, the feed visibility timeline and the synthetic
   tick schedule are immutable and shared by reference across candidates.
   (Feeds are identical inside a group by §3.5, so the schedule is too.)
2. Plugin computations with identical canonical configs SHOULD be computed once
   per tick and shared read-only (14-feeds-and-plugins.md). Shared and unshared
   computation MUST give identical results; tests cover both.
3. Each candidate's execution state is an overlay on the shared recorded book:
   its own resting orders, consumed liquidity and queue positions
   (13-execution-models.md). No candidate can observe another's orders.
4. Seeds: the per-market seed is `H(run seed, slug)` (D14); every candidate RNG
   stream derives from that seed and the stream's name only. Candidates with
   equal ModelConfig therefore see identical latency draws (common random
   numbers), which lowers the variance of A/B comparisons.
5. Layout (tick-major or candidate-major) and parallelism (candidates fanned
   out across pool threads within one job) are chosen by measurement
   (16-performance.md). Output MUST be byte-identical for every layout, thread
   count and candidate order.
6. Faults: `catch_unwind` per candidate per callback (12-engine-core.md). A
   failed candidate stops; the others continue. Cascade and drain limits apply
   per candidate.
7. Output: one result per candidate in index order, each either an ok
   `EngineMarketOutput` or an error with a class from 20 §4 and a one-line
   reason (21 §10, §14). Candidate-level timeouts additionally need the index
   of the candidate currently inside a callback in `progress` / `pong.inflight`,
   which 20 §6.2 does not define yet (40 §8.2.3, §18).

## 6. Result routing and Redis volume

1. The shim stores one compact group result per market job as the BullMQ return
   value (TS-internal shape, versioned with the group aggregate protocol):

   ```text
   { kind: 'candidate-group', idx, slug,
     shared: { execution (stamped, durationMs per candidate), eventsProcessed, eventsByType,
               skipReason?, coverageReasons?, recorderV4Capture?,
               rulesSource?, rulesSnapshotIds?, feeEra? },
     candidates: [ { index, ok: true,  stats: <marketStats without shared fields> | null, skipReason?,
                     unverifiedRules?, ledger?: <base64 gzip> , ledgerDropped? }
                 | { index, ok: false, class, detail?, reason } ] }
   ```

   Rules provenance and the fee era are per market and shared (21 C4: rules are
   identical for all candidates); `unverifiedRules` and the ledger are per
   candidate (42 §3.5, §7.5).

2. A serialized result larger than 16 KiB is stored as
   `{ kind: 'candidate-group', encoding: 'gzip-base64', data }`. A result above
   8 MiB without ledgers fails the job (`UnrecoverableError`, class
   `strategy_fault`, detail `result_too_large`, for every candidate; hint:
   shrink intentMeta; per-market meta caps are in 21 §16). Ledgers have their
   own per-candidate cap (42 §7.5).
3. Native child jobs (groups and single runs) MUST use `removeOnComplete: true`.
   BullMQ 5.77.6 writes the return value into the parent's `:processed` hash
   before it removes the completed job, so `getChildrenValues()` still returns
   it while Redis holds one copy instead of two. Dashboard progress reads only
   the parent's dependency counts (`batches.ts:121,711`). `removeOnFail` stays
   `false`. A test MUST pin this BullMQ behavior so a library upgrade cannot
   silently drop results.
4. Volume estimate: average persisted `intent_meta` is 279 bytes (read-only DB
   query, 2026-10-08), so one candidate record is about 1 KB raw and roughly
   0.2 KB gzipped inside an array of similar records. 100 candidates × 5,523
   markets is then about 110 MB, against about 6.6 GB at the 12 KB/market figure
   of `docs/backtest/fleet/overview.md` ("Scaling beyond ~30k-market batches").
   The §10 benchmark MUST measure the real Redis peak.
5. If the measured peak of a capped group exceeds 1 GiB, a later version adds an
   incremental collector on the aggregate host that moves completed group results
   into a MySQL staging table. Not in v1.

## 7. Aggregation

### 7.1 Job

`aggregateProcessor` MUST dispatch on `data.kind === 'candidate-group'` to a
group aggregate with its own `GROUP_AGGREGATE_PROTOCOL_VERSION` (start at 1).
Parent job data:

```text
{ kind: 'candidate-group', protocolVersion, groupUid,
  submissionUid: groupUid,            // dashboard compatibility (batches.ts:100-140)
  batchUid, commitSha, totalMarkets, expectedMarkets, initialCapital,
  insertMeta: { shared run fields, strategy, ... },
  candidates: [ { index, submissionUid, label, params, cmd, modelConfig, seed } ] }
```

### 7.2 Steps

1. Load children values and failed children once; decompress; sort by `idx`
   (the order invariant of `aggregateProcessor.ts:96-98`).
2. For each candidate in index order: build its ordered market stats and its
   failure list (§8), compute batch stats and segments with the existing TS
   functions (`aggregateProcessor.ts:168-170`), and persist its run.
3. Persistence is one transaction per candidate run (D13). If a run with that
   `submission_uid` already exists, skip it: a group-aware variant of
   `insertBacktestRun` replaces the throw at `src/db/backtests.ts:387-395`. The
   group aggregate is therefore idempotent and keeps `attempts: 3` (extensions
   keep `attempts: 1`, `src/cli/backtest.ts:1521`).
4. After all candidates are persisted, remove the child jobs as today
   (`aggregateProcessor.ts:208-217`).

### 7.3 Failure rows per candidate

| Source | Rows |
|---|---|
| Child failed after retries or as unrecoverable | one row for that idx in every candidate run, reason from the child |
| Child missing | `missing_child_result` in every candidate run (`aggregateProcessor.ts:138-147`) |
| Market-level null stats (`no_slug`, `no_resolution`, `unresolved_outcome`, `incomplete_capture`, no ticks) | every candidate run, reason text of `nullMarketStatsReason` (`aggregateProcessor.ts:36-50`) |
| Candidate error in an ok job | that candidate only, reason `<class>: [<detail>:] <reason>`, `failure_class` and `failure_detail` set (42 §3.6) |

Every row carries the `failure_class` vocabulary of 42 §3.6: the child's class
(20 §4) for failed children, `missing_child_result`, or `market_skip`.

Run `status` is computed per candidate with the existing rule
(`completed` / `partial` / `failed`).

### 7.4 Compute attribution (D13)

The shim stamps the job interval on its own clock (40 §7.1). For every
candidate row of a market job with `k` candidates (failed ones included),
admitted with token weight `w` (40 §7.2):

| Field | Value |
|---|---|
| `durationMs` | `floor(w × (finishedAtMs − startedAtMs) / k)`: the token time the job held, divided over its candidates. With `w = 1` this is D13's "group wall time / N". |
| `startedAtMs`, `finishedAtMs` | the job's interval, identical for every candidate |
| `eventsProcessed`, `eventsByType` | the full count, identical for every candidate (D13) |

Consequences: summed `duration_total_ms` over the group's runs equals the
token time the group consumed; each run's `duration_wall_clock_ms` (union of
intervals, `src/backtest/stats/wallClock.ts`) equals the group's wall clock;
the leaderboard must de-duplicate events (§11.3).

## 8. Failure isolation

Classes are those of 20 §4; the shim actions are in 40 §8.1.

| Failure | Class | Scope | Outcome |
|---|---|---|---|
| Strategy panic, overflow, contract breach in candidate k | `strategy_fault` | candidate k | candidate error; no retry; others unaffected |
| Candidate k stuck inside a callback | `timeout` or `killed` (`backstop_timeout`) | market | the whole job follows 40 §8.2 (cooperative timeout, retry once at 2× budget) and §8.3 (backstop kill, isolated re-run). Once 20 §6.2 reports the candidate inside a callback, the shim SHOULD retry the job without k and record a `timeout` failure for k only. |
| Missing local file | `data_missing` | market | job retried (retry ladder, any host); after exhaustion a failure row in every candidate |
| Transient I/O error | `runtime` | market | job retried; after exhaustion a failure row in every candidate |
| Corrupt or integrity-failed input, Chainlink hole, pre-coverage market | `data_defect` | market | unrecoverable (after the one re-download of 40 §6.1.3); failure row in every candidate |
| Invalid job | `invalid_input` | market | unrecoverable; failure row in every candidate |
| Executor crash | `killed` | every job in flight on that executor | each job re-run once in isolation (40 §8.3); only a job that kills its isolated run fails |
| Output fails the shim's schema or echo check | `invalid_output` | market | unrecoverable, alert; failure row in every candidate (21 §19) |

## 9. Storage

### 9.1 Rows

One `backtest_runs` row per candidate; per-market rows for every candidate (D15);
retention is a later script (42-persistence-and-stats.md §8).

| Shared by all candidates of a group | Per candidate |
|---|---|
| `batch_uid`, `baseline_id`, `comment`, `protocol`, `model`, selection columns, `strategy`, artifact sha and meta, `engine`, `engine_version`, `engine_commit`, `capital_initial`, `input_markets_total`, `feed_eligibility`, producer commit and dirty flag, `seed`, `candidate_group_uid`, `candidate_group_size`, `fee_eras` | `submission_uid`, normalized `params`, `cmd`, `model_config`, `candidate_index`, `candidate_label`, `status`, `markets_persisted`, `failures_count`, segments, market rows, failure rows, `ledger_uri` |

In market rows, `rules_source`, `rules_snapshot_ids` and `fee_era` are equal
across the candidates of a market; `unverified_rules` is per candidate
(42 §3.5).

### 9.2 `cmd` is standalone-equivalent

Each row's `cmd` MUST be a runnable standalone command: the submitted command
without `--candidates` and `--candidates-out`, with the same `--batchUid`, every
normalized param as `--param key=value` (JSON for non-scalars, shell-quoted),
`--seed <runSeed>`, every run-level flag that was given (for example
`--ledger`, `--allow-mixed-fee-eras`, 42 §3.5, §7.5), and the trailing
`--starting-capital <x>` (as `src/cli/backtest.ts:358`). Variant candidates add
`--model-config-override '<canonical JSON>'`. Both `--seed` (native run seed)
and `--model-config-override` (internal) are producer flags whose job mapping is
defined in 21-job-and-output-contract.md; they MUST exist so that every stored
`cmd` is runnable. Because `--latest` and `--random` re-select at run time,
equivalence is defined over the same market set.

### 9.3 Extend

A candidate run is extended with the normal standalone `--extend <runId>`. The
extension runs single-candidate native jobs and inherits `model_config`, `seed`,
artifact sha and `engine` from the row (42-persistence-and-stats.md §5). The
parent's candidate columns are not modified. Extending a whole group in one
submission is a later feature.

## 10. Proof and measurement (M4)

Test details live in 60-verification.md. Required evidence:

1. For every candidate of a ≥ 10-candidate group over ≥ 200 markets:
   `backtest:verify-diff` on persisted rows shows the group run equal to the
   standalone run (market rows excluding `execution`; run summary excluding
   duration columns, `submission_uid`, `cmd` and candidate columns).
2. Shuffled candidate order, `T = 1` vs `T = max`, and both layouts give
   byte-identical outputs.
3. Standalone `--extend` of one candidate over more markets equals a fresh
   standalone run over the union.
4. Fault injection: one candidate panics on a chosen market; only its failure
   rows appear, and all other candidates equal the clean group.
5. Throughput at 1, 10 and 100 candidates (market-candidates per hour), executor
   peak RSS, and Redis peak for a 100 × 1,000 group are reported.

## 11. Dashboard and tooling

1. Run lists show a group badge and link to a group view listing all candidates
   of a `candidate_group_uid` with their segment metrics.
2. The active-batches view shows a group parent as one batch with its candidate
   count; child counting spans the native queue (40-fleet-integration.md §15).
3. Leaderboard: events are counted once per group market,
   `SUM(m.events_processed / COALESCE(r.candidate_group_size, 1))` with a join on
   `backtest_runs`; `marketsDone` becomes market-candidates and is labeled so;
   worker seconds need no change because `durationMs` is already divided.
4. `backtest:verify-diff` gains the exclusions of §10.1 behind an explicit flag.
5. Research protocols adopt groups (one coordinate pass = one group, the map
   output recorded in FAMILY.json) when their strategies are native, which is the
   follow-up goal (D16).

## Open questions

1. D13 says per-candidate `durationMs` = group wall time / N. When the executor
   fans the candidates of one market out over `w` threads, the wall time is
   about `w` times lower than the CPU time used, so worker-seconds on the
   leaderboard would be undercounted. This spec uses `w × wall time / N`
   (§7.4), which equals D13 when the group runs on one thread. Is that
   acceptable?
2. When a group exceeds `maxCandidates` or `maxCandidateMarkets`, should the
   producer refuse (this spec) or split it automatically into several groups that
   share the batch label?
