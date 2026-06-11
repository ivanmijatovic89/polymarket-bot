# Family: convergence-near-expiry

**Thesis:** late in a 15m up/down market, the price is the crowd's probability that a side
resolves YES. If the market is _miscalibrated_ on late-window favorites — i.e. a token priced
at P near expiry wins _more_ than P% of the time (favorite underpricing) — then buying the
favorite late and holding to resolution is +EV. This is a **fatter, structurally different**
edge from the (shelved) micro-timing families: the payoff is the full convergence to $1, not a
few cents of spread, so it has a chance to clear fees.

**Status:** 🟢 **PROMISING — passed Signal + Validation (2026-06-10). Best candidate of the session.**
`ConvergenceFavorite.v1` (buy favorite) → 🔴 KILLED (favorites overpriced). Its mirror
`ConvergenceUnderdog.v1` (buy the cheap side, hold to resolution) → **validated**: real, persistent
favorite-longshot bias. In-sample EV +$1.45/mkt deflated to **OOS +$0.46/mkt (904 trades, 2 months)** —
still solidly positive (vs orderbook-imbalance which deflated to break-even). Full 6000: net +$634,
EV +$0.60. NOT yet proven: live fill realism on the thin underdog side (the #1 risk), capacity, latency, holdout/paper.

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
