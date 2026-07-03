---
artifactType: strategy-family
family: liquidity-wall
---

# liquidity-wall

## Core idea

A **wall** is one resting level whose size dominates its side of the book —
committed capital parked at a single price. Trade around it: a wall is a discrete
barrier / conviction object, distinct from diffuse pressure. The baseline bets
the wall **defends** its price (lean with it); the `fade` mode bets it **breaks
or gets pulled** (lean against it). The sweep discovers the sign.

## Primary decision driver

**Single-level size concentration** — `maxLevelSize / sum(top-N levels)` on one
side of the UP book crossing a dominance threshold, with an absolute size floor.
This is the driver; everything else (which side, follow vs fade, persistence,
distance to touch) is an experiment knob.

## Experiments to try

1. **Baseline knob sweep** — does _any_ param region reach `evPerMarketTotal` > 0?
   Go/no-go gate, and it discovers the sign via the `mode` (follow/fade) knob.
   Sweeps `wallRatio`, `depthLevels`, `minWallShares`, `dwellSec`, `mode`,
   `takeProfit`. (Always first.)
2. **Cross-symbol thinness** — the key lever, and the reason this family might
   live where book-imbalance died. On deep BTC books a single level rarely
   dominates and the book is proven efficient to within cost. On thin SOL / XRP
   (and to a lesser extent ETH) a wall genuinely dominates its side and is not
   instantly arbed, so the concentration signal is both more frequent and more
   informative. Run the frozen config per-symbol and compare `evPerMarketTotal`.
3. **Spoof-aware persistence** — a real defended wall survives; a spoof wall is
   _pulled the instant price approaches it_. Extend the `dwellSec` persistence
   into a shrink-aware filter: require the wall to survive N ticks **and** not
   shrink more than X% as the mid moves toward it. Acting only on walls that hold
   under pressure should sharpen `follow`.
4. **Distance-to-touch gate** — a wall sitting _at_ best bid/ask (price is
   testing it now) behaves differently from a latent wall several ticks deep.
   Gate on `wallPrice − mid`: trade only walls within D ticks of touch (imminent
   interaction) vs only latent ones, and test which carries the edge.
5. **Wall-pull reversal** (variation, needs new code) — instead of the standing
   wall, trigger on a dominant wall that _suddenly disappears_ near touch: a
   pulled wall often precedes a fast move _through_ that vacated level. Enter in
   the break direction. Same wall-anchored family, a removal trigger rather than
   a presence trigger.

## Allowed experiment directions

Anything that keeps single-level concentration as the entry driver: dominance
thresholds, size floors, depth window, follow/fade, persistence/shrink filters,
distance-to-touch gates, wall-removal triggers, per-symbol regime selection,
exit re-tuning.

## Forbidden directions

- Replacing concentration with the aggregate `(bidDepth − askDepth) / sum`
  pressure ratio — that is the **book-imbalance** family's driver, not this one.
- Live-only signals or unrecorded WS fields (breaks the replay invariant).
- Cross-venue / cross-exchange comparison.

## Known weaknesses

- **Correlation with imbalance.** A dominant wall skews aggregate imbalance too,
  so on BTC this risks inheriting the same thin, fee-bound edge book-imbalance
  hit. The decoupling (balanced aggregate + one giant wall) and the thin-symbol
  lever are the bet that it is _not_ the same edge.
- **Spoofing.** Walls can be fake and pulled on approach; without the
  persistence / shrink filter, `follow` will be adversely selected. Captured as
  experiment #3.
- **Sparsity on deep books.** On BTC a single level rarely dominates, so the
  signal may fire rarely — sample size per window could be low. Thin symbols fix
  this (experiment #2).
- **Hold-to-resolution capacity/regime risk** is untested, as for every family.

## Experiment log

### 000-baseline

Hypothesis: does any param region of the concentration driver reach
`evPerMarketTotal` > 0, and does `follow` or `fade` carry the sign?
Result: pending. Future run batch UID: `liquidity-wall--000-baseline`.

## Duplicate notes

Not **book-imbalance**: that family's driver is the _aggregate_ top-N cumulative
depth ratio `(bidDepth − askDepth) / (bidDepth + askDepth)` — a continuous
pressure metric over the whole top of book. liquidity-wall's driver is _single-
level concentration_ — one dominant resting order, a discrete barrier that can be
present even when aggregate imbalance is ~0. Shared `orderbook` tag ≠ shared
driver. Renamed pressure ideas (book-pressure, depth-imbalance, bid-ask-skew)
belong to book-imbalance, not here. "liquidity-wall ≈ big-order ≈ depth-block ≈
iceberg-level" are the synonyms that map back to _this_ family.
