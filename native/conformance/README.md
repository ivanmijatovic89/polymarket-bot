# native/conformance — independent spec-conformance tests

Workstream C of [60-verification.md](../spec/60-verification.md) §10
(decision D45): tests that prove the native engine implements the rules as
the frozen spec states them, written by an author that is a different model
than the implementation session so that correlated errors are caught
(60 VP-6, CF-1). This directory is the only thing conformance commits touch
(CF-3).

Phase status: **C1 delivered** (table-driven vectors and test skeletons per
60 §10.2 row). C2 binds the skeletons to `pmb-sdk`'s testkit and the
canonical binaries once M1 step 5 lands; C3 is the independent review of
PARITY classifications; C4 adds the G3 and G4 scopes. The plan, the per-row
coverage and the spec ambiguities found while transcribing are in
[PLAN.md](PLAN.md).

## Isolation rules (60 §10.1)

- **Checkout.** Everything happens in the separate clone
  `/Users/worker-1/Sites/polymarket-bot-conformance`, branch
  `native-conformance`, never in the native clone or the fleet copy (CF-2,
  01 §8.1 H1).
- **Blocked inputs.** The author never reads, searches or `git show`s:
  `native/crates/*/src/**`, `native/strategies/**` (any checkout, any ref),
  `native/spec/research/**`, `native/PARITY.md` (until C3) and
  `native/STATUS.md`. The checkout's `.claude/settings.local.json` denies
  them; the rule holds by any other means too.
- **Allowed inputs.** The frozen spec at tag `native-spec-g1`
  (`git show native-spec-g1:native/spec/<file>` for 00–60, without
  `research/`), the Polymarket docs under `docs/polymarket/`, the TS sources
  of this checkout under `src/` only where a spec clause cites them as the
  documented ts-compat behavior (for example `src/trading/fees.ts:18-42`,
  `src/trading/capital.ts:16-28`, `src/trading/cancellation.ts:69`,
  `src/trading/cancellation.test.ts:768-958`), and from C2 the rustdoc of
  `pmb-sdk` and its testkit plus the binary protocol (20).
- **Black box.** Tests go through the testkit API or the binary
  (`EngineJob` in, `EngineResult` and trace out). No engine internals are
  inspected. cargo runs only as `cargo test -p pmb-conformance` (C2) and
  `cargo doc --no-deps -p pmb-sdk`; today, standalone, as
  `cargo test --manifest-path native/conformance/Cargo.toml -j 2`.
- **Commits.** Touch nothing outside `native/conformance/`, subject prefixed
  `conformance:`, English only (CF-3). The implementation session MUST NOT
  edit, skip or weaken these tests (CF-4); a failing test is triaged per
  60 §10.3 and never deleted to make a build green.
- No trading bot, no credentials, no orders, no database writes, no network
  except pushing this branch.

## Layout

| Path | Content |
|---|---|
| `Cargo.toml` | Crate `pmb-conformance` (edition 2021, `publish = false`). Dependencies: `serde`, `serde_json` only. A commented `pmb-sdk` dev-dependency placeholder (`../crates/pmb-sdk`, feature `testkit`) for C2. Its own `[workspace]` table keeps it standalone until C2 moves it into the engine workspace. |
| `src/` | Spec-derived helpers, no engine code: `sha256` (FIPS 180-4), `rng` (10 §6.1 RNG-2…RNG-6, independent implementation), `decimal` (exact decimal with the `Rounding` modes of 10 §3.1), `time` (civil date → epoch ms), `vectors` (loading, well-formedness). |
| `vectors/*.json` | Table-driven vectors transcribed from the spec. Every row carries `id` and `spec` (the clause); values the author derived from a spec formula carry a `derivation`/`note`. Shape: `{ spec, source, notes?, …, vectors: [ { id, spec, … } ] }`. |
| `tests/*.rs` | One file per 60 §10.2 G2 row plus the G3 tables. Each test names its clause in a comment (`// spec: 10 §8.2 row 3`). Data tests run now; testkit/binary tests are `#[ignore = "C2: …"]` with a `todo!()` where the SDK call goes and a comment sketching the call against the surface of 30. |
| `PLAN.md` | Test plan per §10.2 row (G2 in detail, G3/G4 outline), input per test, and the ambiguity list for triage (60 §10.3). |

## Clause-to-file map

