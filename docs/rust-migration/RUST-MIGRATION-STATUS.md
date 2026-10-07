---
title: Rust Migration Status
description: Durable progress, decisions and outstanding requirements.
---

# Rust migration status

## Current state

Overall goal: active and incomplete. Production services unchanged. Work occurs in the attached isolated `codex/rust-backtest-benchmark` worktree. Current goal turn classification: progress (durable requirements, pinned catalog, native protocol/client/statistics foundation and independent review).

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

- Specification, dependency-ordered plan and expanding acceptance manifest recorded: 16 audited areas, 40 integration requirements and individual pending entries for 73 registered strategies.
- Captured pinned strategy inventory: 73 tracked definitions and 73 loaded catalog entries. A subsequent read-only DB audit observed 372 saved immutable artifact rows across 316 strategy IDs, with 155 primary-cache files and one isolated-cache file. Those are preliminary observations, not complete required coverage: orphaned run/queue references, source availability and full validation contracts remain pending.
- Added a standalone native crate advertising description/aggregation only, strict bounded JSONL contracts and a Unix parent-loss watchdog.
- Added a coarse-operation TS client with identified errors, output/input validation, backpressure, cancellation/timeout and process cleanup.
- Ported native authoritative batch/tail/calendar calculations and established a pinned independent TS oracle.
- All five independent foundation review findings fixed and rechecked. Final validation includes 16 native tests, 47 client/process tests and 94 full-output statistics scenarios over 28,899 market rows.
- Root Node 20 typecheck, targeted ESLint, strict native Clippy and documentation build passed. Full final CI remains required.
- Preserved historical experimental files and ignored handoff archive. Earlier measurements do not certify the new production runtime.

## Active parallel work

1. Native market decoding/orderbooks/tick semantics and full-output reference fixtures.
2. Native Portfolio/capital/account-event semantics and adverse-order/idempotency fixtures.
3. External immutable strategy/artifact compatibility inventory and remaining schema/reference requirements.

Lead owns integration, shared interfaces, acceptance evidence and sequencing. No existing production CLI, queue, DB or fleet caller has yet switched to native execution.

## Blockers and unknowns

No repeated goal-blocking condition established. Four-device access and external artifact completeness remain to be verified; do not claim their acceptance. Native live execution, all replay modes and required strategy ports remain substantial unfinished work.

## Verification evidence

See `FOUNDATION-REVIEW.md`, `evidence/foundation-validation.json` and `evidence/foundation-stats.json`. Evidence describes the bounded foundation, not full migration acceptance or performance. Requirements stay pending/in progress until their whole scope and final-revision evidence pass.
