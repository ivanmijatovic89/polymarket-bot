# Capability: fleet & queues

verified: 2026-07-30 @ 6c457e4 (RUN-VERIFIED by PLAN `fleet-round-trip` — runs 854 (20 markets) and 855 (200 markets), canonical RULES-pinned batches submitted from this producer)
watches: src/backtest, scripts/run-worker.sh, ops

## Topology

- Queues (BullMQ on REDIS_URL): `backtest-markets` (N children, forked single-concurrency worker processes) + `backtest-aggregate` (parent, in-process worker). Import queue names from `src/backtest/queue.ts` (dashboard duplicates them in dashboard/src/lib/queue.ts — do not copy that). [code src/backtest/queue.ts:11-34]
- Market children return MarketStats as job return values; MySQL is written only by the aggregate step. Aggregate parent is removeOnComplete:true ⇒ after finalize, MySQL (`backtest_runs` by submission_uid) is the ONLY durable record. [run 854: queues showed all-zero counts 3s after aggregate finalize; batch job gone | 2026-07-30]
- Job opts: market attempts:3 (exp backoff 5s); aggregate attempts:3 but attempts:1 for extensions (MySQL merge not atomic with ack). Failed children flow into failure records via ignoreDependencyOnFailure.

## Run-verified submission mechanics (2026-07-30, runs 854/855)

