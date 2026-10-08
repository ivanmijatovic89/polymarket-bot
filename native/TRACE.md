# Canonical parity trace (JSONL)

Both engines write this format for one market so traces can be diffed. One JSON
object per line, in engine processing order. Numbers are plain decimals
(prices/sizes/USDC as JSON numbers). Assets are written as outcome index
`0` (UP/YES, first token) or `1` (DOWN/NO), never as token ids.

```jsonc
// a strategy tick (book/price_change or opted-in synthetic feed tick)
{"t":"tick","seq":17,"ts":1780272001234,"cause":"price_change"}
// intents returned by a callback; src = "tick" | "account"
{"t":"intent","seq":17,"src":"tick","kind":"place_limit","cid":"x1","asset":0,"side":"BUY","price":0.53,"size":10,"orderType":"GTC","postOnly":true,"expireAtMs":null}
{"t":"intent","seq":17,"src":"tick","kind":"place_batch","orders":[{...same fields as place_limit...}]}
{"t":"intent","seq":17,"src":"tick","kind":"cancel_order","cid":"x1"}
{"t":"intent","seq":17,"src":"tick","kind":"cancel_batch","cids":["x1","x3"]}
{"t":"intent","seq":17,"src":"tick","kind":"cancel_market","asset":0}
{"t":"intent","seq":17,"src":"tick","kind":"cancel_all"}
{"t":"intent","seq":17,"src":"tick","kind":"split_positions","size":10}
{"t":"intent","seq":17,"src":"tick","kind":"merge_positions","size":5}
// account events delivered to the strategy
{"t":"event","seq":17,"kind":"fill","ts":1780272001234,"cid":"x2","asset":1,"side":"BUY","price":0.47,"size":5,"fee":0.0617,"liquidity":"TAKER"}
{"t":"event","seq":17,"kind":"order_done","ts":...,"cid":"x2","reason":"filled","filledSize":5}
{"t":"event","seq":17,"kind":"order_rejected","ts":...,"cid":"x5","reason":"..."}
{"t":"event","seq":17,"kind":"positions_split","ts":...,"size":10,"cost":10}
// last line: per-market result (the marketStats object of RunSingleMarketOutput)
{"t":"final","stats":{...}}
```

Rules:

- `seq` = index of the strategy tick (0-based) the record belongs to.
- Account events: emit `order_submitted`, `order_accepted`, `order_rejected`,
  `order_open`, `order_done`, `fill`, `cancel_failed`, `positions_split`,
  `split_failed`, `positions_merged`, `merge_failed`. Exchange order ids and
  fill ids are omitted (they differ by construction).
- Rejection `reason` strings are compared loosely (both must reject; text may differ).
- Diff tolerance: 1e-6 on prices, sizes, USDC, PnL. Everything else exact.
