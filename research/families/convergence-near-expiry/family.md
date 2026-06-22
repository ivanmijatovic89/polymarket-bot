# Family: convergence-near-expiry

**Thesis:** late in a 15m up/down market, the price is the crowd's probability that a side
resolves YES. If the market is _miscalibrated_ on late-window favorites — i.e. a token priced
at P near expiry wins _more_ than P% of the time (favorite underpricing) — then buying the
favorite late and holding to resolution is +EV. This is a **fatter, structurally different**
edge from the (shelved) micro-timing families: the payoff is the full convergence to $1, not a
few cents of spread, so it has a chance to clear fees.

**Status:** 🟠 **NON-STATIONARY edge — static versions shelved; adaptive is the open question (2026-06-14).**
Late-window prices ARE miscalibrated (real, persistent phenomenon) but the **direction flips across
regimes**, so no _static_ buy-one-side strategy is robust.

- `ConvergenceFavorite.v1` (buy favorite): in-sample (Mar–May) favorites OVERpriced → lost. **Forward
  (May 13–Jun 14): favorites UNDERpriced → would WIN** (net ≈ +$760 across bands, see forward curve below).
- `ConvergenceUnderdog.v1` (buy underdog): exact opposite — won in-sample (+$1.45/mkt), **failed forward**
  (EV −$0.27, net −$145, win 38.7%).

The forward favorite-calibration check (extends of `convfav-band-01..05` onto the 3,016 new markets,
high-data, low-variance) shows the sign **reversed** vs in-sample:

| band      | fwd played | fwd win% | ~price | win%−price (fwd) | (in-sample was) |
| --------- | ---------- | -------- | ------ | ---------------- | --------------- |
| 0.55–0.65 | 261        | 61.7     | 0.60   | **+2.1**         | −4.8            |
| 0.65–0.75 | 450        | 72.4     | 0.69   | **+3.4**         | −4.6            |
| 0.75–0.85 | 715        | 80.4     | 0.79   | **+1.5**         | −4.3            |
| 0.85–0.95 | 1211       | 89.7     | 0.89   | **+0.6**         | −2.0            |
| 0.95–0.99 | 1677       | 96.9     | 0.97   | 0.0              | −0.4            |

**Lessons:**

1. **Backward-adjacent OOS (same regime) is NOT validation.** Only fresh FORWARD data caught the flip.
   The underdog's +1.45 → +0.46 → −0.27 was a regime decaying, not a durable edge.
2. **The mispricing is real but non-stationary (sign-flips).** A fixed side will always eventually get killed.
3. ~~The only potentially-tradeable version is adaptive~~ → **ADAPTIVE ALSO RULED OUT (2026-06-16).**

## Regime-persistence check → convergence family CLOSED

Ran a wide-favorite calibration over the **full history** (18,635 btc markets, Dec–Jun, `convfav-fullhist-calib`)
and bucketed the residual (win% − price) **weekly**. Result: the sign **flips almost every week**, runs of one
sign last only 1–2 weeks, and magnitudes (~−1.5 to +2) are mostly **within the ±1.3pp sampling noise** of
~600 trades/week. Only the first ~6 weeks (Dec) showed a sustained block.

**Conclusion: there is NO persistent regime.** Favorites are ~fairly priced overall; the week-to-week wobble is
largely noise. An adaptive regime-detector would be chasing noise (sign flips faster than detectable). The earlier
"edges" (underdog +$1.45, forward favorite flip) were **small calibration noise amplified by narrow price bands /
specific windows** — pattern-in-noise, not a structural edge.

**Family status: 🔴 CLOSED.** Late-window calibration on btc 15m is approximately fair with weekly noise; nothing
stable to trade (static OR adaptive). Don't reopen without a genuinely different mechanism. **Meta-lesson: a cheap
full-history persistence check kills an adaptive idea before you build it — run it before committing to walk-forward.**

## Candidate 001 — `ConvergenceFavorite.v1` → KILLED

Band sweep (`convfav-band-01..05`, 1000 btc mkts each, entryWindow 120s, hold to resolution). The
market is well-calibrated but consistently OVER-prices the favorite — win% is below price in EVERY band:

