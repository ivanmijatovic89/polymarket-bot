# Time-to-pair at scale (W4 remainder, A48)

How long after the leading leg does the completing leg arrive?
Share-weighted lag between a pair level being reached by the leading
leg and matched by the lagging leg (`scripts/time-to-pair.ts`), on
four independent samples:

| sample | mkts | pairRate | p25 | p50 | p75 | p90 | ≤10s | ≤60s | ≤300s |
|---|---|---|---|---|---|---|---|---|---|
| 04b6d7e9 Jun-12 | 30 | 0.90 | 14s | 40s | 86s | 150s | 20% | 63% | 99% |
| 04b6d7e9 May13+Jun10 | 53 | 0.85 | 23s | 67s | 135s | 236s | 14% | 47% | 95% |
| b27bc932 Jun 12–14 | 230 | 0.98 | 15s | 39s | 80s | 136s | 18% | 66% | 99% |
| b27bc932 Jun-10 | 95 | 0.99 | 18s | 43s | 82s | 126s | 15% | 64% | 100% |

## Findings

1. **The pairing clock is minutes, not seconds**: p50 ≈ 40–67s,
   ~2/3 of pair volume completes within 60s, 95–99%+ within 5
   minutes — remarkably stable across two very different recipes
   and multiple days. Only ~15–20% of pair volume completes within
   10s (the instant two-sided oscillation is a minority mode).
2. **Leg-risk horizon prior**: an unpaired leg's expected companion
   arrives on a ~1-minute clock; a leg still unpaired after ~5
   minutes is likely the market's structural excess (the A34
   directional lean) and should be MANAGED as inventory, not
   awaited. Timeout policies belong in the 60–300s band.
3. The patient wallet (04b6d7e9) pairs SLOWER (p50 67s on the W4
   days) at deeper discounts; the grinder pairs faster at parity —
   completion speed and pair depth trade off exactly as the recipe
   map (A37) predicts.

## Producing command

- npx tsx research/gabagool/scripts/time-to-pair.ts --activity
  research/gabagool/data/activity-<wallet>-<window>.jsonl
