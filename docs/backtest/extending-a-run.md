# Extending a Backtest Run

`--extend <runId>` takes an existing telonex backtest run and adds more
markets to it — re-using the same strategy and parameters. The parent
row in `backtest_runs` grows: new per-market results get appended, and
`batch_stats` + `chunked_batch_stats` get recomputed over the union of
existing + new markets, all in one DB transaction.

::: tip Same row, more markets
`--extend` does **not** create a new `backtest_runs` row. The parent
row's `id` stays the same; its `batch_uid` is overwritten with a
`-extN` suffix on each extend; everything else (stats, capital_final,
chunked_batch_stats, per-market rows) updates in place.
:::

## The mechanics

You start with an existing run. Suppose it's run **#103**, originally
launched as:

```bash
npm run backtest -- --strategy X --param ... \
  --input-mode telonex-delta --read-from local \
  --symbol btc --timeframe 15m --latest --limit 6000
```

That run covers 6000 telonex markets. There are, say, 18,000 eligible
markets in total — so 12,000 are uncovered.

To run the same strategy + params on **all 12,000 uncovered** markets:

```bash
npm run backtest -- --extend 103
```

After this completes, run **#103 still exists with the same id**, but
its `marketsTotal` is now ~18,000 and its stats reflect the union.
Strategy, params, symbol, timeframe, converter, read-from — all
inherited from the parent. You don't (and can't) pass them again.

## Adding fewer markets at a time

You don't have to extend to "all". Pass `--limit` to cap the chunk. The
**direction** of the extension — whether it grows the run backward in
time (older markets) or forward (newer ones) — is set by whether you
pass `--latest`:

- **default (no `--latest`)** → extend **backward** from covered. Takes
  the markets immediately **before** the parent's oldest covered
  market.
- **`--latest`** → extend **forward** from covered. Takes the markets
  immediately **after** the parent's newest covered market.

Both modes pick the markets **closest to the covered block's edge**, not
"newest globally" — so an extension grows the contiguous covered region
in one direction at a time.

To picture this, imagine every eligible market for `(symbol, timeframe,
converter, readFrom)` placed on a timeline by `market_start_ms`. Some
slots are filled by the parent run, the rest are open:

```
Eligibility floor                            Newest synced market
(TELONEX_DATASET_ELIGIBLE_FROM)
            │                                                  │
            ▼                                                  ▼
            ░░░░░░░░░░░░░░░░ ███████████████████ ░░░░░░░░░░░░░░
            ⌃                                                  ⌃
            │                  parent run #103                 │
            │                  (latest 6000)                   │
            │                                                  │
            └─ uncovered ──┬──── covered ────┬── uncovered ────┘
              (older end)                     (newer end —
                                               appears after
                                               Telonex syncs
                                               new markets)
```

### Backward (default): grow into older history

Running **`--extend 103 --limit 500`** picks up the 500 markets
immediately before the covered block starts. The covered block expands
to the left:

```
Before:     ░░░░░░░░░░░░░░░░ ███████████████████ ░░░░░░░░░░░░░░
                             ⌃ parent covers     ⌃
                               only this slice

Step 1:     ░░░░░░░░░░░ █████████████████████████ ░░░░░░░░░░░░░░
                        ⌃                       ⌃
                        └── +500 (just added)
                          ── parent covered ───┘
```

Now run **`--extend 103 --limit 1000`** again. It picks the next 1000
markets immediately before the (now-larger) covered block:

```
Step 2:     ░ ██████████████████████████████████ ░░░░░░░░░░░░░░
              ⌃                                ⌃
              └── +1000 (just added)
                ── parent covered (1500 more) ─┘
```

Each `--limit N` consumes more of the older-uncovered region until
nothing's left on that side.

### Forward (`--latest`): grow into newer history

If new markets have been synced after the parent ran, the same idea
works in the other direction. **`--extend 103 --latest --limit 500`**
picks up the 500 markets immediately after the covered block ends:

