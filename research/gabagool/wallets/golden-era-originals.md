# The golden-era originals — 0x52483137 & 0x589222a5 (A43)

The last two unresolved atlas-residue dossiers (#7). Probed 2026-07-17
(session 8). These are the wallets the Nov/Dec era scans ranked top
before gabagool22's story was even half over.

| | 0x52483137…8aa2 | 0x589222a5…4ad2 |
|---|---|---|
| name | hex pseudonym | PurpleThunderBicycleMountain |
| all-time lb profit | **+$485,895** | **+$853,686** |
| all-time volume | $62.5M | $123.5M |
| life (probed) | ~Nov-01 → Dec-06 2025 (~5 wks) | ~Nov-20 2025 → Jan-21 2026 (~9 wks) |
| implied rate | **~$13.9k/day** | **~$14k/day** |
| status | dark since (redeem housekeeping to Apr-24) | dark since Jan-26 redeems |

Era-scan profiles:

- 52483137 Nov-15: maker 0.506, pairRate 0.42, **pairCost 0.836**,
  clips $8 — loose two-sided harvesting of a fee-free, uncrowded book.
- 589222a5 Dec-15: maker 0.332 (taker-heavy — free crossing), pairCost
  0.85, clips $12.65. Jan-15: maker 0.831, pairCost **1.0169** — the
  fee squeeze visible in one row; it quit Jan-21, six days after that
  sample.

## Reading

1. **PurpleThunder is the class's #2 all-time earner** ($854k),
   essentially tying gabagool22 ($869k) in HALF the wall-clock time —
   and at 2× the daily rate. gabagool22 was never the biggest fish;
   it is the best-documented one.
2. ~~52483137 quit Dec-06 — BEFORE fees existed~~ **REWRITTEN by
   A55 (session 10): it was a CONSOLIDATION, not an exit.**
   PurpleThunder's username was registered 2025-12-06T22:29:53Z —
   78 minutes before 52483137's final trade (23:48:17Z) — and PT
   had been trading in parallel since ~Nov-20. One operator ran
   both and folded the older wallet into the newer that evening;
   the combined operator earned ~$854k+ Nov-01→Jan-21. The
   competition-driven-exit reading transfers to the OPERATOR's
   Jan-21 stop (post-fee squeeze, visible in the Jan-15 pairCost
   1.0169 row). (measurements/lineage-sweep.md)
3. **The per-operator daily-rate ceiling has compressed ~5× in 8
   months** (best documented rate per era, trading ex-rebates):

   | era | best wallet | rate/day |
   |---|---|---|
   | Nov 2025 (fee-free, uncrowded) | 52483137 / PurpleThunder | **~$14k** |
   | Dec–Jan (fee shock pool, A40/A42) | 93c22116 | ~$10.6k |
   | Feb–Mar (post-all-crypto-fees, A41) | guh123 | ~$6.5k |
   | Jul 2026 (living, incl. rebates, A30) | 0x04b6d7e9 | ~$2.75k |

   Each shock created a briefly-rich window (A40/A41/A42), but the
   post-window ceiling has ratcheted DOWN every time. Lab
   expectation-setting: a new entrant's realistic ceiling today is
   the $1–3k/day band, and the durable edge is operational
   (fill selection, session choice, subsidy capture), not a
   structural discount pool.

## Sources

- lb-api profit/volume (all/30d); data-api /activity page-walks for
  first/last trade bisection; era scans 2025-11-15 / 2025-12-15 /
  2026-01-15 (variant-scan.ts, on-chain).
