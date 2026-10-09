---
title: Rust Migration Specification
description: Agreed native trading ownership, compatibility and acceptance contract.
---

# Rust migration specification

## Authority and reference

The active goal and the user's shared live/backtest invariant define this migration. This specification consolidates decisions already agreed; it does not replace them with the older narrower experiment proposal. Reference production revision: `07245602d6ff9bca0dcdf772134cba3dd227526c`. Worktree: `/Users/mijat/.codex/worktrees/rust-backtest-benchmark/polymarket-bot`, branch `codex/rust-backtest-benchmark`. Keep the user's primary checkout and its untracked simulator idea document untouched.

The historical experiment architecture file is evidence of an earlier proposal. Its Node live binding, TS signed execution, TS authoritative aggregation and selectively retained production TS engine are superseded by this specification. Experimental implementation and measurements remain evidence and reusable source, not full production acceptance.

## Ownership

Rust owns the entire trading runtime for both live and backtests: decoding/books, meaningful and supported synthetic ticks, feed visibility, tick-scoped snapshots/context/plugins, strategy callbacks, validation/risk, order lifecycle, commitments/capital, idempotent portfolio/accounting, rotation and old-market routing. Rust owns live connections, signing, actual execution/account transports and trading-used blockchain/relayer effects. Replay and live use one core/strategy implementation with distinct real/simulated execution adapters. Rust owns authoritative market, batch, tail/calendar calculations, diagnostics and trace production.

TypeScript retains submission/selection/preflight adapters, queues/fleet scheduling, database transactions/persistence, APIs, dashboard/WebUI and independent administration/recording transport/storage/post-result presentation analytics. Retained TS modules must communicate through native contracts rather than own duplicate trading state or execute strategies on the native path. Keeping TS coverage/wall-clock display helpers and post-result walk-forward analysis does not require retaining the TS trading engine. Shared recorder book/bootstrap calculations need native treatment before deleting the shared TS implementation.

Keep original Parquet inputs, loading/preparation and supported R2/cache/integrity behavior. Do not substitute Arrow conversion. Preserve the supported feature surface; no automatic retirement of strategies, plugins, input modes, old artifacts or useful tools.

## Required capability inventory

List static strategy-definition candidates, successfully loaded registry/protocol definitions and externally published/saved artifacts separately. A static count is not supported coverage. Preserve fail-loud ordinary registry and fail-soft protocol discovery behavior where exposed. Inventory required source hashes, schema/default/coercion/strictness rules, plugin/feed requirements, execution modes, symbols/timeframes and consumers.

Each required strategy needs a native implementation and evidence or an explicitly agreed compatibility treatment. `.mjs` is executable JavaScript, not a portable strategy description. Map immutable historical reference hashes to specific native ports; do not silently rerun a historical result with a different current strategy. Keep isolated TS reference execution for differential evidence until equivalent support exists; no silent fallback in completed production native paths.

Discoveries expand the acceptance manifest. Track subsequent relevant primary-checkout changes against the pinned reference. Explicitly record any existing baseline divergences/defects; do not normalize them away to manufacture parity.

## Process and protocol boundary

Build a standalone native runtime executable from a reusable core crate. Use versioned, language-neutral requests/results for coarse operations: runtime/strategy description, market/group replay, authoritative aggregation, trace capture, diagnostic replay, recorder derivation and live session/snapshot/control. Initial capabilities must advertise only operations actually implemented.

A request carries protocol version and correlation ID. Job inputs carry input identities, exact ordering/window/feed settings, strategy source/core/params/build/target identities, capital/execution/risk/RNG configuration and candidate/submission identity. Output distinguishes usable market results, documented skips, deterministic errors, retryable failures and cancellation. An accepted live command is distinct from its eventual execution/account result.

