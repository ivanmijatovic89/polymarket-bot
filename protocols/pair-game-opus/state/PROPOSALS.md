# Proposals — Pair Game Opus

Engine blockers may be recorded here with a minimal reproduction. They do not
permit edits outside the protocol.

---

## P-001 — The shared risk gate caps any outcome position at 2,000 shares, so every quantity-3,000 level is unreachable

**Status:** resolved by human ruling on 2026-08-03. The 3,000-share rung was
removed, 1,000 is now the maximum, and no shared risk-limit change is needed.
The analysis below is retained as historical evidence.

**What blocks:** `src/trading/riskLimits.ts` hardcodes

```
DEFAULT_RISK_LIMITS = { maxOpenOrders: 20, maxOrderSize: 2000, maxAbsPosition: 2000, maxLossStop: 500 }
```

and `src/trading/OrderManager.ts` calls `enforceRiskLimits({ nowMs, intents, portfolio })`
at both call sites (lines 111 and 138) **without** a `limits` argument. There is no
env var, constructor option or strategy-visible seam — those four numbers are the
only limits that exist, live and in backtest.

`maxOrderSize` rejects a single order larger than 2,000 shares, and
`maxAbsPosition` rejects any order whose projected resulting position exceeds
2,000 shares of one asset. LEVELS.md requires final holdings of 3,000 UP **and**
3,000 DOWN.

**Why no player change can work around it.** RULES let the player buy UP, buy
DOWN, cancel, do nothing, hold/merge/redeem — and forbid selling. Conditions 1
and 2 are about *final* holdings, so the 3,000 shares must be held at the end:

- one big order → `risk_max_order_size`;
- chunked orders → the chunk that would cross 2,000 hits `risk_max_abs_position`;
- merging *reduces* holdings, and RULES already say backtests emit no merge intents;
- selling is forbidden;
- `split_positions` is not in the RULES list of legal player actions, and would
  acquire a pair at exactly 1.00 anyway — above the 0.98 ceiling. (The evaluator
  now fails any run with `split_cost != 0` so this stays closed.)

**Minimal reproduction** (no database, no network, no backtest):

```
tsx protocols/pair-game-opus/tools/repro-risk-cap.ts
```

```
DEFAULT_RISK_LIMITS = {"maxOpenOrders":20,"maxOrderSize":2000,"maxAbsPosition":2000,"maxLossStop":500}

flat, single order at the cap                  held=0     buy=2000  ALLOWED
flat, single order one share over the cap      held=0     buy=2001  BLOCKED risk_max_order_size(max=2000)
flat, one order the size a level-5 leg needs   held=0     buy=3000  BLOCKED risk_max_order_size(max=2000)
holding 2000, top up by one share              held=2000  buy=1     BLOCKED risk_max_abs_position(max=2000)
holding 2000, top up in a legal-size chunk     held=2000  buy=1000  BLOCKED risk_max_abs_position(max=2000)
```

**Confirmed end-to-end on the level-1 market** (`btc-updown-15m-1775088000`,
same player, same config, only `qty` changed):

| run | qty | trades | pnl |
|---:|---:|---:|---:|
| 1077 | 2000 | 2 | 60.00 |
| 1078 | 2001 | 0 | 0.00 |
| 1076 | 3000 | 0 | 0.00 (Level 5 attempt) |

**What would unblock it** — a shared-`src/` change, which this protocol may not
make:

1. Raise `maxOrderSize` and `maxAbsPosition` to at least 3,000 (3,500 would leave
   headroom for repricing overlap), **or**
2. give `OrderManager` an optional `limits` option and let the backtest CLI pass
   it, so the cap becomes a per-run decision rather than a global constant.

Option 1 is the smaller change. `maxOpenOrders` (20) and `maxLossStop` (500) do
not need to move: this player keeps at most two live orders and never sells, so
realized PnL stays at 0 all window.

**Scale note for whoever decides:** a 3,000-share pair costs roughly $2,900 of
working capital per market, so the same change also raises the notional a live
bot could commit in one window. That is a risk decision, not just a constant.

---

## P-002 — A cancel that overtakes its own order is dropped silently, with no terminal event

**Status:** worked around inside the player on 2026-08-03; no shared change is
required. Recorded because the hazard is generic and any strategy that tracks
its own open orders can hit it.

**What happens.** `BacktestExecution.cancelOrderNow`
(`src/trading/execution/BacktestExecution.ts:567`) looks the order up in
`openByClientId` and, when it is not there, returns `{ events: [] }` — an
explicit no-op. Place and cancel are both queued through `computeExecuteAtMs`,
which adds the configured latency plus **independent** symmetric jitter. RULES
pin that at 140 ms ± 20 ms, so a cancel issued on the tick after its own place
can be scheduled up to 40 ms *earlier* than the place it refers to. It then
arrives at an empty book, is dropped, and the place lands afterwards.

**Why it matters.** The strategy has emitted a cancel and will never receive
`order_done` or `order_rejected` for it. If it tracks "one live order per
outcome" — which RULES require — that slot is occupied forever and the leg stops
trading for the rest of the window. Observed directly: the DOWN leg of
`btc-updown-15m-1775092500` sat on a stale 0.47 bid while its own target climbed
to 0.76, and finished the market at 400 of 1,000 shares. Across 20-run samples
this was the single largest source of run-to-run variance, and it was invisible
in the persisted rows — the market simply looks like a strategy that stopped.

**Player-side workaround (shipped).** Track `order_open` and send a cancel only
for an acknowledged order; re-send a cancel that produces no terminal event
within 2 s. Waiting for the acknowledgement costs one tick and makes the
overtake impossible, because an order that is open has provably already landed.

**What would remove the hazard for everyone** — a shared-`src/` change, which
this protocol may not make: have `cancelOrderNow` emit a terminal event for an
unknown `clientOrderId` (an `order_rejected` with reason `unknown_order` would
do), so a cancel always resolves. Alternatively, execute a queued cancel no
earlier than the place for the same `clientOrderId`.
