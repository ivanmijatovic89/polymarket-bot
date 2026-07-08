# Tool: checkBatch

## Purpose

Answer "is this experiment's submitted backtest work finished?" by querying
the database for the experiment's recorded `submissionUids`. Completion is
operational state owned by the database — it is queried on demand and never
stored in family files.

## Use When

- An experiment is `running` and you need to know whether the finished work
  can be judged.
- A Researcher session starts and the family has a `running` experiment.

## Do Not Use When

- Nothing has been submitted yet (no `submissionUids` recorded).
- You need the actual results — use
  [`strategy-research-protocol/tools/getBacktestResults.md`](./getBacktestResults.md).

## Inputs

- `--family <slug> --experiment <experiment-id>` — reads `submissionUids`
  from the family's `FAMILY.json` (per pass for search experiments), or
- `--submission-uids <uid,uid,...>` — explicit handles.

## Implementation

Current implementation: script (read-only database query)

```bash
npm run research:check-batch -- --family book-imbalance --experiment 000-baseline
npm run research:check-batch -- --submission-uids <uid1>,<uid2>
```

A `backtest_runs` row exists for a `submissionUid` only after the aggregate
worker persists that run, so "row exists" = "run finished".

## Source Of Truth

- [`strategy-research-protocol/scripts/check-batch.ts`](../scripts/check-batch.ts)
- [`docs/backtest/statistics/result-storage.md`](../../docs/backtest/statistics/result-storage.md)

## Output

- Per pass (or per single-run experiment): persisted/total submissions, run
  ids, run status (`completed` / `partial` / `failed`), markets, failures.
- Final line `COMPLETE` (exit 0) or `INCOMPLETE` (exit 2).

## After Success

- On `COMPLETE`: judge the finished work per the Judging results section of
  [`strategy-research-protocol/modules/Researcher.md`](../modules/Researcher.md).
  Do not update family files just for completion — it is not memory.
- On `INCOMPLETE`: nothing to update; check again later.

## If It Fails

- Runs reported `partial`/`failed`: inspect with `getBacktestResults`; a
  broken submission may need a re-run under a `--rN` batchUid
  ([`strategy-research-protocol/rules/BATCH-UID.md`](../rules/BATCH-UID.md)).
- Database unreachable: fix env/config; this tool must stay read-only.
