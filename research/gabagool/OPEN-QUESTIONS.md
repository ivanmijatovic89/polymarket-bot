# OPEN-QUESTIONS (living)

Ranked by information value per unit effort. Refreshed session 3
(2026-07-17T01:5xZ). Resolved items moved to the bottom.

1. ~~Rebate estimator feasibility (G4)~~ → RESOLVED (A22): the share
   cancels; rebate = 0.20 × fee-equivalent of own maker fills, exact,
   with a $1/day/market payout threshold. btc-15m pool ≈ $7.3k/day.
3. ~~Tick-size sub-cent rule + rate limits + stream precision~~ →
   RESOLVED (A19): 0.001 exactly outside [0.04, 0.96]; rate limits
   generous (POST /order 5,000/10s) and non-binding; Chainlink streams
   ~200ms/18-decimal → ties measure-zero. Residue (low value):
   primary-source the 1-pUSD marketable minimum; venue-side boundary
   report sampling.
4. **P19's "$8M/day" wallet**: still unmatched (largest 30d volume
    seen: bonereaper $663k/day). Either the figure is wrong or the
    wallet is unlisted — check volume leaderboard top-50 for
    crypto-updown-only wallets.
5. **drfc4eybh7i8 address** (weak resolution): re-resolve via profile
    JSON; then dossier if gabagool-style.

## Resolved this shift

- ~~D3/D4/D5 measurements~~ -> A20 (measurements/window-lifecycle-
  btc15m.md): flip table by band x seconds-left; 1c-tight books all
  window; oscillation front-loaded vs winner fills back-loaded; D4
  resolved by priors (E24 + A17): do not build own-the-open.
- ~~Level offsets at fill time~~ -> covered by D2 (archetype: ~20%
  touch, ~35% ladder 1-4c deep, 9% inside) + A17 (current wallets:
  ladder p10 -12c). Ladder priors are set.
- ~~Edge-source hunt on btc-15m~~ -> A17: deep ladders (p10 -12c),
  cheap-side touch rests, mid-band taker completion ~43% of notional,
  back-loaded minutes 10-13, no open concentration; better wallet =
  waits longer + crosses further from fee peak
  (measurements/edge-source-btc15m.md).
- ~~Resolution mechanics (Game J core)~~ -> A18: Chainlink BTC/USD
  data stream, ties resolve UP, negRisk false, tick 0.01, min 5 shares.

- ~~Maker/taker role split for the incumbent~~ -> A16: measured per
  book — b55f btc-15m 37.8% maker by notional, btc-5m 44.5%; 0xce25
  btc-15m 37.3%; doggystyie 0%.
- ~~Fee-inclusive re-audit of the July actives~~ -> A16: b55f btc-15m
  +2.31% fee-inclusive (edge REAL), 0xce25 +0.31% (barely), btc-5m
  cells fee-negative; edge wallets ~62% taker by notional; new
  exchange contract 0xe1111800...996b with native fees discovered
  (measurements/fee-audit-actives.md).

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
