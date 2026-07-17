# OPEN-QUESTIONS (living)

Ranked by information value per unit effort. Refreshed session 11
(2026-07-17 ~18:10Z) after A58–A64. Resolved items at the bottom.

## Current ranking (session 11)

1. **July weekend lean-collapse: drift or noise?** (A59) Weekend
   excessWon fell 55–78% (June) → 27–37% (July, 4 days). If real,
   the residual-lean is decaying beyond weekdays too. Decidable
   with the NEXT weekend's data (Jul-18/19): pull b27bc932 +
   session-split-vol --dow weekend.
2. **A64 durability across days/months.** The −3..−5c band rule
   rests on Jun-10/12/13 cells (books end Jun-14, G9). Same-method
   joins on Jun-10–14's remaining days (Jun-11 books pullable) and
   on OTHER wallets' evening cells would harden the sharpest rule
   the shift has produced. Also: does the band structure exist in
   March-era books (different fee curve)?
3. **O5/OQ #5 residue — b27bc932 morning allocation** (15m-first
   vs 5m-first): ONE next-day morning snapshot (~08–10Z) settles
   it; W3 answers passively tomorrow.
4. **A62 cohort tracking**: e114e5ca week-2 (does the ramp
   continue past tuition?), 13e0d447/76d4d470 rotation watch
   (profile-less wallets can rotate invisibly, A55) — fold into
   W3 cadence.
5. **btc-5m book recording** (ops-side, G11): every strong living
   wallet is 5m-centric and unstudyable at book level; the $59k/day
   subsidy pool (A60) is on that book. Not this shift's job — but
   the single highest-value data acquisition for the program.

## Prior ranking (session 8) — all resolved or absorbed

