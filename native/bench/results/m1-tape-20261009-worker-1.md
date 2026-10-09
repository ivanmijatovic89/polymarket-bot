# M1 step 7 — derived native tape: decode v1 vs tape, M-19 (worker-1, 2026-10-09)

**Label: `non-idle`.** Every number here was measured alongside the fleet
worker, the Global Runtime and other goal worktrees' builds, tests and
benchmarks (the user's rule for this run forbids pausing the fleet), at
`utility` QoS, outside the 01:00–07:00 window. They are interleaved
comparisons within one sitting (16 §13.5, §13.8): not regression baselines,
not gate evidence of speed. The G2 decision (M-20) needs the idle-window
rerun.

Raw data (every repetition, per-market rows, conditions, `ps` snapshots):

- sittings A–C (first version of this report):
  [`m1-tape-20261009-worker-1.json`](m1-tape-20261009-worker-1.json)
- sittings D–I (review follow-up), the conversion log and NT-6 (b):
  [`m1-tape-20261009-worker-1-2.json`](m1-tape-20261009-worker-1-2.json)

## Summary

| Set                                  | v1 decode (total, median of 3)           | tape decode, streamed (total)        | v1 / tape (within sitting) | tape bytes / v1 bytes         |
| ------------------------------------ | ---------------------------------------- | ------------------------------------ | -------------------------- | ----------------------------- |
| `smoke-50` (50 markets, 6.87 M rows) | E 3028.3 ms, F 2958.2 ms (≈55–57 ms/mkt) | E 349.7 ms, F 350.3 ms (≈6.4 ms/mkt) | E 8.66×, F 8.45×           | 38.8 MB / 98.0 MB = **0.396** |
| `heavy-1` (449,314 rows)             | E 345.6 ms (disturbed), F 191.4 ms       | E 38.6 ms (disturbed), F 25.2 ms     | E 8.96×, F 7.59×           | 2.52 MB / 6.44 MB = **0.391** |

- Across all sittings (A–C, E–F) the within-sitting v1/tape ratio of the
  total medians ranged from 6.6× to 9.8×. The ratio moves with the load on
  the host (sitting A's 9.8× on `heavy-1` comes from a v1 median inflated
  by load, reps 232.8/363.2/364.7 ms), so it is a per-sitting comparison,
  not a stable constant.
- **M-19 (16 §15.2): the raw SoA + zstd tape stays.** Flat Parquet INT64 +
  ZSTD of the same typed rows decodes to typed rows 1.80–1.96× slower than
  the tape and is 1.87–2.80× larger (rule: Parquet only if within 10%).
- The review fixes (header checks, dictionary compare, soft reservations)
  cost nothing measurable on the executor path: interleaved against the
  pre-review binary, streamed tape decode moved by −0.5% on `smoke-50` and
  +1.2% on `heavy-1` (sitting I), inside the run spread.
- NT-6 (b) holds on both sets at the versioned tape path: 51 of 51 markets
  identical on both paths; all 51 stream digests equal those of sittings
  A–C.

## What was measured

- **Decode** = from the file on disk to the engine event stream: every
  kept row's kind, outcome, levels, both timestamps, the file's market id,
  and the skip and anomaly counters (15 §4.2, §8). File read included. Book
  apply, feeds and the strategy are not included. One thread.
- Configurations (`pmb-tape bench --configs`, interleaved ABBA, one
  discarded warm-up pass each):
  - **v1**: `pmb_replay::read_telonex_delta`, today's reader.
  - **tape**: `read_tape_stream`, the executor path `read_market` uses:
    one read of the tape into a reused buffer, a stat of the v1 file, then
    block-by-block decode into reused typed-row buffers with the reader
    rules applied per block.
  - **tape-full**: `load_tape` (whole-file typed rows), then `replay`.
  - **tape-rows**: `load_tape` only — the decode phase (file read, zstd,
    widening into typed rows) without the reader rules.
  - **pq-full / pq-rows**: the M-19 file decoded to the same typed rows
    with parquet-rs, then `replay` / without it.
- Tape format v1 (`codec.rs`): one checksummed zstd frame (level 3) per
  column per 65,536-row block; smallest integer width that fits; delta-coded
  sequence numbers and clocks; decimal frames scaled by their common power
  of ten; checksummed meta with the v1 identity and the tool sha.
- M-19 file (`m19.rs`): the same typed rows as 16 Parquet columns
  (INT64/INT32, lists as repeated columns), ZSTD level 3, 65,536-row
  groups; dictionary, v1 identity and the (rare) inexact indices in the
  footer. Variant `delta` disables dictionaries and writes every integer
  column DELTA_BINARY_PACKED; variant `plain-dict` keeps the parquet-rs
  writer defaults. Both round-trip to typed rows equal to the tape's.

## Conditions

| Item               | Sittings D–I                                                                                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host               | worker-1 (`Worker-1s-Mac-mini`), Apple M4 (4 P + 6 E cores), 16 GB, macOS 26.2 (25C56), AC power, Low Power Mode 0                                                                                                                            |
| Toolchain, profile | rustc 1.89.0 (29483883e 2025-08-04); the workspace `release` profile (opt-level 3, debug false), not the canonical artifact build (31 §4)                                                                                                     |
| Binaries           | E–H: `7b83dd87…6086` @ `137e99be`. D: `6d929afb…501e` @ `2970b02b` and `b2fcc646…5511` @ `089b6357`. I: `1c2ee5c3…c6d2` @ `e621c2f6` and `429cb1a6…a6a5` @ `27d8518f`. Conversion: `e79e76b8…68e7` @ `2cabe764` (same codec)                  |
| Sets               | `smoke-50.json` sha256 `a48228ee…dbc`, `heavy-1.json` sha256 `671aea46…052c`; every source re-checked against the manifest (bytes, sha256) and every tape against its source before timing                                                    |
| QoS, threads       | E–H and the `27d8518f` runs of I: `taskpolicy -c utility`, declared `--qos utility`, effective priority 20 (utility) recorded by the tool. D and the `e621c2f6` runs of I: `taskpolicy -c utility` (those binaries record no QoS). One thread |
| ModelConfig, cache | not used by decode; no in-process cache, warm OS page cache (the first read of each sitting is in the JSON; the page cache was not purged, so it is not a cold read)                                                                          |
| Concurrent load    | `ps` at the start and end of every run (JSON): another worktree's decode benchmark (`ws-bench`) at ~100% CPU throughout E–H, `node` at ~200% CPU during E, other agents' `rustc` builds at 40–100% during E–G                                 |
| 1-min load average | D 3.40 → 2.50; E 3.87 → 4.12; F 4.12 → 4.11; G 3.94 → 3.93; H 3.78 → 3.58; I 4.94 → 3.79 (after every pass in the JSON)                                                                                                                       |

Sittings A–C (first version) used binaries `c55f9a61` (A, @ `089b6357`) and
`229aad62` (B, C, @ `6c1bdebc`), the same host and QoS, at load 6.2–8.8;
no `ps` snapshot was kept for them (see Corrections).

## Results

Times in ms. "Total" is the sum over the set for one repetition (median,
min and max of 3). "Per market" is the median over markets of each
market's median over the 3 repetitions.

### Sitting E (13:13:42, all configurations, M-19 `delta`)

| Set      | Config    | Total median | Total min | Total max | Per-market median |
| -------- | --------- | ------------ | --------- | --------- | ----------------- |
| heavy-1  | v1        | 345.6        | 306.4     | 370.2     | 345.63            |
| heavy-1  | tape      | 38.6         | 28.5      | 49.7      | 38.59             |
| heavy-1  | tape-full | 38.1         | 29.9      | 46.5      | 38.11             |
| heavy-1  | tape-rows | 24.1         | 17.2      | 32.4      | 24.10             |
| heavy-1  | pq-full   | 48.8         | 47.6      | 50.1      | 48.76             |
| heavy-1  | pq-rows   | 44.8         | 40.8      | 45.5      | 44.85             |
| smoke-50 | v1        | 3028.3       | 2994.4    | 3262.2    | 56.79             |
| smoke-50 | tape      | 349.7        | 345.8     | 358.9     | 6.42              |
| smoke-50 | tape-full | 350.3        | 347.7     | 351.4     | 6.45              |
| smoke-50 | tape-rows | 248.5        | 246.0     | 249.3     | 4.63              |
| smoke-50 | pq-full   | 557.7        | 552.6     | 563.8     | 9.88              |
| smoke-50 | pq-rows   | 453.8        | 445.0     | 457.9     | 7.93              |

The `heavy-1` run of E was disturbed (v1 1.8× its F value, wide tape
spreads); its rows are kept, not selected away.

### Sitting F (13:14:07, repeat of E)

| Set      | Config    | Total median | Total min | Total max | Per-market median |
| -------- | --------- | ------------ | --------- | --------- | ----------------- |
| heavy-1  | v1        | 191.4        | 191.1     | 192.3     | 191.40            |
| heavy-1  | tape      | 25.2         | 22.7      | 25.4      | 25.21             |
| heavy-1  | tape-full | 25.0         | 23.0      | 25.0      | 24.96             |
| heavy-1  | tape-rows | 16.0         | 16.0      | 17.2      | 16.03             |
| heavy-1  | pq-full   | 37.0         | 36.5      | 37.0      | 37.01             |
| heavy-1  | pq-rows   | 29.8         | 29.7      | 29.8      | 29.78             |
| smoke-50 | v1        | 2958.2       | 2942.8    | 3181.5    | 54.85             |
| smoke-50 | tape      | 350.3        | 345.4     | 360.3     | 6.43              |
| smoke-50 | tape-full | 353.4        | 347.0     | 489.3     | 6.52              |
| smoke-50 | tape-rows | 255.3        | 247.0     | 472.0     | 4.73              |
| smoke-50 | pq-full   | 568.7        | 555.9     | 647.5     | 9.91              |
| smoke-50 | pq-rows   | 458.5        | 457.0     | 462.6     | 8.00              |

### Sittings A–C (first version, tape path before the review fixes)

| Sitting (binary) | Set      | v1 total median | tape total median  | tape-full total median |
| ---------------- | -------- | --------------- | ------------------ | ---------------------- |
| A (`c55f9a61`)   | smoke-50 | 5118.1          | 766.6 (whole-file) | —                      |
| A                | heavy-1  | 363.2           | 37.1 (whole-file)  | —                      |
| B (`229aad62`)   | smoke-50 | 3835.7          | 584.6              | 570.4                  |
| B                | heavy-1  | 210.6           | 27.9               | 26.4                   |
| C (`229aad62`)   | smoke-50 | 4096.9          | 533.0              | 464.6                  |
| C                | heavy-1  | 217.0           | 28.5               | 26.3                   |

Min, max and per-market rows are in the first JSON. These ran at load
6.2–8.8, so their absolute values are higher than E–F's.

### M-19: tape encoding (16 §15.2)

| Sitting, variant | Set      | tape-rows | pq-rows | pq-rows / tape-rows | tape-full | pq-full | pq-full / tape-full | M-19 bytes / tape bytes         |
| ---------------- | -------- | --------- | ------- | ------------------- | --------- | ------- | ------------------- | ------------------------------- |
| E, delta         | heavy-1  | 24.1      | 44.8    | 1.86                | 38.1      | 48.8    | 1.28                | 4,854,230 / 2,519,035 = 1.93    |
| E, delta         | smoke-50 | 248.5     | 453.8   | 1.83                | 350.3     | 557.7   | 1.59                | 72,476,210 / 38,774,002 = 1.87  |
| F, delta         | heavy-1  | 16.0      | 29.8    | 1.86                | 25.0      | 37.0    | 1.48                | 1.93                            |
| F, delta         | smoke-50 | 255.3     | 458.5   | 1.80                | 353.4     | 568.7   | 1.61                | 1.87                            |
| G, plain-dict    | heavy-1  | 16.6      | 29.9    | 1.80                | 23.4      | 37.5    | 1.60                | 6,909,636 / 2,519,035 = 2.74    |
| G, plain-dict    | smoke-50 | 250.7     | 490.5   | 1.96                | 357.2     | 595.1   | 1.67                | 108,495,569 / 38,774,002 = 2.80 |

M-19's rule is "fastest decode; Parquet if within 10% (tool readability)".
Parquet is 80–96% slower to typed rows and 28–67% slower including the
reader rules, in every sitting and both variants, and its files are larger
than the tape's (`delta` is still 0.74–0.75 of the v1 bytes). **Decision
under the rule: the raw SoA + zstd tape.** The prototype figures quoted in
16 NT-3 (40% slower, 20% larger) did not hold for this lossless typed-row
layer. Likely reasons, not measured separately: the tape stores per-row
list lengths where Parquet decodes per-value repetition levels for eight
list columns, and the tape divides each decimal frame by its common power
of ten, which Parquet's integer encodings cannot exploit.

A first M-19 layout carried the inexact flags as six repeated columns,
which were almost all empty but still cost level decoding: `pq-rows` on
`heavy-1` was 38.8 ms (`delta`) and 39.2 ms (`plain-dict`) against
`tape-rows` 16.1 ms (exploratory runs from uncommitted source, kept in the
second JSON under `exploration`). The indices moved to the footer before
sittings E–G.

### Phase split of the tape path (measured)

`tape-rows` (decode only) against `tape-full` (decode plus reader rules),
same sitting:

| Sitting | Set      | tape-rows | tape-full | reader rules (difference) | rules share |
| ------- | -------- | --------- | --------- | ------------------------- | ----------- |
| E       | heavy-1  | 24.1      | 38.1      | 14.0                      | 37%         |
| E       | smoke-50 | 248.5     | 350.3     | 101.8                     | 29%         |
| F       | heavy-1  | 16.0      | 25.0      | 9.0                       | 36%         |
| F       | smoke-50 | 255.3     | 353.4     | 98.1                      | 28%         |

The differences are of medians, not a profile; zstd decompression is not
separated from the widening into typed-row arrays. The streamed `tape`
path is within the noise of `tape-full` while holding one block of typed
rows instead of the whole file.

### Sitting D: before/after of `089b6357` ("faster tape decode and replay")

Interleaved runs of the two binaries (2970b02b, 089b6357, 089b6357,
2970b02b) per set, each with its own warm-up and 3 ABBA repetitions. At
these commits `tape` meant `load_tape` (whole file) + `replay`.

| Set      | Config | 2970b02b (before) | 089b6357 (after) | after / before (mean of the two medians) |
| -------- | ------ | ----------------- | ---------------- | ---------------------------------------- |
| smoke-50 | tape   | 375.8, 398.0      | 361.9, 362.9     | 0.937                                    |
| smoke-50 | v1     | 2967.0, 3022.0    | 2930.5, 2939.3   | 0.980                                    |
| heavy-1  | tape   | 26.5, 27.4        | 27.1, 27.7       | 1.019                                    |
| heavy-1  | v1     | 188.2, 193.0      | 191.7, 190.8     | 1.003                                    |

The optimization bought about 6% on `smoke-50`'s tape decode and nothing
measurable on `heavy-1` (the 1.9% is inside the 23.6–29.0 ms spread of the
runs). v1, which the commit did not touch, moved by 2% or less: the noise
floor of this sitting. Stream digests did not change (the fixture digest is
pinned).

### Sitting I: the review fixes, before/after

Interleaved runs of `e621c2f6` (branch head before the review, binary
`1c2ee5c3…c6d2`) and `27d8518f` (after, binary `429cb1a6…a6a5`): smoke-50
old, new, new, old, then heavy-1 in the same order, 13:23:14–13:24:20,
load 4.94 → 3.79, `ps` in the second JSON. The old binary read the same
tape files through a temporary compatibility root with its unversioned
path layout.

| Set      | Config    | e621c2f6 (before) | 27d8518f (after) | after / before (mean of the two medians) |
| -------- | --------- | ----------------- | ---------------- | ---------------------------------------- |
| smoke-50 | tape      | 357.1, 361.4      | 356.6, 358.3     | 0.995                                    |
| smoke-50 | tape-full | 356.2, 357.1      | 356.1, 357.8     | 1.001                                    |
| smoke-50 | v1        | 3007.8, 2978.7    | 2987.5, 2987.5   | 0.998                                    |
| heavy-1  | tape      | 25.4, 25.9        | 24.7, 27.1       | 1.012                                    |
| heavy-1  | tape-full | 25.1, 25.6        | 25.7, 25.8       | 1.017                                    |
| heavy-1  | v1        | 194.4, 193.5      | 193.8, 208.0     | 1.036                                    |

All changes are within the spread of the runs (v1, untouched by the
fixes, moved by up to 3.6%).

### Bytes

| Set      | v1 bytes   | tape bytes (zstd 3) | tape / v1 | raw column bytes → zstd frames   | tape bytes (zstd 9, sitting H) | zstd 9 / v1 |
| -------- | ---------- | ------------------- | --------- | -------------------------------- | ------------------------------ | ----------- |
| smoke-50 | 98,019,376 | 38,774,002          | 0.396     | 257,891,851 → 38,732,040 (6.66×) | 36,137,281                     | 0.369       |
| heavy-1  | 6,444,733  | 2,519,035           | 0.391     | 16,195,661 → 2,517,441 (6.43×)   | 2,349,735                      | 0.365       |

The `smoke-50` tapes are 65 bytes larger in total than in sittings A–C:
the meta frame carries the new tool sha. Disk sizing (NT-7): the 31,186 BTC
15m v1 files on worker-1 take 54,727,428 KiB (`du -sk`, about 56.0 GB); at
0.396 they need about 22 GB of tapes, inside worker-1's 40 GB cap.

zstd level 9 (sitting H, a scratch tape root removed afterwards) saves
6.8% of the tape bytes. Its decode ran in a sitting of its own (not
interleaved with level 3): `smoke-50` tape 331.4 ms and tape-rows 235.5 ms,
`heavy-1` 22.4 and 15.6 ms, so no slowdown is visible. Its conversion took
5,718 ms for `smoke-50` (114.4 ms per market) against 4,187 ms at level 3
in the conversion run below (different load: 3.6 vs 5.7). Level 3 stays the
default; level 9 is a cheap disk saving to reconsider at G2.

### Conversion cost

`pmb-tape convert` (binary `e79e76b8`, zstd level 3, `taskpolicy -c
utility`, 13:09:57, load 5.71) reads v1 once (sha256 and decode from the
same bytes), refuses a source that is not the manifest's, encodes, decodes
its own output and compares it with the v1 typed rows, re-checks the v1
stat, and writes tmp → rename. `smoke-50`: 4,187 ms for 50 markets (mean
83.7 ms, median 76.8 ms per market); `heavy-1`: 285.5 ms. Per-market
times are in the second JSON. In sitting A–C's conditions (load 7–8) the
`smoke-50` median was 258.85 ms per market (`convertMsUtility` in the first
JSON).

## NT-6 (b): event stream equality

`pmb-tape verify` checks four things per market: the v1 source still has
the manifest's bytes and sha256; the tape is valid for that exact file
(version, stat identity, job sha256, every frame checksum, header counts
consistent with the blocks); the typed rows decoded from the tape equal
those parsed from v1 (NT-4); and the event stream equals
`read_telonex_delta`'s, event by event, with the same market id and the
same skip and anomaly counters, both for the whole-file replay and for the
block-streamed `read_market` path, which must report `InputPath::Tape`.

| Set                                                              | Result                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| smoke-50                                                         | 50 / 50 identical (6,870,456 rows → 6,870,456 events)                                                  |
| heavy-1                                                          | 1 / 1 identical (449,314 rows; stream digest `7263e195…ad44b8`)                                        |
| CI fixture `crates/pmb-tape/tests/fixtures/telonex-mini.parquet` | identical at 65,536- and 1,000-row blocks; pinned digest `6f2be512…19e073f5`                           |
| generated corpus (unit test, 200 files)                          | identical streams, counters and input errors on v1, whole-file and streamed paths; every counter fires |

The real markets contain no skipped rows and no inexact decimals; the
fixture's crafted rows and the generated corpus cover those paths.

## Corrections to the first version of this report

1. The JSON's `otherLoad` said "ps snapshots in the .md"; the .md had none.
   Corrected in the JSON. `bench` now records `ps` snapshots itself
   (sittings D–H).
2. "84 ms per `smoke-50` market … 274 ms for `heavy-1` at default QoS
   (binary 10799d9d)" had no recorded data and is removed. The conversion
   cost above replaces it, with its binary, QoS and load.
3. The phase split "about 8 ms of the ~16 ms tape decode is zstd … the
   reader rules take another ~9 ms" was an estimate. It is replaced by the
   measured `tape-rows` / `tape-full` split; zstd alone is not separated.
4. "zstd level 9 shrinks `heavy-1` to 0.365" was measured once without a
   record. Sitting H now records it (0.365 for `heavy-1`, 0.369 for
   `smoke-50`).
5. "The v1/tape ratio is the stable quantity (6.6–9.8×)" is restated in
   the summary as a per-sitting range that moves with the load.
6. Commit `089b6357` went unmeasured; sitting D measures it against its
   parent.
7. M-19 was not built; it is now built and measured (sittings E–G).

## Not measured here

- M-20 job time (single-candidate `run` on `smoke-50` and `heavy-1`) and
  `recent-1k` need the M1 binary and the L1 driver.
- Idle-window numbers (01:00–07:00 with the fleet worker and Global
  Runtime paused) are not available for this run.
- A cold read: the page cache was not purged (no root), so the first read
  of each sitting (in the JSON) is not guaranteed cold.

## Commands

```bash
R=/Users/worker-1/Sites/polymarket-bot-native/.claude/worktrees/ws-tape; cd "$R"   # checkout root
(cd native && CARGO_BUILD_JOBS=3 taskpolicy -c background cargo build --release --locked -p pmb-tape)
T=native/target/release/pmb-tape
for s in heavy-1 smoke-50; do
  taskpolicy -c utility $T convert --data-root "$R/data" --tape-root "$R/data/native-tapes" --set native/bench/sets/$s.json
  $T verify --data-root "$R/data" --tape-root "$R/data/native-tapes" --set native/bench/sets/$s.json
  $T m19-convert --data-root "$R/data" --tape-root "$R/data/native-tapes" --set native/bench/sets/$s.json --variant delta
done
# sittings E and F (twice), then G after `m19-convert --variant plain-dict`:
for s in heavy-1 smoke-50; do
  taskpolicy -c utility $T bench --data-root "$R/data" --tape-root "$R/data/native-tapes" \
    --set native/bench/sets/$s.json --reps 3 --qos utility \
    --configs v1,tape,tape-full,tape-rows,pq-full,pq-rows --json <out.json>
done
# sitting H: convert --zstd-level 9 into data/native-tapes/scratch-zstd9, bench --configs tape,tape-rows, remove it
# sittings D and I: release builds of `git archive <commit> native`, each run as
#   taskpolicy -c utility <bin> bench --data-root "$R/data" --tape-root "$R/data/native-tapes" --set <set> --reps 3 --json <out>
```
