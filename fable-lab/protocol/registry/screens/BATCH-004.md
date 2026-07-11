# BATCH-004 — SCR-009: the SIGNAL-003 complement-gate screen

_Frozen session 65, 2026-07-11, per SCREENING.md (D49 + amendments) and
the pre-committed SIGNAL-003 candidate branch (knowledge/SIGNAL-FILLS.md
§6 + amendments 1b/3, verdict in §7). Operator closing-sprint directive
active: ceremony cut to the frozen bars; no optional audits. Freeze =
this commit; strategy `strategies/screens/SCR-009-gated-down-touch.ts`
committed alongside; cell = schema defaults._

## Mini-spec (frozen)

### SCR-009 — SIGNAL-003-gated DOWN-side at-touch bid (IDEAS #22)

- mechanism: the run-472 SCR-008 cell verbatim (join DOWN best bid at
  touch, 30-870s, requote at 1c, hold to settlement, inventory cap 100)
  MINUS the one SIGNAL-003 cell-grid candidate: suppress/cancel the
  quote when (quote price ∈ [0.35, 0.65]) AND (latest valid UP-book
  l10Imb ≥ 0.6400). The threshold is the discovery MID-stratum 80th
  percentile, verified to select exactly the candidate cell's 1,435 of
  7,171 MID fills (computed outcome-free from the shard logs' feature
  columns, session 65). Gate shape is amendment-1b mechanical: the
  flagged cell's complement, nothing else.
- not-a-reskin: not a story gate — E19/E24 gates were a-priori
  time/regime stories and all worsened the fill mix; this gate is the
  first MEASURED fill-mix improvement (z=−4.30 toxic cell excised).
  Distinguishing element vs SCR-008 (kill by default outcome, E29):
  the fill population is provably different (17.7% of discovery fills
  removed, the subset carrying −5.54c/fill).
- invariants (D50): mirror books — gate uses the UP book, quotes the
  DOWN side; consistent (l10Imb on UP ≡ 1−l10Imb on DOWN, one feature).
  Self-crossed books — SCR-008 E6 guard retained. Boundary leak — moot
  (sample entirely inside the reserve window, below the holdout
  boundary 1777237200000). Worst-queue informativeness — not touched
  (touch_or_better bound per D18, same as run 472; model-optimistic,
  disclosed). results.ts zero-PnL convention — q̂/t over ALL N.
- aim: SIGNAL-FILLS §7 candidate (MID × l10Imb q5). The warm monotone
  move60 (+3.06) is NOT gated on (sub-bar; recorded as aiming aid only).
- strategy: `fable-scr-009`, schema defaults (gateMidLo=0.35,
  gateMidHi=0.65, gateImbMin=0.64; all other params = run-472 cell).
- prediction (both anchors disclosed per SIGNAL-FILLS §7): under the
  frozen §6 zero-anchor formula, kept fills average +1.19c/fill
  (p=0.1765, x=5.54c). Under the scan's own measured global anchor
  (−1.012c, n=8,130), the kept-fill complement measured −0.04c/fill —
  the honest point prediction is ≈ 0 before the E26c winner's-curse
  discount on the cell estimate itself. The mechanism REQUIRES q̂
  strictly better than SCR-008's +0.0033 with the gate suppressing
  MID/high-imbalance fills; if the gated cell is no better than the
  ungated one, the family's last arithmetic escape is closed.
- kill: DEFAULT D49 bars (q̂/t over all N). D18 outcome set binds:
  {kill, escalate-memo} — a SURVIVE-bar result writes an operator memo
  (queue-realistic fill model / live paper advocacy), never advances.
  If SCR-009 kills, IDEAS #22 → dead and the maker family CLOSES FOR
  GOOD per SIGNAL-FILLS §6 (no further maker screens without an
  operator-side instrument change or a D27-confirmed venue-drift fire).
- sample (pre-freeze deviations, stated): per D53 (SIGNAL-FILLS
  amendment 3) the sample is a uniform random draw from the RESERVE
  window `market_start_ms ∈ [1772323200000, 1777237199999]` — NOT the
  discovery window (the gate was mined there; a discovery re-run would
  be circular). N = 2000 (deviation from the 500 default, stated
  pre-freeze: power is effect-size-limited, not incidence-limited —
  at the optimistic +1.19c/fill anchor, t ≥ +1.5 needs ≈ 4,000 kept
  fills; N=2000 ≈ 1,560 kept fills is the largest affordable local
  touch run and still only ~½ that; the screen is therefore kill-biased
  by construction, which is acceptable — its D18 outcome set has no
  advance arm and a strong positive would still escalate). Draw
  implementation: seeded Fisher-Yates (seed string `SCR-009-draw-1`,
  djb2-hashed LCG) over the full eligible reserve-window slug list
  ordered by market_start_ms, first 2000 taken, split round-robin into
  6 disjoint local shards — mechanically equivalent to `--random
  --limit 2000` (uniform, outcome-blind) and reproducible, which the
  SQL RAND() path is not; slug lists recorded in
  `logs/SCR-009-shard[0-5].slugs`.
