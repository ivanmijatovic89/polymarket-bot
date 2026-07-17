# January transition (Jan 10–13) — decay curve, fee-free control book, and the fee-mechanics discovery

Data: `data/activity-gabagool22-jan.jsonl` (359,084 rows, Jan 10–13
2026, pull-activity.ts, complete). Analysis: analyze-tail.ts + inline
per-day scripts + on-chain receipt decoding via `POLYGON_RPC_URL`
(read-only `eth_getTransactionReceipt`). Window = days 4–7 after the
2026-01-06 15m-crypto fee introduction.

## Headline numbers (activity cash-flow accounting — see fee caveat below)

654 in-window markets across exactly 4 books (btc/eth × 15m/1h — no 5m
yet, no SOL/XRP, same as December):

| family | mkts | win% | mean $/mkt | pairCost p50 | fills p50 |
|---|---:|---:|---:|---:|---:|
| btc-15m | 262 | 71.0 | +24.52 | 0.99 | 577 |
| eth-15m | 262 | 67.2 | +13.39 | 0.98 | 375 |
| btc-1h | 65 | 92.3 | +50.91 | 0.99 | 641 |
| eth-1h | 65 | 83.1 | +23.58 | 0.99 | 374 |

Totals: net +$14,773 on $1.60M buys = **+0.924%** — exactly between Dec
(+1.90%) and Feb (−0.50%). Merge-dominant exits ($1.59M merges vs $27k
redeems) — still the parity grinder. Clips unchanged (p50 $3.90).

## The decay is NOT monotone — btc-15m per market-start day

| day | n | win% | mean $/mkt | pairCost p50 |
|---|---:|---:|---:|---:|
| Jan 10 | 83 | 49.4 | +0.69 | 0.9945 |
| Jan 11 | 96 | 69.8 | +26.61 | 0.9868 |
| Jan 12 | 83 | 94.0 | +45.93 | 0.9815 |

**Control book btc-1h (fee-free until 2026-03-06), same days**: win
87.0 / 95.8 / 92.9%, pair cost flat ~0.988–0.992. The 1h book shows no
Jan-10 collapse and no trend — so the 15m swing is not market regime.
Reading: **post-fee adaptation** — the operator demanded progressively
deeper discounts on the fee book only (pair cost 0.9945 → 0.9815 in
three days, ~130bp) and restored a near-December hit rate (94.0% win,
$45.93/mkt) by Jan 12. Four days after the fee shock he was at
breakeven; six days after he had re-tuned. The Dec→Feb "decay" is
therefore two separate phenomena: an instant fee shock he largely
adapted to within a week, and a later (mid-Jan→Feb) grind to zero that
this window does NOT yet show — competition/pair-cost compression came
later.

## Fee mechanics — decoded on-chain (the load-bearing discovery)

Method: took his /activity fills (which carry `transactionHash`),
fetched receipts, decoded `OrderFilled` (topic
`0xd0a08e8c…`) + ERC1155/ERC20 transfers. Findings, each verified on
multiple receipts:

1. **On-chain gross fee = 10% × min(p, 1−p) × size, charged to BOTH
   sides in the output asset** (shares for buys, USDC for sells). This
   is the CTF-exchange symmetric-fee form; feeRateBps signed = 1000.
2. **The operator module (tx `to` = `0xe3f18acc…7b0`) refunds in the
   SAME transaction**: makers refunded 100% (charge 0.0375 shares →
   refund 0.0375 shares; net maker fee exactly zero), takers refunded
   down to the published curve.
3. **Net taker fee matches the "Feb-snapshot" formula EXACTLY**:
   fee_usd/share = 0.25·p·(p(1−p))², peak $0.78/100sh at p=0.5.
   Example: taker BUY 8 sh @0.79 → charged 0.2127 sh, refunded 0.1577,
   net 0.0550 sh = $0.0435 = formula value to 4 decimals.
4. **December receipts show fee = 0** — the fee-free era is confirmed
   on-chain, not just by absence of press.
5. Therefore **January's true fee rate = the Feb formula**. The press
   claim "$1.56 per 100 shares at $0.50" (2× the snapshot) is WRONG for
   what was actually charged on-chain on Jan 11–12. Contested-2× issue
   RESOLVED empirically.

## The accounting bias this creates (applies to EVERY fee-era number)

`data-api /activity` reports `size` = gross matched shares and
`usdcSize` = price×size (verified exact on 325k rows, Dec AND Jan) —
**the net taker fee (paid in shares on buys) is invisible**. The maker
in-tx refund makes maker fills exact; taker fills overstate the shares
actually received. Consequences:

- All cash-flow nets computed from /activity are **gross of taker
  fees**. Jan btc-15m: hypothetical all-taker fee = $31.72/mkt; at the
  measured taker-completion share (29–45%, D2/A9) the drag is
  **$9.20–14.27/mkt → corrected mean +$10.24 to +$15.32/mkt** (from
  +$24.52 gross).
- Measured pair costs slightly understate true pair costs (gross
  shares in the denominator).
- **The July actives decomposition (A10–A12) counted rebate transfers
  as income WITHOUT subtracting the fees those rebates refund.** The
  "edge wallets'" +1–3.2% margins are gross-of-fee; whether they
  survive fee-inclusive accounting is now the top open question. Taker
  rebate income implies large fees paid (fees_taker = rebate ÷ tier%,
  tier ≤ 50%): b55f's $3.05k/day taker rebate implies ≥ $6.1k/day of
  taker fees against +$2.7k/day gross trading net.

## Producing commands

- analyze-tail.ts --from 2026-01-10T00:00:00Z --to 2026-01-13T00:00:00Z
- per-day + control-book inline scripts, fee-fit inline scripts, and
  receipt decoding one-liners: JOURNAL 2026-07-17T02:0x–02:3xZ entries.
