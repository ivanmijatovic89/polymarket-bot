# The January winners — 0x961afce6 "CRYINGLITTLEBABY" & 0x93c22116 (A42)

The two cheap-side winners of the January standing-discount pool
(A40), atlas residue #7. Probed 2026-07-17 (session 8).

| | 0x961afce6…3361 | 0x93c22116…c072 |
|---|---|---|
| name | CRYINGLITTLEBABY | bare address (created 2025-12-28, from profile suffix ms) |
| all-time lb profit | **+$381,215** | **+$382,998** |
| all-time volume | $66.3M | $55.0M |
| last trade | 2026-01-26 | 2026-02-01 |
| implied rate | ~$7.6k/day (if born ~early Dec) | **~$10.6k/day over 36 days** |
| status | dark since (30d = 0) | dark since (30d = 0) |

Era-scan profiles:

- **961afce6 Dec-15 (zero-fee era): makerShare 0.105, pairCost
  0.9207** — it was a TAKER-sweeper of deep two-sided discounts when
  crossing was free. **Jan-15 (fee era): makerShare 0.766**, pairCost
  0.9931, clips $4.1, multi-symbol (btc/eth/sol/xrp 15m + hourlies).
  The completion-mode flip tracks the fee regime exactly — behavioral
  proof of the A16/A32 fee arithmetic at wallet level.
- 93c22116 Jan-15: makerShare 0.753, pairRate 0.584, pairCost
  0.9599, clips $3.6, same multi-symbol book mix.

## Reading

1. **They ARE the January pool's harvesters and left when it
   closed**: quits on Jan-26 and Feb-01 bracket the window where
   A40's standing sub-$1 books disappeared (repriced well before
   Mar-16). ~$380k each in roughly 5 weeks — 93c22116's ~$10.6k/day
   is the fastest daily trading rate now documented (above guh123's
   $6.5k/day, A41).
2. **Quit-at-peak n=6** (gabagool22, livebreathevolatility, vidarx
   wind-down, guh123, and these two). NOBODY in the class's winner
   cohort has ever bled out; they all stop abruptly while printing.
   The class's real risk profile: margin compression → exit, not
   blow-up (A26 confirmed no large-loss casualty).
3. **Possible twin operation** [reported]: profits within $1.8k of
   each other, same book mix, same era, same recipe, overlapping
   quits. **Profile-creation check DONE (A54, session 10): NOT
   linked** — 0x961afce6bd9aec79c5cf09d2d4dac2b434b23361 created
   2025-12-08T21:12:19Z vs 0x93c22116e4402c9332ee6db578050e688934c072
   created 2025-12-28T21:57:38Z, 20 days apart (vs the 121s that
   nailed b55f↔0xce25). Twin suspicion stays circumstantial;
   93c22116's creation date equals its first-trade day (fresh
   wallet, immediate deployment — itself a soft rotation signal).
4. Low pairRate (0.57–0.58) at deep pairCost — these were
  dislocation harvesters, not parity grinders: grab the discounted
  side hard, complete when the other side dips, tolerate wide
  imbalance. The recipe matches the LAB seed-2 (cheap-side) cell
  more than seed-1.

## Sources

- lb-api profit/volume windows all/30d; data-api /activity latest
  rows; era scans scan-2025-12-15.json / scan-2026-01-15.json
  (variant-scan.ts, on-chain).
