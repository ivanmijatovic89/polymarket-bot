---
title: Shared Native Core Review
description: Bounded helper validation and unresolved native core integration requirements.
---

# Shared native core review

This checkpoint covers shared arithmetic, context metrics and ongoing market/Portfolio work. It does not certify a strategy runner, native live execution, replay inputs, fleet deployment or a production speed multiplier. The goal remains active, and every full integration requirement remains pending or in progress.

## Arithmetic and context metrics

The arithmetic helper port preserves the pinned TypeScript operation order, eight-place `round2` behavior, JavaScript rounding direction, signed zero, fee guards and fee-scaling overflow. The context helpers preserve finite-value sanitization, nullable average prices, signed-zero minimum, asset-ID availability and book depth/weak-side calculations. Metrics accept typed position amounts and borrowed depth slices; the full strategy context and market-meta wrappers still need integration.

Independent review found no arithmetic or typed metric implementation defect in the tested domain. Arithmetic passes 9,090 bit-aware scenarios, including 64 absent/null fee-rate and post-only selector cases; context metrics pass 3,144 scenarios. Four arithmetic regressions and two metrics regressions pass. Both debug and release profiles have been exercised, but integrated checkpoint evidence is refreshed after the shared modules stabilize; whole-goal final-revision evidence remains required.

The runners build their actual driver with locked offline Cargo, discover the executable from Cargo's compiler artifact messages, capture native source/Cargo/toolchain hashes, freeze the executable, and check source/driver provenance before and after comparison. The pinned TypeScript source bytes must equal Git revision `07245602d6ff9bca0dcdf772134cba3dd227526c`. Finite numbers and infinities use IEEE bit comparisons; NaN payloads are compared by class. The comparator requires one output per input in both runtimes and rejects eight deliberate count/bit/enum/null/type/field mutations. JSON-serialized snapshot equality is insufficient for SDK-observable signed zero and aliases.

## Findings and current disposition

| Finding                      | Evidence and required resolution                                                                                                                                              | Disposition                                                                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-MATH-1                    | An existing executable could pass after current source changed. Build the driver and bind source/build identities to the frozen executable.                                   | Repaired and independently rechecked; future expanded source is automatically fingerprinted.                                                                                 |
| Metrics comparator hardening | Require both outputs to match input count; reject bit, enum, null, numeric type and field mutations.                                                                          | Implemented; eight mutation checks execute in each comparison.                                                                                                               |
| P2-MARKET-1                  | Per-digit radix accumulation rounded intermediate values, differing from `Number('0x20000000000001f')`.                                                                       | Repaired and independently rechecked in the 262-case market corpus.                                                                                                          |
| P2-MARKET-2                  | `{toString:0}` and arrays containing it must preserve checked conversion failure semantics.                                                                                   | Repaired and independently rechecked against pinned conversion exceptions.                                                                                                   |
| P2-MARKET-3                  | Zip-only raw UTF16 comparison could miss omitted responses; bind complete compiled native inputs as well.                                                                     | Repaired; exact corpus counts and four count mutations independently rechecked.                                                                                              |
| Raw UTF16/deep metadata      | JSON permits unpaired surrogate escapes. Raw frames/messages/trace snapshots must preserve code units and avoid an accidental new depth limit or destructive replacement.     | Eight UTF16 closure fixtures, iterative metadata through depth 8,192 and malformed cleanup pass independent review. Full SDK account metadata remains separate pending work. |
| P2-PF-1                      | Large integer metadata and opaque extension fields must normalize to JavaScript binary64, with numeric property-key ordering preserved.                                       | Repaired; internal binary64 bit/key-order probes and full reference suite independently rechecked.                                                                           |
| P2-PF-2                      | `order_done.reason` must accept only filled, canceled, expired or killed.                                                                                                     | Repaired; dedicated terminal enum and invalid-state regressions independently rechecked.                                                                                     |
| P2-PF-3                      | A normalization serialize/parse round trip erased metadata negative zero that a strategy can observe with `Object.is`.                                                        | Repaired by direct tree normalization; internal metadata/extension signed-zero probes independently rechecked.                                                               |
| Retained mutable aliases     | Old OpenOrder/Position references and input Fill/PositionsSplit/meta references can share mutable TS objects. JSON snapshot equality cannot prove equivalent native behavior. | Explicit unmet SDK/runner/consumer requirement; no noncontract assumption or full parity claim.                                                                              |
| Native event identity        | TS pending submissions/splits/merges clear by event-object identity. Distinct equal-valued events must not discharge one another's obligations.                               | Typed event identity tokens proposed for OrderManager/runner; implementation and trace evidence pending.                                                                     |

Portfolio's current-snapshot suite has reached 155 scenarios and 173,834 steps, including real pruning bounds and idempotency/order cases. That count is bounded evidence for the source/build snapshot recorded by its report. It explicitly excludes unresolved alias equivalence. Source motion during comparison must fail provenance instead of producing a pass.

Eight P2 findings are repaired and independently rechecked. Market passes 262 scenarios/1,995 operations and eleven native regressions; Portfolio passes ten native regressions. Idiomatic Rust enum names preserve original serde wire labels. Integrated library exposure does not enable production execution or advertise supported native strategies.

Native scheduling must preserve each historical tick snapshot before advancing a frame child. A borrowed view of the engine’s latest book state cannot stand in for an earlier queued tick. Typed historical snapshot/capture integration remains required.

## Reproduction

Run in the isolated worktree with Node 20. Current source movement may deliberately reject a run; rerun only after authors provide a stable checkpoint.

```bash
/Users/mijat/.cargo/bin/cargo test --locked --offline --manifest-path native/trading-runtime/Cargo.toml --test math --test metrics
python3 scripts/rust-migration/math-differential.py --node /Users/mijat/.nvm/versions/node/v20.19.6/bin/node --report /tmp/native-math-debug.json
python3 scripts/rust-migration/math-differential.py --node /Users/mijat/.nvm/versions/node/v20.19.6/bin/node --release --report /tmp/native-math-release.json
python3 scripts/rust-migration/metrics-differential.py --node /Users/mijat/.nvm/versions/node/v20.19.6/bin/node --report /tmp/native-metrics-debug.json
python3 scripts/rust-migration/metrics-differential.py --node /Users/mijat/.nvm/versions/node/v20.19.6/bin/node --release --report /tmp/native-metrics-release.json
```

Market and Portfolio provide separate test-only oracles against the same pinned source revision. Their final commands, durable reports and remaining SDK requirements will be recorded once the open fixes stabilize. Passing a helper suite does not set `core.01`, strategies, fleet or any production acceptance item to passed.
