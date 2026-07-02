# Batch UID

A batchUid is the label a backtest submission gets (`--batchUid <id>`). It is
how results are found later — in the dashboard, in the database, and from the
result references in `src/strategies/research/<family>/FAMILY.json`.

## Format

One experiment = one batchUid:

```text
<family>--<experiment-id>

book-imbalance--002-persistence-filter
```

The name builds itself from
[`strategy-research-protocol/rules/FAMILY-NAMING.md`](./FAMILY-NAMING.md) and
[`strategy-research-protocol/rules/EXPERIMENT-NAMING.md`](./EXPERIMENT-NAMING.md).
No creativity allowed.

## Param search

All cells of a sweep run under the **same** batchUid — one batch, many runs
inside it:

- the batch answers "how did this experiment do"
- the runs inside it answer "how did each param combination do"

## Re-runs

If the same experiment must be submitted again (bug, bad data, broken run),
append a counter:

```text
book-imbalance--002-persistence-filter--r2
book-imbalance--002-persistence-filter--r3
```

- Never reuse a batchUid for a different experiment or different params.
- The experiment's result reference in `FAMILY.json` points to the batchUid
  that counts; superseded batchUids stay in the database as history.
