# OPEN-QUESTIONS (living)

Ranked by information value per unit effort. Refreshed session 3
(2026-07-17T01:5xZ). Resolved items moved to the bottom.

1. **January transition curve** (IN FLIGHT — data pulled, analysis next):
   Jan 10–13 gabagool22 sample → how fast did pair costs compress from
   0.98 (Dec) toward ≥1.00 (Feb) after the 2026-01-06 fee introduction?
   Dates the competitive-response speed; the decay prior for the lab.
   Byproduct: implied per-fill fee ratio may pin the contested Jan fee
   rate empirically (question 3).
2. **Edge-source hunt on btc-15m**: what do the edge wallets (b55f,
   0xce25, bonereaper's 15m sleeve) do differently from the farmers on
   the SAME book? Level selection vs mid, timing within the 15m window,
   completion behavior. Needs fills×books join (measure-fill-gap.ts
   pattern) on btc-15m slugs from the Jul pulls. Directly feeds H1/H2
   parameter priors.
3. **Jan-era true fee rate** (contested 2× discrepancy): press said
   $1.56/100sh peak; Feb snapshot formula says $0.78. No archive
   snapshots before 2026-03-05. Empirical route via question 1's data
   preferred over more archaeology.
4. **Bulk taker-rebate payouts** (NEW, A12): bonereaper received one
   off-schedule $62,612 TAKER_REBATE (2026-07-08T23:34Z; 20–45× its
   daily rate, daily cadence otherwise 00:10Z/00:45Z). Monthly true-up?
   Tier backpay? Check other wallets' payout streams for similar lumps;
   affects every income decomposition and the program-risk picture.
5. **Level offsets vs top-of-book at fill time** (D2 byproduct data
   exists): were the archetype's bids AT touch or improving? Sets H1's
   ladder parameters.
6. **Maker/taker role split for the incumbent**: on-chain OrderFilled
   (maker/taker fields) for a day of b55f trades; halves of his flow
   behave differently (maker accumulation vs taker completion at 50%
   fee refund).
7. **Rebate estimator feasibility** (G4): can `20% × Σ fee-curve(own
   maker fills) × pool-share` be computed with a defensible pool-share
   assumption (e.g., from market total volume × taker share)? Needed to
   judge H1 in sim at all.
8. **Resolution mechanics** (Game J): source/precision/timing — one
   evening on official rules; matters for endgame quoting bounds.
9. **Tick-size rule confirmation** (0.001 outside [0.04, 0.96]?) + min
   order size + rate limits from CLOB docs.
10. **P19's "$8M/day" wallet**: still unmatched (largest 30d volume
    seen: bonereaper $663k/day). Either the figure is wrong or the
    wallet is unlisted — check volume leaderboard top-50 for
    crypto-updown-only wallets.
11. **drfc4eybh7i8 address** (weak resolution): re-resolve via profile
    JSON; then dossier if gabagool-style.
12. **D3/D4/D5 measurements**: endgame reversal table, open dynamics,
    spread lifecycle (check fable E24/E25 coverage first).

## Resolved this shift

- ~~D2 passive-fill reality gap~~ → A9: worst_queue admits 44–49%,
  touch 64–68%; 29–45% of archetype fills were taker completions
  (measurements/d2-fill-reality-gap.md).
- ~~H3 decomposition for more actives~~ → all seven decomposed,
  stratified meta (measurements/actives-decomposition.md).
- ~~bonereaper dossier / 0.21%-margin mystery~~ → hybrid: btc-5m rebate
  manufacturing + 15m edge sleeve + sports punts; steady-state negative,
  bulk-payout-rescued (wallets/bonereaper.md, A12).
- ~~powerwinner dossier~~ → pure taker-rebate farmer
  (wallets/powerwinner.md, A10).
