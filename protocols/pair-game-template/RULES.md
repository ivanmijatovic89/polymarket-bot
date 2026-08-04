# Rules — Pair Game Template

These rules are immutable. The player may change; the game may not.

## Market

- BTC 15-minute UP/DOWN markets only.
- Telonex delta datasets from 2026-04-02 onward.
- Markets are ordered chronologically. “First N markets” always means the
  first N eligible markets from that fixed floor.
- Live latency is always simulated at 140 ms with 20 ms jitter.

## What the player may observe

- The live UP and DOWN order books and their tick history.
- Price to beat.
- Binance BTC price.
- Chainlink BTC price.
- Time remaining in the market.
- Its own cash, inventory, open orders, acknowledgements and fills.

It may derive features from this information. It may never use resolution,
future ticks, future prices, future fills or any other information unavailable
at the same instant in live trading.

## What the player may do

- Place a BUY order for UP with a chosen price, size and supported time in
  force.
- Place a BUY order for DOWN with a chosen price, size and supported time in
  force.
- Cancel its own orders.
- Do nothing.
- Hold, merge matched inventory where supported, and redeem at settlement.

It may never sell outcome shares. Backtests value pairs at settlement and do
not emit merge intents because the simulator cannot account for mid-market
merges correctly.

## A passing market

For a target of `Q` shares, one market passes only when all are true:

1. Final UP shares are at least `Q`.
2. Final DOWN shares are at least `Q`.
3. At least `Q` shares are therefore matched.
4. The fee-inclusive average acquisition cost of one matched UP/DOWN pair is
   at most `0.98`.
5. Total settlement PnL for the market is positive after all fees and after
   counting every unmatched share.
6. Rebates and rewards are counted as zero.

The `0.98` threshold is the combined cost of UP plus DOWN, not the price of
either individual share.

## Integrity

- The same strategy logic and parameter configuration must play every market
  in a level.
- A level passes only if every included market passes.
- Previously passed levels remain regression gates.
- Strategy logic may not branch on an exact slug, market timestamp, dataset
  row number or known historical outcome.
- Only completed persisted backtest results count as evidence.
- The agent may freely change strategy structure and parameters while trying
  to pass the current level.
- The agent may not alter `README.md`, `RULES.md`, `LEVELS.md` or `missions/`.

## Workspace and parity

- Write only inside `protocols/pair-game-template/`.
- Strategy ids must start with `pair-game-template-`.
- Shared `src/` is read-only. Record engine blockers in
  `state/PROPOSALS.md`.
- Run `npm run protocol:check -- pair-game-template` before pushing strategy code.
- Live and backtest must use the same strategy logic and tick semantics.
- Commit messages start with `pair-game-template:` and changes are pushed to
  `origin/main` before fleet submission.
