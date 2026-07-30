# Capability: backtest CLI

verified: 2026-07-30 @ 4fde3ae (code-survey via parallel readers + initializer spot-checks; NOT yet run-verified — PLAN `smoke-local-backtest`)

## Canonical launch (RULES-pinned)

```
npm run backtest -- --strategy <id> --input-mode telonex-delta \
  --read-from local-or-download-from-r2-to-local --symbol btc --timeframe 15m \
  --from-ms 1775088000000 --latency-delay-ms 140 --latency-jitter-ms 20 \
  --protocol pair-fable --model <model-id>
```

## Facts

- `--protocol` / `--model` exist; CLI wins over env `BACKTEST_PROTOCOL` / `BACKTEST_MODEL`; max 100/255 chars; stored in dedicated nullable columns `backtest_runs.protocol/model` with index `(protocol, model, created_at)`; also appear in `cmd` only when passed as flags. [code src/cli/helpers/backtestArgs.ts:274-288,551-585; src/db/schema.ts:118-121 @ 4fde3ae — spot-checked by initializer]
- Latency: `--latency-delay-ms` ?? env `BACKTEST_LATENCY_DELAY` (default 0); `--latency-jitter-ms` ?? env `BACKTEST_LATENCY_JITTER` (default **20**). Jitter forced to 0 when delay==0, so default runs are deterministic; delay>0 && jitter>0 ⇒ nondeterministic (Math.random). Latency is NOT a DB column — auditable only via `cmd`, and only when passed as flags. [code src/cli/backtest.ts:563-570; src/backtest/runSingleMarket.ts:140-145 @ 4fde3ae — spot-checked]
- **`--extend` does NOT replay parent latency** despite the code comment claiming it: latency flags are forbidden with `--extend` (backtestArgs.ts:487) and resolution falls through to env at extend time (backtest.ts:565-570); no code parses the parent's cmd. Extending a 140ms run with default env yields 0ms extension markets. → PROPOSALS P-001. **Until fixed: never `--extend` a latency-pinned run** (or export matching `BACKTEST_LATENCY_*` first — still leaves no audit trail). [code — spot-checked by initializer @ 4fde3ae]
- Default path = BullMQ FlowProducer: N `market` children on queue `backtest-markets` + 1 `aggregate-batch` parent on `backtest-aggregate`; child jobId `${submissionUid}-m-${idx}`. `--sequential` runs the same loop in-process, no Redis — REQUIRED for uncommitted/unpushed code (SHA gate). `--detach` enqueues and exits printing batchUid; Ctrl-C mid-wait also detaches (workers continue). [code src/cli/backtest.ts:884-1003,1155-1260]
- SHA gate: producer stamps `git rev-parse HEAD` into every job; blocks enqueue on dirty tree (tracked files only) unless BACKTEST_ALLOW_DIRTY=1. Workers run a job iff its SHA == worker's loaded SHA or is an ancestor of it. Unpushed commit ⇒ jobs bounce in delayed (15s cycles, no attempts consumed), workers exit 75, wrapper pull can't reach the commit, batch hangs silently. [code src/backtest/commitGate.ts:14-48; scripts/run-worker.sh:61-107]
- One run ⇒ one transaction writing: 1 `backtest_runs` row + N `backtest_run_markets` + `backtest_run_segments` (all/last_n/daily/weekly/monthly) + `backtest_run_failures`. Market children return stats as BullMQ return values; MySQL is written ONLY by the aggregate step. [code src/db/backtests.ts:374-487; src/backtest/aggregateProcessor.ts:59-220]
- Identity: `submission_uid` unique (flow identity, keys job ids); `batch_uid` NON-unique human group label, defaults to submission_uid. `cmd` = reconstructed argv with `--batchUid` injected (so grepping cmd for --batchUid matches every run). [code src/cli/backtest.ts:286-300,122-148]
- Market selection (telonex): `listEligibleTelonexMarkets({symbol, timeframe, converter:'delta-typed', readFrom, limit, random|latest, fromMs, toMs})`; `--from-ms/--to-ms` are wired NOW but were historically no-ops — old runs' cmd may show ignored bounds. `--latest`/`--random` require `--limit`. Zero eligible ⇒ exit 2. [code src/cli/backtest.ts:463-500]
- `INITIAL_CAPITAL` env (default 1000) is the only capital knob — pure reporting (capitalInitial on segments), never enforced against intents. No CLI flag.
- **Unknown `--flags` are silently dropped** (no error on typos like `--lattest`). Triple-check flag spelling; the launch tool must validate. [code src/cli/helpers/backtestArgs.ts:414-417]
- `--extend <runId>` forbids: --strategy, --param, --symbol, --timeframe, --input-mode, --read-from, --slug, --dir, positionals, --batchUid, --baselineId, --protocol, --model, --latency-*, --comment. Inherits all from parent; parent cmd/batch_uid/submission_uid never modified; concurrent extends blocked via `extending_at` (crash recovery: `UPDATE backtest_runs SET extending_at = NULL WHERE id = <runId>`).

## Open questions

- Aggregate-side commit gating not fully traced (market-side confirmed).
