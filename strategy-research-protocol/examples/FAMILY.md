---
artifactType: strategy-family
family: book-imbalance
---

# book-imbalance

## Thesis

Retail flow on BTC 15m up/down markets is reactive: participants chase the
side that is already moving, posting market orders against whatever resting
liquidity exists. Market makers on this venue are slow to reprice the thinner
side after depth shifts, so a persistently bid-heavy book can precede short
UP drifts (and mirrored for DOWN). The counterparty is the maker whose stale
quotes have not caught up with the depth shift; the edge survives arbitrage
because it is small, short-lived, and below the attention threshold of the
few sophisticated participants in a 15-minute market.

## Signal definition

Over the top `depthLevels = 3` book levels of each side, at every `book` /
`price_change` tick:

```text
imb = (bidSize_UP - bidSize_DOWN) / (bidSize_UP + bidSize_DOWN)
```

Enter the side with `imb > enterThreshold` (mirrored below
`-enterThreshold`), only after the signal has held for `dwellTicks`
consecutive ticks. Exit at `takeProfitTicks` favorable ticks or at market
resolution. All inputs are recorded orderbook fields — no live-only data.

## Edge economics

Why this edge should be structurally fat: the stale-maker story implies the
mispricing scales with depth-shift size, and dwell filtering removes the
single-delta noise entries that diluted prior attempts. Measured comparables:
the killed pre-protocol orderbook-imbalance family measured gross +$0.06/mkt
unconditioned with a measured fee drag near $0.33/mkt — clearly fee-bound.
This family is only worth proposing because dwell persistence is expected to
concentrate entries into materially fatter setups; if the stage-1 screen
measures gross in the same +$0.06/mkt neighborhood, the mechanism brings
nothing structurally new and dies at gate 1.

## Experiment roadmap

1. Spread gate — trade only when the entry-side spread covers fees.
2. Side asymmetry — separate UP and DOWN thresholds (retail long-bias).
3. Depth-weighted imbalance — weight levels by distance from touch.
4. Imbalance decay exit — exit when the signal flips, not at fixed ticks.
5. Time-of-window gate — trade only the first/last N minutes of the episode.

## Duplicate notes

Do not re-propose renamed imbalance ideas (book-pressure, bid-ask-skew,
depth-imbalance) as new families unless the primary decision driver changes.
The killed legacy `orderbook-imbalance` family (pre-protocol) is the closest
prior art; its lesson — fee-bound, needs a structurally fatter signal — is
this family's bar to clear.

## Research log

### 000-baseline — 2026-07-02

Coordinate search (3 passes, 11 cells, latest 1000 markets, batchUids
`book-imbalance--000-baseline--p1..p3`). Verdict: **fail** against
"Best cell netEvPerMarket > 0 at stage-1 coverage" — best cell
`enterThreshold=0.5, dwellTicks=6, takeProfitTicks=2` reached gross
+$0.23/mkt but net −$0.11 over 1000 markets (1840 trades); gate 1 decision:
recycle. The signal is real but thin: dwell filtering doubled gross vs the
unfiltered legacy result, and fees still eat it. `takeProfitTicks` is flat —
stop sweeping it.

Decision: recycle per STAGE-GATES.md — queue `001-spread-gate` (roadmap #1),
which attacks the cost side directly instead of entry quality.

Lesson: dwell persistence improves gross materially (+$0.23 vs +$0.06
legacy) but entry-quality work alone cannot cross this strategy's measured
fee drag (~$0.34/mkt); remaining experiments must cut effective costs
(spread capture, maker-side entries) or find conditioning that concentrates
the gross edge.
