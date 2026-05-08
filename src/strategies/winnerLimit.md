# winnerLimit strategy

Minimal one-shot strategy for backtest debugging.

## Behavior

- Watches a **2-outcome market** (two `assetId`s / CLOB token IDs).
- Waits **10 minutes** from the **first market tick observed**.
- Tracks whether each token’s price has **ever crossed above** `triggerPrice`.
- When at least one token is **currently above** `triggerPrice`, it selects the token with the **higher price** (higher implied win probability) and submits **exactly one** order total:
  - **BUY LIMIT (`GTC`) @ `limitPrice`**
- No cancels, no retries, no sells, no hedging.

Prices in this codebase are **0..1** (so 0.90 = “90c”).

## Env config

Set:

- `STRATEGY=winnerLimit`
- `STRAT_SIZE=5`

Optional:

- `STRAT_ASSET_ID_A=<tokenIdA>`
- `STRAT_ASSET_ID_B=<tokenIdB>`
  - If omitted, the strategy picks the first two asset IDs it sees in the snapshot.
- `STRAT_TRIGGER_PRICE=0.90`
  - Strategy only acts after a token has crossed above this (and is currently above it).
- `STRAT_LIMIT_PRICE=0.90`
  - Limit price used for the BUY. If omitted, defaults to `STRAT_TRIGGER_PRICE`.
- `STRAT_MIN_DELAY_MS=600000`
  - Default 10 minutes.
- `STRAT_DEBUG=true`

## Notes

- The emitted order uses a stable client id: `winnerLimit:buy`.
- If you rerun a backtest, this helps you see exactly when the first order gets submitted.
