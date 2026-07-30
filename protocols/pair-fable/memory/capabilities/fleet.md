# Capability: fleet & queues

verified: 2026-07-30 @ 4fde3ae (code-survey; NOT yet run-verified — PLAN `fleet-round-trip`)

## Topology

- Queues (BullMQ on REDIS_URL): `backtest-markets` (N children, forked single-concurrency worker processes) + `backtest-aggregate` (parent, in-process worker). Import queue names from `src/backtest/queue.ts` (dashboard duplicates them in dashboard/src/lib/queue.ts — do not copy that). [code src/backtest/queue.ts:11-34]
- Market children return MarketStats as job return values; MySQL is written only by the aggregate step. Aggregate parent is removeOnComplete:true ⇒ after finalize, MySQL (`backtest_runs` by submission_uid) is the ONLY durable record.
- Job opts: market attempts:3 (exp backoff 5s); aggregate attempts:3 but attempts:1 for extensions (MySQL merge not atomic with ack). Failed children flow into failure records via ignoreDependencyOnFailure.
- Fleet (RULES): worker-1 (M4, 8 slots, markets+aggregate), worker-2 (M4, 8, markets), m1-milan (M1, 6, markets); m5-milan disabled; m1-ivan is PRODUCER — never run workers there. Real inventory is untracked `ops/ansible/inventory.ini`.

## SHA gating / self-update

Producer stamps HEAD into every job; worker runs job iff SHA == its loaded SHA or ancestor of it. Stale worker: job → delayed +15s (no attempt consumed), worker exits 75, run-worker.sh does git pull --ff-only + relaunch; if HEAD unchanged after pull (unpushed commit) wrapper exits 1 and the batch hangs silently — **always push before submitting; use --sequential for local code**. Gate silently disabled when worker has no git metadata. [code src/backtest/commitGate.ts; scripts/run-worker.sh:61-107]

## Ops commands

- `npm run fleet:status` — ansible probe: git/sessions/cores/disk/datasets per host.
- `npm run fleet:git:pull` — fast (~4-7s) pull+drain+restart, refuses dirty/LOCAL_AHEAD hosts.
- `npm run fleet:start|stop` — drain = tmux C-c + SIGTERM + bounded wait (in-flight jobs finish).
- `npm run bull-board` — UI on :3052. Dashboard :3051 mission-control shows runs.

## Programmatic status (for our fleet.ts tool — reuse, don't reinvent)

- Queue counts: `queue.getJobCounts('waiting','active','completed','failed','delayed','waiting-children')` on both queues (pattern: dashboard/src/lib/queries/queues.ts).
- Active batches: scan aggregate jobs in [waiting-children,waiting,active,delayed], `job.getDependenciesCount({processed,unprocessed})`; **BullMQ getJobs silently caps pages at 200 — always paginate**.
- Worker liveness: Redis hash `backtest:worker:<machineId>#<role>` + `...:heartbeat` (EX 60, rewritten 5s; alive = age <30s). Ghost rows persist until pruned — check heartbeat age, not existence.
- getChildrenValues/getFailedChildrenValues return Redis-key form `bull:<queue>:<jobId>` — normalize before queue.getJob().

## Speed (planning numbers — re-verify per RULES)

~1.5 s/market/slot (stale anchor); ~22 active slots ⇒ full protocol universe (≈11k markets ≥2026-04-02) in ~15 min idle-fleet. Re-measure in PLAN `fleet-round-trip` before relying on it.

## Failure/retry semantics

Per-market failures land in `backtest_run_failures` (reason; unresolved_outcome / no_resolution / missing_child_result / exhausted retries); run status completed|partial|failed. Failed slugs are retryable by `--extend` (success deletes the failure row) — but note the extend-latency bug (backtest-cli.md, P-001) before extending latency-pinned runs. Crash mid-extend: clear `extending_at` manually.
