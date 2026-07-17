# OPEN-QUESTIONS (living)

Ranked by information value per unit effort. Refreshed session 7
(2026-07-17 ~05:10Z real clock) after A26–A33. Resolved items at the
bottom.

1. ~~0x04b6d7e9 deep-dive~~ **DONE session 8 (A34)** —
   measurements/deep-dive-04b6d7e9-btc15m.md: shallow touch-hugging
   ladder (p10 −2c) + timing, btc-15m pairRate 0.94 p50 (0.78 was
   cross-book), excess leg = favorite-side choice (won 60%), all
   taker flow on 15m, sleeve ≈ breakeven+rebates in the hard regime.
   Residue: repeat the join on an OVERNIGHT stretch (O7 regime
   split); margin decay month-by-month still open.
2. **Maker-only fill density at deep offsets on btc-15m** (paper-EV
   residual): can $143/market maker notional be reached at clip $3–5
   without touch-chasing? Answerable from Telonex book replays +
   A17-style fill data BEFORE the lab sweeps (bounds the rebate step).
3. **W4 scale-up of Phase-1 measurements** (thousands of markets,
   month-by-month drift: ladder fill rates, pair-completion timing,
   endgame flip table). Confirms/breaks the numbers the seeds rest on.
4. **First OrderFilled on the 2026 exchange** (probe running in
   background, deployment = 2026-03-31T02:39Z pinned) + which wallets
   migrated first — venue-mechanics residue, partially done.
5. **b27bc932 ladder-per-volatility-regime + requote cadence** (W2
   residue; June Telonex + June pull both on disk).
6. **Why did the Apr-28 / Jul-1 merge toggles happen?** (A27) — watch
   whether other wallets toggled at the same dates (would imply a
   shared operator or a venue-side cause; scan data can answer for
   the sampled days).
7. Atlas residue dossiers: 0xa45fe11d (Mar #1 edge — alive?),
   0x961afce6 / 0x93c22116 (Jan cheap-side winners), golden-era
   originals (0x589222a5, 0x52483137). Each is one cheap unit.
8. drfc4eybh7i8 address re-resolution (weak signal, low value).
9. 5m-book launch date (bracketed Jan-15→Feb-15 by the scans; pin it
   if any unit needs it).
10. Sub-$1 sum-of-asks scan (P38 re-scope; D1) — still unmeasured on
    the current era; the lab sweep partially answers it implicitly.

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
