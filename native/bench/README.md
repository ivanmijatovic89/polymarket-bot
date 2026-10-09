# Native bench sets

Frozen market sets for the native engine benchmarks
(`native/spec/16-performance-and-parallelism.md` §13). Every number in a bench
report names the set it ran on, and the set's manifest pins the exact source
files.

## Sets

| Set        | Content                                                                                                   | Purpose                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `smoke-50` | 50 BTC 15m telonex-delta markets, stratified by row count (588 to 378,134 rows; 6.87 M rows, 98 MB in v1) | per-commit A/B and determinism suite (≤ 1 min)                   |
| `heavy-1`  | `btc-updown-15m-1780925400` (449,314 rows, 6.4 MB in v1)                                                  | per-market phase profile; the same market as the Codex prototype |

Further sets of 16 §13.1 (`june-1k`, `recent-1k`, `btc5m-1k`, `v4-50`) are
added by the steps that first need them.

## Manifest

`sets/<name>.json`:

- `name`, `description`, `createdAt`, `benchSetVersion` (1)
- `inputMode` (`telonex-delta`), `format` (`telonex-delta-typed` v1), `symbol`,
  `timeframe`
- `strategy` and `params`: the workload (`engine-exerciser`, `{}`)
- `modelConfig`: path and sha256 of the ModelConfig reference
  (`native/contract/model-configs/ts-compat-default.json`)
- `selection`: how the markets were chosen (query, cutoff, universe size,
  method, strata, files left out and why)
- `totals` and `markets[]`: `slug`, `file` (relative to the repository root,
  under `data/`), `bytes`, `sha256`, `rows`, and the `tokens` map (`up`,
  `down`) from `telonex_markets`

## Selection

```bash
npm run native:bench:sets -- --set smoke-50|heavy-1|all [--dry-run] [--force]
npm run native:bench:sets -- --verify
```

`scripts/native/bench-sets.ts` is read-only on MySQL and goes through
`src/db/telonexMarkets.ts` only (`listEligibleTelonexSlugs`,
`getMarketsBySlugs`; CLAUDE.md eligibility rule). `smoke-50` takes the
eligible BTC 15m `delta-typed` markets up to the pinned cutoff
(`market_start_ms` ≤ 2026-10-01T00:00:00Z) whose converted file exists under
`data/events/telonex/` (the `local_path` convention of
`src/telonex/localOutputPath.ts`), reads each file's row count from its
Parquet footer, sorts by (rows, slug), cuts 50 equal-count strata and takes
from each the slug with the smallest `sha256("smoke-50|" + slug)`. Files whose
footer cannot be read are listed in `selection.unreadableFooter` and left out
(one on 2026-10-09: `btc-updown-15m-1765684800`).

## Frozen

A committed manifest is never edited. The script refuses to overwrite one
without `--force`, and a replaced set gets a new name. `--verify` re-hashes
every listed file; a changed sha256 or size invalidates comparisons across
that change and is reported (16 §13.1). `pmb-tape verify` checks the same
before it compares streams.

## Derived tapes on these sets

```bash
cd native && cargo build --release -p pmb-tape
R=$(git rev-parse --show-toplevel)
native/target/release/pmb-tape convert --data-root "$R/data" --tape-root "$R/data/native-tapes" --set native/bench/sets/smoke-50.json
native/target/release/pmb-tape verify  --data-root "$R/data" --tape-root "$R/data/native-tapes" --set native/bench/sets/smoke-50.json
taskpolicy -c utility native/target/release/pmb-tape bench --data-root "$R/data" --tape-root "$R/data/native-tapes" --set native/bench/sets/smoke-50.json --reps 3 --json <out.json>
```

Tapes live only under the checkout's gitignored `data/native-tapes/`
(16 NT-8). `bench` runs one discarded warm-up pass per configuration, then
ABBA-interleaved repetitions, and prints the binary sha256 and load averages.

## Results

`results/<topic>-<yyyymmdd>-<host>.md` holds step-level measurements (for
example the M1 step 7 tape numbers). Numbers taken outside the 01:00–07:00
window with the fleet worker and Global Runtime paused are labeled
`non-idle` with their load average and are never gate evidence of speed
(16 §13.5). Milestone reports go to `native/reports/` (16 §13.8).
