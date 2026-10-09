# Crate map

Crates are grouped by role so a reader finds code by purpose. Names describe
content; module paths use the underscore form (`domain::rules`). Rule: E11 in
`native/spec/02-decisions.md`.

| Folder       | Crate            | Holds                                                                                                                               | Since                     |
| ------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `core/`      | `domain`         | fixed-point money math, ids and seeds, market identity, exchange rules tables, order types and state machine, fills, account events | N0                        |
| `core/`      | `orderbook`      | dense-ladder order books                                                                                                            | N0                        |
| `core/`      | `engine`         | serial event loop, order manager, ledger, cascades, window gate, stats                                                              | N1                        |
| `core/`      | `execution`      | execution adapter trait and the measured simulator models (fill, latency, fee, report)                                              | N1 placeholder, N3 models |
| `core/`      | `plugins`        | strategy plugins (volatility, technical indicators, dwell and time-window gates)                                                    | N5                        |
| `inputs/`    | `v4-replay`      | Recorder V4 package reader                                                                                                          | N1                        |
| `inputs/`    | `telonex-replay` | telonex-delta reader with TS goldens                                                                                                | N0 (used from N7)         |
| `inputs/`    | `feeds`          | feed visibility models for Telonex replay, timings from measurements                                                                | N7                        |
| `exchange/`  | `exchange-clob`  | CLOB V2 adapter: auth, signing, REST, user WS, journal, probe runner (`real-orders` feature for the sending path)                   | N2                        |
| `interface/` | `job-contract`   | job and result types shared with TypeScript, model config, JSON schemas                                                             | N0                        |
| `interface/` | `sdk`            | strategy SDK surface, params derive, testkit                                                                                        | N1                        |
| `interface/` | `runtime`        | the binary: describe, schema, selftest, run, probe, paper, serve                                                                    | N1                        |

`native/strategies/` (separate package) holds strategies built against `sdk`.
