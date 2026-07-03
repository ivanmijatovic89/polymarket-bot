---
artifactType: strategy-family
family: book-imbalance
---

# book-imbalance

## Core idea

Use persistent orderbook imbalance as the primary entry driver: when resting
size is heavily skewed to one side, lean in that direction only if the skew is
large enough and survives basic noise filters.

## Primary decision driver

Resting bid/ask size imbalance over the top N book levels. One family has one
driver; thresholds, persistence filters, depth weighting, exits, and regime
gates are experiments inside this family.

## Experiments to try

1. **Baseline knob sweep** - test whether any imbalance threshold, dwell window,
   and take-profit combination clears fees over recent BTC 15m markets.
2. **Persistence filter** - require imbalance to hold for several consecutive
   ticks before entry to reduce single-delta false signals.
3. **Spread-regime gate** - only trade imbalance when the entry-side spread is
   wide enough to compensate for maker queue and taker fee assumptions.
4. **Side asymmetry** - test separate UP and DOWN thresholds if the baseline
   shows one side dominates edge or losses.

## Allowed experiment directions

Change thresholds, dwell windows, depth weighting, side handling, exit rules,
and regime gates while keeping orderbook imbalance as the primary entry driver.

## Forbidden directions

- Do not use live-only fields, unrecorded WebSocket metadata, or required
  external feed data.
- Do not replace imbalance with a different entry driver; that is a new family.
- Do not edit a frozen strategy file after it has a recorded result.

## Known weaknesses

The baseline may overfit transient depth that disappears before a queued
backtest intent can execute. It may also concentrate edge in a small number of
wide-spread markets.

## Experiment log

### 000-baseline

Status: proposed. First run should use batch UID
`book-imbalance--000-baseline`.

## Duplicate notes

Do not propose a renamed imbalance idea such as book-pressure, bid-ask-skew, or
depth-imbalance as a new family unless it introduces an independent primary
decision driver.
