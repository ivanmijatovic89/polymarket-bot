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
    fee curve CHANGED SHAPE and its peak MORE THAN DOUBLED between
    **2026-03-05 (old formula still up, max effective 1.56%/0.44%) and
    2026-04-01 (new formula live)** — narrowed via /trading/fees
    snapshots 20260305182223 vs 20260401214533; ~10 March snapshots
    exist for exact-date bisection if ever needed. **[verified]**
  - **January-era rate RESOLVED on-chain (session 3)**: decoded
    OrderFilled receipts of gabagool22's Jan 11–12 taker fills — net
    fee kept after in-tx refund = 0.25·p·(p(1−p))² per share, i.e. the
    Feb-snapshot formula EXACTLY ($0.78/100sh peak, 1.56% effective at
    p=0.5). The press "$1.56/100sh" figure is wrong for what was
    charged; there was NO Jan→Feb halving, so a mid-Feb fee cut is
    ELIMINATED as gabagool's exit trigger. **[verified]**
    (measurements/jan-transition-gabagool22.md)
- Consequence for wallet forensics: gabagool started 2025-10-29 in the
  ZERO-FEE era; fees+rebates arrived 2026-01-06 mid-run; he quit
  2026-02-20, ~6.5 weeks later. The incumbent cluster runs entirely in the
  fee+rebate era and still prints (P15/_META) — so fees did not kill the
  game; they changed who pays whom. Whether gabagool's quit correlates
  with a fee/rebate parameter change in mid-February is OPEN (archive
  snapshots needed).

## Fee implementation on-chain (decoded from receipts, session 3)

- **Gross charge**: the CTF Exchange charges `10% × min(p, 1−p) × size`
  to BOTH sides of every fill (feeRateBps=1000 signed in orders), taken
  in the OUTPUT asset — shares for buys, USDC for sells. **[verified]**
  (OrderFilled `fee` field across price band 0.04→0.96).
- **In-tx refunds by the operator module** (tx `to` =
  `0xe3f18acc55091e2c48d883fc8c8413319d4ab7b0`): makers refunded 100%
  (net maker fee exactly $0 — "makers are never charged" is
  implemented as charge-then-refund); takers refunded down to the
  published curve. **[verified]** (transfer-level decode, multiple txs).
- **December 2025 receipts show fee=0** — the zero-fee era is verified
  on-chain, not just from press. **[verified]**
- **Forensics consequence (CRITICAL)**: `data-api /activity` reports
  gross `size`/`usdcSize` (= price×size exactly, verified on 325k
  rows); the net taker fee (docked in shares on buys) is INVISIBLE.
  All activity-based cash-flow nets are gross of taker fees, and rebate
  transfers must never be added to them without also subtracting the
  fees they refund. See PRIORS A13. **[verified]**

## The 2026 exchange contract (discovered session 3, fee audit)

- July 2026 crypto up/down fills settle on
  **`0xe111180000d2663c0091e4f400237545b87b996b`** — NOT the v1 CTF
  exchange. New fill event (topic0 `0xd543adfd…`, OrderFilled-like
  layout). Fee semantics NATIVE: maker fee = 0 on-chain, taker fee =
  published curve charged directly in USDC (verified 0.07·p(1−p)·shares
  to 5 decimals), fees routed to `0x115f48dc…`. Matching can MINT pairs
  (complementary buys combine at $1/pair via the CTF) — a taker buying
  DOWN can be matched against a maker buying UP with no share transfer,
  just a mint. pUSD (`0xc011a7e1…`) appears in the settlement path.
  **[verified]** (receipt decodes, measurements/fee-audit-actives.md)
