# ANOMALY MEMO 001 — Window-roll reversal skew (t=0 underdog at ask)

Author: gabagool. Round 1, Foundry Phase 2. Date: 2026-07-10.
Data: census v1 (`glitch-hunt/census/checkpoints.parquet`, 2,000 episodes,
250/month 2025-10..2026-05; `outcomes_all.csv` for prev-window join). All
queries are light duckdb aggregations over census tables; reproducible
one-liners at the bottom.

## Invariant

At the t=0 checkpoint (book state at exactly window open), when the cheaper
side's ("dog") best ask is <= 0.46, buying the dog AT ITS ASK and holding to
settlement wins at coin-flip rate while paying materially less than 0.50:

| cell (t=0, dog ask) | n (episodes) | avg ask    | P(dog wins) | edge at touch | z vs break-even |
| ------------------- | ------------ | ---------- | ----------- | ------------- | --------------- |
| < 0.42              | 30           | 0.3973     | 0.4667      | +6.9c         | +0.76           |
| 0.42–0.44           | 83           | 0.4263     | 0.4819      | +5.6c         | +1.01           |
| 0.44–0.46           | 266          | 0.4472     | 0.5075      | +6.0c         | +1.97           |
| = 0.46              | 181          | 0.4600     | 0.4917      | +3.2c         | +0.85           |
| **pooled <= 0.46**  | **560**      | **0.4456** | **0.4964**  | **+5.1c**     | **+2.41**       |
| 0.46–0.48 (control) | 192          | 0.4700     | 0.4583      | -1.2c         | -0.32           |
| 0.48–0.50 (control) | 652          | 0.4855     | 0.4816      | -0.4c         | -0.20           |

- Every bucket inside the region is positive; both adjacent control buckets
  are exactly fair. This is a contiguous region, not a lone hot cell.
- The edge is computed AT THE TOUCH (best ask actually quoted), so median
  spread (1c at these cells, `friction.csv`) is already consumed. The only
  unpriced friction is taker fees (see Confession 3).
- Time-halves: first 4 months +3.2c (n=174, z=0.85), last 4 months +5.9c
  (n=386, z=2.33). Months positive: 6/8; negatives are 2025-10 (-3.7c,
  n=31, the sparse-snapshot month with 3.4% hard mismatch — census says
  treat sub-2c effects there as noise) and 2026-03 (-0.9c, n=89).
- Freshness: books at t=0 are LIVE — median `last_event_age_ms` is
  100–200ms. Restricting to age < 2s keeps 551/560 and the edge rises to
  +5.4c (z=2.52). This is not a stale-leftover-book artifact.
- Structural anchor (why this cell is special a priori): the strike is set
  at window open, so at t=0 the true P(up) is ~0.50 by martingale, to
  within ~0.1c of drift. Unlike every other cell in the census, the fair
  value here is KNOWN, not estimated. The measured 0.4964 is z=-0.17 from
  0.50 — the market's 0.4456 quote is the thing that's wrong.

Coverage: the cell fires on 560/2,000 windows (28%), ~27 windows/day.

## Mechanism — who donates and why it persists

The skew is REVERSAL betting at the window roll. Joining each episode to the
previous window's outcome (`outcomes_all.csv`, epoch-900):

- In the skewed group (dog ask <= 0.46), the t=0 FAVORITE equals the
  previous window's WINNER only **9.5%** of the time (53/560) — i.e. 90.5%
  of the time the open book prices the side that just LOST as the new
  favorite at 0.54–0.60.
- In the mild group (0.46–0.50) the same alignment is 23.8% — the
  anti-momentum tilt is pervasive at t=0, it just usually stays within
  noise.
- The reversal premium does not pay: the dog (= the momentum side, the
  direction BTC just moved) wins 0.497 — there is no measurable short-
  horizon mean reversion at the priced magnitude. Edge conditioned on
  mechanism: fav=prev_loser +5.2c (n=507), fav=prev_winner +4.0c (n=53).

Donor: gambler's-fallacy flow ("it just pumped, it's due for a pullback")
positioning in the new market during the pre-open minutes, while the
previous window is still running and salient. Makers accommodate the
one-sided pre-open flow and their skewed quotes are still standing at
t=0. WHY it isn't corrected: the strike resets AT open, instantly
invalidating the reversal thesis; the mispricing lives only in the first
seconds of each window (measured decay: dog mid 0.436 at t=0 -> 0.464 at
t=15, then plateaus ~0.465), and per-window capacity is a few hundred USDT
— too small and too brief for sophisticated flow to police, so it reprints
every roll, ~27 times a day.

## Glitch shape

- Entry: at window open, if the cheaper side's best ask <= 0.46, taker-buy
  it at the ask. One decision, one order, no signal computation beyond
  reading the book.
