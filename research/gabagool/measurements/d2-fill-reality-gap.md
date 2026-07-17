# Measurement D2: the passive-fill reality gap

Session 1, 2026-07-17. Script: `scripts/measure-fill-gap.ts`. Method:
gabagool22's actual BUY fills (data-api /activity) joined to Telonex
delta-typed book replays (repo `replayTelonexDeltaParquetForMarket` +
`MarketEngine` — book reconstruction only, no strategy/execution) for the
same btc-updown-15m markets. Per fill, we test whether the engine's maker
rules would have granted it: worst_queue (min bestAsk in ±W < fill price)
and touch_or_better (≤). Raw output: `data/d2-results.log`.

## Caveat first

Activity timestamps are SECONDS; book timestamps are exchange ms. A ±1–2s
alignment error is inherent → the 3s window is the fairest single number;
1s under-admits, 10s over-admits (windows start overlapping unrelated
moves). Fill role (maker vs taker) is not observable in /activity — the
"at/above-ask" placement class mixes true taker buys with skew artifacts.

## Results

**btc-15m, Dec 8–10 2025 (zero-fee era): 40 markets, 26,304 fills**

| rule | W=1s | W=3s | W=10s |
|---|---:|---:|---:|
| worst_queue admits | 29.0% | **43.8%** | 72.2% |
| touch_or_better admits | 44.1% | **64.1%** | 88.3% |

Placement vs prevailing best bid: 20.4% at touch, 39.7% deeper than bid,
8.8% inside spread, 28.8% at/above ask (2.3% no book). Offset quantiles
(fill − bestBid): p10 −0.04, p25 −0.02, p50 0.00, p75 +0.01, p90 +0.03.

**btc-15m, Feb 17–20 2026 (fee era tail): 40 markets, 16,856 fills**

| rule | W=1s | W=3s | W=10s |
|---|---:|---:|---:|
| worst_queue admits | 38.0% | **49.1%** | 81.1% |
| touch_or_better admits | 53.5% | **68.4%** | 93.0% |

Placement: 20.7% touch, 33.1% deeper, 0.9% inside spread, 45.2% at/above
ask. (Size-weighted numbers within 2pp of unweighted everywhere.)

## Findings

1. **THE number: worst_queue sees ~44–49% of the archetype's real fills;
   touch_or_better ~64–68%** (3s window, both eras). The conservative
   sim understates fill COUNT by ~2×, the optimistic bound by ~1.5×.
2. **The missed half is the benign half.** Fills the engine admits are
   (by its rule) those where the ask crossed the level — the informed
   subset (fable E16). The ~50% it misses are uninformed-arrival fills
   (sellers hitting standing bids without the book tearing through) —
   the population that funds real makers per queue-model theory
   (literature/A1). So the EV distortion is worse than the count
   distortion: sim-EV ≈ real-EV-of-the-toxic-half.
3. **He was not purely passive.** ~29% (Dec) to ~45% (Feb) of fills
   printed at/above the prevailing ask — a large minority were TAKER
   completions (free to cross in the zero-fee era; in Feb this rose,
   consistent with urgency under thinner margins, and cost taker fees —
   part of why the tail bled). "Passive two-sided maker" needs amending
   to "maker-biased two-sided accumulator with taker completion."
4. **Ladder shape**: placement mass at bid−(1–4c) (p10−p25) and at the
   touch — a 1–4 cent-deep ladder below best bid, plus touch joins,
   plus opportunistic crossing. First direct read of his quoting policy
   (BRIEF §4 updated).

## Consequences

- A worst_queue backtest of a parity-accumulator measures the wrong
  strategy: half the volume and the adverse half. Sim results are a
  LOWER BOUND; a sim-positive cell would be extraordinary evidence, a
  sim-negative cell is expected and non-fatal (H1 kill criteria stand:
  D2 came in at ~45–50%, above the <20% "sim is blind" threshold, so
  sim screens retain SOME signal — but validation belongs to live-paper
  or a trades-channel queue model, exactly fable EDGE-SPACE §3.2/3.3).
- touch_or_better is the closer instrument for THIS concept (misses
  ~1/3) but overfills on size (full-size grants) — bracket, don't trust.
- The taker-completion share means fee modeling (G3 shape) matters even
  for "maker" variants; and post-2026-05-28, taker completion earns
  tier rebates (see wallets/b55f + powerwinner) — the venue now
  subsidizes the crossing leg the archetype paid full price for in Feb.