- Canonical RULES-pinned command WITHOUT `--sequential` = fleet submission. Prints at enqueue: `enqueueing flow batchUid=<uid> submissionUid=<uid> totalMarkets=N commitSha=<sha8>` then `enqueued: aggregate jobId=<uid>-agg`, then progress lines `[N/M] completed/failed/elapsed/eta`, then `aggregator done: succeeded/failed/skipped` and a wall timer. **The numeric run id is NOT printed** (neither path prints it) — recover deterministically via `SELECT id FROM backtest_runs WHERE submission_uid='<printed uid>'` (unique column; unlike the sequential path's racy newest-row query, P-003). [run 854/855 | 2026-07-30]
- Submission wall time includes a pre-enqueue eligibility+meta phase (~30-60s for 200 markets: telonex eligibility query + per-market meta print) BEFORE `enqueueing flow` appears. Don't diagnose a hang until that phase is past.
- Batch of 20: 20/20 succeeded, exit 0, 21.9s total incl. fleet self-update bounce. Batch of 200: 200/200 succeeded, exit 0, 19.0s from enqueue (fleet already warm). Zero manual intervention. [run 854, 855 | 2026-07-30]
- Provenance lands: backtest_runs.protocol='pair-opus', model='claude-fable-5', cmd = full argv incl. latency flags + injected --batchUid. [db run 854/855 | 2026-07-30]
- machine_id on market rows shows real fleet machines. Run 855 distribution: 527674ef4858×74, da1482db09f6×64, 5a69e8aa2068×36, 8955f8d87c59×26. Run 854 (small batch): only 2 machines got jobs — **small batches don't exercise all machines** (a machine mid-self-update gets skipped entirely). [db run 854/855 group-by machine_id | 2026-07-30]

## SHA gating / self-update — OBSERVED LIVE

Producer stamps HEAD into every job; worker runs job iff SHA == its loaded SHA or ancestor of it. Stale worker: job → delayed +15s (no attempt consumed), worker exits 75, run-worker.sh does git pull + relaunch. [code src/backtest/commitGate.ts; scripts/run-worker.sh:61-107]
- Observed: pre-batch fleet at 2b73aac (older main commit), producer-machine workers at c80bb2f (a commit NOT on main — pair-docs branch). Submitting jobs stamped 6c457e4 flipped ALL machines to 6c457e4 within ~19s (first market completed t+17s incl. the bounce; remaining 19 in the next 4s). Even the non-main-SHA worker reached 6c457e4. [run 854; fleet.ts snapshots 19:16:56 vs 19:18:08 | 2026-07-30]
- Unpushed commit ⇒ batch hangs silently (wrapper can't pull the SHA) — **always push before submitting; --sequential for local code**. [code scripts/run-worker.sh:61-107 — not deliberately triggered]

## Fleet reality (observed 2026-07-30 — differs from RULES table!)

| machine_id | slots seen | note |
|---|---|---|
| 527674ef4858 | 8 workers + supervisor | fleet (M4 class per RULES) |
| da1482db09f6 | 8 workers + supervisor | fleet (M4 class per RULES) |
| 5a69e8aa2068 | 6 workers + supervisor | fleet (m1-milan per RULES 6 slots) |
| 8955f8d87c59 | 5 workers + supervisor | **the PRODUCER machine** (machine_id matches run 852's sequential run). RULES says no workers here, but 5 slots are live and took 26 markets in run 855 → P-004 filed, await human ruling |

Total observed capacity: 27 market slots (22 fleet + 5 producer).

## Programmatic status — tools/fleet.ts (BUILT, use it)

`tsx protocols/pair-opus/tools/fleet.ts [--json]` — queue counts (both queues, incl. waiting-children), worker liveness, active aggregate batches with processed/unprocessed child counts. Verified against a live batch (caught mid/post-run worker state; batches < ~20s finish faster than polling). Patterns inside:
- Queue counts: `queue.getJobCounts('waiting','active','completed','failed','delayed','waiting-children')`.
- Worker liveness: Redis hash `backtest:worker:<machineId>#<role>` + `...:heartbeat` key (EX 60, rewritten ~5s; alive = age <30s). Ghost hashes persist — check heartbeat AGE, not key existence. Hash fields: commitSha, branchName, processedTotal, eventsTotal, lastMarket, lastFinishedAt, queues. `processedTotal` resets on worker restart (self-update) — per-batch attribution comes from DB machine_id, not this counter.
- Active batches: aggregate jobs in [waiting-children,waiting,active,delayed] + `job.getDependenciesCount({processed,unprocessed})`; **BullMQ getJobs silently caps pages at 200 — paginate**.
- getChildrenValues/getFailedChildrenValues return Redis-key form `bull:<queue>:<jobId>` — normalize before queue.getJob().
- Cross-checked against Bull Board 2026-07-30: fleet.ts queue counts match Bull Board's API (`GET :3052/admin/queues/api/queues` — note the API lives UNDER the /admin/queues base path, `/api/queues` alone 404s) exactly on both queues (idle state, all zeros; active-state pipeline verified earlier via runs 854/855). 31/31 workers alive at the time. [tool output | 2026-07-30]

## Speed (RUN-VERIFIED 2026-07-30 — replaces the stale ~1.5s anchor)

- Per-market per-slot replay: avg 1.61s over 200 markets (min 0.37s, max 6.5s; producer-machine slots slowest at avg 2.4s — it also runs everything else). [db run 855 segments duration_avg_ms=1609.83 | 2026-07-30]
- **Sustained fleet throughput: ~870 markets/min** (200 markets, wall clock 13.8s across 27 slots, warm fleet, early-April markets). [db run 855 duration_wall_clock_ms=13796 | 2026-07-30]
- Full protocol universe (≈11k markets ≥2026-04-02) ⇒ ~13-16 min idle-fleet, consistent with the RULES anchor. Caveats: later (busier) markets have more events per market and may run slower than these April-1 samples; cold fleet adds a ~15-20s self-update bounce.

## Failure/retry semantics

Per-market failures land in `backtest_run_failures` (reason; unresolved_outcome / no_resolution / missing_child_result / exhausted retries); run status completed|partial|failed. Failed slugs are retryable by `--extend` (success deletes the failure row) — but note the extend-latency bug (backtest-cli.md, P-001) before extending latency-pinned runs. Crash mid-extend: clear `extending_at` manually. (Code-verified; no failures occurred in runs 854/855 to observe live.)
