# 03 — What is reused from the previous attempt, and when

The previous attempt lives on branch `native-engine` (clone
`/Users/worker-1/Sites/polymarket-bot-native`, read-only for this goal; its
`ws/*` workstream branches hold unmerged work). Its spec was built around
Telonex-first replay and a copy-mode profile against the TS engine; this goal
drops both. Rules: **in-tree** code is normal code; **reference** code is read,
and copied only after review, when the milestone in the table needs it, with
every ts-compat branch removed; **not reused** code is not read at all.

## 1. In tree now (N0)

| Crate | Content | Lines (incl. tests) |
|---|---|---|
| `pmb-core` | fixed-point money math with checked arithmetic and explicit rounding; ids and per-market seeds; market identity and slug parsing; `ExchangeRules` with the dated fee-era and taker-delay tables and per-rule verification status; order types, order state machine, fills, account events | ~6,100 |
| `pmb-book` | dense-ladder order books with a top-of-book change bit | ~1,500 |
| `pmb-contract` | job and result types (`MarketJobData` → `EngineJob`, `EngineResult` → `RunSingleMarketOutput`), model config, canonical JSON, JSON schemas and fixtures | ~5,600 |
| `pmb-replay` | Parquet helpers and the telonex-delta reader with a TS-generated golden (used from N7; kept compiling from N0) | ~3,400 |

Also in tree: `native/fixtures/` (decode goldens), `native/contract/`
(schemas, fixtures, model configs), the CI job, `scripts/native/`,
`native/deny.toml`.

## 2. Reference code on `native-engine` (copy after review when cited)

| Path on `native-engine` | What it is | Reused at |
|---|---|---|
| `native/crates/pmb-engine/` | event loop, order manager, ledger, cascades, window gate, stats; 225 tests incl. converted TS suites | N1 (modules copied after review; `TsCompat` branches removed; semantics per E09, E10) |
| `native/crates/pmb-engine/src/exec/` | simulator skeleton, scheduler, model traits (fill, latency, fee, report) | N3 (trait shapes; every model re-implemented from measurements) |
| `native/crates/pmb-runtime/` | binary: `describe`, `schema`, `selftest`, `run`, job parsing, trace sinks | N1 |
| `native/crates/pmb-sdk/`, `pmb-sdk-macros/` | strategy SDK surface, params derive, testkit | N1 (minimal surface), N5 (full) |
| `native/crates/pmb-feeds/` | Binance, Chainlink two-clock, price-to-beat visibility models; synthetic tick schedule | N7 only (with measured timings) |
| `native/crates/pmb-plugins/` | TimeWindowVolatility, TechnicalIndicators, DwellGate, TimeWindowGate with goldens | N5 |
| `native/crates/pmb-tape/` | derived fast tape for Telonex files (8.5× decode) | N7, optional, after N6 timers |
| `native/strategies/` | engine exerciser, feed exerciser, SDK usage examples | N1 (exerciser schedule), N5 |
| `native/conformance/` | Fable-written conformance vectors and skeletons (86 data tests) | N1 and N3: vectors reusable where the semantics are unchanged by E09, E10 and the measured models |
| `src/native/` (TS) | `buildEngineJob`, `resolveModelConfig`, `validateEngineResult`, `toRunSingleMarketOutput`, protocol-v2 runner | N5 |
| `src/strategy/artifacts/native/` (TS, `ws/w3build`) | canonical reproducible builder with post-link gates; reproducibility proven (same sha from two builds) | N5 |
| `native/bench/`, `scripts/native/bench-sets.ts` | bench set manifests and selection | N6 |
| `src/cli/parity/*`, `src/backtest/parity/*` | parity harness | not reused, except its golden generators (`*_gen.ts`) |
| `src/strategies/testing/engine-exerciser.ts` | TS twin of the exerciser | not reused |

Unmerged work on `ws/int` (wave-2 wiring: runtime ↔ engine, feeds and plugins
wired, TS integration) and `ws/w3build` is reference too; the previous lead
session was asked to push them. Read them from the worktrees under
`/Users/worker-1/Sites/polymarket-bot-native/.claude/worktrees/` if they are
not on origin.

## 3. Reference documents on `native-engine` (`native/spec/`)

Read only the cited sections, only when the milestone needs them. They never
override this spec (00 §6).

| Document | Sections worth reading | For |
|---|---|---|
| `10-domain-model.md` | fixed-point and rounding, ids, clock model, determinism rules | N1 |
| `11-exchange-rules.md` | fields and sources, fee eras, taker delay, GTD, tick/min size, capture script | 10 (extracted), N3, N5 |
| `12-engine-core.md` | loop, intents and validation, state machine, cascades, window gate, fault semantics | N1 (design reference, not a template) |
| `13-execution-models.md` | trait shapes, realistic fixes RF01–RF15 and their A/B rule | N3 |
| `14-feeds-and-plugins.md` | §7 V4 feeds; §12 plugins | N1, N5, N7 |
| `15-inputs.md` | §5–§6 V4 reader; §8 data-anomaly policy | 11 (extracted), N1 |
| `16-performance-and-parallelism.md` | executor, caches, decode, benchmark methodology | N6 |
| `20-binary-protocol.md` | subcommands, exit codes, env allowlist, secrets channel | N1, N2 |
| `21-job-and-output-contract.md` | job and output shapes, skip taxonomy | N5 |
| `22-trace-ledger-journal.md` | trace, fill ledger, journal envelope | N2, N4 |
| `30-strategy-sdk.md` | SDK surface, params derive, determinism lints | N1, N5, N8 |
| `31-artifacts-build-publish.md` | crate layout, reproducible builds, publish, trust gate, build daemon | N5, N8, N9 |
| `40-fleet-integration.md`, `41-candidate-groups.md`, `42-persistence-and-stats.md` | fleet, groups, migrations and stats | N5, N8 |
| `50-live-runtime.md` | §8.2 adapter (extracted into 10), §6–§7 discovery and streams, §9–§18 guards, journal, service | N2, N4, N9 |
| `51-calibration-plan.md` | §3 prerequisites, §6 probes (extracted into 10), §9–§13 analysis methods | N2, N3 |
| `60-verification.md` | §8 property tests, §10 conformance workstream, §12 fixture markets | N1, N3 |
| `research/early-audits.md` | docs-vs-engine gap table, TS execution quirks | 10 |

## 4. Not reused

The ts-compat profile and its rule list, the parity matrix and cells,
`PARITY.md`, the oracle pin and canary, the old `STATUS.md` and goal prompt,
the $100 strategy-level calibration plan (replaced by probe sessions), and
every process decision of the previous attempt (E06 lists what is carried).
