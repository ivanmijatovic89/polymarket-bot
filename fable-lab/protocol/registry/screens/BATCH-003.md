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