| Gate | §10.2 row / clauses | Vectors | Tests |
|---|---|---|---|
| G2 | Order state machine, 10 §8.1–§8.4 (one test per row of §8.2, plus forbidden transitions from S1–S6) | `vectors/order_state_machine.json` | `tests/order_state_machine.rs` |
| G2 | Account event ordering and cascades, 12 §6.1–§6.4, 12 §4.2 (event clock, decision stamp), 12 §5.3, 30 §4/§4.1, 22 §3.3 | `vectors/cascades.json` | `tests/cascades.rs` |
| G2 | Capital C1–C4, 10 §9.4, 10 §3.3 R5/R6/R9, 12 §7.5, 12 §9.4–§9.6, 60 INV-1/2/3/7 | `vectors/capital.json` | `tests/capital.rs` |
| G2 | cid generations, 10 §6, 10 S4, 12 §7.1, 13 §5.1 Cancels, 60 §5.10 | `vectors/cid_generations.json` | `tests/cid_generations.rs` |
| G2 | Dedupe, 12 §7.6, 12 §7.2, 10 N5, 21 §10 (`duplicate_active_cid`) | `vectors/dedupe.json` | `tests/dedupe.rs` |
| G2 | Output quantization, 10 §4 Q1–Q3, 10 R-1/R14/R15, 21 §11, §18 | `vectors/output_quantization.json` | `tests/output_quantization.rs` |
| G2 | Skip taxonomy, 21 §13–§15 | `vectors/skip_taxonomy.json` | `tests/skip_taxonomy.rs` |
| G2 | Contract vocabularies, 21 §17, 20 §4/§4.1/§4.4, 10 §10.2, 10 §9.2 | `vectors/vocabularies.json` | `tests/vocabularies.rs` |
| G2 | `ModelConfig` hash, 21 §6/§6.1/§6.3, 21 §3 CI item 6, 13 §7.3 | `vectors/model_config_hash.json` | `tests/model_config_hash.rs` |
| G2 | Seed vectors, 10 RNG-1…RNG-7, 14 F-51, 60 DET-13 | `vectors/seed_vectors.json` | `tests/seed_vectors.rs` |
| G2 | ts-compat rule values, 11 §4, 11 §3 (ts-compat column), 13 §5.1–§5.2 | `vectors/ts_compat_rules.json` | `tests/ts_compat_rules.rs` |
| G3 (data now) | Fee curves, eras and rounding, 11 §5.1–§5.3, 10 R8 | `vectors/fee_curves.json`, `vectors/fee_eras.json` | `tests/g3_fee_curves.rs` |
| G3 (data now) | Taker delay, 11 §6.1–§6.3 | `vectors/taker_delay.json` | `tests/g3_taker_delay.rs` |
| G3 (data now; ts-compat rows G2) | GTD, 11 §8, 10 §7.4 | `vectors/gtd.json` | `tests/g3_gtd.rs` |
| G3 (data now; ts-compat rows G2) | Batch and cancel caps, 11 §9 | `vectors/caps.json` | `tests/g3_caps.rs` |

## Running

Today (standalone, no engine sources needed; the machine is shared, keep
`-j 2`):

```bash
cargo test --manifest-path native/conformance/Cargo.toml -j 2            # 86 data tests
cargo test --manifest-path native/conformance/Cargo.toml -j 2 -- --ignored  # lists the 151 C2 skeletons (they panic with todo!)
cargo fmt --manifest-path native/conformance/Cargo.toml --check
```

From C2 (60 §10.0): the crate joins the engine workspace (the `[workspace]`
table here is removed, `pmb-sdk = { path = "../crates/pmb-sdk", features =
["testkit"] }` is enabled as a dev-dependency) and runs as
`cargo test -p pmb-conformance`. Black-box binary tests take the canonical
`artifact` binary (60 VP-7, 31 §4) from an explicit path (to be fixed in C2,
proposed: environment variable `PMB_CONFORMANCE_BIN` read by the test, never
by the engine) and drive it through 20 §5 (`describe`, `schema`, `selftest`,
`run --job`, `run-group`) with crafted `EngineJob`s and the committed fixture
markets of 60 §12.

## Conventions

- `// spec: <doc> <clause>` on every test; vector rows carry the same in
  `spec`.
- Numbers the spec gives were recomputed independently before they were
  transcribed (all 15 RNG-7 rows, the 7 fee-curve rows, every dated epoch,
  the Q3 rounding rows); numbers the author derived state their derivation.
- Where a clause is ambiguous the vector says so and points at the PLAN.md
  item (`PLAN A-nn`) instead of guessing.
- Profiles: `ts-compat` rows are G2; `realistic`-only rows are G3; `live`-only
  rows are G4 (skeletons exist for all, gated by their `#[ignore]` reason).
