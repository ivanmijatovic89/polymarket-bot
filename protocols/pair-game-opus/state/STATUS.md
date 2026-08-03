# Status — Pair Game Opus

- Highest passed level: **5** (first 5 eligible markets, run **1326**)
- Current level: **6** (first 6 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: (no entries)

## Evidence

| Level | Run | Result |
|---:|---:|---|
| 1 | 1322 | PASS |
| 2 | 1323 | PASS |
| 3 | 1324 | PASS |
| 4 | 1325 | PASS |
| 5 | 1326 | PASS |

All five gate runs above used **pure defaults** (no `--param` other than the
level's injected `qty`). Every market ended exactly 1000/1000; pair costs on
run 1326 were 0.9385–0.9621 against the 0.98 ceiling, every market profitable.

Stability was measured before promoting, not assumed: the same configuration
passed level 5 **8 out of 8** independent runs (1314–1321). The previous
configuration passed 8 of 16 (~50%) and was rejected for that reason.

## How the player works now

1. **Ceiling guard (`avgCap`)** — no bid may push the realized `avgUp + avgDown`
   past `pairCeil`. This is the number the evaluator reads, so the run is legal
   at every instant, not only if it finishes.
2. **Momentum priority** — the leg whose ask is above its own EMA is the
   priority leg. A resting bid only fills while its side is getting cheaper, so
   an even-handed builder spends a trending window buying the outcome that
   expires worthless.
3. **Underdog allowance by projection** (replaced the old fixed `soloShare`
   split) — the non-priority leg may pay whatever the ceiling still holds once
   the priority leg is finished at today's price. A fixed split cannot do this
   job: wide, and the underdog buys at 0.4 in the opening minutes; narrow, and a
   genuinely mid-priced underdog is starved until the priority leg completes,
   which is how a window ends 0/1000.
4. **`takePace = 0.05`** — crossing now aims to complete the priority leg inside
   ~45 s rather than a quarter of the window. This was the single change that
   turned a 50%-reliable player into an 8-of-8 one; see below.
5. **Conviction override (`convEdge` 0.12, `convFull` 0.20, `convUntil` 0.06)** —
   while inside the opening 6% of the window, a wide gap between the two asks
   overrides the trend reading: the favourite becomes the priority leg, the
   reserve held back for the underdog shrinks, and the crossing throttle opens.

## What was learned this session

- **Market 5 has no patient line, and that is measured, not assumed.** After the
  first 48 s its DOWN ask never trades below 0.870 again (minimum at t+64 s).
  Winning it by buying UP cheap first would need 1,000 UP shares at an average
  under 0.10 *and* completed inside 20 s. The pair can only be started in the
  first ~45 s, which is why a mechanism that acts on the opening book had to
  exist.
- **The crossing throttle was the real blocker**, not the priority rule. Market
  3's rising leg is affordable for only ~90 s; at `takePace = 0.25` the throttle
  permitted ~270 of the 1,000 shares in that window, so the leg finished
  lopsided. Everything else — pacing, imbalance limits, priority latching,
  underdog discounts — was tuning around a constraint that was doing the damage.
- **Measured and rejected**, each on ≥2 runs: accumulation pacing on both legs
  (`fillPace`); pacing the underdog only; `maxImbalance` 200/400/600 (both legs
  stall at the cap, as the previous session predicted); `priority=dear` as a
  standing rule (loses market 3); `momDeadband` latching; `priorityLatch`;
  `leadPad` ≥ 0.10 (starves the underdog in markets 1 and 4); `underdogDiscount`
  ≥ 0.20. All ship disabled at their defaults and are documented in the file.
- **Two-run sweeps are noise at this variance.** Several apparently-decisive
  results earlier in the session did not survive a proper sample. Configurations
  are now only accepted on an 8-run sample.

## Level 6 — already scouted, not yet solved

Run 1327 fails it. The sixth market, `btc-updown-15m-1775092500`, is market 5's
shape again: its DOWN ask is cheapest at t+0 (0.490) and rises for the rest of
the window, while UP collapses to 0.002. Its pair floor is 0.492, so it is very
winnable — but only by buying DOWN inside roughly the first 30–40 s. The
patient line is arithmetically dead, same as market 5: DOWN sits at 0.93–0.94
around t+210–330 while UP is 0.07–0.08 there, and UP is only below 0.03 after
t+450 when DOWN is already ≥0.97.

The conviction override does not rescue it because the opening gap is only 0.04
(0.53/0.49), well under `convEdge`. By t+30 the gap is 0.25 and conviction
would fire — but by then the player has already spent the ceiling, because the
underdog's allowance at the open is itself ~0.48, so UP fills at 0.48 and drags
1,000 shares of the worthless outcome in at an average of 0.44.

**The mechanism to beat is the underdog spending near 0.50 before the window has
revealed anything.** One attempt is already implemented and measured:
`underdogRamp` (ramp the underdog's price allowance up from zero over the first
part of the window; ships disabled at 0). It does help market 6 — DOWN starts
getting bought — but at 0.05/0.10/0.20 it fails market 3, whose *rising* leg
must be bought inside its first 60 s and is sometimes the underdog. So a blanket
early ban on the second leg is too blunt; what is needed is something that
suppresses second-leg buying only while the two prices are still close together
(the genuine "both legs near 0.5" trap), and lets it through once they have
separated. That is the next thing to try.

Do not lower `convEdge` to catch market 6: a 0.04 opening gap fires in almost
every window, and conviction is what makes markets 4 and 5 work.

## Next action

Work level 6 along the line above. Keep re-running levels 1–5 as regression
gates after every change, and sample any candidate at least 8 times before
promoting it to defaults — two-run comparisons are noise at this variance.

## Needs human

Nothing.
