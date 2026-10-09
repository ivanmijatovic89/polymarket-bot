# Benchmark report M1: worker-1 (2026-10-09)

Written by `scripts/native/bench-l0.ts` and `scripts/native/bench-l1.ts` (16 §13.8).
The `.json` next to this file holds every row with its conditions and raw repetitions.
Rows are appended in the order they ran; a row marked `non-idle` is never regression
or gate evidence (16 §13.5).

## Row 1: L0 criterion benches (2026-10-09 13:06:21 – 13:24:43)

**`non-idle`**: L0 numbers are read only as before/after A/B within this sitting
(01 §6 M1 step 7), never as regression or gate evidence (16 §13.5). Reasons:

- quiet host not confirmed (fleet worker and Global Runtime not paused)
- other work seen by ps (start, during, end): 49 test, 3 fleet-worker, 3 global-runtime, 49 build
- no 60 s pre-start load sampling
- 1-minute load average reached 6.59 during the row (limit T + 1 = 2.00)
- started at 13:06, outside the 01:00-07:00 benchmark window

- Commit `abed35d2b8a560f7a5ae7a25d64fc0c8c2552ae7`; cargo profile `bench`; rustc 1.89.0 (29483883e 2025-08-04)
- QoS utility (effective: utility); data root `/Users/worker-1/Sites/polymarket-bot-native/.claude/worktrees/ws-bench/data`
- 3 runs per target, interleaved: `pmb-core/fixed`, `pmb-book/book`, `pmb-replay/decode`
- Load average (1 min) during the row: 3.82 (2.18–6.59)
- ps checks: 38 (start, 36 during, end); other work seen in 38
  - build: 49 distinct process(es)
  - fleet-worker: 3 distinct process(es)
  - global-runtime: 3 distinct process(es)
  - test: 49 distinct process(es)
- market fixture/btc-updown-15m-1785028500: 93427 rows, 1209921 bytes, /Users/worker-1/Sites/polymarket-bot-native/.claude/worktrees/ws-bench/data/events/telonex/delta-typed/btc/15m/btc-updown-15m-1785028500.parquet
- market fixture/btc-updown-15m-1779501600: 102535 rows, 1457460 bytes, /Users/worker-1/Sites/polymarket-bot-native/.claude/worktrees/ws-bench/data/events/telonex/delta-typed/btc/15m/btc-updown-15m-1779501600.parquet
- market fixture/btc-updown-15m-1768222800: 2 rows, 7784 bytes, /Users/worker-1/Sites/polymarket-bot-native/.claude/worktrees/ws-bench/data/events/telonex/delta-typed/btc/15m/btc-updown-15m-1768222800.parquet
- market fixture/btc-updown-5m-1770857100: 54 rows, 8472 bytes, /Users/worker-1/Sites/polymarket-bot-native/.claude/worktrees/ws-bench/data/events/telonex/delta-typed/btc/5m/btc-updown-5m-1770857100.parquet
- market heavy-1/btc-updown-15m-1780925400: 449314 rows, 6444733 bytes, /Users/worker-1/Sites/polymarket-bot-native/.claude/worktrees/ws-bench/data/events/telonex/delta-typed/btc/15m/btc-updown-15m-1780925400.parquet
- market fixture/btc-updown-15m-1785028500: 446360 decimal strings
- market fixture/btc-updown-15m-1779501600: 501428 decimal strings
- market fixture/btc-updown-15m-1768222800: 296 decimal strings
- market fixture/btc-updown-5m-1770857100: 216 decimal strings
- market heavy-1/btc-updown-15m-1780925400: 2151586 decimal strings
- market fixture/btc-updown-15m-1785028500: 93427 kept events, 5839 change a top of book
- market fixture/btc-updown-15m-1779501600: 102535 kept events, 16756 change a top of book
- market fixture/btc-updown-15m-1768222800: 2 kept events, 2 change a top of book
- market fixture/btc-updown-5m-1770857100: 54 kept events, 34 change a top of book
- market heavy-1/btc-updown-15m-1780925400: 449314 kept events, 80428 change a top of book

Each value is the median, min and max over runs of criterion's per-run median point estimate; raw samples are in the JSON.

