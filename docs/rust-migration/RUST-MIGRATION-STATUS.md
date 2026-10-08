---
title: Rust Migration Status
description: Durable progress, decisions and outstanding requirements.
---

# Rust migration status

## Current state

Overall goal: active and incomplete. Production services are unchanged. Work occurs in the attached isolated `codex/rust-backtest-benchmark` worktree. The previous user-reply turn made no implementation progress; this continuation advances authoritative state through current independent evidence, repaired native sources and checkpoint publication.

Pinned TS revision: `07245602d6ff9bca0dcdf772134cba3dd227526c`. Merge `84f3a838` brought that revision into the isolated benchmark worktree. The user's primary checkout and its existing untracked simulator idea document remain untouched.

## Decisions

- Rust owns the full shared strategy/trading runtime, replay/feed preparation, live connections/signing/execution and authoritative statistics.
- TypeScript retains scheduling/fleet coordination, database transactions/persistence, APIs/UI and independent administration/recording/presentation.
- Retain Parquet; no Arrow input conversion.
- Shared parameter replay requires independent candidate state and durable grouped ingestion.
- Use subagents actively with non-overlapping ownership and fresh independent review. A helper, subagent or milestone completion is not overall completion.
- No real-money orders or production live activation during this goal.
- Earlier selected-strategy benchmark evidence does not certify complete production parity or a final speed multiplier.

## Progress

The specification, dependency plan and expanding manifest cover 16 audited areas and 64 integration requirements. Individual acceptance remains pending for 73 registered strategies and 374 observed immutable artifact hashes. Static inventory found 219 catalog hashes without local bytes and 85 external source candidates; run/queue/live/fleet reference reconciliation and source recovery remain required. The SDK usage inventory covers 158 source candidates, 21 helpers and 155 available bundles, with all ten SDK requirements still pending.

The native foundation has a strict bounded JSONL contract, Unix parent-loss watchdog and a coarse-operation TS client with framing, identified errors, backpressure, cancellation and process cleanup. No production caller has switched. The executable advertises description/aggregation only, with no native strategies, replay modes or live execution enabled.

The current frozen helper checkpoint passes 68 native tests, 47 client/process tests, strict all-target Clippy, Rust formatting, binary build and strict checking of seven TS oracles. Fresh independent reports cover market (269 total cases/2,025 operations), Portfolio (158/173,840), intents (211), arithmetic (9,106 per profile), metrics (3,145 per profile), metadata (404/81,583 per profile) and authoritative statistics (99/28,899 rows). See `SHARED-CORE-REVIEW.md` for domains and unresolved requirements.

Draft PR [#300](https://github.com/ivanmijatovic89/polymarket-bot/pull/300) is open and attached. Published revision `75dab3b5` passed Root, Dashboard, WebUI, Docs, prototype and macOS native checks. Its Ubuntu native check found a real signed-zero metrics defect; the repair has passed local independent debug/release review. New remote macOS/Ubuntu validation must pass on the repaired checkpoint before that CI evidence is accepted. New intent and metadata suites are included in the matrix.

## Active work and remaining requirements

1. Lead: integrate/publish the reviewed checkpoint and start replay/input preparation from the actual pinned production sources.
2. Runtime agent: typed historical frame admission and serialized strategy/event dispatch, preserving receipt and callback order.
3. Integration agent: direct typed Portfolio nonfinite probes, real record/view identities, account metadata and OrderManager/pending commitments.
4. SDK agent: unified typed-record/metadata session graph, StrategyContext and plugin capture/cache semantics.

The metadata graph is verified only for its declared ordinary data-property domain. Its pinned Observer operation trace skips arithmetic and input file IO. Portfolio retained mutable aliases are still unmet, and current Serde snapshot probes do not prove derived nonfinite typed-state bits. Typed market payload retention is implemented, but complete SDK wrapper identity and callback sequencing remain pending.

Full native strategies and schemas/artifacts, all replay/input modes and feeds, live reconciliation/rotation/signing, caller migration, fleet deployment, four-device validation, final release/rollback and final alternating end-to-end benchmarks remain substantial unfinished work. No repeated goal-blocking condition has been established. Missing external access or unavailable required source bytes cannot count as acceptance.

## Evidence policy

Current bounded reports and integrated logs are stored under `evidence/core-*`; foundation and older independent reports retain their own source identities. Reports are not whole-goal completion or performance evidence. Every full acceptance requirement stays pending/in progress until its entire scope passes on the final revision.
