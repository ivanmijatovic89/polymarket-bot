# OPEN-QUESTIONS (living)

Ranked by information value per unit effort. Refreshed session 3
(2026-07-17T01:5xZ). Resolved items moved to the bottom.

1. **Fee-inclusive re-audit of the July actives (NEW #1, from A13)**:
   all decomposition nets are gross of taker fees while rebates were
   counted as income. For b55f/0xce25/bonereaper/farmers: measure true
   taker-fee drag — either on-chain (sample OrderFilled receipts, net
   fee = charged − refund, as done for gabagool Jan) or bounded via
   rebate ÷ tier%. Decides whether the "+1–3.2% edge" survives. THE
   load-bearing question for STRATEGY-BRIEF's premise that real alpha
   exists today.
2. **Edge-source hunt on btc-15m**: what do the edge wallets (b55f,
   0xce25, bonereaper's 15m sleeve) do differently from the farmers on
   the SAME book? Level selection vs mid, timing within the 15m window,
   completion behavior. Needs fills×books join (measure-fill-gap.ts
   pattern) on btc-15m slugs from the Jul pulls. Directly feeds H1/H2
   parameter priors. (Merge with question 1 where possible — same
   receipt decoding gives maker/taker roles AND fees.)
3. **Bulk taker-rebate payouts** (NEW, A12): bonereaper received one
   off-schedule $62,612 TAKER_REBATE (2026-07-08T23:34Z; 20–45× its
   daily rate, daily cadence otherwise 00:10Z/00:45Z). Monthly true-up?
   Tier backpay? Check other wallets' payout streams for similar lumps;
   affects every income decomposition and the program-risk picture.
4. **Level offsets vs top-of-book at fill time** (D2 byproduct data
   exists): were the archetype's bids AT touch or improving? Sets H1's
   ladder parameters.
5. **Maker/taker role split for the incumbent**: on-chain OrderFilled
   (maker/taker fields) for a day of b55f trades; halves of his flow
   behave differently (maker accumulation vs taker completion at 50%
   fee refund).
6. **Rebate estimator feasibility** (G4): can `20% × Σ fee-curve(own
   maker fills) × pool-share` be computed with a defensible pool-share
   assumption (e.g., from market total volume × taker share)? Needed to
   judge H1 in sim at all.
7. **Resolution mechanics** (Game J): source/precision/timing — one
   evening on official rules; matters for endgame quoting bounds.
8. **Tick-size rule confirmation** (0.001 outside [0.04, 0.96]?) + min
   order size + rate limits from CLOB docs.
9. **P19's "$8M/day" wallet**: still unmatched (largest 30d volume
    seen: bonereaper $663k/day). Either the figure is wrong or the
    wallet is unlisted — check volume leaderboard top-50 for
    crypto-updown-only wallets.
10. **drfc4eybh7i8 address** (weak resolution): re-resolve via profile
    JSON; then dossier if gabagool-style.
11. **D3/D4/D5 measurements**: endgame reversal table, open dynamics,
    spread lifecycle (check fable E24/E25 coverage first).

## Resolved this shift

- ~~January transition curve~~ → A15: not monotone decay — fee shock,
  then ~6-day adaptation back to 94% win via 130bp deeper discounts;
  the fee-free 1h control book held steady
  (measurements/jan-transition-gabagool22.md).
- ~~Jan-era true fee rate~~ → A14: resolved ON-CHAIN — Jan taker fee =
  Feb formula exactly ($0.78/100sh peak); press 2× figure wrong;
  mid-Feb fee-cut exit trigger ELIMINATED.
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