For local supervision, use JSON-line control envelopes over stdin/stdout; stdout is protocol-only and diagnostics go to stderr. Trace bulk data uses bounded files/chunks with integrity/provenance and lease/cancellation semantics. Never serialize JS factories, closures, observer callbacks or class methods. IDs/source sequences requiring bigint must remain decimal strings across JSON. Native per-tick strategy/book processing stays within Rust.

Version negotiation must verify loaded binary/core/strategy capabilities, not merely Git ancestry. Missing capabilities fail/defer explicitly according to whether a compatible update exists. Define process exit, cancellation, draining, retry and parent-loss behavior before adopting the worker adapter. Bound requests/output memory and keep concurrency within the single machine budget.

## Compatibility and numerical evidence

Preserve actual baseline ordering: recorded heap prioritizes ingest sequence before selected timestamp/file tie; paired rows restore both books and emit one strategy callback; delta invalid-row skipping and bigint sequences must match the supported TS behavior. Preserve input-specific window rules instead of imposing one generic timestamp policy. V4 uses receipt-order events, half-open receipt windows, bootstrap without strategy history, gap resets, tick-scoped captured feeds and opening-reference/TWAP rules.

Compare discrete tick/action/order/account structures and IDs exactly. Document justified field-specific floating-point comparisons; persisted rounded business fields must match. Seeded RNG order and per-candidate independence are behavioral contracts. Compare full traces/context/portfolio, not only final PnL. Keep no-activity result rows distinct from missing/null results and failures so denominators remain correct.

## Persistence and sharing

TS owns database transactions; Rust computes authoritative fields. Native outputs are plain validated DTOs, not `BatchStats` objects with `toRunColumns()` methods. Extensions must recompute the chronologically ordered old/new union while preserving existing row-lock/rollback/overlap behavior, or use explicit revision-checked snapshots and retries. Never persist stale computed summaries.

Grouped parameter replay shares immutable input/book/feed preparation only. Candidate strategy, RNG, orders, capital/portfolio and outputs are independent. Explicit compatibility keys, stable candidate identities, bounded groups and durable idempotent ingestion/partial-failure outcomes are required. Do not equate shared compute with reduced result-row count. Do not multiply independent benchmark ratios.

## Completion and deployment boundary

The acceptance manifest is an expanding requirement ledger, not proof by itself. Each pass requires exact commands/scenario coverage, final source/build/input identities and inspectable evidence. Every required supported consumer must migrate before removing superseded executable TS implementations. Neutral TS types/helpers can remain.

Validate non-production workers on all four actual fleet devices without disrupting active workloads. Build/deploy verified target-specific native artifacts and verify budgets, identity, updates, drain/cancel/crash/retry recovery and complete DB outcomes. Required missing access is unmet work, not a passed substitute.

Final evidence includes independent behavior/scope review, resolved findings, CI, release/runbook/rollback and repeated alternating end-to-end TS/Rust benchmarks on identical inputs/params/budgets with final queue/data/log/trace/serialization/stats/DB wiring. Earlier selected benchmark ratios are not universal production promises. Prepare the verified release; production live activation and real-money orders are outside this goal.

The overall goal remains incomplete if any required acceptance item is pending, failed, blocked or weakly verified. A working vertical slice, subagent result, token/usage stop or finished milestone does not complete the migration.

## Foundation wire limits

Protocol version 1 uses JSONL with a 64 MiB request limit including framing. Input and result values are plain JSON with at most 124 nested object/array containers (root container depth one, primitives depth zero). Identifier byte limits use UTF-8; whitespace-only identifiers and Unicode control characters are rejected. Wire strings must contain Unicode scalar values. Client inputs cannot contain cycles, sparse arrays, accessor-backed values or custom JSON serialization.

The Unix launcher reserves inherited descriptor 3 for a parent-watch pipe. Closing it or abrupt parent death terminates native work. The TS client sends one whole operation and accepts one correlated response only after clean process closure. This foundation currently advertises description and aggregation only; no native strategies, replay modes or live trading are advertised yet.
