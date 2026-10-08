---
title: Rust Migration Status
description: Durable progress, decisions and outstanding requirements.
---

# Rust migration status

## Current state

Overall goal: active and incomplete. Production services unchanged. Work occurs in the attached isolated `codex/rust-backtest-benchmark` worktree. Current goal turn classification: progress (native arithmetic, market and Portfolio work, expanded immutable artifact scope and independent reviews).

Reference TS revision: `07245602d6ff9bca0dcdf772134cba3dd227526c`. Starting migration worktree revision: `190787ac`. The benchmark branch originally used an older TS baseline; merge `84f3a838` brought the pinned production revision into the isolated worktree without changing the user's primary checkout. Its existing untracked simulator idea document remains untouched.

## Decisions

- Full native live connections/signing/execution supersede the earlier Node binding/TS live adapter split.
- Authoritative aggregation/calendar stats move to Rust; TS retains transactions and independent post-result display/research analytics.
- Parquet retained; no Arrow input conversion.
- Shared parameter replay is required, with independent candidate state and durable grouped ingestion.
- Selected v15 benchmark evidence is reusable, not a general strategy/input/live certification.
- No real-money live orders or production live activation during this goal.
- Use subagents actively with non-overlapping ownership and fresh independent review; a subagent or milestone completion does not complete the overall goal.

## Progress

- Specification, dependency-ordered plan and expanding acceptance manifest recorded: 16 audited areas, 64 integration requirements, individual pending entries for 73 registered strategies and 374 observed immutable artifact hashes.
- Captured pinned strategy inventory: 73 tracked definitions and 73 loaded catalog entries. A subsequent read-only DB audit observed 372 saved immutable artifact rows across 316 strategy IDs, with 155 primary-cache files and one isolated-cache file. The completed static inventory observes 374 unique hashes including two cache-only versions and 219 catalog hashes without local bytes, plus 85 tracked external source candidates. This is not complete required coverage: run/queue/live/fleet references, source recovery and full validation contracts remain pending.
- Added a standalone native crate advertising description/aggregation only, strict bounded JSONL contracts and a Unix parent-loss watchdog.
- Added a coarse-operation TS client with identified errors, output/input validation, backpressure, cancellation/timeout and process cleanup.
- Ported native authoritative batch/tail/calendar calculations and established a pinned independent TS oracle.
- All five independent foundation review findings fixed and rechecked. Final validation includes 16 native tests, 47 client/process tests and 94 full-output statistics scenarios over 28,899 market rows.
- Root Node 20 typecheck, targeted ESLint, strict native Clippy and documentation build passed. Full final CI remains required.
- Preserved historical experimental files and ignored handoff archive. Earlier measurements do not certify the new production runtime.

## Active parallel work

1. Typed historical market snapshots and receipt/dispatch sequencing.
2. Typed intent/risk/cancellation ports followed by pending-capital and OrderManager integration.
3. Shared SDK identity/value-graph implementation and plugin/strategy compatibility, based on the observed usage inventory.

Lead owns integration, shared interfaces, acceptance evidence and sequencing. No existing production CLI, queue, DB or fleet caller has yet switched to native execution.

## Shared-core work in progress

- Shared arithmetic matches pinned TS in 9,090 bit-aware cases, including omitted/null fee-rate and post-only selectors, and four native regressions. The runner builds current sources before freezing the executable and records native input/toolchain hashes. Debug/release evidence and fresh implementation review pass; this is bounded helper evidence, not strategy-runtime acceptance.
- Typed Portfolio passes 155 cases/173,834 steps and ten native regressions after independently reviewed integer, terminal-reason and signed-zero repairs. Retained object aliases and mutations remain required SDK/consumer integration work; full production parity is not claimed.
- Native market decoding/orderbooks pass 262 cases/1,995 operations and eleven native regressions, including UTF16, radix conversion, internal numeric values and deep metadata. Historical typed tick capture and strategy dispatch still require integration.
- The immutable artifact inventory and all ART-01 through ART-12 requirements are now recorded. No strategy port is certified by static discovery.

## Blockers and unknowns

No repeated goal-blocking condition established. Four-device access and external artifact completeness remain to be verified; do not claim their acceptance. Native live execution, all replay modes and required strategy ports remain substantial unfinished work.

Shared context metrics pass 3,144 bit-aware scenarios and two native regressions. Eight shared-core P2 findings were repaired and independently rechecked; see `SHARED-CORE-REVIEW.md`. Strategy/SDK alias and broader account metadata semantics remain explicitly unmet.

The SDK audit confirms actual external Observer metadata/tape alias mutation and first-tick input-file hashing. Those behaviors are required native work and eventual benchmark costs. Native typed historical snapshot/runner sequencing is also an explicit pending requirement.

The [SDK usage inventory](SDK-USAGE-INVENTORY.md) tracks 158 source candidates, 21 helpers and 155 available bundles, with 219 catalog bundles unavailable locally. SDK-01 through SDK-10 are required pending work. Static discovery does not certify executed schema/plugin/strategy compatibility.

## Verification evidence

See `SHARED-CORE-REVIEW.md` and `evidence/core-*.json` for the current bounded checkpoint; `FOUNDATION-REVIEW.md`, `evidence/foundation-validation.json` and `evidence/foundation-stats.json`. Evidence describes the bounded foundation, not full migration acceptance or performance. Requirements stay pending/in progress until their whole scope and final-revision evidence pass.
