# Dataset

- Source: `telonex` datasets only, converter `delta-typed`
  (`--input-mode telonex-delta`)
- Read mode: `--read-from local-or-download-from-r2-to-local`
- Symbol: Bitcoin (btc) — slugs `btc-updown-15m-*`
- Timeframe: 15 min
- **Telonex eligible from: 2025-12-01T00:00:00Z** (the
  `TELONEX_DATASET_ELIGIBLE_FROM` floor; the series itself is recorded since
  2025-10-11, but markets below the floor are excluded from the universe)
- Feed coverage for THIS symbol/timeframe (btc 15m) — matters ONLY for
  variants that declare the feed:
  - **Binance aggTrades (BTCUSDT): from 2025-11-29** — covers the full
    eligible universe
  - **priceToBeat: from 2026-02-18 23:45** — the recording epoch of the
    btc 15m series specifically (other series have their own epochs);
    markets before it have no key
  - **Chainlink (crypto_prices, btcusd): from 2026-04-02** — coverage start
    for all symbols incl. btcusd; hard error on any market before that date
- **Protocol universe floor: ≥ 2026-04-02.** This protocol backtests only
  markets from 2026-04-02 onward — 4+ months of data (Apr, May, Jun, Jul, …,
  growing by ~96 new markets/day). Rationale: this market changes fast, so
  recent months carry the signal; going further back adds volume, not
  insight — we may not even need all 4 months, but we never need anything
  before this date. Convenient side effect: from this floor, ALL external
  feeds (Binance, priceToBeat, Chainlink) are fully covered, so declaring a
  feed never shrinks the universe.

# Strategy Rubics
In this section i will define all rubics strategy must follow:
1. we


# Trading Rubics
- Not latency aware strategy

# Backtesting

## Backtesting Speed
market speed:
fleet speed:

## Distributed Backtesting (Fleet)
Currently we have:
- worker-1
- worker-2
- m1-milan
- m1-ivan

