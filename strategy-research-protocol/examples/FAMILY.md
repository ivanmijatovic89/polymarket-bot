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

Taker round trip costs ~$0.34/mkt at protocol-default sizing (fee floor per
RESEARCH_SCOPE.md). For the mechanism to clear stage-1, directional accuracy
on imbalance-triggered entries must exceed ~53.5% at 2-tick take-profit —
plausible for a persistence-filtered depth signal if the stale-maker story is
real at all. Prior orderbook-imbalance research (killed family) found gross
+$0.06/mkt unconditioned; this family must beat that via dwell filtering or
die at gate 1.

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
`book-imbalance--000-baseline--p1..p3`). Evaluator verdict: **fail** against
"Best cell netEvPerMarket > 0 on the test split at stage-1 coverage" — best
cell `enterThreshold=0.5, dwellTicks=6, takeProfitTicks=2` reached gross
+$0.23/mkt but net −$0.11 (train −$0.09 / test −$0.14, 1840 trades). The
signal is real but thin: dwell filtering doubled gross vs the unfiltered
legacy result, and fees still eat it. `takeProfitTicks` is flat — stop
sweeping it.

Decision: recycle per STAGE-GATES.md — queue `001-spread-gate` (roadmap #1),
which attacks the cost side directly instead of entry quality.

Lesson: dwell persistence improves gross materially (+$0.23 vs +$0.06
legacy) but entry-quality work alone cannot cross the ~$0.34 fee floor here;
remaining experiments must cut effective costs (spread capture, maker-side
entries) or find conditioning that concentrates the gross edge.