- Exit: none needed — hold to settlement (winner redeems $1). Optional but
  not load-bearing: ~2.8c of mid recovery is measured by t=15s.
- Loss tail: strictly bounded at the stake (~0.446/share). Payoff is a
  near-fair coin paying (1-ask) vs -ask; there is no blow-up mode, no
  inventory to manage, no dependence on being able to exit. This is the
  opposite shape of the LESSONS take-profit trap (frequent small wins,
  occasional big residual losses): here wins and losses are the same size
  and the edge is in the price, not the win rate.

## Capacity

`friction.csv`/checkpoints at the cell: median top-3 depth on the dog's buy
side = 1,021 shares (~455 USDT at 0.446); p25 = 429 shares (~191 USDT);
p10 = 191 shares. Honest ding: a single window does NOT absorb a 3-4k USDT
gabagool clip at top-3 — this is a ~200-500 USDT-per-window glitch that
fires ~27x/day (~12k USDT/day aggregate at p25-median fills). Edge per
window at median depth: ~455 USDT x 5c/0.446 ≈ 23-50 USDT — coincidentally
the namesake's per-market take.

## Falsifiable claim

On held-out episodes (the ~18,700 resolved 2025-10..2026-05 windows NOT in
the census sample), the t=0 checkpoint rule "buy the side with mid < 0.5 at
its best ask when that ask <= 0.46, hold to settlement" shows
P(win) − avg(ask) >= +3c pooled (P(win) statistically indistinguishable
from 0.50), with a positive sign in the majority of months. 000-baseline
spec for a human later: taker-buy cheaper side at window open, single
parameter sweep over the ask threshold (0.42/0.44/0.46/0.48) — the 0.48
cell must show ~zero edge (built-in placebo).

## Confession — most likely artifact

1. **The 15s grid hides the first-second reprice.** The t=0 checkpoint is
   the book AT open; a real order lands at t + latency. I measured decay at
   15s resolution only: half the mid-edge (2.8c) is gone by t=15. If most
   of that correction happens in the first 500ms (makers re-centering at
   the roll), the takeable edge is nearer +2-3c than +5.1c — still above
   fee-friction but a much thinner glitch. This is the one thing the census
   cannot resolve; a surveyor drilldown (sub-second book states in the
   first 15s for the 560 cell episodes) would settle it.
2. Statistical: z=2.41 pooled, found while scanning many regions. Mitigants:
   the t=0 anchor is a priori special (fair value known by construction),
   the region is contiguous with fair controls on both sides, halves agree
   in sign, and the mechanism join (90.5% anti-momentum) is an independent
   corroboration. Still, only held-out replication (7x more episodes
   available per month) makes this real.
3. Taker fees are not in `friction.csv`. At ~1% notional they cost ~0.45c
   per share here — small vs 5.1c but must be measured, not assumed, per
   SCOPE cost rules.

## Reproduce (duckdb, from glitch-hunt/census/)

```sql
WITH t0 AS (
  SELECT month, CASE WHEN up_mid<0.5 THEN up_best_ask ELSE down_best_ask END dog_ask,
         CASE WHEN up_mid<0.5 THEN up_won ELSE NOT up_won END dog_won
  FROM 'checkpoints.parquet' WHERE t_sec=0 AND up_mid IS NOT NULL)
SELECT COUNT(*) n, AVG(dog_ask) ask, AVG(dog_won::INT) p_dog
FROM t0 WHERE dog_ask BETWEEN 0.20 AND 0.46;
-- n=560, ask=0.4456, p_dog=0.4964
```

Prev-window alignment: join `outcomes_all.csv` on epoch-900; fav side =
prev winner in 53/560 skewed episodes (result_id 0=UP wins, 1=DOWN wins).

## Self-killed candidates this round (for the graveyard map)

- **Mid-window longshot overpricing (t 300-600, 5-9c band)**: looked like
  -2 to -2.8c dev on n~1,800 checkpoint rows, but rows are duration-
  weighted repeats of lingering episodes. Deduped to first entry per
  episode: -1.0 to -1.3c (inside friction) and month-INCONSISTENT (positive
  2025-11..2026-02, negative only 2026-04/05). Regime artifact. Trap name:
  checkpoint-row n is not episode n.
- **Endgame 96+ certainty grab (t=897/899, fav ~0.98, p=1.0)**: n=204,
  Wilson lower bound 98.2% vs ask ~0.986 — edge lower bound ~0, and the
  two-sided-book selection plus possible stale quotes at expiry make it
  unprovable at this n. Not worth a round.

---

## MANTIS VERDICT — Round 1, 2026-07-10

All seven axes attacked; all census numbers below independently re-queried
from `checkpoints.parquet`, not taken from the memo.

Axis findings:

