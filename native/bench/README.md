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
npm run native:bench:sets -- --set smoke-50|heavy-1 --name <new-name>   # replacement set
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

A committed manifest is never edited. The script refuses to overwrite a
manifest that git tracks, even with `--force`; a replacement selection is
written under a new name with `--name` (for example `smoke-50-20261101`).
`--force` only replaces a manifest that was never committed. `--verify`
re-hashes every listed file; a changed sha256 or size invalidates
comparisons across that change and is reported (16 §13.1). `pmb-tape`
checks the same: `convert` refuses (and exits non-zero on) a source whose
bytes or sha256 differ from the manifest, `verify` fails on it, and `bench`
refuses to time a set until every source and tape matches.

## Derived tapes on these sets

Run from the repository root (the build runs in a subshell, so the paths
below stay root-relative):

```bash
R=$(git rev-parse --show-toplevel); cd "$R"
(cd native && CARGO_BUILD_JOBS=3 taskpolicy -c background cargo build --release -p pmb-tape)
T=native/target/release/pmb-tape
$T convert --data-root "$R/data" --tape-root "$R/data/native-tapes" --set native/bench/sets/smoke-50.json
$T verify  --data-root "$R/data" --tape-root "$R/data/native-tapes" --set native/bench/sets/smoke-50.json
$T m19-convert --data-root "$R/data" --tape-root "$R/data/native-tapes" --set native/bench/sets/smoke-50.json  # only for M-19 rows
taskpolicy -c utility $T bench --data-root "$R/data" --tape-root "$R/data/native-tapes" \
  --set native/bench/sets/smoke-50.json --reps 3 --qos utility \
  --configs v1,tape,tape-full,tape-rows,pq-full,pq-rows --json <out.json>
```

Tapes live only under the checkout's gitignored `data/native-tapes/`
(16 NT-8), at `<format>-v<version>/tape-v<tape format>/<symbol>/<timeframe>/<slug>.pmbtape`.
`convert` resolves the tape root through symlinks and refuses one that lies
inside the inputs' data links or the fleet copy. M-19 alternative files go
to `m19-parquet-int64/` under the same root.

`bench` checks every source and tape against the manifest, then runs one
discarded warm-up pass per configuration and ABBA-interleaved repetitions.
Its JSON records the 16 §13.5 conditions (label, host, chip, macOS, rustc,
profile, binary and set manifest sha256, ModelConfig, threads, requested
and effective QoS, cache budget, input path per configuration), `ps`
snapshots, load averages after every pass and the first read of the
sitting. `--label` defaults to `non-idle`; `idle-window` is claimed only
for runs in the 01:00–07:00 window with the fleet worker and Global
Runtime paused.

## Results

`results/<topic>-<yyyymmdd>-<host>.md` holds step-level measurements (for
example the M1 step 7 tape numbers), each with a `.json` of every row, its
conditions and raw repetitions. Numbers taken outside the 01:00–07:00
window with the fleet worker and Global Runtime paused are labeled
`non-idle` with their load average and are never gate evidence of speed
(16 §13.5). 16 §13.8 places milestone reports in `native/reports/`; where
step-level results live is a question for the lead (they may move to
`native/reports/bench-m1-<yyyymmdd>-<host>.*` at merge).
