# VENUE-MECHANICS — verified venue facts for crypto up/down series

Living file (workstream B). Every claim tagged and sourced. Last update:
2026-07-17 (session 1).

## Fee schedule — NOW (pulled 2026-07-17)

- Formula: `fee = C × feeRate × p × (1 − p)` (C = shares, p = price),
  charged to TAKERS only; "makers are never charged fees". Fee peaks at
  p=0.5, →0 toward 0/1. Rounded to 5 decimals, min charge 0.00001 USDC.
  **[verified]** — https://docs.polymarket.com/polymarket-learn/trading/fees
- Category rates (taker feeRate / maker rebate share):
  **Crypto 0.07 (70bps) / 20%**; Sports 0.05/15%; Finance-Politics-
  Mentions-Tech 0.04/25%; Economics-Culture-Weather-Other 0.05/25%;
  Geopolitics fee-free. **[verified]** (same page, 2026-07-17).
  - At p=0.5 that is 0.07 × 0.25 = **1.75c/share**, i.e. 3.5% of a 50c
    contract; at p=0.9: 0.63c/share.
- NOTE the shape difference vs this repo's backtest model: the venue curve
  is `feeRate·p(1−p)` (quadratic), the repo models `bps·min(p,1−p)`
  (piecewise linear, `src/trading/fees.ts`, default 156bps). At p=0.5 repo
  gives 0.0156×0.5 = 0.78c/share vs venue 1.75c/share today (and ~1.56c in
  the Jan-2026 era). ENGINE-GAPS must quantify this mismatch precisely.
  **[verified]** for the repo side (fees.ts read); venue side per docs.

## Fee history — the timeline that brackets gabagool's run

- **Until 2026-01-06: 15m crypto markets were FEE-FREE** (the platform's
  long-standing zero-fee model). **[verified]** via multiple independent
  news reports of the change (Cointelegraph/TradingView, Finance Magnates
  2026-01-07, CoinMarketCap, Unchained; docs update surfaced 2026-01-06).