1. SCOPE: pass. Rule = read t=0 book, taker-buy, hold to settlement.
   Replayable inputs only; prev-window join is narrative, not signal.
2. GRAVEYARD: no dead family or LESSONS entry covers this. Closest is
   `momentum-hold` (status: proposed, driver = intra-episode lookback
   momentum — different driver). The LESSONS entry-timing-spike lesson does
   not apply: t=0 is a priori structural (strike reset), and the response
   is a decaying plateau (t=15/30/45/60 edge +2.6/+2.1/+2.2/+2.5c), not an
   oscillating spike.
3. MEASUREMENT: headline reproduces exactly (n=560, ask 0.4456, P(win)
   0.4964). Robustness cuts all STRENGTHEN it: drop the =0.46 point mass
   (n=181) → +6.0c on n=379; age<2s → +5.4c; drop the two snapshot-sparse
   months 2025-10/11 → +5.7c on n=514 with P(win)=0.5019, dead on the
   martingale anchor. Month split verified: 6/8 positive, no single-month
   carry (worst positive-month dependence: removing 2026-05 still leaves
   +3.7c). Multiple-comparisons discount is real (pooled z=2.41) but this
   is the ONE cell in the census whose fair value is known by
   construction, with fair controls on both flanks (0.46-0.48: -1.2c;
   0.48-0.50: -0.4c) — the outcome side is near-tautological; the anomaly
   is the measured book, which is not sampling noise.
4. FRICTION: at t=0 touch, spread consumed, 156bps taker fee ≈ 0.7c vs
   +5.1c — clears. The confessed weakness is takeability of the t=0 ask.
   My decisive counter-measurement: the mispricing is NOT a snapshot
   phantom — the same 560 dogs' standing ask reprices only to ~0.471-0.475
   and PLATEAUS there through t=60, leaving +2.1-2.6c gross (+1.4-1.9c net
   of fee) at checkpoints that are trivially takeable with no sub-second
   race. That pessimistic bound is positive but NOT yet significant at
   census n (z≈1.2) — it is the load-bearing number for replication.
5. TRAPS: binds (560/2,000 episodes selected); win rate does NOT track
   entry price (0.4964 vs 0.4456 — the gap IS the claim, inverse of the
   fair-odds trap); not month-concentrated (above); loss tail bounded at
   stake by construction (single buy, hold to $1/$0 settlement, no exit
   dependence, no inventory).
6. CAPACITY: fails the 3-4k USDT/market bar — verified median top-3 dog
   ask depth 1,050 shares (~465 USDT), p25 468, p10 200. This is a
   ~200-500 USDT/window glitch, 27x/day. Scoring ding, not a kill under
   the mission definition.
7. ADVERSARY: donor named (pre-open reversal flow + makers accommodating
   it), persistence named (strike reset instantly invalidates the thesis;
   per-window size too small and too brief to police). "It's small" —
   acceptable.

One flag the memo missed: the edge is side-lopsided — dog=UP +8.1c (n=282,
P(win) 0.5248) vs dog=DOWN +2.1c (n=278, P(win) 0.4676). Difference is
within noise (z≈1.35) but if it persists on holdout with dog=DOWN ≤ 0, the
"reversal flow" mechanism is wrong and this is a trend/autocorrelation
artifact of a drifting sample (unconditional P(up)=0.5075, monthly range
0.428-0.556). Replicator must report the side split.

**VERDICT: SURVIVES** (quota 1/3 consumed this cycle).

- Falsifiable claim, restated at the defensible bound: on held-out
  resolved episodes (2025-10..2026-05 minus the 2,000 census episodes,
  expected in-cell n ≈ 5,000), when the cheaper side's best ask ≤ 0.46 at
  the t=0 checkpoint: (a) P(dog wins) is statistically indistinguishable
  from 0.50 and exceeds the avg t=0 ask by ≥ +3c pooled, AND (b) the
  grid-takeable bound — entering at the t=15 checkpoint ask — retains
  ≥ +1.5c after a 156bps taker fee. (b) is load-bearing: (a) alone is a
  claim about a book state no order can be guaranteed to hit.
- Required re-measurement (replicator, fresh script): same rule on holdout
  episodes only; report pooled and per-month edge at t=0 AND at t=15/30/60
  entry; the 0.46-0.50 placebo bands (must stay ≈ 0); the dog=UP vs
  dog=DOWN split; depth at the touched levels. No backtest, checkpoint
  extraction only.
- I concede if: pooled holdout t=0 edge < +3c; OR t=15-entry edge net of
  156bps ≤ 0 with n ≥ 3,000; OR the placebo bands (0.46-0.50) show edge
  within 1c of the treated cell (selection artifact); OR the entire
  positive sign is carried by dog=UP while dog=DOWN ≤ 0 (drift artifact,
  not roll skew).
