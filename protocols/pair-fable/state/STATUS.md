# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 4, complete)

## Current work

Session 4 delivered (all evidence from this session's tool runs; two
pre-registered experiments, two pre-code kills, zero fleet runs needed):

1. **E-015 — pair-v5 (taker pair-arb) KILLED at Phase 0.** New tool
   `tools/bookscan.ts` replayed the latest 800 markets' books locally
   (199.5M events). Fee-inclusive two-sided arb moments exist (1,943
   episodes, zero-latency value ≈ $1.88/market) but last sub-millisecond:
   1/1943 survives 140ms, executable $0.00/market vs the $0.10 kill bar.
   pair-v5.md.
2. **E-016 — pair-v6 (maker leg + instant taker completion) KILLED at
   Phase 0.** Completion cost C p50 = 1.016 at ZERO latency (complement
   repriced before the fill instant), 1.037 at +140ms; P(C<1) = 2.4%;
   free-abort bound $0.04/market vs $0.10 bar. Hold-all directional
   readout −0.029/share (−$1.51/market, 8/9 days negative) also closes
   the abort-policy prong. The −0.06/share invariant now has a
   decomposition (pair-v6.md). Both pre-registrations committed (2e9bfef)
   BEFORE the scan ran; scan JSON archived at
   memory/experiments/data/bookscan-2026-07-31-latest800.json.
3. Validity checks: 800/800 markets on local disk; outcome split over the
   scan window 403 UP / 397 DOWN (no trend bias in the directional
   readout); smoke-sample tease (+0.04/share hold-all on 10 markets)
   explicitly refuted at n=800.

## Next step (session 5)

Session 5 is the mission's every-fifth SELF-CHECK — audit against goal 1
(profitable variant ASAP), the M1–M5 gate list (still pending, still not
urgent: no promotion candidate), and whether the axis sequence is still
the fastest route. Then the two remaining inside-RULES untested axes,
Phase-0 scans first (extend tools/bookscan.ts, same discipline):

1. **Taker-lead pair**: buy side Y at ask (pay 700bps-curve fee), rest a
   maker bid on X; entry condition askY+fee+bidX < gate is far more common
   than double-ask < 1. Scan: frequency of entry moments, P(X's bid fills
   before window end | entry), settlement value of unfilled-leg residue,
   full pair economics. Key question: is the unfilled-residue tail better
   than the killed families' doom (you hold the side that was WINNING at
   entry)?
2. **Deep-book maker placement**: per-start invariant was measured at
   top-of-book only. Scan hold-all/completion economics for fills at
   bestBid−δ over a δ grid (bigger crashes, better prices, worse
   selection — which wins is an empirical question).
3. If BOTH die at Phase 0: the honest position becomes "buy-only pair
   mechanics on BTC-15m are exhausted at 140ms under the binding sim" —
   escalate via PROPOSALS (P-009 live measurement, and/or a human ruling
   on widening strategy space/timeframes/symbols). Only after the scans.

## Blockers

None. No in-flight fleet runs; no in-flight local jobs.

## Needs human

Nothing blocking. Carried proposals: P-002/P-003/P-005/P-006/P-007/P-009
(all `proposed`).

## Standing session guards

- Never end a session waiting on an in-flight fleet run — record ids here,
  return `continue` (A4/A6).
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine commits
  (this session: origin/main had no new commits at session start; no src/
  changes since 28f1f8b).
- Queue submissions require a CLEAN tree: commit+push BEFORE launching.
- m7 remainder pending: pnl decomposition column on next results.ts touch.
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes).
- JOURNAL entries are for the HUMAN: plain language, 3–6 short lines, at
  most one evidence pointer per conclusion (inbox 330fa938, permanent).
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front,
  analyze as results land (inbox c841c329).

## Inbox processed through

2026-07-31T00:52:26.664Z-c841c329 (this session processed 330fa938 —
journal style, applied from this session's entries onward — and c841c329 —
whole-grid submission, recorded as a standing guard; no fleet grids this
session).
