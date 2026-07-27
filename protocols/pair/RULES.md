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
5. Leg imbalance is a controlled, swept risk knob (from strict parity up
   to ~40%), never unbounded — and cheap-side excess is capped tighter
   than favorite-side excess.
6. Never-overpay guards go on PLACEMENT (the pair you build), never on
   COMPLETION (the pair you rescue).
7. Exits are merge and redeem only (follows from rule 1: no sells, ever).


# Trading Rubics
- Not latency aware strategy
- Not latency dependent — operational definition: a variant must remain
  profitable at BOTH 0 ms and 140 ms+ simulated latency (the latency
  battery). Requote churn is the known killer: at 140 ms it multiplies
  fills ~8× and converts ~34% into fee-paying taker fills — quote
  stability is a design axis, not an execution detail.
- Hour-of-day and minute-of-window are ALLOWED policy variables (measured
  edge concentrates in minutes 10–13 and, for passive quoting, in the
  20–24Z weekday session; the US session 12–19Z is adverse for it).

# Backtesting

- The simulator admits only ~44–49% of real-world fills (worst_queue
  maker model): backtests are a LOWER BOUND and a screening tool;
  promotion-grade validation requires walk-forward + the live probe.
- Never compare or pool results across fee eras (our dataset floor
  2026-04-02 already guarantees single-era data — keep it that way).

## Backtesting Speed
market speed:
fleet speed:

## Distributed Backtesting (Fleet)
Currently we have:
- worker-1
- worker-2
- m1-milan
- m1-ivan

