# Engine exerciser strategy (parity test)

A deterministic strategy implemented identically in TypeScript
(`src/strategies/testing/engine-exerciser.ts`, id `engine-exerciser`) and Rust
(`native/strategies/engine-exerciser`). It exists only to drive every engine
feature through both engines on real markets. It is not a trading strategy.

Notation: `n` = count of market ticks seen so far (book/price_change only,
first tick is n=0). `UP` = asset index 0, `DOWN` = asset index 1.
`bid(A)`/`ask(A)` = best bid/ask price of asset A (skip the action for that
tick if missing, and retry on the next tick — keep a "pending action" flag).
`pos(A)` = portfolio position qty. All prices are snapped down to the 0.01 tick
for BUY and up for SELL, clamped to [0.01, 0.99]. Sizes are shares.
Client ids are exactly the strings below.

## Market tick schedule

| n | Action |
|---|---|
| 50 | `place_limit` GTC BUY UP @ bid(UP), size 10, postOnly=true, cid `x1` |
| 60 | `place_limit` FOK BUY DOWN @ ask(DOWN), size 5, cid `x2` |
| 70 | `split_positions` UP/DOWN size 10 |
| 90 | `place_limit` GTD BUY UP @ bid(UP)−0.02, size 6, expireAtMs = tick ts + 120000, cid `x3` |
| 100 | `place_batch` [GTC SELL UP @ ask(UP)+0.03 size 4 cid `x4a`, GTC SELL DOWN @ ask(DOWN)+0.03 size 4 cid `x4b`] |
| 120 | `cancel_order` cid `x1` |
| 150 | `place_limit` GTC BUY UP @ ask(UP)+0.02, size 200, cid `x5` (crossing, larger than depth) |
| 180 | `place_limit` FOK BUY UP @ bid(UP)−0.05, size 5, cid `x6` (must be killed) |
| 200 | `place_limit` GTC BUY DOWN @ ask(DOWN), size 3, postOnly=true, cid `x7` (must be rejected: would cross) |
| 220 | `cancel_batch` [`x4a`, `x4b`, `x9-missing`] |
| 260 | `merge_positions` UP/DOWN size = min(pos(UP), pos(DOWN), 5) (skip if 0) |
| 300 | `cancel_market` asset UP |
| 400 | `place_limit` GTC SELL UP @ bid(UP), size = min(pos(UP), 5) (skip if < 1), cid `x8` (crossing sell) |
| 500 | `cancel_all` |
| every 100 from 600 | if no open orders: GTC BUY UP @ bid(UP)−0.01 size 5, cid `r{n}`; at n+40 `cancel_order` `r{n}` |

## Account callback

- On the first `fill` of cid `x2`: return `place_limit` GTC SELL DOWN @ fill
  price + 0.05 (snap up), size = fill size, cid `x2-exit` (cascading intent).
- Everything else: no intents.

## Params

`{}` — no parameters. Requires no feeds and no plugins.
