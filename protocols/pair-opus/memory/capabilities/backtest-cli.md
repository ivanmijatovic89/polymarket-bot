# Capability: backtest CLI

verified: 2026-07-30 @ 6c457e4 (code-survey via parallel readers + initializer spot-checks; sequential path RUN-VERIFIED by PLAN `smoke-local-backtest` — runs 852/853; queue/fleet path RUN-VERIFIED by PLAN `fleet-round-trip` — runs 854 (20 markets) / 855 (200 markets), details in fleet.md)
watches: src/cli, src/backtest, src/db/telonexMarkets.ts

## Canonical launch (RULES-pinned)

```
npm run backtest -- --strategy <id> --input-mode telonex-delta \
  --read-from local-or-download-from-r2-to-local --symbol btc --timeframe 15m \
  --from-ms 1775088000000 --latency-delay-ms 140 --latency-jitter-ms 20 \
  --protocol pair-opus --model <model-id>
```

## Run-verified (2026-07-30, runs 852/853)

- The canonical RULES-pinned command works end-to-end with `--sequential --limit N`: exit code 0, one `backtest_runs` row + N market rows + segments in MySQL. [run 852 | 2026-07-30] [run 853 exit code checked exactly: EXIT=0]
- `backtest_runs` row carries protocol='pair-opus', model='claude-fable-5', params JSON ({price:0.1,size:10} from `--param`), and `cmd` = full argv incl. both latency flags, `--from-ms`, and injected `--batchUid`. batch_uid == submission_uid when no label passed. [db backtest_runs id=852 | 2026-07-30]
- **Sequential mode prints NO run id and NO batchUid** — nothing on stdout identifies the run (sequential persists silently between replay and BATCH STATS, code src/cli/backtest.ts:1052-1096 @ 433647d). Recover the run by querying newest `backtest_runs` for protocol+model, or match `cmd`. Racy with parallel launches → PROPOSALS P-003; tools must query DB immediately after launch. [run 853 | 2026-07-30]
- **Deterministic run-id recovery (P-003 workaround, run-verified)**: pass a self-generated unique `--batchUid` — it persists in sequential mode too (`backtest.ts:291,299,1060` — `chosenLabel = parsed.batchUid`, sequential persist includes it), so `SELECT ... FROM backtest_runs WHERE batch_uid = ?` (indexed) recovers the run with no newest-row race on BOTH paths. `submission_uid` then becomes `<batchUid>--<uuid>`. This is what tools/run-backtest.ts does on every launch (label prefix + UTC stamp + rand). [run 857 batch_uid=smoke-20260730T194744-4vrhbh | 2026-07-30]
- **Queue path prints batchUid + submissionUid at enqueue** (`enqueueing flow batchUid=... submissionUid=...`) but also no numeric run id; recover it deterministically via `WHERE submission_uid='<uid>'` (unique column, no race). Queue path prints progress + `aggregator done` but NOT the BATCH STATS block sequential prints. [run 854/855 | 2026-07-30]
- Selection with `--from-ms <floor> --limit N` (no --latest/--random) = oldest-first, consecutive slugs from the floor (852 got epochs 1775088000..1775091600, 900s apart; floor epoch = exactly 2026-04-02T00:00Z). [db run 852 slugs | 2026-07-30]
- Market rows get machine_id + commit_sha even in sequential mode; this producer's machine_id is `8955f8d87c59`, sha stamped = HEAD at launch (433647d). fleet-round-trip must show OTHER machine_ids. [db run 852 | 2026-07-30]
- Segments written for a 5-market run: all + daily + weekly + monthly, NO last_n — last_n rows exist only when markets ≥ bucket (LAST_N_BUCKETS=[500,1000,3000,6000]). All segment values matched printed BATCH STATS exactly (pnl −5, 5/5 played, 5 maker trades, fees 0). [db run 852 segments; code src/backtest/stats/backtestSegments.ts:40,179-184 @ 433647d]
- Speed anchor (local sequential, producer M1 Pro, warm local parquet): 5 markets in 7.7s wall ≈ 1.5 s/market — matches the RULES anchor for local. [run 852 durationWallClockMs=7712 | 2026-07-30] Fleet speed now measured: ~870 markets/min sustained, avg 1.61 s/market/slot over 27 slots — see fleet.md. [run 855 | 2026-07-30]
- Replay reality check: a 15m market ≈ 125k `price_change` + ~0.5k `book` events (623,627 events / 5 markets). [run 852 orderbook summary | 2026-07-30]
- `[read-from] LOCAL hit` lines confirm local-or-download-from-r2-to-local reads local files when present (no R2 traffic for covered slugs). [run 852 log | 2026-07-30]

## Facts