```
Before:     ░░░░░░░░░░░░░░░░ ███████████████████ ░░░░░░░░░░░░░░
                             ⌃                 ⌃
                             └── parent covered

Step 1:     ░░░░░░░░░░░░░░░░ ██████████████████████████ ░░░░░░░
                                                  ⌃    ⌃
                                                  └── +500 (just added)
                          ── parent covered ─────────┘
```

Running **`--extend 103 --latest --limit 1000`** again picks the next
1000 markets immediately after the new edge:

```
Step 2:     ░░░░░░░░░░░░░░░░ ████████████████████████████████ ░
                                                       ⌃    ⌃
                                                       └── +1000
                          ── parent covered (1500 more) ───┘
```

If you don't pass `--limit`, the chunk size is "all uncovered in the
chosen direction" — every open slot in that direction gets queued.

::: tip Typical research workflow
You usually launch the parent with `--latest --limit N` (`latest 500`,
then a fresh `latest 1000`, then `latest 3000`, then `latest 6000`).
Each is a separate `backtest_runs` row covering the newest N markets.

When you're satisfied at `latest 6000` and want that same run to
cover *all* history, `--extend <runId>` grows it **backward** in chunks:

```bash
npm run backtest -- --extend 103 --limit 500    # adds previous 500
npm run backtest -- --extend 103 --limit 1000   # adds 1000 more
npm run backtest -- --extend 103                # all remaining backward
```

If Telonex syncs new markets later, `--extend 103 --latest` grows the
same run **forward** to catch them.
:::

### When backward / forward has nothing to take

- The parent's covered block starts at the eligibility floor (no markets
  exist before it): **default backward errors**, telling you to use
  `--latest` instead.
- The parent's covered block ends at the newest available market (no
  Telonex syncs since): **`--latest` errors**, telling you the default
  goes backward.

The error messages call out which flag to use, so you don't have to guess.

## Restricting the time window

`--from-ms` / `--to-ms` filter candidates to a specific
`market_start_ms` range (milliseconds since epoch, matching the
`telonex_markets.market_start_ms` column):

```bash
# All uncovered markets between 2026-01-01 and 2026-02-01 UTC
npm run backtest -- --extend 103 \
  --from-ms 1767225600000 --to-ms 1769904000000

# 500 oldest uncovered markets that start on or after 2026-01-01 UTC
npm run backtest -- --extend 103 \
  --from-ms 1767225600000 --limit 500
```

## Catching up on newly synced markets

When the Telonex sync brings in new eligible markets weeks after the
parent run was launched, just re-run `--extend 103` — the planner
re-computes the uncovered set against the *current* eligibility
universe and picks up whatever's new.

## What's inherited from the parent, what isn't

The parent run defines the **strategy** and the **eligible universe**:

| Source            | What it contributes                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| Parent run        | `strategy`, `params`, `symbol`, `timeframe`, `input_mode`, `converter`, `read_from`                          |
| `--extend` invocation | `--limit`, `--latest`, `--random`, `--from-ms`, `--to-ms`                                                |

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

`--comment` is rejected with `--extend`; the parent run's original comment
is preserved.

Failed slugs can be retried by a subsequent `--extend`; when the slug
succeeds, its old failure row is removed from the parent run.

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

Two `--extend <same id>` invocations at once would race the candidate-set
planning (both reading the same "covered" set, both picking overlapping
slugs). To prevent corruption, `backtest_runs.extending_at` is set to
`NOW()` atomically when an extension flow enqueues, and cleared in the
same transaction as the merge UPDATE. A second concurrent extend on the
same run gets a clear error:

```
[backtest] --extend 103: another extension is already in progress
(extending_at = 2026-06-06T16:28:44.000Z). Wait for it to finish, or —
if the previous extender crashed — release the lock with:
  UPDATE backtest_runs SET extending_at = NULL WHERE id = 103;
```

If a process crashes mid-extend (kill -9, terminal closed, etc.) the
lock won't release on its own. Run the printed UPDATE manually.
Extensions of **different** runs are fine — they share no lock state.

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
