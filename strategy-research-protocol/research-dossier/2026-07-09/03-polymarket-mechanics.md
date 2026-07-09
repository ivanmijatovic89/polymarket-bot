# Polymarket Mechanics for BTC 15m Up/Down Markets (as of 2026-07-09)

Research lane 03. Scope: current mechanics of the global Polymarket CLOB (Polygon) that matter for a
bot trading `btc-updown-15m-<epochStart>` markets. Every claim cited; live-API observations from
2026-07-09 are marked **[live probe]**. Confidence flags: **[CONFIRMED]** = official docs or live API;
**[REPORTED]** = secondary sources; **[UNCERTAIN]** = conflicting or unverified — measure before trusting.

---

## 1. Fee structure

### 1.1 Current taker fee schedule (global platform)

- Fees are **taker-only**: "Makers are never charged fees." Fee formula per official docs:
  `fee = C × feeRate × p × (1 − p)` where C = shares traded, p = share price. Fees are computed in
  collateral (USDC/pUSD), applied automatically **at match time by the protocol** — orders no longer
  carry a fee field (see §5 CLOB v2). Rounded to 5 decimals; smallest fee 0.00001. **[CONFIRMED]**
  https://docs.polymarket.com/trading/fees
- Category taker `feeRate` table (docs, July 2026): **Crypto 0.07** (max **$1.75 per 100 shares** at
  p=0.50), Sports 0.03, Finance/Politics/Tech/Mentions 0.04, Economics/Culture/Weather/Other 0.05,
  Geopolitics 0 (fee-free). **[CONFIRMED]** https://docs.polymarket.com/trading/fees
- The 15m/hourly crypto up/down markets fall under the Crypto category — the highest rate — and were
  the **first** markets to get taker fees (Dec 2025), explicitly to blunt latency arbitrage against
  the Chainlink print. **[REPORTED]**
  https://www.tradingview.com/news/cointelegraph:e59c32089094b:0-polymarket-quietly-introduces-taker-fees-on-15-minute-crypto-markets/ ,
  https://www.financemagnates.com/cryptocurrency/polymarket-introduces-dynamic-fees-to-curb-latency-arbitrage-in-short-term-crypto-markets/
- Fee shape: peaks at p=0.5, → 0 toward 0.01/0.99. At crypto rate 0.07: p=0.5 → 1.75¢/share;
  p=0.9 → 0.63¢/share; p=0.98 → ~0.14¢/share. (Derived from the docs formula.)
