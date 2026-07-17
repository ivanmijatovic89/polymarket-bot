# 0x95f51617…779f — "the failed challenger" (RECLASSIFIED: World Cup blow-up, not a class casualty)

Address: `0x95f51617e900f7d4df2894d77a73c1b2b269779f`
Profile created 2026-01-07 (the day after 15m-crypto fees). All-time lb
profit −$547k, 30d (mid-Jun→mid-Jul) −$542k (A23).

**Bottom line (A26): this wallet is NOT a failed gabagool-class
challenger.** Its crypto-updown activity was always dust-scale and
roughly breakeven; the −$542k was lost market-making 2026 FIFA World
Cup sports books at ~$100+ clips over ~3.5 weeks. A23's contrary read
was a chimera artifact: volume/profit taken from the (WC-dominated)
leaderboard, book classification taken from a last-500 /activity sample
that landed after it had reverted to crypto dust — exactly the A24
lesson ("never infer book mix from last-500 scans"), re-learned on the
loss side.

## Method

- `scripts/challenger-timeline.ts` — one /activity page per UTC day,
  2026-01-07 → 2026-07-17, density-extrapolated when the page is full
  (500 rows). Output: `data/challenger-timeline.json` (gitignored).
- Loss attribution: data-api `/positions` (all 417 remaining rows,
  paged). The positions ledger is **loss-biased** — worthless (losing)
  tokens are never redeemed so their rows persist with cashPnl, while
  redeemed winners vanish — which makes it exactly a ledger of where
  money was lost.

## Four eras (from the daily timeline)

| era | dates | active days | fills | notional | clip | merges | books |
|---|---|---|---|---|---|---|---|
| probe | Jan 07 – Apr 21 | 22/105 | 683 | $1.7k | $2.4 | 0 | btc-updown 15m/5m + stray NBA/valuations |
| grind | Apr 22 – Jun 10 | 35/50 | ~452k | ~$1.42M | $3.1 | 0 | btc-updown-5m + btc-updown-15m, BUY-only |
| silence | Jun 11 – Jun 23 | 0/13 | 0 | 0 | — | — | — |
| whale | Jun 24 – Jul 17 | 21/24 | ~387k | ~$40.7M | $105 | yes (first ever) | fifwc-* (World Cup), some MLB, crypto dust |

- The grind era IS gabagool-shaped (BUY-only, $3 clips, no merges,
  btc 5m+15m) but at ~$28k/day notional — never "at scale".
- The whale era is a different machine: clip ×33, merges appear,
  books switch to fifwc-* spread/total/team-to-advance markets. Peak
  day Jul 3 (arg-cvi): ~$26M notional est. (density-extrapolated;
  order of magnitude corroborated by the 30d leaderboard volume,
  $1.48M/day ≈ $44M ≈ whale-era total $40.7M).
- After the WC semifinals (eng-arg Jul 15) it reverted to crypto dust
  (~$2–33k/day, $1.9 clips — the live-shadow O3 observation).

## Loss attribution (positions ledger, 2026-07-17)

Sum of cashPnl by book family over all 417 surviving positions:

| family | cashPnl | n positions |
|---|---|---|
| worldcup (fifwc-*) | **−$615,456** | 254 |
| btc-updown-5m | −$1,478 | 44 |
| eth-updown-5m | −$662 | 35 |
| mlb | −$555 | 26 |
| btc-updown-15m | −$310 | 21 |
| eth-updown-15m | −$176 | 8 |
| other | −$100 | 29 |

Single worst position: fifwc-che-col-2026-07-07-team-to-advance
**−$135,955**; five positions ≥$30k, all WC. All crypto-updown families
combined: **−$2.6k** — three orders of magnitude below the WC loss and
consistent with the pre-whale all-time profit (−$547k all-time minus
−$542k/30d ≈ −$5k for the entire Jan–Jun crypto life).

Caveat: gross WC losses (−$615k) exceed the net 30d figure (−$542k) —
the difference is redeemed WC winners + $60k maker rebates, which the
positions ledger cannot show. Attribution of the LOSS side is
unambiguous regardless.

## What this changes for the class research

1. **The class loses its only large negative example.** No wallet is
   currently known to have lost big running sub-$1 pair accumulation
   on crypto up/down. The remaining measured negatives are small:
   HelixEdge −$20k/30d (btc-5m cold start), and fee-era margin
   compression (the archetype's exit).
2. "Losing big is a live outcome of this strategy family executed
   badly" (A23 / _META consequence d) is withdrawn. The correct
   statement: losing big is a live outcome of *general MM bots
   wandering into event-driven sports books*; the crypto-updown class
   has so far produced only slow bleeds or breakeven-plus-subsidy.
3. The wallet remains mildly interesting as a *probe-then-pivot*
   specimen: it ran the gabagool recipe at dust size for 7 weeks,
   apparently concluded it wasn't worth scaling (breakeven at $3
   clips, near-zero rebate tier), paused 13 days, and redeployed the
   same infrastructure on a seasonal sports event — where the passive
   two-sided book-state trigger got run over by informed flow
   (team-to-advance books move discontinuously on goals; a resting
   ladder is pure adverse selection there). That contrast is itself
   evidence FOR the 15m-crypto niche: bounded windows, continuous
   underlying, no jump-to-zero information events mid-window.
4. W1 ("failed-challenger post-mortem") is hereby CLOSED as
   reclassified — the deep post-mortem of its WC losses is sports-MM
   research, out of scope. The residual in-scope question (why did it
   judge the grind not worth scaling?) is answered by A16/A22
   economics: at tier-0 taker fees and ~$28k/day maker share its
   rebate income would have been ~$10–30/day — rational to quit.
