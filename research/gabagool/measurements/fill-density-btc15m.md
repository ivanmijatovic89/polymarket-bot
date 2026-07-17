# Maker fill density by depth offset × requote speed (A37)

OPEN-QUESTIONS #2: can a maker-only policy at $3–5 clips reach the
$143/market maker notional that unlocks the $1/day/market rebate step
(A28) — without taker completion?

Method: `scripts/fill-density.ts` over the 30 June-12 btc-15m books
(data/telonex-r2, US session — the HIGH-flow regime, A35/A36 caveat).
One resting BUY level per side at (bestBid@last-requote − offset),
requoted every R seconds; fill granted only when bestAsk goes STRICTLY
below the level (engine worst_queue rule — the conservative model, D2:
real touch-heavy fills run ~2× this); max one fill per requote
interval per side; minute 14 not quoted. This measures book dynamics
(like D2), not strategy EV.

| offset | requote | fills/mkt p25/p50/p75 | $4-clip notional p50 | % mkts ≥ $143 |
|---|---|---|---|---|
| at touch | 1s | 93/133/157 | **$532** | **100%** |
| at touch | 5s | 80/101/113 | $404 | 100% |
| at touch | 15s | 50/58/63 | $232 | 97% |
| −1c | 1s | 31/59/74 | $236 | 73% |
| −1c | 5s | 50/67/81 | $268 | 93% |
| −2c | 1s | 12/26/37 | $104 | 33% |
| −2c | 5s | 31/45/54 | $180 | 63% |
| −2c | 15s | 27/37/43 | $148 | 50% |
| −5c | 15s | 9/18/23 | $72 | 3% |
| −10c | 15s | 2/5/7 | $20 | 0% |

(−5c/−10c at 1–5s requote are near-zero; full grid in the script
output.)

## Findings

1. **The rebate step is reachable maker-only.** At-touch or −1c
   quoting at $4 clips clears $143/market in 93–100% of markets even
   under worst_queue. A maker-pure policy funds its own rebate floor;
   taker completion is NOT needed for subsidy access. (H3's farmer
   floor and H1's rebate line both become sim-verifiable through this
   density.)
2. **Requote speed × depth INTERACT — two local optima, and they are
   the two living recipes.** At the touch, faster requoting
   monotonically adds fills (1s: 133 ≫ 15s: 58) — chase the touch.
   At −2c and deeper, fast requoting HURTS (−2c: 26 fills at 1s vs 45
   at 5s; −5c: 4 at 1s vs 18 at 15s): repricing pulls the level away
   before sweeps arrive — deep rungs want PATIENT standing orders.
   Fast+shallow is 0x04b6d7e9 (A34); slow+deep is b55f/0xce25 (A17).
   The middle (fast+deep, slow+shallow) is dominated. The lab sweep
   should treat (offset, requote interval) as a JOINT axis, not
   independent knobs.
3. **Depth is expensive in density**: fills/market falls ~3× from
   touch to −2c and ~7× to −5c (at each config's best requote speed).
   The A17 deep rungs (−12c) are rare-event harvesters (~5/market) —
   their value must come per-fill (price), not from volume or rebates.
4. Scale note: p50s here × $4 clips are per-market maker notional at
   ONE level/side; the real wallets run ladders (43–46 price levels
   for 0x04b6d7e9) and larger effective notional. A k-rung ladder ≈
   sum of rungs, approximately (rungs correlate in sweeps).

## Caveats

- 30 markets, one US-session Jun-12 stretch — the highest-flow regime;
  overnight/EU densities are likely LOWER (A36 pairCosts suggest
  quieter books). W4 must re-run this table on off-session months.
- worst_queue is the floor: D2 measured real touch fills ≈ 2× this
  rule. Treat the table as the sim's own arithmetic — what the lab's
  backtest will grant.
- One clip per requote interval caps burst fills; real cascades can
  refill faster.

## Producing command

- npx tsx research/gabagool/scripts/fill-density.ts --dir
  research/gabagool/data/telonex-r2 --clip 4