- **2026-01-06/07: dynamic taker fees introduced on 15-MINUTE crypto
  markets** — no formal announcement ("quietly"); peak ~3.15% of a 50c
  contract (→ feeRate ≈ 0.063; the Cointelegraph example "$1.56 on 100
  shares at $0.50" → feeRate 0.0624). Purpose per reports: neutralize
  latency arbitrage vs Binance and fund maker liquidity incentives; fees
  redistributed DAILY to liquidity providers. **[verified]** (three
  independent outlets + the repo's own 156bps default, which matches the
  1.56c/share@0.5 era exactly — the repo constant was calibrated to the
  January schedule).
- **Fee formula history (archive.org, fetched 2026-07-17)** — snapshots of
  the fees page changed content on 2026-01-08, 01-12, 01-22, 02-28, 05-31:
  - **Feb-2026 era** (snapshot 2026-02-28): `fee = C × p × feeRate ×
    (p(1−p))^exponent`; two market groups: {feeRate 0.0175, exponent 1,
    rebate 25%} and crypto {feeRate 0.25, exponent 2, rebate 20%}. Crypto
    peak: $0.78 per 100 shares at p=0.5 → "maximum effective fee rate is
    1.56%" (of trade value). **The repo's 156bps model equals this era's
    peak exactly.** **[verified]**
  - Same snapshot announces: fees extend to **ALL crypto markets starting
    2026-03-06** (only markets deployed on/after the date) + NCAAB +
    Serie A; and a separate "Liquidity Rewards" program appears in nav.
    **[verified]**
  - **Current era** (live page + 05-31 snapshot): `fee = C × feeRate ×
    p(1−p)`, crypto 0.07 → peak $1.75 per 100 shares at p=0.5. The crypto
    fee curve CHANGED SHAPE and its peak MORE THAN DOUBLED somewhere in
    2026-02-28 → 2026-05-31. **[verified]** (endpoints), exact date OPEN.
  - January-era rate ambiguity: media reported "$1.56 per 100 shares at
    $0.50" (= effective 3.12%) at the 01-06 introduction, but the Feb
    snapshot's formula yields $0.78 (effective 1.56%). Either the press
    misread effective-rate-vs-per-share, or crypto fees were HALVED
    between Jan 7 and Feb 28 — a halving would have halved the rebate
    pool and is a candidate trigger for gabagool's 2026-02-20 exit
    (the maker-rebates docs page's FIRST archive capture is 2026-02-20).
    **[contested/open]** — resolve via Jan snapshots of the developer
    fees page (the learn page carried no formula in Jan).
- Consequence for wallet forensics: gabagool started 2025-10-29 in the
  ZERO-FEE era; fees+rebates arrived 2026-01-06 mid-run; he quit
  2026-02-20, ~6.5 weeks later. The incumbent cluster runs entirely in the
  fee+rebate era and still prints (P15/_META) — so fees did not kill the
  game; they changed who pays whom. Whether gabagool's quit correlates
  with a fee/rebate parameter change in mid-February is OPEN (archive
  snapshots needed).

## Maker Rebates Program

- Eligibility: resting orders that add liquidity AND get filled (maker
  fills). Rebate pool = share of taker fees per market category (Crypto:
  20%). Distribution DAILY in pUSD, min $1 accrued. "Fee-curve weighted":
  your share of executed maker liquidity within each market, weighted by
  `C × feeRate × p(1−p)` of your maker fills. **[verified]**
  (https://docs.polymarket.com/market-makers/maker-rebates +
  help.polymarket.com article 13364471, fetched 2026-07-17).
- Observed in the wild: gabagool22 received MAKER_REBATE payouts $1,693.20
  (2026-02-18T00:11Z) and $125.66 (2026-02-21T00:12Z) — daily-batch
  timestamps ≈ 00:11 UTC. **[verified]** (own activity pull).
  - Scale check: $1,693 in one payout vs his ~$7.6k/day lifetime-average
    trading profit — rebates were a MATERIAL income stream (possibly
    covering several days; payout cadence vs accrual period still open).
- Implication for T2 (why live makers win while sims say no): the engine
  models neither the rebate income (P32) nor the fee-driven taker-flow
  composition change. A maker earning the 20% crypto rebate share receives
  income proportional to fee-weighted maker volume — at gabagool's ~35k
  fills/day this compounds. Rebate modeling belongs in METRICS/BRIEF as a
  separate PnL line.

## Taker Rebate Program (discovered via 0xb55f's TAKER_REBATE rows)

- Launched **2026-05-28**. Seven tiers (Bronze→Obsidian) by trailing-30d
  WEIGHTED volume; fee refund share 3% → 50%; one-time bonus per new
  tier; paid daily ~midnight UTC in pUSD. Crypto markets carry the
  highest category weight (2.3× vs sports 1.0×). ~$11.9M paid to ~39k
  traders as of mid-2026. **[verified]** (docs.polymarket.com/trading/
  taker-rebates + multiple reports; observed payouts to 0xb55f at ~00:10
  UTC, $2.8–3.3k/day).
- Competition-structure consequence: a top-tier incumbent pays an
  EFFECTIVE taker fee of ~half the posted curve, while a new entrant
  starts at 3% refund — a volume-based fee moat protecting incumbent
  gabagool-style wallets. The incumbent's taker rebate (~$3,050/day)
  implies ~$6.1k/day gross taker fees paid → roughly half his flow is
  TAKER-side. "Passive maker only" no longer describes the winning meta;
  the current variant mixes maker accumulation with taker completion at
  halved fees.

## Order/market mechanics

- Tick size: books quote at $0.01 normally; endgame favorites trade at
  sub-cent (0.9662-style) prices and the EPB family rounds to 3 decimals —
  Polymarket halves tick size to 0.001 when price is outside [0.04, 0.96]
  (tick_size_change events exist in the engine decoder). **[reported]** —
  confirm exact rule from CLOB docs in a later unit.
- GTD minimum expiry: 60s (OrderManager-enforced repo-side). Live batch
  limit: 15 orders/batch. **[verified]** (repo ENGINE.md/CLAUDE.md; venue
  numbers behind them still to be primary-sourced).
- Min order size, rate limits, negRisk status for updown series: OPEN.
- Resolution source/precision/timing for crypto up/down: OPEN (Game J).
  `polymarketPriceToBeat` = the strike feed exists live (repo). The 15m
  slugs embed the window epoch; resolution is reportedly Chainlink-based —
  DO NOT trust until primary-sourced.

## Open questions (workstream B queue)

1. Archive.org sweep of docs fees page + maker-rebates page: date every
   parameter change Jan→Jul 2026 (esp. any change near 2026-02-20).
2. Did 5m and hourly crypto markets carry fees in Feb 2026, or only 15m?
   (Gabagool's tail volume was 5m-heavy — fee-avoidance or flow-following?)
3. Rebate program launch date + whether rebate share/formula changed.
4. Exact tick-size rule, min size, rate limits from CLOB API docs.
5. Resolution mechanics from official market rules (Game J).
