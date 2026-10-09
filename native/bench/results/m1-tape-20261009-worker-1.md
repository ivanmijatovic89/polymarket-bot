# M1 step 7 — derived native tape: decode v1 vs tape (worker-1, 2026-10-09)

**Label: `non-idle`.** Measured alongside the fleet worker, the Global Runtime
and other goal worktrees' builds and tests (the user's rule for this run
forbids pausing the fleet), at `utility` QoS, outside the 01:00–07:00 window.
These numbers are interleaved comparisons within one sitting (16 §13.5,
§13.8). They are not regression baselines and not gate evidence of speed.
The G2 decision (M-20) needs the idle-window rerun.

Raw data, every repetition and per-market rows:
[`m1-tape-20261009-worker-1.json`](m1-tape-20261009-worker-1.json).

## Summary

| Set                                  | v1 decode                                           | tape decode (streamed)                    | speedup  | tape bytes / v1 bytes         |
| ------------------------------------ | --------------------------------------------------- | ----------------------------------------- | -------- | ----------------------------- |
| `smoke-50` (50 markets, 6.87 M rows) | 64.3–68.3 ms per market (median); 3.84–4.10 s total | 9.4–10.4 ms per market; 0.53–0.58 s total | 6.6–7.7× | 38.8 MB / 98.0 MB = **0.396** |
| `heavy-1` (449,314 rows)             | 210.6–217.0 ms                                      | 27.9–28.5 ms                              | 7.6×     | 2.52 MB / 6.44 MB = **0.391** |

Ranges are the two sittings B and C below. NT-6 (b) holds on both sets: the
engine event stream read from the tape is identical to the v1 reader's on
51 of 51 markets (6,870,456 + 449,314 rows).

## What was measured

- **Decode** = from the file on disk to the engine event stream: every kept
  row's kind, outcome, levels, both timestamps, the file's market id, and
  the skip and anomaly counters (15 §4.2, §8). File read included. Book
  apply, feeds and the strategy are not included. One thread.
- **v1**: `pmb_replay::read_telonex_delta`, the current reader (whole
  `File`, parquet 56.2 column reader, miniz_oxide GZIP, the T6 decimal
  parser).
- **tape**: `pmb_tape::read_tape_stream`, the executor path that
  `read_market` uses. It does one read of the tape into a reused buffer, a
  stat of the v1 file for the identity check, then decodes block by block
  into reused typed-row buffers and applies the reader rules per block.