- `--protocol` / `--model` exist; CLI wins over env `BACKTEST_PROTOCOL` / `BACKTEST_MODEL`; max 100/255 chars; stored in dedicated nullable columns `backtest_runs.protocol/model` with index `(protocol, model, created_at)`; also appear in `cmd` only when passed as flags. [code src/cli/helpers/backtestArgs.ts:274-288,551-585; src/db/schema.ts:118-121 @ 4fde3ae — spot-checked by initializer] [db run 852 columns confirmed | 2026-07-30]
- Latency: `--latency-delay-ms` ?? env `BACKTEST_LATENCY_DELAY` (default 0); `--latency-jitter-ms` ?? env `BACKTEST_LATENCY_JITTER` (default **20**). Jitter forced to 0 when delay==0, so default runs are deterministic; delay>0 && jitter>0 ⇒ nondeterministic (Math.random). Latency is NOT a DB column — auditable only via `cmd`, and only when passed as flags. [code src/cli/backtest.ts:563-570; src/backtest/runSingleMarket.ts:140-145 @ 4fde3ae — spot-checked]
- **`--extend` does NOT replay parent latency** despite the code comment claiming it: latency flags are forbidden with `--extend` (backtestArgs.ts:487) and resolution falls through to env at extend time (backtest.ts:565-570); no code parses the parent's cmd. Extending a 140ms run with default env yields 0ms extension markets. → PROPOSALS P-001. **Until fixed: never `--extend` a latency-pinned run** (or export matching `BACKTEST_LATENCY_*` first — still leaves no audit trail). [code — spot-checked by initializer @ 4fde3ae]
- Default path = BullMQ FlowProducer: N `market` children on queue `backtest-markets` + 1 `aggregate-batch` parent on `backtest-aggregate`; child jobId `${submissionUid}-m-${idx}`. `--sequential` runs the same loop in-process, no Redis — REQUIRED for uncommitted/unpushed code (SHA gate). `--detach` enqueues and exits printing batchUid; Ctrl-C mid-wait also detaches (workers continue). [code src/cli/backtest.ts:884-1003,1155-1260]
- SHA gate: producer stamps `git rev-parse HEAD` into every job; blocks enqueue on dirty tree (tracked files only) unless BACKTEST_ALLOW_DIRTY=1. Workers run a job iff its SHA == worker's loaded SHA or is an ancestor of it. Unpushed commit ⇒ jobs bounce in delayed (15s cycles, no attempts consumed), workers exit 75, wrapper pull can't reach the commit, batch hangs silently. [code src/backtest/commitGate.ts:14-48; scripts/run-worker.sh:61-107]
- One run ⇒ one transaction writing: 1 `backtest_runs` row + N `backtest_run_markets` + `backtest_run_segments` (all/last_n/daily/weekly/monthly) + `backtest_run_failures`. Market children return stats as BullMQ return values; MySQL is written ONLY by the aggregate step. [code src/db/backtests.ts:374-487; src/backtest/aggregateProcessor.ts:59-220]
- Identity: `submission_uid` unique (flow identity, keys job ids); `batch_uid` NON-unique human group label, defaults to submission_uid. `cmd` = reconstructed argv with `--batchUid` injected (so grepping cmd for --batchUid matches every run). [code src/cli/backtest.ts:286-300,122-148]
- Market selection (telonex): `listEligibleTelonexMarkets({symbol, timeframe, converter:'delta-typed', readFrom, limit, random|latest, fromMs, toMs})`; `--from-ms/--to-ms` are wired NOW but were historically no-ops — old runs' cmd may show ignored bounds. `--latest`/`--random` require `--limit`. Zero eligible ⇒ exit 2. [code src/cli/backtest.ts:463-500]
- **No `--limit` does NOT mean full universe — silent LIMIT 1000**: `listEligibleTelonexMarkets` defaults `limit ?? 1000` ("to match legacy behaviour", src/db/telonexMarkets.ts:117,276), so an unlimited-looking run replays only the 1000 OLDEST eligible markets from the floor. Run 864 launched as "full" persisted exactly 1000/10747. → PROPOSALS P-008. tools/run-backtest.ts injects an explicit `--limit 1000000` since d8b8cc9, making launcher no-limit truly full-universe (run 870: 10747 markets). [run 864/870 | 2026-07-30]
- **Dirty-tree gate fires on ANY tracked-file change** — including `protocols/*/tools/` edits that never affect worker strategy code: queue launch exits 2 with "Working tree has uncommitted changes". Commit+push before any fleet submission, even for tool-only diffs (or run --sequential). [pf0-fullreal first attempt, 2026-07-30]
- `INITIAL_CAPITAL` env (default 1000) is the only capital knob — pure reporting (capitalInitial on segments), never enforced against intents. No CLI flag.
- **Unknown `--flags` are silently dropped** (no error on typos like `--lattest`). Triple-check flag spelling; the launch tool must validate. [code src/cli/helpers/backtestArgs.ts:414-417]
- `--extend <runId>` forbids: --strategy, --param, --symbol, --timeframe, --input-mode, --read-from, --slug, --dir, positionals, --batchUid, --baselineId, --protocol, --model, --latency-*, --comment. Inherits all from parent; parent cmd/batch_uid/submission_uid never modified; concurrent extends blocked via `extending_at` (crash recovery: `UPDATE backtest_runs SET extending_at = NULL WHERE id = <runId>`).

## Open questions

- Aggregate-side commit gating not fully traced (market-side confirmed).