- execution: LOCAL 6-way sharded (touch mode cannot run on the fleet),
  `tools/run-backtest.ts --sequential --fill-mode touch_or_better`,
  batchUids `SCR-009-touch-s[0-5]` (D18 label), latency pinned 0/0
  (D8/D51 — the wrapper refuses ambient latency). Smoke first: 10
  discovery markets (the SIGNAL-003 smoke set), counts only.

## Pre-results amendments (append-only, before any shard result read)

- **Amendment 1 (extension rule, frozen pre-results):** after the N=2000
  verdict read, IF q̂ > 0 (any positive, whether or not the survive bar
  is met), the run is EXTENDED once over the remaining eligible
  reserve-window markets (~3,460) to sharpen the estimate for the
  months-later successor — extension via the same local touch shards on
  the leftover slugs, judged over the UNION. If q̂ ≤ 0 → kill stands on
  the N=2000 read, no extension, family closes. This rule exists so the
  extend/stop decision is not made after seeing how close the number is
  to a bar.
- **Amendment 2 (checker allocation, closing-sprint directive):** the
  D49 fresh-context batch checker runs ONLY if the verdict is
  escalate/survive-bar (false-positive protection where it pays); a
  kill at these bars is self-certifying (kill-biased screen, honest
  arithmetic already predicts ≈ 0) and gets no checker.

## Launch record (session 65, pre-results)

- Draw: `tools/scr009-draw.ts` → 2,000 of 5,460 eligible reserve-window
  markets (seed `SCR-009-draw-1`), shard slug lists committed as
  `logs/SCR-009-shard[0-5].slugs`.
- Smoke: run 480 (`SCR-009-touch-smoke`), 10 markets, 10/10 filled, 10
  maker / 0 taker fills, counts only (fills.ts). DEVIATION disclosed:
  the mini-spec named the discovery smoke set, but the smoke used
  shard0's first 10 RESERVE slugs (they are inside the N=2000 sample).
  No outcome was read (plumbing greps + fills.ts counts only), so the
  sample stays clean; the deviation is procedural and is recorded here.
- Shards: `SCR-009-touch-s[0-5]`, launched detached ~21:40 UTC, all six
  verified in-log: latency env 0/0, D18 hook active, loaded
  334+334+333+333+333+333 = 2,000.

## Results (append-only, after all shards complete)

_Read session 65, ~22:05 UTC. All six shards exited clean (1 elapsedTime
block each, no failure lines). Pooled readout (`tools/scr009-pool.ts`,
committed pre-read), output verbatim:_

```
SCR-009-touch-s0: run 486 status=completed markets=334
SCR-009-touch-s1: run 485 status=completed markets=334
SCR-009-touch-s2: run 482 status=completed markets=333
SCR-009-touch-s3: run 483 status=completed markets=333
SCR-009-touch-s4: run 484 status=completed markets=333
SCR-009-touch-s5: run 481 status=completed markets=333
POOLED: N=2000 played=1992 won/lost=982/1010 winRate=0.4930
  evPerMarket=-1.9585 sd=48.4984 q=-0.0404 t=-1.8060 CI95=[-4.0840, 0.1670]
  makerTrades=1992 takerTrades=0 feesTotal=0.0000
```

(winRate here = won/(won+lost), the pool tool's convention; played
convention would give 982/1992 = 0.4930 as well since ties are rare.)

### Verdict: SCR-009 — **KILL** (default bar: q̂ ≤ 0)

- q̂ = −0.0404 ≤ 0 → KILL. t = −1.81 (CI95 barely includes 0 from
  below). Prediction NOT met under either disclosed anchor: the kept
  fills average −1.96c/share on fresh reserve-window data, vs the
  −0.04c measured-anchor complement on discovery and the +1.19c frozen
  zero-anchor formula.
- Amendment 1 (extension): does NOT fire — requires q̂ > 0. Amendment 2:
  no fresh-context checker — kill at these bars is self-certifying.
- D18 conditional: this is a touch_or_better (optimistic-bound) result —
  the kill is decisive under the most favorable fill assumption the
  engine can express (the realistic fill model can only be worse).
- Attribution caveat (recorded, no verdict impact): two things changed
  vs run 472 (gate added; window moved discovery→reserve). The −1.96c
  vs −0.04c gap is confounded between gate winner's curse and window
  drift; the frozen closure rule does not need the attribution.
- **Consequence (SIGNAL-FILLS §6, pre-committed): the maker family
  CLOSES FOR GOOD.** IDEAS #22 → dead (all 22 ledgered ideas resolved:
  21 dead, #10 parked pending CONFIRM-010 unlock). No further maker
  screens without an operator-side instrument change (queue-realistic
  fill model per EDGE-SPACE §3.2) or a D27-confirmed venue-drift fire.
