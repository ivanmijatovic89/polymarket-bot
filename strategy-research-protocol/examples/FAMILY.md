---
artifactType: strategy-family
family: book-imbalance
status: experimental
champion: book-imbalance.001
tags:
  - orderbook
  - imbalance
  - entry-signal
---

---

# book-imbalance

## Core idea

Use persistent orderbook imbalance as the primary entry driver: when resting
size is heavily skewed to one side, lean in that direction.

## Primary decision driver

Resting bid/ask size imbalance over the top N book levels. (One driver per
family — if a new idea changes the driver, it is a new family, not an experiment.)

## Experiments to try

A ranked list of ideas worth testing in this family — plain notes, not a
committed queue. The baseline sweep runs first; after that, the next experiment
is chosen by what results teach us, not blindly in order. Kill the family only
when this list is exhausted.

1. **Baseline knob sweep** — does _any_ param region beat baseline net of fees?
   Go/no-go gate. (Always first.)
2. **Persistence filter** — transient imbalance is the suspected false-signal
   source; require it to hold N ticks before entry.
3. **Spread-regime gate** — edge may only exist in wide-spread markets; gate out
   tight ones.
4. **Side asymmetry** — UP vs DOWN imbalance may not be symmetric (cf. long-bias
   lesson in memory).

## Allowed experiment directions

Anything that keeps imbalance as the entry driver: thresholds, persistence,
depth weighting, regime gates, side handling.

## Forbidden directions

- Live-only signals or unrecorded WS fields (breaks replay invariant).
- Anything that replaces imbalance as the driver (that is a new family).

## Known weaknesses

(fill in as experiments reveal them)

## Experiment log

### 001 — baseline sweep

Hypothesis: does any param region beat baseline?
Result: (pending — batchUid obimb-sweep-01)

## Duplicate notes

Do not propose a renamed imbalance idea (book-pressure, bid-ask-skew,
depth-imbalance) as a new family — those are the same driver.
