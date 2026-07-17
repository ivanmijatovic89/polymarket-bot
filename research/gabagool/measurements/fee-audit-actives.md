# Fee-inclusive re-audit of the July actives (A13 fallout) — the edge survives, thinner

Script: `scripts/measure-onchain-fees.ts` (samples every k-th tx of a
wallet's fills for a book/window, decodes fill events + refunds from
receipts; POLYGON_RPC_URL read-only). Window: Jul 14–16, same as the
decomposition. 120–150 receipts per cell, 100% decode rate.

## New venue fact discovered en route: a NEW exchange contract

July crypto up/down fills do NOT settle on the v1 CTF exchange
(`0x4bfb…982e`, OrderFilled + charge-10%-refund flow, verified for Jan)
but on **`0xe111180000d2663c0091e4f400237545b87b996b`** with a new fill
event (`topic0 0xd543adfd…`, same field layout as OrderFilled). Fee
semantics are NATIVE here: maker fee = 0 on-chain (no charge-refund
round trip), taker fee = published curve charged directly in USDC
(verified 0.07·p(1−p)·shares to 5 decimals), fee routed to module
`0x115f48dc…`; matching can MINT pairs (complementary buys combine,
$1/pair to the CTF). Launch date of this contract: unknown — bracket
Jan→Jul if it ever matters. /activity remains GROSS: the taker fee is
still invisible in usdcSize (A13 holds in the current era).

## Results (per cell: maker/taker split by notional, net fee rate)

| wallet / book | maker share of notional | net fee, % of turnover | taker-fill fee rate | gross margin (decomp) | **fee-inclusive margin** |
|---|---:|---:|---:|---:|---:|
| b55f / btc-15m | 37.8% | 0.888% | 1.43% | +3.20% | **+2.31%** |
| 0xce25 / btc-15m | 37.3% | 1.657% | 2.64% | +1.97% | **+0.31%** |
| b55f / btc-5m | 44.5% | 1.842% | 3.32% | −0.14% | **−1.98%** |
| doggystyie / btc-5m | **0%** | 2.605% | 2.61% | −0.32% | **−2.93%** |

(Rebates are NOT in these margins — they are separate income, and they
refund at most tier% ≤ 50% of the fee column.)

## Findings

1. **The btc-15m edge survives fee-inclusive accounting** — b55f keeps
   +2.31% of turnover after real on-chain fees. The premise "real
   trading alpha exists in July 2026" stands (A11 confirmed, thinner).
2. **0xce25's btc-15m sleeve barely survives** (+0.31%): it runs a much
   more taker-aggressive style on this book (85 taker vs 65 maker
   fills, taker fees 2.64% — near the p≈0.5 curve peak). Its
   wallet-level "+2.31% best measured edge" (gross) needs downward
   revision; rank order b55f > 0xce25 on btc-15m REVERSES after fees.
3. **The current meta is majority-taker even for edge wallets**: ~62%
   of edge-book notional is taker-side. The archetype's D2 number
   (29–45% taker completions) has grown into the dominant mode. Any
   lab family that is pure-passive-maker models a MINORITY of what
   winners actually do.
4. **doggystyie is 100% taker** — zero maker fills in 120 sampled txs.
   Its "perfect 0.0% parity grinder" fingerprint is a pure
   taker-rebate-manufacturing loop (fee −2.93% of turnover, rebates
   refund ≤50%; the REST of its rebate income must come from weighted
   volume tiers, i.e., the one-time bonuses/pool structure — or it
   runs at a genuine net loss on this book while farming tier status).
5. Fee drag ranks exactly by book/price-band: btc-15m edge quoting
   (wider band, extremes) pays ~0.9–1.7% while btc-5m mid-band
   grinding pays ~1.8–2.6% — the fee curve's p(1−p) shape makes
   mid-band taker completion the most expensive behavior, which is
   precisely what 5m rebate manufacturing requires.

## Caveats

- Per-tx systematic sampling (every k-th) weights by tx, not notional;
  ratios are within-sample. 120–150 txs per cell out of 3.4k–8.1k.
- Single 2-day window; same-window as the gross decomposition so the
  margin subtraction is internally consistent.
- Maker/taker classification: a fill row whose `taker` topic is the
  exchange itself = the wallet's own order was the aggregate (taker)
  side; else the wallet's resting order was hit (maker). Verified
  against fee=0 on all maker rows (both exchange generations).