| price band | played | win% | win%−price | gross |
| ---------- | ------ | ---- | ---------- | ----- |
| 0.55–0.65  | 87     | 55.2 | −4.8       | −$99  |
| 0.65–0.75  | 136    | 65.4 | −4.6       | −$116 |
| 0.75–0.85  | 235    | 75.7 | −4.3       | −$200 |
| 0.85–0.95  | 399    | 88.0 | −2.0       | −$125 |
| 0.95–0.99  | 585    | 96.6 | −0.4       | −$65  |

Smooth, monotonic, ~1440 markets → high-confidence kill. (Actual entry = ask+slippage > midpoint, so
even worse than shown.) **Favorite-buying is dead.**

## Candidate 002 — `ConvergenceUnderdog.v1` → VALIDATED (best of session)

Buy the underdog (lower-mid token), hold to resolution. Band sweep (`convdog-band-01..04`, 1000 btc
mkts each) — every band net + GROSS positive, fattest in the moderate underdog:

| underdog band | played | win% | EV/mkt    | gross |
| ------------- | ------ | ---- | --------- | ----- |
| 0.35–0.45     | 148    | 45.3 | **+1.45** | +$237 |
| 0.25–0.35     | 166    | 35.5 | +1.26     | +$229 |
| 0.15–0.25     | 189    | 22.8 | +0.68     | +$143 |
| 0.05–0.15     | 351    | 11.7 | +0.15     | +$67  |

**OOS validation** (band 0.35–0.45, run id 46 → `convdog-band-01-ext1`, frozen, prev 5000 mkts Mar–May):
in-sample EV +1.45 → **OOS +0.46 / mkt, net +$419, 904 trades**. Held solidly positive (vs imbalance
which deflated to ~0). Full 6000: net +$634, EV +0.60.

**Why believable:** documented behavioral favorite-longshot bias (persistent, not a microstructure quirk);
internally cross-checked by the favorite kill; tiny fees (hold to resolution).

## Next gates for ConvergenceUnderdog (in order)

1. **Fill realism — THE risk.** The edge = buying the thin, unpopular underdog side late. Check available
   depth/fill sizes; the backtest doesn't model own-market-impact. If you can't get size live, the edge is illusory.
2. **Latency stress** (`BACKTEST_LATENCY_DELAY`) — does it survive intent→fill delay?
3. **Regime sub-stability + more OOS depth** — extend further back; is +0.46 stable across sub-periods?
4. **Capacity** (how much size the underdog book absorbs) → **holdout + paper**.

## Candidate 001 — spec (`ConvergenceFavorite.v1`)

**Mechanism (order-book only — no external feeds):**

- In the entry window (`minEntrySec ≤ secondsLeft ≤ entryWindowSec`), identify the **favorite**:
  the token with the higher mid.
- Enter (taker buy) iff `favMid ≥ favoriteThreshold` AND `favAsk ≤ maxPrice` (skip no-juice near-certainties).
- **Hold to resolution** — no take-profit / stop. The share pays $1 if the favorite wins, $0 if not.
  (Backtest settles open positions at market end.)
- One trade per market.

**Knobs (ranges → sweep). The threshold sweep IS the experiment** — it traces the late-window
calibration curve (at what price are favorites under/over-priced):

| knob                | range       | controls                                               |
| ------------------- | ----------- | ------------------------------------------------------ |
| `favoriteThreshold` | 0.55 → 0.95 | min favorite price to enter (the calibration probe)    |
| `maxPrice`          | 0.90 → 0.99 | skip favorites too expensive to have juice             |
| `entryWindowSec`    | 30 → 300    | how late to start looking (secondsLeft ≤ this)         |
| `minEntrySec`       | 10 → 60     | stop entering this close to expiry (need time to fill) |
| `size`              | 25 (fixed)  | order size                                             |

**Pre-mortem (fastest kills):**

- **Efficient pricing:** if favorites at price P win exactly ~P% → gross ≈ 0 → fees sink it.
- **Longshot bias the _wrong_ way:** if favorites are *over*priced (win < P%), every threshold loses
  gross — a clean kill, and the sweep shows it as a monotonic loss.
- **Asymmetry:** buy at 0.85 → win +0.15 / lose −0.85. Needs conditional win-rate > threshold.
  Watch win-rate vs threshold directly.

**Baseline:** do-nothing (net of fees). The decisive read is **GROSS by threshold** — does the
conditional win-rate beat the entry price at any band?
