# Family: orderbook-imbalance

**Thesis:** when resting size is heavily skewed to one side of the book, near-term price
tends to drift toward the heavy side (liquidity pressure — lean _with_ the book).

**Status:** 🗄️ **SHELVED — real but too thin, fee-bound (2026-06-10).** A genuine persistent
directional edge (GROSS +$335 / 6000 btc markets) but break-even net after fees, and regime-dependent
(strong recently, negative Mar–Apr). The one low-overfitting lever — a maker take-profit fee cut (v2) —
**made it worse** (net +$11 → −$40), because the resting maker TP misses fills that the taker captured,
so winners rot. Remaining "fixes" (gates / exit re-tuning) are signal-fitting on a thin edge → shelved
rather than overfit. Don't re-open without a structurally fatter signal or a cheaper fee/venue.

## Candidate 001 — results (`OrderbookImbalance.v1`)

Best frozen config: `enter=0.4 dwellSec=20 takeProfit=0.15 stopLoss=0.02 depthLevels=3 maxHoldSec=300`.
All from run id 38 (`obimb-sweep-14` → `-ext1` → `-ext2`); in-sample sweep `obimb-sweep-01..14`.

| window            | period             | net       | gross    | EV/played  |
| ----------------- | ------------------ | --------- | -------- | ---------- |
| in-sample (tuned) | newest 1000 (May)  | +$54      | +131     | +0.121     |
| OOS A             | prev 1000 (Apr)    | +$137     | +202     | +0.377     |
| OOS B             | new 4000 (Mar–Apr) | **−$180** | +1       | −0.150     |
| **full union**    | **6000 (Mar–May)** | **+$11**  | **+335** | **+0.006** |

**Lesson (honest):**

- **Over 6000 markets it is break-even** (EV +$0.006). The strong single-window OOS (April) was
  partly a favorable regime — one OOS window is NOT validation. The extra 4000 markets caught a
  false positive before it cost anything. _Always validate on multiple windows._
- **NOT dead like spike-reaction.** GROSS is non-negative in every window and **+$335 over 6000**;
  there is a real, thin, persistent directional edge. Spike's gross topped at ~$0.
- **Fees are the swing factor:** full-period gross +$335, fees $324, net +$11. Cutting fees is the
  difference between break-even and a persistent small positive across regimes.
- `dwellSec` does double duty (sharper signal + fewer trades → fewer fees). Low win ~30% / big
  avg-win ~3.2 (trend profile).

## v2 maker take-profit — tested, FAILED (`obimb-v2-maker-6000` vs v1 `obimb-sweep-14-ext2`, same 6000)

|       | v1 taker | v2 maker-TP     |
| ----- | -------- | --------------- |
| fees  | $323     | $282 (−$41 ✅)  |
| GROSS | +$335    | +$242 (−$93 🔴) |
| NET   | +$11     | **−$40**        |

The fee cut worked but a resting maker SELL at `entry+tp` needs the price to trade _through_ a fixed
level — stricter than the taker mid-cross — so it **misses fills the taker captured**; those winners
decay to stops/timeouts. Lost gross ($93) > fee saved ($41). Pre-set bar ("net-positive across full
6000") missed → shelved.

## Why shelved (not iterated further)

The edge is real but ~+$0.04/market at best and regime-dependent. The only low-overfitting lever
(structural fee cut) didn't tip it. Gates / exit re-tuning on an edge this thin = fitting noise.
Re-open only with a structurally stronger signal or a cheaper fee tier / maker rebates.

## Candidate 001 — spec (to build)

**Hypothesis:** in a 15m up/down market, a strong, _persistent_ bid/ask size imbalance on the
UP token predicts short-term UP-mid drift in the imbalance direction.

**Mechanism (order-book only — no external feeds):**

- Compute `imbalance = (bidDepth − askDepth) / (bidDepth + askDepth)` over the top `depthLevels`
  of the UP book (use `bidsDepthByLevel` / `asksDepthByLevel` from the snapshot).
- Require it to persist ≥ `dwellSec` (reject one-tick spoof noise).
- If `imbalance ≥ enter` (bids heavy) → buy UP; if `≤ −enter` (asks heavy) → buy DOWN.
- Exit via the reused SpikeMomentum machinery: `takeProfit` / `stopLoss` / `maxHoldSec` /
  late-window bailout.
- Open only when `secondsLeft ≥ minSecondsLeft`.

**Knobs (ranges → sweep):**

| knob             | range       | controls                        |
| ---------------- | ----------- | ------------------------------- |
| `depthLevels`    | 1 → 5       | how deep to measure imbalance   |
| `enter`          | 0.30 → 0.70 | how skewed before acting        |
| `dwellSec`       | 1 → 10      | persistence filter (anti-spoof) |
| `takeProfit`     | 0.02 → 0.10 | profit target                   |
| `stopLoss`       | 0.02 → 0.05 | loss cut                        |
| `minSecondsLeft` | 120 → 600   | stay away from resolution       |
| `size`           | 25 (fixed)  | order size                      |

**Pre-mortem (fastest kills):**

- If book imbalance is mostly **spoofing / fleeting**, it won't predict drift → flat/negative EV.
  The `dwellSec` persistence filter is the main defence; if even long-dwell imbalance is flat, kill.
- **Same execution wall as spike-reaction:** if the edge < spread + fees, taker can't monetize.
  **Watch GROSS, not just net** — that is the early read on whether the family has a future.

**Baselines:** `do-nothing` (net of fees) + `random-entry-same-cadence`.

**First test plan:** smoke (does it trade?) → coarse sweep on `enter` × `dwellSec` × `takeProfit`
on the last 1000 btc markets → read the GROSS surface before tuning anything else.