- **[UNCERTAIN — measure]** Raw market metadata shows `maker_base_fee: 1000, taker_base_fee: 1000`
  (bps-style fields) on the live 15m market **[live probe, CLOB `GET /markets/{conditionId}`]**, while
  the docs table says crypto feeRate 0.07. The v2 migration guide says fee rates are
  operator-determined at match time and should be queried per market via `getClobMarketInfo()`
  (https://docs.polymarket.com/v2-migration). Do not model fees from static fields — **measure
  realized fee per fill from trade reports**, which matches the protocol's "costs are measured, not
  modeled" rule.
- **[UNCERTAIN]** One help-center article implies sell-side taker orders may not be charged
  (https://help.polymarket.com/en/articles/13364478-trading-fees, sports-focused wording); the docs
  formula is side-symmetric. Verify buy vs sell taker fees empirically.
- Historical: secondary sources quote max fees "up to 1.80%" / $0.75–$1.80 per 100 shares from the
  Dec-2025 rollout — treat pre-2026 fee levels as historical, not current.
  https://startpolymarket.com/learn/polymarket-fees/ ,
  https://www.kucoin.com/news/flash/polymarket-introduces-taker-fees-for-15-minute-crypto-prediction-markets

### 1.2 Maker Rebates Program (fee redistribution)

- Taker fees fund a **Maker Rebates Program**: rebate pool = share of taker fees collected, **20% for
  Crypto** (25% for most other categories), distributed **daily** in **pUSD**, minimum $1 accrued to
  be paid. **[CONFIRMED]** https://docs.polymarket.com/market-makers/maker-rebates
- Qualification: place resting orders that **get filled** (your liquidity is taken). Rebate is
  pro-rata by _fee-equivalent of your executed maker volume_ within each market:
  `rebate = (your_fee_equivalent / total_fee_equivalent) × rebate_pool`, with
  `fee_equivalent = C × feeRate × p(1−p)`. Pools are **per market** — you compete only against other
  makers in the same 15-minute market. **[CONFIRMED]**
  https://docs.polymarket.com/market-makers/maker-rebates ,
  https://help.polymarket.com/en/articles/13364471-maker-rebates-program
- Net effect: a maker filled by takers effectively earns back ~20% of the taker fee its fills
  generated (if it's the only maker at that level). This is a **rebate on being filled**, not a quote
  uptime subsidy — no spread/uptime requirement. **[CONFIRMED]** (same sources)

### 1.3 Liquidity Rewards Program (separate program, quote-based)

- The older **Liquidity Rewards** program pays for _resting_ quotes: sampled **every minute**, scored
  by quadratic closeness to the size-adjusted midpoint `S(v,s) = ((v−s)/v)² · b`, two-sided depth
  boosted via Q_min of the two sides; single-sided scoring allowed at 1/c (c=3.0) only when midpoint
  ∈ [0.10, 0.90]; both sides required outside that band; per-market `max_spread` and `min_size`
  cutoffs; paid daily at ~midnight UTC, $1 minimum. **[CONFIRMED]**
  https://docs.polymarket.com/market-makers/liquidity-rewards ,
  https://help.polymarket.com/en/articles/13364466-liquidity-rewards
- On the live BTC 15m market the rewards config exists — `rewards: {min_size: 50, max_spread: 4.5,
rates: null}` **[live probe]** — but `rates: null` suggests **no daily reward pool is currently
  funded on 15m markets**; the paid incentive there is the Maker Rebates share of taker fees.
  **[UNCERTAIN — confirm by checking the rewards dashboard/API for a nonzero rate on a 15m market.]**

### 1.4 Polymarket US (separate venue, for completeness)

- Polymarket US (CFTC-regulated DCM via the $112M QCEX acquisition, July 21 2025; Amended Order of
  Designation Nov 25 2025 enabling intermediated access) runs a **different fee schedule** effective
  **July 1, 2026**: taker `Θ = 0.06` (max $1.50/100 contracts at $0.50), **maker rebate coefficient
  −0.0125** (maker is _paid_ up to $0.31/100 at $0.50), plus retroactive monthly-volume taker rebates
  (10% ≥$250K, 25% ≥$1M, 50% ≥$5M, paid weekly). **[CONFIRMED]** https://docs.polymarket.us/fees ,
  https://www.prnewswire.com/news-releases/polymarket-acquires-cftc-licensed-exchange-and-clearinghouse-qcex-for-112-million-302509626.html ,
  https://www.prnewswire.com/news-releases/polymarket-receives-cftc-approval-of-amended-order-of-designation-enabling-intermediated-us-market-access-302625833.html
- The global-platform 15m markets are flagged `restricted: true` **[live probe]**. Our bot trades the
  global Polygon CLOB; the US venue matters only if the strategy is ever ported there (different
  fees, direct maker rebates).

---

## 2. CLOB mechanics

### 2.1 Order types, sizes, ticks

- Order types: **GTC**, **GTD** (expires; engine enforces expiry ≥ ~1 min safety margin and rejects
  expirations within 10s), **FOK** (fill entirely or cancel), **FAK** (fill available, cancel rest).
  Market-order semantics: BUY specified in dollars, SELL in shares. **Post-only** flag exists for
  GTC/GTD (rejected if it would cross); incompatible with FOK/FAK. **[CONFIRMED]**
  https://docs.polymarket.com/trading/orders/overview
- Minimum sizes: live BTC 15m market has `minimum_order_size: 5` shares **[live probe]**. Community
  docs additionally report a **$1 minimum notional for marketable orders** (FOK/FAK or crossing
  buys). **[REPORTED — verify]** https://github.com/Polymarket/agent-skills/blob/main/order-patterns.md
- Tick size: live BTC 15m market `minimum_tick_size: 0.01` at mid prices **[live probe]**. Tick
  regimes of 0.1/0.01/0.001/0.0001 exist platform-wide; the long-standing rule is the tick tightens
  **0.01 → 0.001 when price goes above 0.96 or below 0.04**, and the market websocket emits
  `tick_size_change` events. **[REPORTED for the boundary rule; the event type is CONFIRMED]**
  https://docs.polymarket.com/market-data/websocket/market-channel ,
  https://nautilustrader.io/docs/latest/integrations/polymarket/ ,
  https://polyarb-navy.vercel.app/glossary/tick-size
  **[UNCERTAIN whether the boundary tick change actually fires on 15m markets in their final
  seconds — must be confirmed from our own recorded stream; it matters a lot for endgame quoting.]**
- "Always fetch the market's tick size before quoting rather than assuming a value." **[CONFIRMED]**
  https://docs.polymarket.com/trading/orders/overview

### 2.2 Matching, priority, price improvement

- Off-chain matching engine, on-chain settlement (Polygon, CTF Exchange v2 since Apr 28 2026).
  Matching is **price-time priority**. **[REPORTED — consistent across sources]**
  https://docs.polymarket.com/concepts/order-lifecycle ,
  https://polymarkets.co.il/en/guide/order-book-guide/
- **Price improvement goes to the taker**: a crossing order executes at the resting order's price
  (buy limit 0.55 vs resting ask 0.52 fills at 0.52). A resting maker never gets improved beyond its
  own price but stays maker-classified. **[REPORTED]**
  https://polymarkets.co.il/en/guide/order-book-guide/ ,
  https://www.tradetheoutcome.com/polymarket-taker-vs-maker-which-order-type-should-you-use/
- Trade lifecycle statuses: MATCHED → MINED → CONFIRMED (or RETRYING → FAILED) — fills are not
  final until on-chain confirmation; a bot must handle FAILED trades. **[CONFIRMED]**
  https://docs.polymarket.com/trading/orders/overview

### 2.3 Binary complement, mirrored books, split/merge

- Each market = one CTF condition with two ERC-1155 outcome tokens (Up, Down); each pays $1 (pUSD)
  if correct. `negRisk: false` on 15m markets **[live probe]** — the negRisk adapter (NO→YES
  conversion in mutually-exclusive multi-outcome sets) does **not** apply here; plain binary CTF
  does. https://github.com/Polymarket/neg-risk-ctf-adapter
- **The two books are one book mirrored**: buying UP at p is the same order as selling DOWN at 1−p.
  Live probe showed UP bid 0.63×330.11 with DOWN ask 0.37×330.11 (identical size) — best-ask sum
  1.01, best-bid sum 0.99, i.e. a single 1-tick spread expressed twice. **[live probe, CONFIRMED]**
  The matching engine can also match two sells (or two buys) of complementary tokens against each
  other by **merging/splitting** $1 collateral. https://yzc.me/x01Crypto/decoding-polymarket
- **Split/Merge**: 1 pUSD ⇄ (1 UP + 1 DOWN) at any time before resolution via the CTF contract —
  no trading fee, gas only (relayer-abstracted for Polymarket accounts). **[CONFIRMED]**
  https://docs.polymarket.com/developers/CTF/merge ,
  https://startpolymarket.com/learn/splitting/

---

## 3. Resolution mechanics (BTC 15m)

- Exact rule, verbatim from the live market **[live probe, Gamma API]**: _"This market will resolve
  to 'Up' if the Bitcoin price at the end of the time range specified in the title is **greater than
  or equal to** the price at the beginning of that range. Otherwise, it will resolve to 'Down'. The
  resolution source for this market is information from Chainlink, specifically the BTC/USD data
  stream available at https://data.chain.link/streams/btc-usd. Please note that this market is about
  the price according to Chainlink data stream BTC/USD, not according to other sources or spot
  markets."_
  - **Tie/exact-equal close ⇒ UP wins.** UP carries a one-sided micro-edge at zero net move.
  - Reference is the **Chainlink Data Streams BTC/USD** report at window start and end — _not_
    Binance spot, _not_ an average. Divergence between Chainlink aggregate and any single exchange
    feed is resolution-relevant noise.
- Oracle stack: **Chainlink Data Streams** (low-latency signed price reports) + **Chainlink
  Automation** triggering on-chain resolution at the preset end time — no UMA, no dispute window on
  these markets; settlement is near-instant after window close. **[REPORTED, multiple sources]**
  https://www.theblock.co/post/370444/polymarket-turns-to-chainlink-oracles-for-resolution-of-price-focused-bets ,
  https://cryptoslate.com/polymarket-just-made-bitcoin-bets-settle-instantly-with-chainlink-upgrade/ ,
  https://www.prnewswire.com/news-releases/polymarket-partners-with-chainlink-to-enhance-accuracy-of-prediction-market-resolutions-302555123.html
- Series launched **Oct 21, 2025** (15m); a **5-minute series (`btc-updown-5m-<epoch>`) also exists**
  **[live probe]**. https://www.cryptopolitan.com/polymarkets-15-minute-up-down/ ,
  https://coinmarketcap.com/academy/article/polymarket-debuts-5-minute-bitcoin-prediction-markets-with-instant-settlement
- Slug arithmetic **[live probe]**: `<epochStart>` = unix seconds of the **window start**, aligned to
  900s (15m) / 300s (5m). Order acceptance opens well before the window (observed
  `accepting_orders_timestamp` ~24h ahead for the probed market).
- Polymarket exposes both **Binance and Chainlink** real-time price feeds over its Real-Time Data
  Socket (Chainlink requires a sponsored key). Recording both is the way to measure the
  Chainlink-vs-exchange gap that resolution depends on. **[CONFIRMED]**
  https://docs.polymarket.com/developers/RTDS/RTDS-crypto-prices
- **[UNCERTAIN — measure]** Redemption timing: resolution is automated and fast, but whether winning
  shares are auto-converted to pUSD or require a redeem transaction (relayer-sponsored) determines
  capital velocity between consecutive windows. Sources say traders gain "faster access to winnings"
  (https://www.bankless.com/read/polymarket-integrates-chainlink-to-automate-resolutions) but the
  exact redeem latency for API accounts must be measured on-chain.
- **[UNCERTAIN]** Which exact Data Streams report timestamp defines "start"/"end" price (first report
  ≥ boundary? last report ≤ boundary?) is not published in the market description. Measurable by
  recording the Chainlink stream and comparing with realized resolutions.

---

## 4. 2025–2026 change log relevant to this bot

| Date        | Change                                                                                                                                                                                                                                                                                                          | Source                                                                                                                                                                                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2025-07-21  | QCEX acquisition ($112M) → US re-entry path                                                                                                                                                                                                                                                                     | https://www.prnewswire.com/news-releases/polymarket-acquires-cftc-licensed-exchange-and-clearinghouse-qcex-for-112-million-302509626.html                                                                                                                                   |
| 2025-09/10  | Chainlink partnership; Data Streams + Automation resolution for price markets                                                                                                                                                                                                                                   | https://www.prnewswire.com/news-releases/polymarket-partners-with-chainlink-to-enhance-accuracy-of-prediction-market-resolutions-302555123.html                                                                                                                             |
| 2025-10-21  | 15-minute crypto up/down series launched (BTC/ETH/SOL/XRP)                                                                                                                                                                                                                                                      | https://www.cryptopolitan.com/polymarkets-15-minute-up-down/                                                                                                                                                                                                                |
| 2025-11-25  | CFTC Amended Order → Polymarket US intermediated access                                                                                                                                                                                                                                                         | https://www.prnewswire.com/news-releases/polymarket-receives-cftc-approval-of-amended-order-of-designation-enabling-intermediated-us-market-access-302625833.html                                                                                                           |
| 2025-12     | First taker fees, on 15m crypto markets only; anti-latency-arb rationale; maker rebates funded from them                                                                                                                                                                                                        | https://www.tradingview.com/news/cointelegraph:e59c32089094b:0-polymarket-quietly-introduces-taker-fees-on-15-minute-crypto-markets/                                                                                                                                        |
| 2026-02-18  | Fees extended (NCAAB, Serie A); rebates recomputed **per market**                                                                                                                                                                                                                                               | https://docs.polymarket.com/changelog                                                                                                                                                                                                                                       |
| 2026-03-30+ | Sports-wide fees for new markets; category fee table generalized                                                                                                                                                                                                                                                | https://help.polymarket.com/en/articles/13364478-trading-fees                                                                                                                                                                                                               |
| 2026-04-28  | **CLOB v2 + CTF Exchange V2 + pUSD**: 1h downtime, all resting orders wiped; EIP-712 domain v2, new verifying contract; Order struct drops `taker/expiration/nonce/feeRateBps`, adds `timestamp/metadata/builder`; fees operator-set at match time; collateral now pUSD (ERC-20, 1:1 USDC-backed); v1 SDKs dead | https://docs.polymarket.com/v2-migration , https://help.polymarket.com/en/articles/14762452-polymarket-exchange-upgrade-april-28-2026 , https://www.coindesk.com/markets/2026/04/06/polymarket-reveals-a-full-exchange-upgrade-to-take-control-of-its-own-trading-and-truth |
| 2026-07-01  | Polymarket US fee schedule effective (Θ=0.06 taker, −0.0125 maker, volume rebates)                                                                                                                                                                                                                              | https://docs.polymarket.us/fees                                                                                                                                                                                                                                             |

Operational consequences: (a) any historical data recorded pre-2026-04-28 spans a full exchange
migration — order-book behavior, fees, and collateral differ across that boundary; (b) bots must use
v2 order signing and treat fee rates as dynamic per-market values; (c) expect further fee-schedule
drift — re-measure fees whenever the changelog moves.

---

## 5. Ranked structural / mechanical opportunities

Ranked by (edge size × confidence) / risk. These are mechanism plays, not directional signals.

**1. Maker-rebate-aware spread capture (quote both sides, never cross).**
Mechanism: taker fee at mid-range prices is ~1.75¢/share on crypto while makers pay zero and
recover ~20% of the taker fee their fills generate, per market
(https://docs.polymarket.com/trading/fees, https://docs.polymarket.com/market-makers/maker-rebates).
A two-sided maker earning the 1-tick spread (1¢ observed live) plus rebate competes against takers
paying up to 1.75¢ — the fee wall is a moat for makers. Data to confirm: our recorded stream gives
fill rates at top-of-book, realized adverse selection vs the Chainlink print, and realized rebate
per $ of maker volume (paid daily, observable on-chain in pUSD). Risks: adverse selection near
window end (informed takers hitting stale quotes as the Chainlink print becomes predictable);
rebate pool is shared pro-rata so crowding shrinks it; inventory ends as a binary payout unless
merged/flattened.

**2. Complement-pair completion via split/merge (fee-free inventory conversion).**
Mechanism: 1 pUSD ⇄ 1 UP + 1 DOWN at zero trading fee (https://docs.polymarket.com/developers/CTF/merge).
Whenever combined maker fills leave you long both legs, merging returns collateral instantly; and
quoting _both_ books' bids (UP bid at b, DOWN bid at 1−b−spread) is a synthetic spread trade whose
completed pairs need no exit trade at all. The classic "UP+DOWN asks < $1" free lunch is mostly
mirrored away (live probe: books are exact mirrors, ask sum 1.01), so the realistic version is
_being the resting side that completes pairs_, not crossing. Data to confirm: recorded book already
shows both legs; measure frequency of both-sides fills within one window and merge gas/latency.
Risks: legging (one side fills, the other doesn't → naked binary exposure into resolution);
merge/relayer latency near window close.

**3. Tie-rule micro-edge (equal-close resolves UP).**
Mechanism: resolution is `end ≥ start ⇒ UP` [live probe verbatim]. P(exact tie on the Chainlink
report) is small but strictly positive (discrete price grid, quiet minutes), so fair value of UP =
P(up) + P(tie), yet the market has no structural reason to price the asymmetry; any time UP and DOWN
trade symmetrically around 0.50 the UP side is cheap by P(tie). Data to confirm: from recorded
Chainlink stream, count exact-equal 15m closes at report precision (tick data → empirical P(tie));
compare with traded mid symmetry. Risks: edge may be < fees/spread (then it only tilts maker skew,
not taker trades); P(tie) depends on the stream's decimal precision — measure, don't assume.

**4. Boundary tick-regime asymmetry in the endgame.**
Mechanism: if/when the tick tightens 0.01→0.001 beyond 0.96/0.04
(https://docs.polymarket.com/market-data/websocket/market-channel — `tick_size_change` events;
boundary values community-documented), the last minutes of decided windows allow 0.1¢ quoting where
taker fees are also near zero (p(1−p) → 0.03–0.04 of peak). Queue priority on the coarse grid just
_before_ the switch, and fast re-quoting just _after_, are both mechanical advantages. Data to
confirm: does `tick_size_change` fire on 15m markets in our recorded stream, and what do endgame
books look like on the fine grid? Risks: rule not officially confirmed for these markets; endgame
fills at 0.97–0.99 are exactly where a late Chainlink swing is most expensive (small gain, large
tail loss).

**5. Redemption/capital-velocity optimization across consecutive windows.**
Mechanism: settlement is Chainlink-automated and near-instant
(https://cryptoslate.com/polymarket-just-made-bitcoin-bets-settle-instantly-with-chainlink-upgrade/);
a new window opens every 15 minutes (5m series: every 5). If winning collateral is usable within
seconds, the same bankroll can compound ~96 windows/day; if redemption lags minutes, effective
capital halves. Also: merging (opportunity 2) _before_ resolution returns collateral without waiting
for the oracle at all. Data to confirm: on-chain timestamps from resolution tx to spendable pUSD for
our own test fills. Risks: none directional — purely operational; but mis-measuring it inflates
every other strategy's simulated Sharpe.

**6. Rebate-pool concentration monitoring (choose _which_ windows to make).**
Mechanism: rebates are computed **per market** (https://docs.polymarket.com/market-makers/maker-rebates),
and 15m markets are many small pools — a window with high taker volume and few active makers pays a
disproportionate rebate per $ quoted. Probed market: $4.4K volume, ~$7.8K book liquidity in one
window [live probe]. Data to confirm: per-window taker volume distribution from recorded trades; our
own share of maker fills. Risks: it's an allocation overlay, not standalone edge; volume clusters in
volatile windows where adverse selection is also worst.

**Not viable as a standing edge:** crossing "UP ask + DOWN ask < $1" — the books are a single
mirrored spread [live probe: ask sum 1.01], so sub-$1 ask sums can only appear transiently during
order placement/cancel races, and the crypto taker fee (2 legs × up to 1.75¢) eats gaps smaller than
~3.5¢. Worth a passive detector in the recorded stream to quantify frequency before spending any
engineering on it.