- **tape-full**: `load_tape` (the whole file's typed rows) followed by
  `replay`. It is slightly faster than the streamed path but holds about
  53 MB of typed rows for `heavy-1` instead of one block of about 8.6 MB
  (both computed from the column widths; 16 §6.2).
- Tape format v1 (pmb-tape `codec.rs`): one checksummed zstd frame (level 3)
  per column per 65,536-row block. Integers use the smallest width that
  fits. Sequence numbers and clocks are delta-coded. Decimal frames are
  scaled by their common power of ten. The meta frame is checksummed and
  carries the v1 identity (bytes, mtime_ns, sha256) and the tool sha.

## Conditions

| Item               | Value                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host               | worker-1, Apple M4 (4P+6E), 16 GB, macOS 26.2 (25C56), AC power, Low Power Mode off                                                                     |
| Toolchain          | rustc 1.89.0 (29483883e 2025-08-04), cargo `release` profile of the workspace (not the canonical artifact build, 31 §4)                                 |
| Binary             | `native/target/release/pmb-tape` sha256 `229aad62acc32daf60c068eba95632f8525ead2f56b1e7c7b330ca37134cce09`, source `ws/tape` @ 6c1bdebc (sittings B, C) |
| QoS / threads      | `taskpolicy -c utility`, one thread                                                                                                                     |
| Sets               | `native/bench/sets/smoke-50.json`, `native/bench/sets/heavy-1.json` (frozen; every source sha256 re-checked by `pmb-tape verify` before the runs)       |
| ModelConfig        | not used by decode (manifests reference `ts-compat-default.json`)                                                                                       |
| Page cache         | warm: one discarded warm-up pass per configuration                                                                                                      |
| Repetitions        | 3 per configuration, interleaved and reversed per repetition: v1, tape, tape-full, tape-full, tape, v1, v1, tape, tape-full                             |
| Concurrent load    | fleet worker (node at ~140–250% CPU), Global Runtime, other goal agents' `cargo test` (e.g. `ws-bench` `telonex_golden`), eslint and prettier runs      |
| 1-min load average | sitting A 7.30 → 8.82; B 7.78 → 6.90; C 6.22 → 6.80 (per-pass values in the JSON)                                                                       |

## Results

Times are in ms. "Total" is the sum over the set for one repetition
(median, min and max of 3). "Per market" is the median over markets of
each market's median over the 3 repetitions.

### Sitting B (12:27:04, binary 229aad62)

| Set      | Config    | Total median | Total min | Total max | Per-market median |
| -------- | --------- | ------------ | --------- | --------- | ----------------- |
| smoke-50 | v1        | 3835.7       | 3302.8    | 5019.3    | 64.31             |
| smoke-50 | tape      | 584.6        | 392.1     | 623.4     | 10.40             |
| smoke-50 | tape-full | 570.4        | 378.6     | 645.9     | 9.12              |
| heavy-1  | v1        | 210.6        | 208.8     | 213.4     | 210.60            |
| heavy-1  | tape      | 27.9         | 24.8      | 27.9      | 27.88             |
| heavy-1  | tape-full | 26.4         | 25.2      | 27.0      | 26.38             |

### Sitting C (12:27:34, same binary)

| Set      | Config    | Total median | Total min | Total max | Per-market median |
| -------- | --------- | ------------ | --------- | --------- | ----------------- |
| smoke-50 | v1        | 4096.9       | 3599.8    | 4910.1    | 68.33             |
| smoke-50 | tape      | 533.0        | 396.0     | 560.9     | 9.39              |
| smoke-50 | tape-full | 464.6        | 398.2     | 632.8     | 7.41              |
| heavy-1  | v1        | 217.0        | 212.7     | 234.2     | 216.95            |
| heavy-1  | tape      | 28.5         | 24.0      | 38.4      | 28.54             |
| heavy-1  | tape-full | 26.3         | 24.2      | 30.3      | 26.33             |

### Sitting A (12:21:09, binary c55f9a61 @ 089b6357, whole-file tape path only)

| Set      | Config | Total median | Total min | Total max | Per-market median |
| -------- | ------ | ------------ | --------- | --------- | ----------------- |
| smoke-50 | v1     | 5118.1       | 4607.6    | 10264.6   | 83.51             |
| smoke-50 | tape   | 766.6        | 713.9     | 824.6     | 13.92             |
| heavy-1  | v1     | 363.2        | 232.8     | 364.7     | 363.25            |
| heavy-1  | tape   | 37.1         | 36.3      | 47.6      | 37.15             |

Sitting A ran under the highest load of the three (7.3–8.8). The spread
between sittings is a property of the non-idle host. The v1/tape ratio is
the stable quantity (6.6–9.8×).

### Bytes

| Set      | v1 bytes   | tape bytes | tape / v1                                    | raw column bytes → zstd frames   |
| -------- | ---------- | ---------- | -------------------------------------------- | -------------------------------- |
| smoke-50 | 98,019,376 | 38,773,937 | 0.396 (per market 0.364–0.439, median 0.400) | 257,891,851 → 38,732,040 (6.66×) |
| heavy-1  | 6,444,733  | 2,519,035  | 0.391                                        | 16,195,661 → 2,517,441 (6.43×)   |

Disk sizing (NT-7): the 31,186 BTC 15m v1 files on worker-1 take
54,727,428 KiB (`du -sk`, about 56.0 GB). At 0.396 they need about 22 GB of
tapes, inside worker-1's 40 GB cap. zstd level 9 shrinks `heavy-1` from
0.391 to 0.365 of v1 at about 30% more encode time and the same decode
time. That was measured once, not as a row. Level 3 stays the default.

### Conversion cost

`pmb-tape convert` reads v1 once (sha256 and decode from the same bytes),
encodes, decodes its own output, compares it with the v1 typed rows, rechecks
the v1 stat, and writes tmp → rename. At `utility` QoS under the same load
the median was 259 ms per `smoke-50` market (15.0 s for the set) and 679 ms
for `heavy-1`. At default QoS earlier in the session (binary 10799d9d) it was
84 ms per `smoke-50` market on average (4.2 s for the set) and 274 ms for
`heavy-1`. That is in line with the ~86 ms CPU per market of 16 §2.2.

## NT-6 (b): event stream equality

`pmb-tape verify` checks four things per market. The v1 source still has
the manifest's bytes and sha256. The tape is valid for that exact file
(version, stat identity, job sha256, every frame checksum). The typed rows
decoded from the tape equal the typed rows parsed from v1 (NT-4). The event
stream equals `read_telonex_delta`'s stream, event by event (kind, outcome,
levels, both timestamps, row index), with the same market id and the same
skip and anomaly counters. It checks this both for the whole-file replay
and for the block-streamed `read_market` path, which must report
`InputPath::Tape`.

