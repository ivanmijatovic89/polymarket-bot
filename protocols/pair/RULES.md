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

# Strategy
## Strategy Description
Strategy pokusava da kupi obe shares i UP i DOWN ali da njihova ukupna cena bude manja od $1 sa ukljucenim fees. tako da moze da se uradi merge i da se zaradi od razlike.
Primer 500 UP shares at avg price 0.32 + 500 DOWN share at avg price 0.64 = avg pair price 0.96 ( after fees) i kada se uradi merge zaradi se 500 * 0.04 = 20 USDT

Strategy ne treba da kupi odjednom po 500 shares, nego treba da kupuje malo jednu stranu, malo drugu stranu i tako da imabalance bude mali i i da rizik bude mali.

Strategy ne sme da bude latency depended... Mnogi drugi botovi koriste brze sisteme i bolje od mog, kada sam radio research video sam da profitabilni botovoi koji koriste ovu strategiju nisu latecy dependable. Izvrse jedan trade sada pa nakon nekoliko sekundi drugi itd... znai mora da prezivi da ne bude vezana za backtest latency kako je namesten.


## Strategy Rubics
In this section i will define all rubics strategy must follow:
1. we only BUY, we do not SELL
2. we build only for Bitcoin 15 min
3. we merge only once per market (in market or after market)
4. All accounting is FEE-INCLUSIVE: maker fills cost $0 in fees; every
   taker fill budgets the full 0.07·p·(1−p)/share curve (we are tier-0,
   no fee refunds). A pair is "below $1" only after fees.
5. Exits are merge and redeem only (follows from rule 1: no sells, ever).


# Trading Rubics
- Not latency dependent — operational definition: a variant must be
  profitable at the measured live latency (~140 ms) and must not collapse
  as latency INCREASES (the standard eval sweeps latency upward).

# Backtesting

- Every backtest run must set `BACKTEST_LATENCY_DELAY` explicitly and record
  it with the run. A run whose latency came from the ambient `.env` is not
  evidence — pin it per run.
- Canonical run:

  ```bash
  npm run backtest -- --strategy <id> --input-mode telonex-delta \
    --read-from local-or-download-from-r2-to-local --symbol btc --timeframe 15m \
    --from-ms 1775001600000   # 2026-04-02 protocol floor
  ```

## Backtesting Speed
- market speed: ~1.5 s per market per worker slot (older anchor measurement —
  re-verify once before relying on it for planning)
- fleet speed: ~22 active slots ⇒ the full protocol universe
  (≥ 2026-04-02 ≈ 11k markets, growing ~96/day) replays in roughly 15 min
  end-to-end when the fleet is idle

## Distributed Backtesting (Fleet)
Backtests are submitted to the BullMQ fleet (never run locally on the
producer). Active workers (ansible inventory):

| Machine | Chip | Backtest slots | Queues |
|---------|------|----------------|--------|
| worker-1 | Mac mini M4 | 8 | markets + aggregate |
| worker-2 | Mac mini M4 | 8 | markets |
| m1-milan | M1 | 6 | markets |

- m5-milan (12 slots) exists but is currently disabled in the inventory.
- m1-ivan (M1 Pro, 4 slots) is the PRODUCER and live-trading machine — models
  never run backtest workers on it.
- Workers self-update from origin/main and run committed code only (jobs are
  gated on the producer's commit SHA — push before submitting).

