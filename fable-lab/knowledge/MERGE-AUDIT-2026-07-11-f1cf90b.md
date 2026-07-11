# Merge audit — operator merge of main (f1cf90b, 2026-07-11)

**Why this exists.** The operator's 2026-07-11 update noted "main was merged
into this branch (wall-clock stats fix + dashboard improvements)". Every lab
conclusion (E9–E23) and every citation in `engine/CAPABILITIES.md` was
measured/written against pre-merge engine code; nobody had checked whether
the merge changed semantics the lab depends on. This unit (U59, session 50)
audited the merge diff `git diff f1cf90b^1 f1cf90b -- src/` end to end.

## Verdict

**No cited replay, fill, fee, tick, or statistics semantics that any lab
verdict depends on changed.** E9–E23 and the CAPABILITIES.md citations
stand. Two changes are lab-relevant in a POSITIVE direction (one closes a
known accepted risk), one is a semantic change to a column nothing in the
lab reads.

## What the merge touched (src/ only; full stat: 22 files)

| Area | Files | Lab relevance |
|---|---|---|
| Batch stats | `src/backtest/stats/batchStats.ts`, new `stats/wallClock.ts` | see §1, §2 |
| Worker plumbing | new `src/backtest/commitGate.ts` helper, `queue.ts`, `cli/backtestWorker.ts`, `cli/backtestWorkerChild.ts` (+ a test) | see §3 |
| LLM usage tooling | new `src/llm-usage/*` | none (reporting tool, no engine surface) |
| Old-system research | `src/strategies/research/endgame-panic-bid/*`, its INDEX.json | none (charter-off-limits tree; auto-discovered strategy ids `research-*` do not collide with `fable-*`) |

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
(batchStats.ts:299-300 → `backtests.ts:143-144` `toDecimal`); with the guard,
nothing out-of-range can reach the driver on ANY path — including the fleet
worker path (`backtestWorkerChild` → `marketProcessor` → aggregate persist),
which since U58 bypasses the lab's D12 wrapper clamp entirely (evidence runs
go through the bare engine CLI). Before this merge, fleet evidence runs
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
drops 10 min → 3 min (queue.ts): a job orphaned by a HARD-killed worker is
now reclaimed by the stalled-checker in ≤ 3 min instead of ≤ 10.

Lab relevance: purely positive for fleet submissions — every lab push makes
all workers self-update on their next job, so the lab was maximally exposed
to the orphan class. Worst-case stall math for sizing/polling: a stalled
market job costs ≤ 3 min + 30s detection, not ≤ 10 min.

## Method

Diff read directly (`git diff f1cf90b^1 f1cf90b -- src/`); quality-column
producer traced by grep over `src/` (only schema.ts + batchStats + the
backtests.ts persist/parse sites reference the fields); lab consumers swept
by grep over `fable-lab/` for quality/wall-clock reads. Findings restated
into DECISIONS D12 (amendment) and LESSONS E13 (note) — D31 fresh-context
check required before the unit closes.
