# Batch UID

A batchUid is the human-chosen grouping label a backtest submission gets
(`--batchUid <id>`). It is how results are grouped later — in the dashboard,
in the database, and from `src/strategies/research/<family>/FAMILY.json`.

Exact per-run tracking uses `submissionUids` (auto-generated, identical in
Redis and `backtest_runs.submission_uid`), recorded in FAMILY.json at submit
time. The batchUid groups; the submissionUids identify.

## Format

```text
<family>--<experiment-id>[--<suffix>]
```

The name builds itself from
[`strategy-research-protocol/rules/FAMILY-NAMING.md`](./FAMILY-NAMING.md) and
[`strategy-research-protocol/rules/EXPERIMENT-NAMING.md`](./EXPERIMENT-NAMING.md).
No creativity allowed. One experiment normally produces SEVERAL batchUids
(smoke, one per coordinate pass, refinements, re-runs) — that is expected.

## Suffixes

| suffix         | meaning                                           | example                                           |
| -------------- | ------------------------------------------------- | ------------------------------------------------- |
| `--smoke`      | smoke test; never evidence, never freezes code    | `book-imbalance--000-baseline--smoke`             |
| `--pN-<param>` | coordinate-search pass N sweeping `<param>`       | `book-imbalance--000-baseline--p1-enterThreshold` |
| `--refine`     | Evaluator-requested refinement mini-grid          | `book-imbalance--000-baseline--refine`            |
| `--rN`         | re-run after a bug / bad data / broken submission | `book-imbalance--002-persistence-filter--r2`      |

A single-run experiment (`kind: variation` with fixed `params`) uses the bare
`<family>--<experiment-id>` label.

## Rules

- All cells of one pass share that pass's batchUid — the batch answers "how
  did this pass do", each run inside answers "how did this value do".
- Never reuse a batchUid for a different effective experiment or different
  params. A re-run gets the next `--rN`.
- FAMILY.json records which batchUids count; superseded batchUids stay in the
  database as history.
- Stage extensions (`extendBacktest`) grow existing runs and do NOT change
  the batchUid.
