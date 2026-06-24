# Context — the game we are playing

Every worker reads this. It is deliberately tiny: just enough to reason. For
depth, follow the pointers — do not restate them here.

- **Venue:** Polymarket CLOB (binary prediction market). Each market has a YES
  and a NO token; `YES_price + NO_price = 100¢` always. Winner pays 100¢.
- **Instrument:** crypto **15-minute UP/DOWN** markets — BTC, ETH, SOL, XRP.
  "Will the price be higher or lower at the end of the 15m window than at the
  start?" Resolves at window end.
- **Data available in backtest:** recorded **orderbook ticks only** (deterministic
  replay). **No spot price / external feed** — if an idea needs one, it can't be
  tested yet (capture it as a `blocked` family).
- **Costs are real:** maker/taker fees + latency are simulated. An edge must
  survive them. Always watch **GROSS** (is there an edge at all?) separately from
  **net** (does it survive cost?).
- **Live/backtest invariant:** the same strategy logic runs on the same tick
  stream live and in backtest. Any divergence is a bug. See `CONSTRAINTS.md`.

Pointers (read only if you need depth):

- The market mechanics: `docs/key-concepts.md`
- Replay / the three modes: `docs/how-it-works.md`
- Commands, fees, fill model, dataset: `CLAUDE.md`
- What's already proven dead: the lessons in each family's `FAMILY.md`
  (BTC 15m order-book timing / calibration / imbalance / favorite-underdog are
  all proven sub-cost — don't re-propose them).
