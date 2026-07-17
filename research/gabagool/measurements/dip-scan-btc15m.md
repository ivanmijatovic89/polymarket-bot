# Sum-of-best-asks < $1 scan (D1 / OPEN-QUESTIONS #10, A40)

The Game-A number, finally measured: how often does askUp + askDn dip
below $1.00 on btc-15m, for how long, how deep, and is the taker-taker
instant arb alive?

Method: `scripts/dip-scan.ts` over 209 stub-filtered books —
2026-01-15 (35), 2026-03-16 (48), 2026-05-13 (48), 2026-06-10 (48),
2026-06-12 (30). An episode = maximal span with both best asks present
and summing < $1; per episode: duration, min sum, max instantaneous
top-of-book pair value = min(bestAskSize_up, bestAskSize_dn)×(1−sum),
and whether the discount clears two-leg taker fees 0.07·p(1−p).

| day | eps/mkt p50 | ep dur p50/p90 | dip-time/mkt p90 | minSum p10 | value/ep p50/p90 | totValue/mkt p50/p90 | fee-clearing mkts |
|---|---|---|---|---|---|---|---|
| Jan 15 | 12 | 0.00/0.01s | **124.5s** | **0.720** | $8.78/$96 | $11.87/**$10,636** | 74% |
| Mar 16 | 10 | 0.00/0.00s | 0.0s | 0.980 | $0.12/$0.65 | $2.85/$8.99 | 63% |
| May 13 | 6 | 0.00/0.00s | 0.0s | 0.970 | $0.10/$1.37 | $2.42/$16.44 | 67% |
| Jun 10 | 8 | 0.00/0.00s | 0.0s | 0.980 | $0.10/$1.16 | $2.52/$14.58 | 67% |
| Jun 12 | 7 | 0.00/0.00s | 0.0s | 0.980 | $0.05/$0.30 | $1.00/$3.33 | 27% |

## Findings

1. **Dips exist in 100% of markets but are FLICKERS in the current
   era**: 6–10 episodes/market, essentially all closed by the very
   next book event (duration p90 ≤ 10ms measured); standing sub-$1
   books do not exist Mar→Jun (dip-time/mkt p90 = 0.0s).
2. **The taker-taker instant arb is DUST today**: max top-of-book
   harvest ≈ $2.5/market p50 (~$15 p90) GROSS, per-episode $0.10 —
   before latency, slippage, and the race for the same flicker. This
   is why nobody crosses both legs: the class captures these dips
   PASSIVELY (a resting bid is filled by the same sweep that creates
   the flicker). Confirms P38's re-scope of D1 and the BRIEF §4 note
   that "temporarily cheap" is a 1–2c-plus-sweep phenomenon.
3. **January was a different regime — standing discounts**
   [reported]: dip-time p90 124s/market, minSum p10 0.72, per-episode
   value $8.78 p50, and a fat tail of markets with thousands of
   dollars of standing top-of-book pair value. Fee-era week 2: the
   zero-fee bots had just left (A15) and books were LOOSE. This is
   the pool the Jan cheap-side winners (0x961afce6, 0x93c22116,
   vidarx's Dec–Jan era) harvested, and its disappearance by March
   is the class repricing it. CAVEAT: January magnitudes may be
   inflated by stale one-sided books (same coverage era as the G10
   stubs) — tagged [reported], not [verified]; the Mar→Jun numbers
   come from dense books and are [verified].
4. Fee-clearing dips exist in ~2/3 of markets even today, but their
   value is inside the $2.5/market dust — fee-clearing is necessary,
   not sufficient.

## Lab implications

- No taker-taker "arb sweep" family: the edge is not in crossing
  both legs on a flicker (value ≈ dust, race-contested).
- The flicker CADENCE (6–10/market, all sub-second) is the fill
  opportunity clock for passive dip-capture: a resting bid must
  already be sitting there when the flicker happens — consistent
  with A37 (fast requoting at touch wins) and D2's worst_queue
  admitting the through-sweeps.
- If a Jan-like dislocation regime ever returns (new fee shock, bot
  exodus), the standing-discount harvest is worth ~1000× today's —
  a regime detector (standing sub-$1 time per market) is cheap to
  compute live and belongs in the ops dashboard someday.

## Producing command

- npx tsx research/gabagool/scripts/dip-scan.ts --dir
  research/gabagool/data/telonex-r2-w4 --recursive --by-day
  (2026-06-12 books copied into the tree as 2026-06-12-extra/)