| Bench                                               | Per iteration                   | Per element                                        | Per-run medians                 |
| --------------------------------------------------- | ------------------------------- | -------------------------------------------------- | ------------------------------- |
| `book/apply_level_top_change`                       | 1.75 ms (1.74 ms–1.76 ms)       | 17.63 ns (17.56 ns–17.76 ns) / element (99000)     | 1.74 ms, 1.76 ms, 1.75 ms       |
| `book/apply_snapshot_30x30`                         | 141.68 µs (141.63 µs–142.74 µs) | 141.68 ns (141.63 ns–142.74 ns) / element (1000)   | 141.68 µs, 141.63 µs, 142.74 µs |
| `book/best_bid_ask_both_outcomes`                   | 6.50 ns (6.23 ns–6.68 ns)       | 6.50 ns (6.23 ns–6.68 ns) / element (1)            | 6.68 ns, 6.23 ns, 6.50 ns       |
| `book/event_apply_and_tops`                         | 2.79 ms (2.78 ms–2.83 ms)       | 27.92 ns (27.84 ns–28.34 ns) / element (100000)    | 2.79 ms, 2.83 ms, 2.78 ms       |
| `book/ladder_side_set`                              | 58.34 µs (55.57 µs–58.64 µs)    | 1.18 ns (1.12 ns–1.19 ns) / element (49406)        | 55.57 µs, 58.34 µs, 58.64 µs    |
| `book_apply_tops/fixture/btc-updown-15m-1768222800` | 5.54 µs (5.35 µs–5.59 µs)       | 2.77 µs (2.67 µs–2.79 µs) / element (2)            | 5.59 µs, 5.54 µs, 5.35 µs       |
| `book_apply_tops/fixture/btc-updown-15m-1779501600` | 4.42 ms (4.36 ms–4.55 ms)       | 43.08 ns (42.53 ns–44.39 ns) / element (102535)    | 4.36 ms, 4.42 ms, 4.55 ms       |
| `book_apply_tops/fixture/btc-updown-15m-1785028500` | 3.86 ms (3.78 ms–3.91 ms)       | 41.34 ns (40.42 ns–41.89 ns) / element (93427)     | 3.86 ms, 3.78 ms, 3.91 ms       |
| `book_apply_tops/fixture/btc-updown-5m-1770857100`  | 8.32 µs (7.66 µs–9.46 µs)       | 154.08 ns (141.91 ns–175.19 ns) / element (54)     | 7.66 µs, 9.46 µs, 8.32 µs       |
| `book_apply_tops/heavy-1/btc-updown-15m-1780925400` | 18.78 ms (18.55 ms–19.01 ms)    | 41.81 ns (41.28 ns–42.30 ns) / element (449314)    | 19.01 ms, 18.55 ms, 18.78 ms    |
| `columns16/fixture/btc-updown-15m-1768222800`       | 96.79 µs (95.92 µs–103.37 µs)   | 48.39 µs (47.96 µs–51.69 µs) / element (2)         | 95.92 µs, 96.79 µs, 103.37 µs   |
| `columns16/fixture/btc-updown-15m-1779501600`       | 29.93 ms (29.50 ms–29.98 ms)    | 291.88 ns (287.71 ns–292.35 ns) / element (102535) | 29.50 ms, 29.98 ms, 29.93 ms    |
| `columns16/fixture/btc-updown-15m-1785028500`       | 25.30 ms (25.28 ms–26.35 ms)    | 270.78 ns (270.61 ns–282.08 ns) / element (93427)  | 26.35 ms, 25.28 ms, 25.30 ms    |
| `columns16/fixture/btc-updown-5m-1770857100`        | 115.55 µs (115.54 µs–135.12 µs) | 2.14 µs (2.14 µs–2.50 µs) / element (54)           | 135.12 µs, 115.54 µs, 115.55 µs |
| `columns16/heavy-1/btc-updown-15m-1780925400`       | 128.46 ms (128.33 ms–131.83 ms) | 285.90 ns (285.62 ns–293.41 ns) / element (449314) | 131.83 ms, 128.33 ms, 128.46 ms |
| `decimal_parse/fixture/btc-updown-15m-1768222800`   | 2.65 µs (2.65 µs–2.66 µs)       | 8.97 ns (8.96 ns–8.97 ns) / element (296)          | 2.65 µs, 2.65 µs, 2.66 µs       |
| `decimal_parse/fixture/btc-updown-15m-1779501600`   | 5.29 ms (5.23 ms–5.36 ms)       | 10.55 ns (10.42 ns–10.68 ns) / element (501428)    | 5.23 ms, 5.29 ms, 5.36 ms       |
| `decimal_parse/fixture/btc-updown-15m-1785028500`   | 4.59 ms (4.58 ms–4.80 ms)       | 10.29 ns (10.26 ns–10.75 ns) / element (446360)    | 4.58 ms, 4.80 ms, 4.59 ms       |
| `decimal_parse/fixture/btc-updown-5m-1770857100`    | 1.70 µs (1.69 µs–1.73 µs)       | 7.85 ns (7.81 ns–8.00 ns) / element (216)          | 1.70 µs, 1.73 µs, 1.69 µs       |
| `decimal_parse/heavy-1/btc-updown-15m-1780925400`   | 22.38 ms (22.32 ms–25.20 ms)    | 10.40 ns (10.37 ns–11.71 ns) / element (2151586)   | 22.38 ms, 22.32 ms, 25.20 ms    |
| `file_to_tape/fixture/btc-updown-15m-1768222800`    | 130.65 µs (104.69 µs–190.30 µs) | 65.33 µs (52.35 µs–95.15 µs) / element (2)         | 104.69 µs, 190.30 µs, 130.65 µs |
| `file_to_tape/fixture/btc-updown-15m-1779501600`    | 46.78 ms (46.30 ms–48.34 ms)    | 456.19 ns (451.54 ns–471.46 ns) / element (102535) | 46.30 ms, 48.34 ms, 46.78 ms    |
| `file_to_tape/fixture/btc-updown-15m-1785028500`    | 39.60 ms (39.46 ms–40.46 ms)    | 423.85 ns (422.39 ns–433.07 ns) / element (93427)  | 39.46 ms, 39.60 ms, 40.46 ms    |
| `file_to_tape/fixture/btc-updown-5m-1770857100`     | 128.69 µs (127.27 µs–130.19 µs) | 2.38 µs (2.36 µs–2.41 µs) / element (54)           | 128.69 µs, 130.19 µs, 127.27 µs |
| `file_to_tape/heavy-1/btc-updown-15m-1780925400`    | 196.22 ms (192.98 ms–279.23 ms) | 436.71 ns (429.49 ns–621.45 ns) / element (449314) | 192.98 ms, 196.22 ms, 279.23 ms |
| `fixed/checked_add_sub`                             | 4.06 µs (4.06 µs–4.15 µs)       | 0.99 ns (0.99 ns–1.01 ns) / element (4096)         | 4.15 µs, 4.06 µs, 4.06 µs       |
| `fixed/format_micros`                               | 230.74 µs (225.96 µs–231.43 µs) | 56.33 ns (55.17 ns–56.50 ns) / element (4096)      | 230.74 µs, 225.96 µs, 231.43 µs |
| `fixed/mul_div/ceil`                                | 11.32 µs (11.32 µs–17.22 µs)    | 2.76 ns (2.76 ns–4.20 ns) / element (4096)         | 11.32 µs, 17.22 µs, 11.32 µs    |
| `fixed/mul_div/floor`                               | 11.49 µs (11.32 µs–11.81 µs)    | 2.80 ns (2.76 ns–2.88 ns) / element (4096)         | 11.49 µs, 11.81 µs, 11.32 µs    |
| `fixed/mul_div/half_away`                           | 13.61 µs (13.28 µs–22.35 µs)    | 3.32 ns (3.24 ns–5.46 ns) / element (4096)         | 13.61 µs, 22.35 µs, 13.28 µs    |
| `fixed/mul_div/toward_zero`                         | 10.95 µs (10.80 µs–12.26 µs)    | 2.67 ns (2.64 ns–2.99 ns) / element (4096)         | 12.26 µs, 10.95 µs, 10.80 µs    |
| `fixed/parse_decimal`                               | 49.64 µs (48.86 µs–50.33 µs)    | 12.12 ns (11.93 ns–12.29 ns) / element (4096)      | 50.33 µs, 49.64 µs, 48.86 µs    |
| `fixed/price_is_on_tick`                            | 2.04 µs (2.04 µs–2.11 µs)       | 0.50 ns (0.50 ns–0.51 ns) / element (4096)         | 2.11 µs, 2.04 µs, 2.04 µs       |
| `fixed/price_notional`                              | 10.77 µs (10.53 µs–11.70 µs)    | 2.63 ns (2.57 ns–2.86 ns) / element (4096)         | 10.77 µs, 11.70 µs, 10.53 µs    |
| `fixed/price_to_tick`                               | 11.88 µs (11.68 µs–11.93 µs)    | 2.90 ns (2.85 ns–2.91 ns) / element (4096)         | 11.93 µs, 11.68 µs, 11.88 µs    |
| `fixed/qty_for_collateral`                          | 13.62 µs (13.39 µs–13.92 µs)    | 3.33 ns (3.27 ns–3.40 ns) / element (4096)         | 13.62 µs, 13.92 µs, 13.39 µs    |
| `fixed/usdc_mul_rate`                               | 13.21 µs (13.04 µs–15.30 µs)    | 3.23 ns (3.18 ns–3.73 ns) / element (4096)         | 13.04 µs, 15.30 µs, 13.21 µs    |