| Set                                                              | Result                                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| smoke-50                                                         | 50 / 50 identical (6,870,456 rows → 6,870,456 events)                                  |
| heavy-1                                                          | 1 / 1 identical (449,314 rows; stream digest `7263e195…ad44b8`)                        |
| CI fixture `crates/pmb-tape/tests/fixtures/telonex-mini.parquet` | identical; pinned digest `6f2be512…19e073f5` (`cargo test -p pmb-tape --test fixture`) |

Per-market stream digests (`pmb_tape::compare::digest`) are in the JSON.
The real markets contain no skipped rows and no inexact decimals. The skip,
drop, null, clock-anomaly, inexact and error paths are covered by the
fixture's crafted rows and by the unit tests, which assert identical
streams, counters and `InputError`s on both paths. They also cover the
fallback cases: corrupt frame, corrupt meta, truncated, padded, bad magic,
future version, stale mtime and wrong job sha256.

## Observations

1. The tape decodes to the engine stream 6.6–7.7× faster than today's v1
   reader on both sets (non-idle, utility QoS), at 40% of the v1 bytes. That
   includes the typed-row layer (lossless: `ingest_seq`, the id dictionary,
   per-list lengths and the inexact flags) that the 16 §2.2 prototype did
   not carry. The prototype was 0.45 of v1 and 13× faster against a
   decode-only baseline.
2. For `heavy-1`, about 8 ms of the ~16 ms tape decode is zstd
   decompression of 16.2 MB of raw columns. The rest is widening into the
   typed-row arrays, which is memory-bound (about 60 MB written, estimated
   from the column widths). The reader rules take another ~9 ms, writing
   the event stream (about 45 MB, estimated) in
   pmb-replay's row layout. Further gains are in narrower typed rows and
   the 16 §7.3 32-byte event layout, not in the codec.
3. The selection universe had one unreadable v1 file:
   `btc-updown-15m-1765684800.parquet` (622,721 bytes, footer is not
   `PAR1`). It is eligible in MySQL but cannot be decoded by any reader.
   It is recorded in `smoke-50.json` `selection.unreadableFooter`.

## Not measured here

- M-19, the alternative encoding (flat Parquet INT64 + ZSTD), was not built.
- M-20 job time (single-candidate `run` on `smoke-50` and `heavy-1`) and
  `recent-1k` need the M1 binary and the L1 driver.
- Idle-window numbers (01:00–07:00 with the fleet worker and Global Runtime
  paused) are not available for this run.

## Commands

```bash
cd native && CARGO_BUILD_JOBS=3 taskpolicy -c background cargo build --release -p pmb-tape
R=/Users/worker-1/Sites/polymarket-bot-native/.claude/worktrees/ws-tape   # checkout root
for s in heavy-1 smoke-50; do
  taskpolicy -c utility native/target/release/pmb-tape convert --data-root $R/data --tape-root $R/data/native-tapes --set native/bench/sets/$s.json
  native/target/release/pmb-tape verify --data-root $R/data --tape-root $R/data/native-tapes --set native/bench/sets/$s.json
  taskpolicy -c utility native/target/release/pmb-tape bench --data-root $R/data --tape-root $R/data/native-tapes --set native/bench/sets/$s.json --reps 3 --json <out.json>
done
```