1. ~~What predicts the favorable-drift fills?~~ **DONE session 8
   (A44)** — measurements/drift-features-btc15m.md: momentum context
   is the only discriminating feature; momentum continues at 30–60s
   (falling-ask fills are the adverse subset); winner fills in calm
   states, breakeven wallet fills mid-chase at local tops. Lab gate:
   quote when |preDrift30| ≈ 0, veto after falls, don't chase
   rallies with instant upward requotes. Residue: validate the gate
   threshold on more days/months (fold into W4 #3).
2. ~~Session-split scale-up with a realized-vol covariate~~ **DONE
   session 9 (A49, A50)** —
   measurements/session-split-vol-b27bc932.md: 478 markets across
   Mar/Jun/Jul. US-worst/evening-best holds 3/3 at month scale;
   evening 20–23Z is the only robustly positive session in the
   current era (+1.65%); realized-vol tercile is a session proxy
   (gate on session, at most a US-storm veto); the grinder's gross
   margin decayed +1.9% (Mar) → ≈0% (Jun→). Bonus A50: btc-5m-first
   is lifelong, the 15m sleeve toggled OFF mid-Apr→May (Apr-15 and
   May-13 = 100% btc-5m; "May downtime" reads in A45/A46 corrected).
   ~~Residue: exact 15m-sleeve OFF/ON boundary dates~~ **DONE
   session 10 (A53, measurements/sleeve-toggle-b27bc932.md)** — the
   story is richer than a reflex: rollout pause Mar-30/31, then a
   ~1-week evaluation under the 0.072 curve (Apr-02→08), one-day
   shutdown Apr-08→09; the May trim did NOT revive it (May-13 off);
   revived ~May-27 with the redeploy one day before the taker-tier
   launch. Module viability is fee-regime-gated; new-entrant
   (tier-0) economics are the bar for lab candidates.
3. **W4 remainder**: pair-completion timing + endgame flip table at
   scale (density done, A38; session PnL split is #2 above).
4. ~~First OrderFilled on the 2026 exchange + earliest migrants~~
   **DONE session 10 (A51)** —
   measurements/first-fill-2026-exchange.md: first fill Apr-3
   12:52:59Z was a 2-wallet $38 smoke test on novelty books; no
   migrants ever "moved first" — the venue ran a test trickle for
   3.5 weeks then hard-cut ALL books v1→v2 on 2026-04-28
   ~11:01–11:03Z (no dual-running; v2 reloaded over hours). v2 is
   venue-wide, not crypto-only (corrects session-3/7 assumption).
   Cross-link: b27bc932 merge-OFF Apr-28T14:27Z = 3.4h post-cutover.
   ~~NEW residue: did the fee-curve reshape ship at the Apr-28
   cutover?~~ **RESOLVED same session (A52,
   measurements/fee-curve-history.md)** — NO: cutover fee-neutral
   (k=0.0720 both sides). Reshape rolled out Mar-29/30 (gradual,
   mixed per-order terms), complete Mar-31 12Z — one release train
   with the v2 deployment. Launch k was 0.072 (published), quietly
   trimmed to 0.070 May 6–10. Era-matched fee constants now in
   VENUE-MECHANICS. Follow-on: A50's 15m-sleeve-OFF gains the
   reshape as causal candidate; A49 margin decay gains a fee-step
   confound.
5. ~~b27bc932 btc-5m expansion~~ **DOSSIER AMENDED session 9** —
   durable across 3 consecutive windows (O7–O9); era table added to
   wallets/b27bc932.md (June profile era-bound ≤ mid-July; btc-5m
   sleeve at farmer economics, merges track volume). RECAST by A50:
   btc-5m-first is the wallet's lifelong day-scale norm — the open
   part is only the intra-day live allocation (morning 15m-first vs
   US-session 5m-first). One next-day MORNING snapshot still settles
   it (W3 answers passively).
6. ~~drfc4eybh7i8 re-resolution; 5m-launch-date pin; twin-link
   checks~~ **ALL DONE session 10 (A54,
   measurements/residue-closeouts-session10.md)** — drfc =
   0x096924c4… CONFIRMED but zero lifetime activity (dud handle);
   btc-5m launched 2025-12-18T05:00Z midnight-ET (fee-free until
   Mar-06 → 5m farmer meta impossible before then); 961afce6↔
   93c22116 NOT profile-linked (20d apart);
   **gabagool22→guh123 succession CONFIRMED** (guh123 profile
   created 6m51s after gabagool22's last trade) — quit-at-peak is
   partly identity rotation; dossiers are operator SLEEVES.
7. ~~Weekday-vs-weekend stratification of the session rule~~ **DONE
   same session (A59,
   measurements/session-split-vol-b27bc932.md §A59)** — 574
   current-era markets (fresh Jul-11/12 weekend pull): the A49
   session map is WEEKDAY-only. Weekday evening +1.74% (positive in
   all vol terciles) / weekday US −1.58% replicate; weekends
   restructure and the favorite-lean collapses. **REVISED at n=10
   weekend days same session**: weekends are mildly positive in all
   sessions (+0.54% overall, 8/10 days) and structureless; only the
   lean's weekend death stands (excessWon ~50%, July 27–37%). v1
   envelope = weekday 20–24Z; weekends lean-disabled or idle.
   Weekday map extended to n=6 same session: structure holds
   (US −0.79% only negative, evening +1.27% all-tercile positive);
   "US-storm veto" refines to US×mid/storm. Residue: watch whether
   the July weekend lean collapse (37/36/27/32% by day) is drift
   or noise (next weekend's data decides).

## Prior ranking (session 7) with resolutions

1. ~~0x04b6d7e9 deep-dive~~ **DONE session 8 (A34)** —
   measurements/deep-dive-04b6d7e9-btc15m.md: shallow touch-hugging
   ladder (p10 −2c) + timing, btc-15m pairRate 0.94 p50 (0.78 was
   cross-book), excess leg = favorite-side choice (won 60%), all
   taker flow on 15m, sleeve ≈ breakeven+rebates in the hard regime.
   Residue: repeat the join on an OVERNIGHT stretch (O7 regime
   split); margin decay month-by-month still open.
2. ~~Maker-only fill density~~ **DONE session 8 (A37)** —
   measurements/fill-density-btc15m.md: YES, rebate step reachable
   maker-only (touch/−1c at $4 clips: 93–100% of markets ≥$143 under
   worst_queue); (offset × requote) is a joint axis with two local
   optima matching the two living recipes. Residue: re-run the
   density table on off-session/overnight months (part of W4).
3. **W4 scale-up of Phase-1 measurements** (thousands of markets,
   month-by-month drift: ladder fill rates, pair-completion timing,
   endgame flip table). Confirms/breaks the numbers the seeds rest on.
4. **First OrderFilled on the 2026 exchange** (probe running in
   background, deployment = 2026-03-31T02:39Z pinned) + which wallets
   migrated first — venue-mechanics residue, partially done.
5. **b27bc932 ladder-per-volatility-regime + requote cadence** (W2
   residue; June Telonex + June pull both on disk).
6. **Why did the Apr-28 / Jul-1 merge toggles happen?** (A27) —
   DOWNGRADED session 8: no class-wide sync exists (7 of 9 actives
   never merge in any pull); bonereaper is the only other merge
   user — zero merges found in the 9h before Jul-1 (probe), sparse
   merges + a 139-burst Jul 7–15. Weak coincidence with b27bc932's
   Jul-1 toggle-ON; venue-side cause not excluded but not testable
   cross-wallet. Revisit only if a third wallet starts merging.
7. Atlas residue dossiers: ~~0xa45fe11d~~ **DONE session 8 (A41,
   guh123 — 33-day sprint at $6.5k/day, quit-at-peak n=4, retired
   Mar-24)**; remaining: 0x961afce6 / 0x93c22116 (Jan cheap-side
   winners — now more interesting given A40's January
   standing-discount pool), golden-era originals (0x589222a5,
   0x52483137). Each is one cheap unit.
8. drfc4eybh7i8 address re-resolution (weak signal, low value).
9. 5m-book launch date (bracketed Jan-15→Feb-15 by the scans; pin it
   if any unit needs it).
10. ~~Sub-$1 sum-of-asks scan (D1)~~ **DONE session 8 (A40)** —
    measurements/dip-scan-btc15m.md: 100% of markets dip but only as
    sub-second flickers (~$2.5/mkt top-of-book today — taker-taker
    arb is dust); January had STANDING discounts (124s p90, minSum
    0.72) since repriced away. Residue: none (regime detector idea
    noted for ops).

## Resolved session 7

- ~~W1 failed-challenger post-mortem~~ → A26: World Cup blow-up, not
  a class casualty; class has NO large-loss example.
- ~~live-shadow O2 (b27bc932 merges)~~ → A27: toggled module, eras
  pinned to the second.
- ~~W5 rebate economics~~ → A28: rebate = 1.4%·(1−p) per $ maker
  notional; $1/day/market step; cheap-side pays ~2× balanced.
- ~~two-way-mm vanished May/Jun~~ → A29: decoder bug (2026 exchange
  changed OrderFilled layout); fixed, re-scanned; real story is
  gradual decline 319→94.
- ~~"who runs the class today at what economics"~~ → VARIANT-ATLAS.md
  (W0 core) + A30 (0x04b6d7e9) + A31 (livebreathevolatility predates
  gabagool22) + A33 (vidarx, adaptation paid $660k).
- ~~cold-start viability under taker tiers~~ → A32: moat only taxes
  taker completion; maker-pure newcomers win today (2 live proofs).
- ~~W6 paper-EV~~ → measurements/paper-ev-seeds.md; deep-pair cell =
  primary lab target.
- ~~W7 terrain (books)~~ → measurements/terrain-books.md: btc-15m
  flow down 9× from Jan peak; btc-5m 8× bigger but margin-negative;
  class share of flow rising everywhere.
- ~~2026 exchange deployment date~~ → 2026-03-31T02:39:03Z (block
  84902353), on-chain getCode binary search.

## Resolved earlier (sessions 1–6, unchanged)

- ~~Rebate estimator (G4)~~ → A22. ~~Tick/limits/precision~~ → A19.
- ~~P19 "$8M/day"~~ → CLOSED (A23; nobody matches).
- ~~D2 fill reality gap~~ → A9 (44–49% admitted). ~~D3/D4/D5~~ → A20.
- ~~Edge-source hunt~~ → A17. ~~Resolution mechanics~~ → A18.
- ~~Fee-inclusive audit~~ → A16. ~~Jan transition~~ → A15. ~~Jan fee
  rate~~ → A14. ~~Actives decomposition~~ → A11/A12. ~~bonereaper /
  powerwinner dossiers~~ → A12/A10.
