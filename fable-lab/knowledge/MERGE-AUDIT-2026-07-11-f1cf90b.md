# Merge audit — operator merge of main (f1cf90b, 2026-07-11)

**Why this exists.** The operator's 2026-07-11 update noted "main was merged
into this branch (wall-clock stats fix + dashboard improvements)". Every lab
conclusion (E9–E23) and every citation in `engine/CAPABILITIES.md` was
measured/written against pre-merge engine code; nobody had checked whether
the merge changed semantics the lab depends on. This unit (U59, session 50)
audited the merge diff `git diff f1cf90b^1 f1cf90b -- src/` end to end.

## Verdict

**No cited replay, fill, fee, tick, or statistics semantics that any lab
verdict depends on changed.** E9–E23 stand. Two changes are lab-relevant in
a POSITIVE direction (one closes a known accepted risk), one is a semantic
change to a column nothing in the lab reads. One mechanical side effect:
the merge shifted `batchStats.ts` line numbers (337 → 343 lines), so three
lab citations into that file went stale (ranges only, semantics unchanged)
— corrected in this unit: CAPABILITIES.md §"computeBatchStats" (172-337 →
180-343), engine/notes/data-results-pipeline.md (same + computeQuality
160-167 → 162-175), EPISTEMOLOGY.md (160-167 → 162-175).

## What the merge touched (src/ only; full stat: 22 files)

| Area | Files | Lab relevance |
|---|---|---|
| Batch stats | `src/backtest/stats/batchStats.ts`, new `stats/wallClock.ts`, `stats/package.json` | see §1, §2 |
| Worker plumbing | `src/backtest/commitGate.ts` (pre-existing; gains the new `haltWorkerForSelfUpdate` helper), `queue.ts`, `cli/backtestWorker.ts`, `cli/backtestWorkerChild.ts` (+ a test) | see §3 |
| LLM usage tooling | new `src/llm-usage/*` | none (reporting tool, no engine surface) |
| Old-system research | `src/strategies/research/endgame-panic-bid/*`, its INDEX.json | none (charter-off-limits tree; its auto-discovered strategy ids — `endgame-panic-bid.000-baseline` etc. — do not collide with the lab's `fable-*` ids) |

**Explicitly untouched:** `src/trading/` (fill simulation, fees, OrderManager,
Portfolio), `src/market/` (tick semantics), `src/parquet/` (replay),
`src/strategy/` (registry — the later `a10b59d` registry change is the
operator-applied lab patch, already reconciled in U58), `src/db/telonexMarkets.ts`
(eligibility). Verified via the diff stat: no files under those paths appear.

## §1 computeQuality guard — closes the E13 crash class engine-side (incl. the fleet path)

`batchStats.ts` `computeQuality` now returns **null** when the avg/std ratio
is non-finite or |q| > 99,999,999 (batchStats.ts:168-174) — degenerate
near-identical pnls previously produced ~1e8+ ratios that overflowed the
DECIMAL(14,6) `quality_system`/`quality_trade` columns and rolled back the
entire one-transaction persist (LESSONS E13, runs 315/318/320).

Traced: `computeQuality` is the SOLE producer of those fields
(batchStats.ts:299-300); with the guard, nothing out-of-range can reach the
driver on any path — including the fleet aggregate persist (runs in the
parent `backtestWorker.ts`'s in-process aggregate Worker via
`aggregateProcessor.ts:161` → the same guarded `computeBatchStats`; the
child's `marketProcessor` handles per-market rows only), which since U58
bypasses the lab's D12 wrapper clamp entirely (evidence runs go through the
bare engine CLI). Driver-boundary write sites (all downstream of the one
guarded producer, per the D31 verifier's independent trace):
`backtests.ts:143-144` (`toDecimal`, null-checked),
`src/cli/rebuild-backtest-segments.ts:143-144` (a second independent write
site, recomputes via `computeBacktestSegments → computeBatchStats`,
null-checked), `backtests.ts:273-274` (literal nulls), the research insert
script via `insertBacktestRun`; `verify-backtest-diff.ts` reads only. Before this merge, fleet evidence runs
carried the E13 exposure as an unmitigated risk (the D12 clamp lives only in
`tools/run-backtest.ts`); it is now closed at the source. The lab clamp
remains as harmless defense-in-depth on local wrapper runs (it can no longer
fire for this class: the value is nulled before the driver boundary).

Behavioral note for readers of old rows: pre-merge degenerate segments
persisted via the lab clamp as |q| = 1e6 (runs ≥ 316, local wrapper only);
post-merge they persist as NULL. No protocol statistic distinguishes these
(D12 argued 1e6 vs 1e9 carry identical decision information; null is the
same "degenerate" signal — results.ts computes its own q from pnls and never
reads the column).

## §2 durationWallClockMs semantic change — no lab dependency

The `all`-segment `durationWallClockMs` changed from
`max(finishedAtMs) − min(startedAtMs)` (span, counting idle gaps) to the
**union of per-market busy intervals** (new `stats/wallClock.ts` `unionBusyMs`;
always ≤ durationTotalMs; an `--extend` hours later no longer inflates it).
Swept the lab for consumers: no lab tool or verdict reads this column —
`tools/results.ts` computes its statistics from pnls/segments,
`tools/capacity.ts` estimates wall time from the charter's ~1.75s/market
anchor, and no engine note documents the old semantics. Nothing to update.

## §3 Worker self-update orphan fix + lockDuration 10 min → 3 min

New `haltWorkerForSelfUpdate` pauses a worker's fetch loop synchronously the
moment stale code is detected, so a self-updating worker no longer grabs one
more job and orphans it mid-flight (previously: job stuck "active" holding a
lock, parent batch hanging in WAITING-CHILDREN). `WORKER_OPTS.lockDuration`
drops 10 min → 3 min (queue.ts): a job orphaned by a HARD-killed worker now
has its lock expire within ≤ 3 min of the last renewal (was ≤ 10), plus up
to one 30 s `stalledInterval` until the checker reclaims it.

Lab relevance: purely positive for fleet submissions — every lab push makes
all workers self-update on their next job, so the lab was maximally exposed
to the orphan class. Worst-case stall math for sizing/polling: a stalled
market job costs ≤ 3 min + 30s detection, not ≤ 10 min.

## Method

Diff read directly (`git diff f1cf90b^1 f1cf90b -- src/`); quality-column
producer traced by grep over `src/` — writers beyond the backtests.ts
persist/parse sites exist (`rebuild-backtest-segments.ts`, the research
insert script; enumerated in §1) but all sit downstream of the one guarded
`computeQuality`; lab consumers swept by grep over `fable-lab/` for
quality/wall-clock reads. Findings restated into DECISIONS D12 (amendment)
and LESSONS E13 (note). D31 fresh-context check: **sound-with-findings**,
6 MINOR, all applied in this file and the derived artifacts (additional
write sites enumerated; three stale batchStats.ts line citations in lab
docs corrected; the invented `research-*` id prefix fixed; commitGate.ts
"new" wording fixed + package.json row added; fleet-path process
description corrected to the parent aggregate Worker; §3 stall arithmetic
made consistent). The verifier independently reproduced the diff stat, the
guard text at exact cited lines, the union ≤ total argument, the
consumer-sweep result, and the D12/E13 fidelity check (no bar, threshold,
or figure tightened).
