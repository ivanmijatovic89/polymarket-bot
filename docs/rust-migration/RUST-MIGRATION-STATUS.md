---
title: Rust Migration Status
description: Durable progress, decisions and outstanding requirements.
---

# Rust migration status

## Current state

Overall goal: active and incomplete. Production services are unchanged. Work occurs in the attached isolated `codex/rust-backtest-benchmark` worktree. Implementation continues with parallel subagents, non-overlapping ownership and fresh independent review.

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

The previous published `6945cad7` helper checkpoint passed 68 native tests, 47 client/process tests, strict all-target Clippy, Rust formatting, binary build and strict checking of seven TS oracles. Fresh independent reports cover market (269 total cases/2,025 operations), Portfolio (158/173,840), intents (211), arithmetic (9,106 per profile), metrics (3,145 per profile), metadata (404/81,583 per profile) and authoritative statistics (99/28,899 rows). See `SHARED-CORE-REVIEW.md` for domains and unresolved requirements.

Draft PR [#300](https://github.com/ivanmijatovic89/polymarket-bot/pull/300) is open and attached. Published revision `75dab3b5` passed Root, Dashboard, WebUI, Docs, prototype and macOS native checks. Its Ubuntu native check found a real signed-zero metrics defect; the repair has passed local independent debug/release review. Repaired revision `6945cad7` now passes all seven remote checks, including native debug/release comparisons on both Ubuntu and macOS with the new intent/metadata suites. Terminal CI evidence is stored in `evidence/core-ci-6945cad7.json`; this applies to that checkpoint, not ongoing new source changes.

## Active work and remaining requirements

1. Lead: integrate/publish the reviewed checkpoint and start replay/input preparation from the actual pinned production sources.
2. Runtime agent: typed historical frame admission and serialized strategy/event dispatch, preserving receipt and callback order.
3. Integration agent: direct typed Portfolio nonfinite probes, real record/view identities, account metadata and OrderManager/pending commitments.
4. SDK agent: unified typed-record/metadata session graph, StrategyContext and plugin capture/cache semantics.

The current typed record arena uses the metadata identity graph and direct field slots; it has no detached JSON mirror. Independent ordinary-property and record graph traces pass in debug/release. Authoritative Portfolio record storage, complete SDK wrappers/prototypes, context/plugins and actual runner processing remain unmet. Typed derived Infinity/NaN probes now run before JSON projection; NaNs compare by class and every finite/infinite/zero/path boundary remains exact.

Full native strategies and schemas/artifacts, all replay/input modes and feeds, live reconciliation/rotation/signing, caller migration, fleet deployment, four-device validation, final release/rollback and final alternating end-to-end benchmarks remain substantial unfinished work. No repeated goal-blocking condition has been established. Missing external access or unavailable required source bytes cannot count as acceptance.

## SDK and admission checkpoint

The new source-frozen checkpoint passes 89 native tests, 47 client/process tests, strict all-target Clippy, Rust formatting, binary build and strict checking of nine TypeScript oracles. Native strategies, production replay/live capabilities and production callers remain unavailable. Published revision `aa6d6fb7` now passes all seven remote CI checks, including native comparisons on macOS and Ubuntu; terminal evidence is in `evidence/admission-ci-aa6d6fb7.json`. Ongoing uncommitted source changes require their own validation.

Current reviewed evidence covers Portfolio 160 scenarios/173,843 events/18 comparator mutations; typed records and metadata 531 scenarios/116,766 actions/14 mutations in each profile; callback admission 45 scenarios/258 operations/13 mutations; and actual local Parquet admission 25 scenarios/116 admitted rows/9 mutations in each profile. Existing market, intent, arithmetic, metric and statistics reports have also been refreshed on this same source set. Full boundaries and unresolved contracts are documented in `SDK-ADMISSION-REVIEW.md`; reports and integrated logs are under `evidence/admission-*`.

Independent reviews found and repaired logical JSON key conversion, comparison drivers losing previously admitted rows on errors, whole-rowgroup materialization, empty footer bounds, discarded deprecated footer bounds and lazy data-page JSON statistics. A further DECIMAL key conversion defect remains explicitly unmet, with its portable actual-reader reproduction under `evidence/parquet-decimal-pending/`. No complete replay-mode acceptance is claimed.

Next work converts Portfolio and raw account ingress to authoritative shared records, implements complete SDK/context/plugin behavior, integrates typed source BigInt/nonfinite clocks and the actual runner, and completes replay logical conversion/mode adapters. The next uncommitted phase integrates the DECIMAL helper and group/page reader access, shared typed source records, and authoritative Portfolio ingress/retention; those changes do not inherit checkpoint acceptance. Existing production services and the primary working directory remain unchanged.

## Shared record and raw reader checkpoint

The next frozen checkpoint passes 109 native tests, 47 process/client tests, formatting, all-target Clippy and the required strict checking of ten TS comparison programs. Typed Source56/299 operations, Portfolio185 with24 graph scenarios/264 actions, actual Parquet73/348 rows and DECIMAL747 have author/fresh independent evidence where documented. Metadata531, market269, intents211, arithmetic9,106, metrics3,145 and statistics99 reports were refreshed on this source set. See `RECORD-INTEGRATION-REVIEW.md` and `evidence/records-validation.json` for exact domains, report/source identities and remaining requirements. Remote CI for the new checkpoint is pending.

Authoritative managed envelopes and Position/OpenOrder/history records now share the accounting graph; original map keys survive mutations to exposed order IDs. Raw DECIMAL decoding preserves page-width/cursor behavior, column-wide dictionary compaction, raw-footer null/converted-type provenance and precision/scale boundaries. Reader provenance now binds2,551 imported/package/native-helper files and exact tools. The previous demonstrated DECIMAL conversion/schema defects are repaired in the covered flat domain; complete reader/mode acceptance remains unmet.

Actual runner installation/bindings, graph-aware OrderManager, ONE frozen PortfolioSnapshot root and authoritative WS records, full SDK/context/plugins/prototypes/capture, complete inputs/feeds, all strategies/artifacts, production callers/fleet/persistence/live, device validation and final benchmark remain required. The runner body is still a development draft outside the native source set. This is progress toward the full goal, not completion or a new speed measurement.

## Evidence policy

Current bounded reports and integrated logs are stored under `evidence/admission-*`; `evidence/core-*`, foundation and older independent reports retain their own checkpoint source identities. Reports are not whole-goal completion or performance evidence. Every full acceptance requirement stays pending/in progress until its entire scope passes on the final revision.
