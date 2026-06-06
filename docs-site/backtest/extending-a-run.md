# Extending a Backtest Run

Sometimes you want to take a backtest that already produced solid results
and run **the same strategy + params** over more markets — without losing
the original result or having to re-run everything from scratch. The
`--extend <runId>` flag does exactly this.

::: tip One backtest_runs row, growing
An extension does **not** create a new row in `backtest_runs`. It appends
new per-market results into the parent row and **recomputes** that row's
`batch_stats` and `chunked_batch_stats` over the union of existing + new
markets. The parent's id never changes. The `batch_uid` is updated to
reflect the latest extend (`-ext1`, `-ext2`, …).
:::

## When to use it

The canonical research workflow looks like this:

```bash
# 1. Iterate on params with small fast batches
npm run backtest -- --strategy X --param ... \
  --input-mode telonex-delta --read-from local \
  --symbol btc --timeframe 15m --latest --limit 500
# → creates run #100

# 2. Once the params look good, scale up with fresh runs
npm run backtest -- --strategy X --param ... \
  --input-mode telonex-delta --read-from local \
  --symbol btc --timeframe 15m --latest --limit 1000
# → creates run #101

# 3. After validating at 1000, 3000, 6000 etc, you have run #103 covering
#    the "elite 6000". Now run the full universe on top of it:
npm run backtest -- --extend 103
# → run #103 grows from 6000 to ~all eligible markets,
#   its batch_stats / chunked_batch_stats recompute over the union.
```

You can also extend in chunks:

```bash
# Run #103 currently has 6000 markets. Add 2000 more oldest-missing:
npm run backtest -- --extend 103 --limit 2000

# Add only markets in a specific time window:
npm run backtest -- --extend 103 \
  --from-ms 1764547200000 --to-ms 1767139200000

# Add 500 oldest-missing within a window:
npm run backtest -- --extend 103 \
  --from-ms 1764547200000 --limit 500
```

When Telonex syncs new markets weeks later, run the same command again —
it picks up whatever's newly eligible.

## What's inherited from the parent, what isn't

The parent run defines the **strategy** and the **eligible universe**:

| Source            | What it contributes                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| Parent run        | `strategy`, `params`, `symbol`, `timeframe`, `input_mode`, `converter`, `read_from`                          |
| `--extend` invocation | `--limit`, `--latest`, `--random`, `--from-ms`, `--to-ms`, `--comment`                                   |

Trying to combine `--extend` with any of the inherited flags fails loudly:

```
$ npm run backtest -- --extend 103 --strategy OtherStrategy.v1
[backtest] --extend 103 cannot be combined with: --strategy. These are
inherited from the parent run.
```

Trying to extend a `recorded`-mode run (or a legacy run with no coverage
metadata) also fails with a clear message. For legacy runs, run
`scripts/backfill-backtest-coverage-meta.ts` first to populate the
`input_mode` / `converter` / `read_from` / `timeframe` columns.

`--random` and `--latest` are **per-invocation** flags — even if the
parent was run with `--latest`, that doesn't transfer. Default order is
**oldest-first**; pass `--latest` for newest-first, or `--from-ms` to bias
the selection to a specific window.

## How `--limit` interacts with `--from-ms` / `--to-ms`

The flags compose:

| Invocation                                       | Resulting candidate set                              |
| ------------------------------------------------ | ---------------------------------------------------- |
| `--extend N`                                     | All eligible markets minus the ones the parent ran   |
| `--extend N --limit M`                           | M oldest-missing                                     |
| `--extend N --from-ms X --to-ms Y`               | All missing with `market_start_ms` in `[X, Y]`       |
| `--extend N --from-ms X --to-ms Y --limit M`     | M oldest-missing within `[X, Y]`                     |
| `--extend N --latest --limit M`                  | M newest-missing                                     |

`market_start_ms` is the slug-derived window-start epoch in milliseconds,
indexed on `telonex_markets`. See
[Run a Backtest (Telonex)](/datasets/telonex/backtest) for how to find
it.

## What the pre-flight log shows

Before any BullMQ jobs are queued or any DB write happens, the CLI prints
a summary:

```
[backtest] Extending run #103 (SplitSellRedeem.v5 / btc / 15m / delta-typed / local)
[backtest] Parent covered: 6,000 / 18,000 eligible-in-range (33%)
[backtest] Extending by 500 markets (limited from 12,000), order=oldest-first
[backtest] First market: 2026-01-04T00:45:00.000Z, last: 2026-01-09T12:30:00.000Z
[backtest] New batchUid: <parent>-ext3
```

If nothing matches the filter, the CLI exits cleanly with
`nothing to extend — no missing markets match the filter` and writes nothing.

## Concurrency

Concurrent extensions of the same run are **not supported**. There's no
explicit lock — the DB transaction uses `SELECT ... FOR UPDATE` on the
parent row to serialise the actual merge step, but if two extensions are
planned simultaneously they may pick overlapping candidate sets and the
second one will fail with a duplicate-idx error. Just don't run
`--extend <N>` twice in parallel against the same run.

Extensions of **different** runs are fine — they share no state at the
parent-row level.

## Verification: extension equals fresh

Phase 2 of the feature was implemented against an equality invariant:
running a fresh `--limit 20` and a `--limit 10` followed by `--extend N
--limit 10` produce **bit-identical** stats columns. The chunked stats
JSON also matches exactly. If you ever see a mismatch, that's a bug —
file an issue with the two `backtest_runs` row dumps attached.

## See also

- [Running Backtests](/backtest/running-backtests) — basics, flags, env
- [Run Statistics](/backtest/statistics/run-statistics) — what each
  column on `backtest_runs` means
- [Chunked Batch Statistics](/backtest/statistics/chunked-batch-statistics) —
  how the recomputed segment stats work
