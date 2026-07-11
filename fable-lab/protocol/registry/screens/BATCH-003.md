# BATCH-003 — G2-asymmetry touch screen + three derivation kills

_Frozen session 62, 2026-07-11, per SCREENING.md (D49 + amendments 1-3,
D50). Context: BATCH-002 killed all three mechanism-gap screens (E26)
and the run-465 decomposition produced the invariants discipline (E27/
D50). This batch's idea generation swept the remaining expressible
space; three of four candidates died AT DERIVATION (recorded below —
lessons are product), leaving one screen. Freeze = this commit;
strategy `strategies/screens/SCR-008-down-touch.ts` committed
alongside; cell = schema defaults. Sample rule: `--random --limit 500
--to-ms 1772323199999`, latency pinned per D8. Touch mode → LOCAL
`--sequential --fill-mode touch_or_better`, batchUid containing
`touch`, D18 rules bind (kill/escalate only)._

## Derivation kills (zero-cost; no runs)

1. **Split-funded sell-side maker (any gate)** — DEAD AT DERIVATION.
   By the mirror identity (CAL-001 am. #12), resting an UP ask at price
   a after a split is arithmetically identical to resting a DOWN bid at
   1−a (settlement completes the identity: split cost $1 = the pair's
   settlement value). Every sell-side maker idea is therefore the
   already-measured buy-side punch-through/touch family (E16/E17/E19/
   E24/E26a) in disguise. No sell-side mechanism can escape a buy-side
   kill here.
2. **Round-number / tick-granularity anchoring** — DEAD AT DESIGN
   (measured, outcome-free). If quoters anchored at round levels, ask
   mass should cluster there. Measured on the CAL-001 discovery log
   (100,119 integer-cent asks, all offsets/sides, no outcome touched):
   ask mod 5c = {0c: 19.1%, 1c: 18.9%, 2c: 20.6%, 3c: 20.6%, 4c: 20.9%}
   — round levels are slightly UNDER-represented vs the 20% uniform
   line. No anchoring carrier exists; with the scan's detectability
   floor (~3.7c at Bonferroni bars on this log) a full SIGNAL-003
   registration is not worth its session. The books are
   machine-quoted (consistent with the exact mirror invariant).
3. **Cross-episode anti-continuation strategies (SIGNAL-002 lean)** —
   NOT EXPRESSIBLE as a backtest strategy. The previous window's
   outcome is not observable from the current market's ticks; episodes
   replay in isolation (fleet: one market per job; local: state resets
   per slug, ordering not guaranteed under --random). SIGNAL-002
   measured the taker side of this axis via post-hoc SQL joins — NULL,
   sub-bar ~3c early lean — so nothing testable is lost. Any future
   attempt requires operator-side engine work (cross-episode context
   feed) and a live-parity argument; blocked, not merely unmeasured.

## Mini-spec (frozen)

### SCR-008 — ungated DOWN-side at-touch bid (IDEAS #21)
- mechanism: join the DOWN best bid at touch, NO state gate, 30-870s,
  requote on 1c drift, hold fills to settlement, inventory cap 100.
  Aim: the pooled G2 asymmetry (SIGNAL-001/E25, map-grade): UP-side
  buys lose −1.16c gross on average across all states (z=−5.2), DOWN
  flat — the UP ask carries a persistent premium. Mirror-consistent
  tradable expression of "sell the UP premium" (mirror identity:
  UP ask at a ≡ DOWN bid at 1−a).
- not-a-reskin: every killed touch cell (E19 quiet/loud, E24
  tail/reversal/opening) TIMED informed flow with a state/time gate;
  this cell times nothing and harvests an unconditional one-sided
  skew. Required escape argument vs the E19 mechanism (EDGE-SPACE §4):
  the screen tests skew (+1.16c gross, the venue's strongest measured
  regularity) against unconditional touch adverse selection — a
  contest no prior cell measured. Worst-queue expression would be
  auto-dead (§4 dedupe); hence touch mode.
- invariants (D50): premise USES the same-tick mirror identity rather
  than fighting it (no cross-book disagreement required); crossed
  books are guarded per E6 (no quotes into crossed states); boundary
  market excluded mechanically by --to-ms (E18); touch fills are the
  D18 OPTIMISTIC bound — a kill is decisive under the most favorable
  fill assumption, a win escalates to the operator, never advances;
  results.ts zero-PnL convention noted (flat markets counted in
  played, not in wins/losses).
- aim: SIGNAL-MAP §3 G2 row (map-grade annotation; licenses nothing —
  screens may be weakly aimed).
- strategy: `screens/SCR-008-down-touch.ts` (`fable-scr-008`),
  defaults.
- prediction: EV per played market > 0 (touch bound; D18: outcome set
  is {kill, escalate}, never advance/live-EV; a kill closes the
  ungated single-side touch cell decisively under the engine's most
  favorable fill assumption).
- kill: default bars (q̂/t over all N per D49 amendment 1; D49
  amendment 3 default-kill applies).

## Feasibility smoke (counts only, no PnL — E15 discipline)

_Run 2026-07-11 session 62 (run 466, oldest-15 discovery markets,
local `--sequential --fill-mode touch_or_better`, latency pinned
in-log, D18 hook line present): 14/15 markets filled, 15 maker fills +
4 taker fills (a resting GTC bid that the ask subsequently crosses
fills via the engine's taker path — favorable-price fills, engine
semantics), 0 failures. Counts read via fills.ts only, no PnL. Cell
unchanged post-smoke (schema defaults)._

## Erratum + VOID (session 63, 2026-07-11, pre-verdict)

- **Run 467 (SCR-008-touch-screen) is VOID.** The run executed with
  `BACKTEST_LATENCY_DELAY=140` (ambient `.env`, logged at startup per
  the D19 amendment) — the freeze above required "latency pinned per
  D8" (0/0). Same violation class as the voided first EXP-001 probe
  (E7). The run was additionally truncated at 73/500 markets by
  session end (persisted `completed`, 0 failures) — truncation alone
  would be judgeable per D9; the latency violation voids it
  regardless. DISCLOSURE: the session-63 resume read the tail of
  `logs/SCR-008-touch-screen.log`, which included the truncated run's
  aggregate summary (70 played, winRate 0.4571), BEFORE the latency
  line was noticed. The void is forced by the objective condition
  mismatch and was decided independent of those numbers; they are
  disclosed here and never cited.
- **Smoke erratum:** the feasibility-smoke paragraph above claims
  "latency pinned in-log" for run 466 — FALSE. Run 466 also logged
  DELAY=140. The smoke was counts-only (no PnL) and remains
  plumbing-grade, but a pinned re-smoke precedes the relaunch.
- Root cause: the D49 screening tier has no submission tool — screens
  were launched manually and the session-62 launch omitted the D8 env
  prefix (submit.ts pins it but only knows experiment stages). Fix:
  D51 mechanical guard in `tools/run-backtest.ts` (refuses non-zero
  effective latency unless batchUid contains `lat`).
- Relaunch: pinned re-smoke `SCR-008-touch-smoke-r2` (counts only),
  then canonical screen run `SCR-008-touch-screen-r2` (N=500, same
  frozen sample rule and cell — nothing about the mini-spec changes).

## Pinned re-smoke (session 63, counts only, no PnL — E15 discipline)

_Run 468 (SCR-008-touch-smoke-r2, oldest-15 discovery markets, local
`--sequential --fill-mode touch_or_better`, DELAY=0/JITTER=0 verified
in-log, D18 hook line present): 14/15 markets filled, 14 maker fills,
0 taker fills, 0 failures. The unpinned run 466's 4 taker-path fills
do NOT reproduce at pinned latency — they were 140ms artifacts
(resting bid crossed during the artificial delay), confirming the
latency setting was behavior-changing, not cosmetic. Counts read via
fills.ts only. Cell unchanged (schema defaults)._

## Verdicts (append-only after runs complete)

### SCR-008 — decision: kill (default outcome, D49 amendment 3)

_Session 63, 2026-07-11. Canonical run 472 (SCR-008-touch-screen-r2,
N=500 random discovery, 0 failures, unique for its batchUid; runs
466/467 latency-violating per the erratum above, 467 VOID)._

Pre-verdict checks (artifact lines pasted per SCREENING amendment 4):
- `[fable] latency env: BACKTEST_LATENCY_DELAY=0 BACKTEST_LATENCY_JITTER=0`
- `[fable] D18 fill-mode hook: 479 BacktestExecution instance(s) forced to touch_or_better` (log line 11715; hook count grep = 2: activation line 2013 + end summary. CORRECTED per checker finding 1 — the verdict as first committed "pasted" 500 from intention, not from the log; 479 = played markets, the 21 no_in_window_activity skips never instantiate an execution. The E28 defect class caught in the very unit that codified it.)
- boundary market 1777237200: 0 log hits (structurally excluded by
  `--to-ms 1772323199999`)

Readout (results.ts, all-N convention): N=500, played=479 (ungated —
nearly every market fills, as designed), maker/taker=479/0,
pnlTotal=+79, EV/market=+0.158, CI95=[−4.05,+4.36], q̂=+0.0033,
t=+0.0736, winRate(played)=0.5115 (245/234), positiveDayFrac=0.55
over 91 days, fees=0 (maker).

Bar application (frozen D49 defaults): no kill branch fires (q̂>0,
t>−1, prediction "EV per played > 0" HELD at +0.165/played) and the
survive bar is nowhere near met (t=+0.07 ≪ 1.5) → **kill is the
default outcome** (amendment 3), same shape as SCR-006. D18: touch is
the OPTIMISTIC bound — at the friendliest fill assumption the engine
can express, harvesting the venue's strongest measured regularity
(G2: +1.16c UP-ask premium, z=−5.2) nets ≈ +0.16c/share/market ≈
statistical zero. No escalation warranted (a bound-side zero cannot
clear live costs).

Mechanism note (screen-grade): this is the FIRST touch cell that does
not lose (every E19/E24/E26 touch cell lost 0.4-4.5/market). The
ungated DOWN-side bid at touch breaks exactly even: the persistent
UP-ask premium is real and approximately CANCELS unconditional touch
adverse selection on the DOWN side — the skew exists but is priced to
the marginal liquidity provider's break-even, leaving no rent.

## Batch checker (fresh-context, session 63) — SOUND-WITH-FINDINGS, both applied

Report verbatim in `knowledge/AUDIT-2026-07-11-BATCH-003-CHECKER.md`.
Substance: kill re-derived exactly from raw SQL (all statistics match),
freeze byte-intact (mini-spec block identical 6be18b0 → HEAD), 467 void
factually grounded, D50 invariants line coherent, derivation kills
consistent (engine episode-isolation verified in runSingleMarket.ts).
Findings applied: (1) MAJOR verdict-neutral — the pre-verdict "pasted"
hook line quoted 500 instances where the log says 479; corrected
in-place above with attribution (the E28 artifact-fidelity defect,
caught by the amendment-4 check in its first outing). (2) MINOR —
derivation kill #1's "already-measured buy-side family" overstates AT
FREEZE TIME: the ungated buy-side touch cell was measured by SCR-008
itself within this batch, not before it. The frozen text stands
unedited per append-only discipline; read "already-measured" as
"measured once this batch's own screen resolved". The reduction (sell
side ≡ mirror buy side) is unaffected, so with run 472 killed the
sell-side family is genuinely closed.
