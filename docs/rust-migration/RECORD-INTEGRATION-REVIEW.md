---
title: Native Record Integration Review
description: Shared source and portfolio record integration, raw Parquet codec evidence, and required remaining work.
---

# Native record integration review

This checkpoint implements authoritative source and selected Portfolio records in the shared session graph and integrates actual flat Parquet DECIMAL decoding. It is compared against TypeScript reference `07245602d6ff9bca0dcdf772134cba3dd227526c`. The complete migration remains active and incomplete: no native strategy, production replay/live capability, migrated production caller, fleet acceptance or new speed multiplier is certified.

## Implemented behavior and evidence

The frozen source passes 109 native tests, 47 process/client tests, Rust formatting, all-target Clippy with warnings denied, executable build and the required CI strict typecheck of ten TypeScript comparison programs. Four test-only drivers remain intentionally ignored by ordinary Cargo tests and are executed by their differential runners. A separate exploratory check with extra optional-property flags found five diagnostics in older comparison wrappers; that result is recorded as a failure, not counted as another pass.

| Component                  | Bounded evidence                                                                                                                                           | Required remaining behavior                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typed source/admission     | 56 scenarios, 299 operations, 11 typed-source probes; author and fresh independent debug/release reports; 13 response mutations and 5 dependency mutations | Inherited properties/descriptors, actual runner bodies and production owner scheduling                                                                                                          |
| Portfolio managed records  | 185 scenarios, 173,857 ordinary steps, 24 managed graph scenarios with 264 actions; fresh independent comparison and 18 comparator mutations               | Authoritative WS records, ONE frozen cached snapshot root, generic coercions/descriptors/prototypes and complete OrderManager/runner integration                                                |
| Actual flat Parquet reader | 73 scenarios, 348 admitted rows; author and fresh independent debug/release reports; 11 response mutations and 5 dependency mutations                      | Complete logical/input modes, nested conversion, other DECIMAL physical types, exact exception identity/timing, zero-declared-count pages, Buffer SDK aliases, feeds and R2/permission adapters |
| DECIMAL codec              | 747 scenarios and 12 comparator mutations in debug/release; 9 native tests                                                                                 | Whole reader or SDK acceptance; validated-descriptor, raw-footer and authored-schema contexts stay separate                                                                                     |
| Existing helpers           | Market269/2,025 operations; intents211; metadata531/116,766 actions per profile; arithmetic9,106 and metrics3,145 per profile; statistics99/28,899 rows    | Full strategies, context/plugins, production consumers and deployment                                                                                                                           |

Sources store exact BigInt ordinals, nonfinite Number clocks, negative zero and UTF16 text in authoritative graph slots. A diagnostic Serde projection is not source authority. Per-child spreads read current slots at dispatch, preserve insertion order and shared child edges, and allocate a fresh outer source record only where the reference does. Worker/job transport must instantiate independent session graphs for independently mutable candidates.

Managed account envelopes and payloads are allocated before queue admission. Processing reads current envelope kind and current scalar/payload slots. Fill/Split histories and Position/OpenOrder/history maps now retain graph records; one accounting core applies their financial transitions. Snapshot membership containers are distinct from authoritative maps while records retain identity. Private commitment bookkeeping remains part of that core. The current snapshot wrapper/root and WS map storage still require further conversion; existing graph handles alone do not prove whole SDK parity.

## Findings repaired in this checkpoint

- Fill/Split alias probe identities now follow the current mutable event kind. The financial transition was correct; the comparison driver had observed the wrong payload category.
- Mutating a submitted order's `clientOrderId` cannot change the map key used to resolve a later fill. Partial/complete fills and done/rejected history now use the resolved event/map key. Four independent actual-TypeScript repros and durable corpus cases verify the repair.
- DECIMAL numeric decoding uses precision-selected 32/64-bit reads inside the original page cursor, followed by Number conversion and division. Scalar row conversion cannot reproduce cross-row halfword reads.
- Compressed/uncompressed V1 and V2 retain distinct cursor contexts. Uncompressed V2 does not unconditionally reset the cursor to page end; a subsequent header can therefore fail before any rowgroup admission.
- Raw Thrift absence becomes `null` in the reference reconstructed schema. Numeric/BYTE_ARRAY dictionary files with absent `type_length` consequently select a fixed codec and throw its missing-length error. Positive fixed dictionaries decode Buffers. Footer/page DECIMAL statistics retain Buffer bytes instead of using the numeric dictionary codec.
- Undefined dictionary values are compacted across the whole column before definition-level materialization, including across pages. Logical missing overrides cannot fall through to unrelated physical values. Fixed dictionary/plain mixed pages preserve Buffer bytes.
- Native inferred logical annotations cannot replace raw converted-type provenance. LogicalType-only DECIMAL/JSON annotations, including annotations the reference ignores as incompatible, preserve their original physical values.
- Raw INT64 DECIMAL precision20 is accepted by the reference. Physical native schema validation is now separated from raw codec precision/scale; values are not clamped. Raw scale powers use Node20-verified binary64 bits for scales0..308 and positive Infinity thereafter, preserving underflow and signed zero.
- Header/version validation remains before admission. Earlier rowgroups remain admitted when a later group fails, while any failing group contributes no partial prefix.

Source reports bind 102 installed module/package/helper files. Actual-reader reports bind 2,551 observed module/package/native-helper files, including transitive compression and transpiler dependencies. Discovery and authoritative import sets must match; file additions/deletions/content changes and exact Node/Cargo/Rust executable identities are guarded before and after comparisons. Runtime tracing is evidence-only and is never installed in the trading process.

## Scope and next work

The executable still advertises only `describe_runtime` and aggregation. No production caller has switched. All 64 integration requirements, 73 registered strategies and 374 observed artifact versions remain pending or in progress; these helper passes do not change their acceptance scope.

Next implementation installs the actual runner orchestration, binds the complete graph-aware OrderManager and SDK/context/plugins, completes authoritative Portfolio snapshot/WS semantics, and connects real replay modes and feeds. Session capture requires ephemeron reachability rather than permanently rooted values behind weak keys. Reader empty/declared-count, other physical/logical conversions, nested fields, exception identities and Buffer alias behavior remain required rather than assumed irrelevant.

Every supported strategy/artifact, producer/worker/fleet path, persistence transaction, live reconciliation/signing/rotation, external consumer, non-production fleet device, release/rollback and final alternating end-to-end benchmark remains required. Production services and the user's primary checkout remain unchanged. This checkpoint measures parity domains, not performance.

## Reproduction and stored evidence

Run from the isolated worktree with Node20 and the locked Rust toolchain. `evidence/records-validation.json` indexes the frozen native source hashes, 21 report hashes and adjacent validation logs. `records-source-*`, `records-portfolio*`, `records-decimal-*` and `records-parquet-*` retain author/fresh-review identities and exact scope flags. Older `admission-*` evidence remains bound to its own `aa6d6fb7` checkpoint and its seven successful remote CI checks.

For both build profiles run `dispatch-differential.py`, `parquet-decimal-differential.py`, `parquet-input-differential.py`, `metadata-differential.py`, `math-differential.py` and `metrics-differential.py` with `--node /absolute/path/to/node20`, then repeat with `--release`. Run `market-differential.py`, `portfolio-differential.py`, `intents-differential.py` and `stats-differential.py` with the same Node argument. Scripts reside under `scripts/rust-migration/`; pass `--report` to save their identities. Both native CI platforms now execute Source, DECIMAL and actual-file comparisons in debug/release. Remote CI for this new checkpoint must pass on its published revision.
