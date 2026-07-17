# 0x2d8b401d…260a "vidarx" — the regime drifter (W0 atlas case study, session 7)

Address: `0x2d8b401d2f0e6937afebf18e19e11ca568a5260a`
All-time lb profit **+$659,586** (3rd–4th biggest known in the class,
≈ tied with b55f) + $76,093 maker rebates (first payout 2026-01-08 —
a day-2 adopter of the rebate program). Still alive (last fill
2026-07-15) but wound down: +$4,292/30d.

## The trajectory (era-scan samples)

| day | cluster | sampled notional | pair | maker | clip |
|---|---|---|---|---|---|
| 2025-12-15 | cheap-side | $24k | 0.68 @ 0.978 | 0.54 | $8.8 |
| 2026-02-15 | parity-edge (btc-5m) | $31k | 0.86 @ 0.950 | 0.75 | $3.2 |
| 2026-03-15 | parity-edge, #2 that day | **$134k** | 0.84 @ 0.976 | 0.79 | $5.4 |
| 2026-04-15 | parity-farmer | $26k | 0.80 @ 1.020 | 0.44 | $7.5 |
| 2026-05→07 | below scan floor (still trading small) | — | — | — | — |

One wallet crossed three variant clusters as the venue changed:
cheap-side in the zero-fee era → deep parity-edge through the fee
shocks (peaking at #2 on the book the week all-crypto fees landed) →
farmer posture in the reshape era → wind-down.

## What the case study says

1. **Adaptation paid**: $660k lifetime is professional-tier money,
   earned by MOVING along the design axes as eras turned — the
   third documented long-game outcome besides "quit at peak"
   (gabagool22, livebreathevolatility) and "born native to the
   current era" (b27bc932, 0x04b6d7e9). The class supports at least
   three career paths.
2. Its 2026-02/03 peak profile (pair 0.84–0.86 @ 0.95–0.976, maker
   0.75–0.79, clips $3–5) is ANOTHER deep-pair specimen — third
   existence proof for the lab's primary target cell, this one
   spanning the fee transition itself.
3. The wind-down (edge → farmer → dust over Apr–Jul) tracks the
   margin history: it left as its niche compressed rather than
   bleeding — consistent with the class-wide "professionals exit,
   not bleed" pattern (now n=3).

Sources: era scans (data/variant-scan/), lb-api, /activity
MAKER_REBATE pull, 2026-07-17.
