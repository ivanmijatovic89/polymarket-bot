# Dataset

- Source: `telonex` datasets only, converter `delta-typed`
  (`--input-mode telonex-delta`)
- Read mode: `--read-from local-or-download-from-r2-to-local`
- Symbol: Bitcoin (btc) — slugs `btc-updown-15m-*`
- Timeframe: 15 min
- **Telonex eligible from: 2025-12-01T00:00:00Z** (the
  `TELONEX_DATASET_ELIGIBLE_FROM` floor; the series itself is recorded since
  2025-10-11, but markets below the floor are excluded from the universe)
- Feed coverage — matters ONLY for variants that declare the feed:
  - **Binance aggTrades (BTCUSDT): from 2025-11-29** — covers the full
    eligible universe
  - **priceToBeat: from 2026-02-18 23:45** (15m btc recording epoch; markets
    before it have no key)
  - **Chainlink (crypto_prices): from 2026-04-02** — hard error on any
    market before that date
- **Universe rule**: a variant that declares NO external feeds backtests the
  full eligible universe (≥ 2025-12-01). Declaring priceToBeat shrinks it to
  ≥ 2026-02-18 23:45; declaring chainlink shrinks it to ≥ 2026-04-02. The
  core pair-discount edge is visible in the order books alone — prefer
  book-only variants unless a feed provably adds edge (evidence required).


# Strategy Rubics
In this section i will define all rubics each strategy must follow:


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

