# Session split: time-of-day economics of a 24/7 parity grinder (A36)

Question (residue of A35): does time-of-day change pair economics?
0x04b6d7e9 can't answer it (it only trades 12–19Z weekdays), so this
uses the 24/7 wallet b27bc932's full June pull — 222 btc-15m markets
(Jun 12 00:00Z → Jun 14 09:30Z, ≥1h margins), winners from telonex DB.

Script: `scripts/session-split.ts` (leg audit per market as
deep-dive-04b6.ts, bucketed by window start hour).

| bucket | mkts | fills/mkt p50 | outlay p50 | pairCost p25/p50/p75 | gross PnL | p10/p50/p90 | losers | excessWon |
|---|---|---|---|---|---|---|---|---|
| overnight 00–05Z | 68 | 134 | $760 | 0.955/0.990/1.035 | **+$219** | −$52/+$9/+$54 | 46% | 71% |
| eu 06–11Z | 58 | 173 | $925 | 0.960/0.988/1.031 | **+$274** | −$64/+$11/+$55 | 36% | 67% |
| us 12–19Z | 64 | 200 | $1,132 | 0.960/**1.006**/1.041 | **−$384** | −$110/+$1/+$71 | 50% | 81% |
| evening 20–23Z | 32 | 157 | $937 | 0.969/0.991/1.014 | **+$566** | −$26/+$16/+$66 | 28% | 78% |

All: 222 markets, +$674 gross on $231k outlay (+0.29%, gross of fees;
~50% taker share means real fee drag is material — A24 already showed
this wallet's trading line is ≈ breakeven fee-inclusive, subsidy
carries it).

## Findings

1. **The US session is where the parity-grind recipe BLEEDS.** Median
   pair completes above $1 (1.006), half the markets lose, the left
   tail doubles (p10 −$110 vs −$26..−$64 elsewhere) — even though the
   wallet commits MORE capital and gets MORE fills there ($1,132 /
   200 p50). Every other session is gross-positive.
2. **Put against A35, the two living winners divide the day**: the
   grinder's edge lives overnight/EU/evening; the US session belongs
   to 0x04b6d7e9's shallow-fast-requote + favorite-lean recipe (the
   ONLY hours it trades). Same book, same days — the profitable
   recipe is session-dependent, not just parameters.
3. **Excess-leg direction confirms A34 across wallets**: b27bc932's
   excess leg won 67–81% of markets by session — even a 0.98-parity
   grinder's tiny residual lean is informed. The unpaired remainder
   as informed directional lean is now a CLASS pattern (n=2 at very
   different parity tolerances).
4. Caveats: one wallet, 2.4 days (Jun 12–14, Fri–Sun boundary),
   gross-of-fee, /activity-based. The W4 scale-up should stratify by
   session over months before this becomes a build rule.

## Lab implications

- Add session as a sweep dimension (or at minimum a reporting
  segment): {00–05, 06–11, 12–19, 20–23}Z. Expect the parity-grind
  cell to fail 12–19Z and pass elsewhere; expect the shallow-fast
  cell (A34) to be the US-session candidate.
- A v1 that runs the grinder recipe overnight/EU/evening and either
  idles or switches recipe 12–19Z matches BOTH living winners'
  revealed preferences.

## Producing command

- npx tsx research/gabagool/scripts/session-split.ts --activity
  research/gabagool/data/activity-b27bc932-jun.jsonl
