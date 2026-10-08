---
title: Runtime and Replay Integration Review
description: Bounded native runner, OrderManager, SDK and replay integration evidence with unresolved production requirements.
---

# Runtime and replay integration review

The native source now contains the actual shared runner and OrderManager bodies, a single authoritative Portfolio record graph and cached frozen snapshot root, graph-backed strategy context and PluginSet, and recorded/Telonex paired/Telonex delta replay bodies. The full-body reference compares the real pinned TypeScript Runner, OrderManager, Portfolio and PluginSet, including lifecycle, account feedback, rotation, contexts and retained references. This checkpoint is a foundation for the full migration. The executable still advertises no strategy, replay input mode or live trading capability, and no production caller has switched.

## Verification

The integration floor passes 164 native units, 47 process/client tests against the explicitly selected private build, Rust formatting, strict all-target Clippy and strict checking of every TS reference oracle. Eight ignored tests are external fixture drivers; the relevant comparison programs execute their frozen binaries with generated input manifests. They are not omitted production tests.

The reports under `evidence/runtime-*` bind native sources, drivers, wrappers, compiler/Node identities, actual imported reference dependencies and immutable input bytes within each report's documented scope. The primary Cargo target belongs only to this worktree. The runner driver also enforces its source-root marker. Native sources remained frozen during the final comparisons. These reports do not inherit acceptance from earlier checkpoints.

| Domain                      | Covered comparison                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| Portfolio                   | 194 scenarios, including 33 retained-root scenarios / 387 actions                                  |
| OrderManager                | 160 actual-source scenarios, six direct regressions and 21 comparator mutations                    |
| Shared runner               | 23 actual-source scenarios in debug/release, 18 comparator mutations and five dependency mutations |
| Local Parquet reader        | 80 cases / 383 admitted rows in debug/release                                                      |
| Recorded replay             | 64 cases / 96 emitted ticks in debug/release                                                       |
| Telonex paired/delta replay | 61 cases / 88 emitted ticks in debug/release, three direct regressions and 17 comparator mutations |

Existing market, intents, metadata, arithmetic, metrics, statistics, DECIMAL and typed admission comparisons were refreshed on this same native source set. Numeric and callback limitations remain those stated by the individual programs; this table is not full engine acceptance or a performance measurement.

Fresh independent runner review reproduced and repaired a real cache bug: TypeScript updates the account-context plugin cache only for a truthy snapshot. A later falsy snapshot must remain visible in that market context while account callbacks keep the earlier truthy snapshot. The new actual-source regression passes independently. Fresh independent Telonex review contributed 18 adversarial cases, now durable in the oracle, and independently passes 61/88. It also repaired weak evidence validation: both sides must satisfy exact envelope and scalar types, with canonical ASCII BigInt source strings, even if both outputs contain the same malformed value.

## Other repaired differences

- OrderManager validators perform each source-site property read separately. A stateful price/size getter can return a valid value on the first read and zero on the second; caching that read changes rejection and later getter behavior. Eight bounded accessor scenarios cover this and original thrown-object identity. General operator/prototype behavior remains required.
- Portfolio stores one cached snapshot root and original managed order/event/history references, preserving original map keys even if exposed identifiers mutate. Financial handlers still require callback-aware source-site operators and reentrant ownership.
- Optional Parquet fields are materialized as `null` by the existing reader. Telonex `Number(null)` therefore selects index zero. Treating that field as undefined incorrectly skips a valid row.
- A raw column's `num_values` is a truthy thrift Int64 object even at zero. The reference skips its data pages and exposes undefined scalar codec values. Native flat zero-count columns now preserve that distinction and skip invalid data pages; seven actual-file fixtures cover the repair. Dictionary initialization before skipped pages, nested columns and exact malformed-reader errors remain required.
- Paired books apply together before one awaited callback. Telonex preserves physical cursor order, source receipt clocks and exact wide ingest sequences. Initial stop runs before reading the first row, and a callback failure survives an ignored close rejection.

## Required next integration

The remaining work includes authoritative mutable graph ingress for original messages and cached market snapshots; complete array assignment/descriptors, prototypes, generic operators/coercion and WeakMap ephemeron capture; callback-aware reentrant financial Portfolio operations; exact owning Promise job scheduling; throwing stop callbacks and their original error through cleanup; full physical/nested/Buffer/dictionary/reader error domains; R2/EPERM opening; Recorder V4 and external feed preparation; all required strategies and immutable artifacts; live signing/reconciliation/rotation; production callers, queue/fleet/persistence and device validation; and final release/rollback and alternating complete benchmarks.

A reentrant financial getter may call the same Portfolio again synchronously. Holding a RefCell state guard across that callback is not acceptable. The next owner design must use one CoreState, release guards before callbacks and preserve source-site partial mutations and original locals. Snapshot membership materialization and live Map/Set iteration must follow their respective TypeScript source semantics.

The current replay Stop API accepts a Boolean closure and does not yet represent a thrown JS stop callback. The typed market fixture engine still copies mutable AST bodies; production requires the common authoritative graph engine. Current graph wrappers alone do not certify that ingress boundary. These are explicit required migration items, not permission to retire supported behavior.

No whole acceptance criterion is completed here. No production activation, real-money order or new speed multiplier is claimed. The preceding docs-only revision `c6634521` passed all seven remote CI checks; this new code checkpoint needs its own remote CI.

## Reproduce

Use Node 20 and a Cargo target reserved for the current source root:

```sh
cargo test --locked --offline --manifest-path native/trading-runtime/Cargo.toml --target-dir /private/tmp/current-worktree-native-target
cargo clippy --locked --offline --manifest-path native/trading-runtime/Cargo.toml --target-dir /private/tmp/current-worktree-native-target --all-targets -- -D warnings
python3 scripts/rust-migration/order-manager-differential.py --node /absolute/path/to/node20 --target-dir /private/tmp/current-worktree-native-target
python3 scripts/rust-migration/runner-full-differential.py --node /absolute/path/to/node20 --target-dir /private/tmp/current-worktree-native-target
python3 scripts/rust-migration/runner-full-differential.py --node /absolute/path/to/node20 --target-dir /private/tmp/current-worktree-native-target --release
python3 scripts/rust-migration/telonex-replay-differential.py --node /absolute/path/to/node20 --target-dir /private/tmp/current-worktree-native-target
python3 scripts/rust-migration/telonex-replay-differential.py --node /absolute/path/to/node20 --target-dir /private/tmp/current-worktree-native-target --release
```

Set `PMB_NATIVE_TEST_BINARY` to the private target's current executable when running native client/process integration tests. Do not reuse the Cargo target for a copied or independently frozen source directory.
