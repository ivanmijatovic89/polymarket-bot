# Family: pair-v8 (deep-book maker placement) — Phase 0: data scan

Fourth axis, second of the two remaining inside-RULES untested axes
(STATUS session-4 plan). The E-014 per-start invariant (−0.06/share) and
its E-016 decomposition were measured for fills AT the top of book
(join-bid at bestBid). pair-v8 asks whether resting DEEPER changes the
economics:

> Rest the join-bid at bestBid − δ instead of bestBid. Fills only trigger
> in bigger crashes: the price is better by δ, the selection is worse
> (bigger move ⇒ more informed). Which effect wins is empirical.

At δ=0 this is exactly the killed configuration (E-016 scan B), which
doubles as a regression check on the extended scanner.

## Pre-registered definitions (written BEFORE the scan ran)

- **Universe, replay, fee curve**: identical to pair-v7 Phase 0 (same scan
  pass; latest 800 pinned to slugs 1784043000 → 1784762100).
- **δ grid**: 0.00 / 0.01 / 0.02 / 0.03 / 0.05 / 0.08 (dollars below the
  pre-event bestBid). Each (side, δ) stream is independent with its own 5 s
  refractory — the same fresh-quote fill proxy as scan B, shifted down:
  a moment fires when the new bestAsk_X < (pre-event bestBid_X) − δ and
  the level P = bestBid_X − δ ≥ 0.01 (min valid price). Fill price = P.
- **Readouts per δ** (identical machinery to E-016 scan B): refractory
  moments per market, fill-price distribution, completion cost
  C = P + askY(t+140) + fee(askY) with p10..p90, zero-latency C, P(C<1)
  and tighter gates, completion depth ≥ 10 shares, free-abort upper bound
  EV/market, abort-corrected EV/market, and the HOLD-ALL readout (never
  complete: EV/share = 1{X wins} − P, EV/market at 10-share increments,
  win rate, per-day breakdown, % markets positive).
- **Sane band**: P ∈ [0.10, 0.90]; verdicts on full set AND sane band.
- **Regression check (binding)**: the δ=0.00 stream must reproduce
  E-016's scan-B numbers (same moments count, C p50 1.0373, hold-all
  −0.029/share on the sane band) — if it does not, the scanner extension
  is buggy and NO verdict is valid until fixed.

## Pre-registered priors (honest)

The E-016 decomposition says a top-of-book trade-through fill carries
≈ −2.9c/share of unconditional directional adverse selection, and the
complement reprices +1.6c instantly / +4.5c by +140 ms. Deeper placement
buys δ cents of price cushion but conditions on a strictly bigger crash.
Two plausible worlds: (i) crashes overshoot at 15 m scale — deep fills buy
panic and mean-revert, hold-all EV/share turns positive somewhere on the δ
grid; (ii) big moves are informed (Binance leads), deeper fills are MORE
toxic per share and the cushion never catches up. Frequency also collapses
with δ — even a positive per-share EV may be worth pennies per market.
The scan measures all of it in one pass.

## Pre-registered verdicts

- **BUILD v8**: some δ > 0 with hold-all EV ≥ $0.25/market (sane band and
  full set agreeing on sign) and day-consistency (positive on ≥ 6 of the
  ~9 scan days — the 07-14 partial-day trap from E-016 is pre-refuted),
  OR abort-corrected completion EV ≥ $0.25/market with P(C<1) ≥ 20% at
  that δ.
- **WEAK**: best δ with hold-all EV/market in [$0.10, $0.25), or a
  positive hold-all per-share EV whose frequency is too low to matter
  (record for potential stacking with another family).
- **KILL the family**: every δ on the grid fails both prongs — hold-all
  EV < $0.10/market AND free-abort upper bound < $0.10/market — on both
  the full set and the sane band. Time-scoped as always.

Confounders pre-committed: (a) markets-with-any-moment per δ reported — a
family firing in < 5% of markets cannot carry goal 1 regardless of
per-share EV; (b) per-day breakdown per δ (9 scan days); (c) BIAS
ASYMMETRY, same as pair-v7: the fresh-quote proxy overstates fill count
AND fill quality (a real resting bid is staler; in a sustained crash a
stale higher bid fills earlier at a worse price), so KILL is a fortiori
but BUILD only licenses Phase-1 strategy code — the real-simulator
backtest is the confirming evidence; (d) completion readouts inherit
pair-v6's death by default (C was ≥ 1 at δ=0 because the COMPLEMENT
repriced; deeper own-side placement does not obviously help the complement
leg) — the hold-all prong is the one this family actually banks on.