- v1 (Jan era) flow for comparison: charge 10%×min(p,1−p) to both
  sides + in-tx refunds by `0xe3f18acc…` (see "Fee implementation
  on-chain" above).
- **Launch dates RESOLVED (A51, session 10,
  measurements/first-fill-2026-exchange.md):** deployed
  2026-03-31T02:39:03Z; first fill 2026-04-03T12:52:59Z (a 2-wallet
  $38 smoke test on novelty books); ~3.5 weeks of test trickle; then
  a venue-wide HARD cutover **2026-04-28 ~11:01–11:03Z** — v1
  exchanges at full volume through 11:00Z, zero after 11:15Z, no
  dual-running at 15m resolution; v2 volume recovered from ~1% of
  normal (12:00Z) to full scale by Apr-29. **The v2 exchange is
  venue-wide (all Polymarket books), not crypto-only** — the earlier
  "crypto up/down" observation was sampling bias. Consequence for
  forensics: receipts before Apr-28 ~11:02Z decode as v1
  charge+refund; after, as fee-native. Open (one probe): whether the
  fee-curve reshape (Feb-28→May-31 bracket) shipped exactly at this
  cutover.

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
- **Payout mechanics (A21, observed streams of all 7 actives)**: daily
  TAKER_REBATE at ~00:10Z started exactly **2026-06-20** (the May 28–
  Jun 19 launch-window accrual was paid later as ONE same-second batch,
  2026-07-08T23:34:35Z — $174k across this cohort alone). MAKER_REBATE
  daily at ~01:00Z (Mar–Apr) then ~00:45Z; observable back to
  2026-03-26. Payout jobs are batched and occasionally slip by hours
  (whole-cohort same-second catch-ups Jul 4 11:39Z, Jul 13 16:50Z);
  manual round-number grants observed ($7,500.00, $1,500.00). The
  taker stream out-earns the maker stream ~5–10×/day for every active
  wallet. **[verified]** (measurements/rebate-payout-provenance.md)
- Competition-structure consequence: a top-tier incumbent pays an
  EFFECTIVE taker fee of ~half the posted curve, while a new entrant
  starts at 3% refund — a volume-based fee moat protecting incumbent
  gabagool-style wallets. The incumbent's taker rebate (~$3,050/day)
  implies ~$6.1k/day gross taker fees paid → roughly half his flow is
  TAKER-side. "Passive maker only" no longer describes the winning meta;
  the current variant mixes maker accumulation with taker completion at
  halved fees.

## Order/market mechanics

- Tick size: 0.01 default; the venue emits a `tick_size_change` event
  when "price hits >0.96 or <0.04" — i.e. the sub-cent (0.001) regime
  switches on exactly outside [0.04, 0.96]. **[verified]**
  (docs.polymarket.com/trading/orderbook.md, fetched 2026-07-17;
  matches the decoder events + EPB 3-decimal rounding).
- GTD minimum expiry: 60s (OrderManager-enforced repo-side). Live batch
  limit: 15 orders/batch. **[verified]** (repo ENGINE.md/CLAUDE.md; venue
  numbers behind them still to be primary-sourced).
- Min order size: **5 shares**; tick **0.01**; negRisk **false** for
  btc-updown-15m — from the live gamma market object
  (`orderMinSize`/`orderPriceMinTickSize`/`negRisk`, pulled 2026-07-17).
  **[verified]** Additionally: a MARKETABLE order (FOK/FAK, or a BUY
  that crosses) must be ≥ 1 pUSD notional; resting GTC/GTD only need
  the 5-share minimum. **[reported]** (NautilusTrader Polymarket
  adapter docs — secondary; primary page not yet found).
- **Rate limits [verified]** (docs.polymarket.com/api-reference/
  rate-limits.md, fetched 2026-07-17): POST /order 5,000/10s burst,
  120,000/10min sustained; DELETE /order same; POST /orders (batch,
  ≤15) 2,000/10s, 21,000/10min; DELETE /orders 2,000/10s, 15,000/10min;
  cancel-all 250/10s; cancel-market-orders 1,500/10s. General: CLOB API
  9,000/10s, Gamma 4,000/10s, Data-API 1,000/10s. Consequence: rate
  limits are NOT a binding constraint for a gabagool-style bot — the
  archetype's peak ~700 fills/15m is orders of magnitude inside these
  caps; data-api pullers should respect 1,000/10s.
- **Resolution (Game J) — primary-sourced from the market rules text**:
  "resolves to Up if the Bitcoin price at the end of the time range is
  greater than or equal to the price at the beginning" — **ties resolve
  UP**; source = **Chainlink BTC/USD data stream**
  (https://data.chain.link/streams/btc-usd), explicitly "not other
  sources or spot markets". `polymarketPriceToBeat` (live feed) is the
  venue's own strike broadcast of that stream's window-open price.
  **[verified]** (gamma description, 2026-07-17)
- Chainlink Data Streams (the resolution source) publish signed reports
  at ~sub-second cadence (~200ms class) with **18-decimal** prices and
  an `observationsTimestamp` per report. **[reported]** (chain.link
  data-streams docs/marketing + third-party implementations, 2026-07-17).
  Consequence: exact price ties at window boundaries are measure-zero —
  the "ties resolve UP" clause is a legal nicety, NOT a tradable
  asymmetry. Which report the venue samples at the boundary (first
  report with observationsTimestamp ≥ window edge? venue-side reader?)
  remains OPEN and is probably unknowable from public docs — treat the
  final-second boundary as ±1 report (~sub-second) of oracle ambiguity.

## Open questions (workstream B queue)

1. Archive.org sweep of docs fees page + maker-rebates page: date every
   parameter change Jan→Jul 2026 (esp. any change near 2026-02-20).
2. Did 5m and hourly crypto markets carry fees in Feb 2026, or only 15m?
   (Gabagool's tail volume was 5m-heavy — fee-avoidance or flow-following?)
3. Rebate program launch date + whether rebate share/formula changed.
4. ~~Exact tick-size rule, min size, rate limits~~ RESOLVED (A19) —
   residue: primary-source the 1-pUSD marketable-order minimum.
5. ~~Resolution mechanics (Game J)~~ RESOLVED (A18 + A19 stream
   precision) — residue: venue-side boundary sampling (likely
   unknowable from public docs).
