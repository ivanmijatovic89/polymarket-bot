# Deep-dive: 0x04b6d7e9's btc-15m sleeve (fills × books + per-market audit)

OPEN-QUESTIONS #1 (session 8). The strongest living variant's execution
on the lab's exact book, from two joins over the SAME 30 consecutive
btc-15m windows (2026-06-12 11:45–19:15Z, US session — note: per O7
this is the HARD pair-cost regime; overnight numbers are likely better):

- `scripts/edge-source.ts` (A17 method) — /activity BUY fills ×
  Telonex delta-typed book replay: level class at fill time, offset vs
  touch, minute-of-window, post-fill mid drift. 4,619 fills matched
  (16 unmatched), $82k notional. Books pulled to data/telonex-r2/ via
  the FIXED pull-telonex-r2.ts (it fetched `r2://` URIs with plain
  fetch — never worked for r2-only rows; now routes through
  src/r2 downloadR2ToLocal. The A17-era runs used the canonical local
  tree, so A17 numbers are unaffected).
- `scripts/deep-dive-04b6.ts` — per-market leg audit from the same
  /activity pull, winners from telonex DB result_id.

The wallet traded ALL 30 consecutive windows in the stretch — no
window selection; participation is continuous, as the atlas timeline
implied.

## 1. Level-class fingerprint (vs the A17 wallets, same method & era)

| class | 04b6d7e9 fills%/notional% | b55f | 0xce25 |
|---|---|---|---|
| taker (≥ ask) | 38.0 / 39.2 | 32.4 / 43.0 | 35.6 / 42.6 |
| at-touch | 24.2 / 22.9 | 25.1 / 15.7 | 20.7 / 18.5 |
| inside spread | 11.7 / 10.2 | 7.0 / 6.2 | 4.4 / 3.4 |
| deeper ladder | 26.1 / 27.7 | 35.5 / 35.0 | 39.3 / 35.6 |

Offset vs touch (price − bestBid): p10 **−2c** / p25 −1c / p50 0 /
p75 +1c / p90 +4c. Compare b55f/0xce25 p10 = **−12/−13c**.

**The ladder is SHALLOW.** The touch-hugger profile: half its maker
volume rests AT the touch or inside the spread; the deep tail barely
reaches −2c. Its deep pair costs (p25 0.940) are achieved by TIMING —
catching both sides' dips with near-touch quotes — not by resting deep
discount ladders and waiting for sweeps. This is a different mechanism
than b55f/0xce25 and modifies the H1 ladder prior: deep offsets are
one road to sub-$1 pairs, not the only one.

Maker-share reconciliation: the era scans (on-chain, role-exact) give
makerShare 0.889 on Jun-15 across all books; this join classes 38% of
btc-15m fills taker-priced. The arithmetic closes: btc-15m is ~27% of
its notional (Jun-15 scan), and 0.38 × 0.27 ≈ 10% ≈ the scan's 11%
taker share — i.e. **essentially ALL of its taker flow lives on
btc-15m; the btc-5m/hourly sleeves are maker-pure.** (Level-class ≠
role — stale-book misclassification exists — but the consistency is
tight.) The wallet runs different execution per book: maker-pure
where it farms, taker-completing where the pair edge is.

## 2. Timing and adverse selection

Minute-of-window: near-FLAT (6–7.5%/min) with a mild lift minutes
10–12 (27.4% of fills, 30.9% of notional) and a hard cut in minute 14
(2.3%). Far less back-loaded than b55f (39.7% in minutes 10–13).

Post-fill mid drift (BUY fills): touch **+0.32c @10s / +0.93c @60s**,
deeper +0.24c / +0.54c — favorable, not adverse; taker −0.24c /
−0.37c — it pays the spread AND small immediate adverse drift on
completions. At this horizon its resting fills show **no adverse
selection signature**, consistent with A17's read for the June edge
cohort, and now shown for a shallow near-touch ladder specifically.

## 3. Per-market leg audit (30 windows, US session)

| metric | value |
|---|---|
| pairRate p25/p50/p75 | **0.83 / 0.94 / 0.98** |
| pairCost p25/p50/p75 | 0.940 / 0.982 / 1.022 |
| fills/market p25/p50/p75 | 119 / 137 / 193 |
| outlay/market p25/p50/p75 | $1,930 / $2,955 / $3,706 |
| distinct price levels per side p50 | 43–46 |
| inter-fill gap p50 | ~1s |
| gross PnL (30 mkts) | +$579 total; p10 −$332 / p50 +$20 / p90 +$234; 14/30 losers |

- **The atlas pairRate 0.78 is a cross-book artifact.** On btc-15m
  alone the wallet is a 0.94-parity grinder (p50), with the low tail
  (0.70–0.83) coming from windows where it lets one leg run. Its
  cross-book number is dragged down by the 5m/hourly sleeves.
- **The excess leg is a directional CHOICE, not an adverse
  constraint.** Excess avg px 0.547 vs other-leg 0.437 (it leans
  toward the FAVORITE, not the cheap side; cheap-side excess in only
  15/30) and the excess leg WON 18/30 (60%) — EV ≈ 0.60 − 0.547 ≈
  +5c/share gross. The feared failure mode (cheap side fills pile up
  adversely when that side is about to lose) is NOT what this wallet's
  imbalance looks like.
- **Sleeve economics in the hard regime are thin.** Gross +0.65% of
  outlay; estimated taker fee drag ≈ 2.78% × 39.2% taker notional ≈
  1.1% of total notional (/activity is gross-of-fee, A13) → trading
  net ≈ breakeven-to-slightly-negative, plus maker rebates ≈ 0.7% ×
  ~61% maker notional ≈ +0.4% → sleeve ≈ modestly positive. Its
  +0.30%-of-turnover overall margin is NOT concentrated in US-session
  btc-15m; the 47% loser rate with ±$300–400 tails at $3k outlay is
  what "thin structural edge + rebates" looks like per-market.
- Capital: $2,955/market p50 is ~3.3× b27bc932's $896 (W2) — still
  small; a $5–10k bankroll covers the sleeve at this scale.

## 4. Implications for the lab

1. **H1 ladder prior widens**: {touch-hugging shallow ladder, requote
   fast, taker-complete when pair-improving} is the strongest living
   variant's btc-15m recipe — add a "shallow + fast" cell alongside
   the deep-offset cell (b55f-style) in the first sweep. 40+ price
   levels/side and 1s inter-fill gaps imply requote cadence ≪ 15s —
   at or beyond the sim's latency envelope; the lab should test
   requote intervals as a first-class parameter.
2. **Pair-completion targets**: on btc-15m aim pairRate ~0.95 with
   pairCost ≤0.98 median; accept ~0.83 pairRate when one side runs —
   and when leaving a leg unpaired, leave the FAVORITE-side leg, not
   the cheap one (sign of the 60% excess-win read).
3. **Expect losers**: ~47% of markets lose gross in the US session at
   these parameters; certification metrics must be distributional
   (H-family kill lines), not win-rate-based.
4. **Regime split matters — RESOLVED differently than expected
   (A35)**: this sample is the hard 12–19Z regime because that is the
   ONLY regime this wallet trades — zero fills 20–05Z ever, weekdays
   81/83 vs weekends 11/32, dark on Memorial Day. There is no
   overnight data to compare; the winner deliberately lives where
   flow is 2–5× even though realized pair costs are worst there.
   Overnight-vs-session comparison must use b27bc932 (24/7) instead.

## Producing commands

- npx tsx research/gabagool/scripts/pull-telonex-r2.ts --symbol btc
  --timeframe 15m --from 2026-06-11T00:00:00Z --to 2026-06-15T00:00:00Z
  --slugs-file research/gabagool/data/04b6d7e9-jun-slugs.txt --limit 30
- npx tsx research/gabagool/scripts/edge-source.ts --activity
  research/gabagool/data/activity-04b6d7e9-jun12-14.jsonl --dir
  research/gabagool/data/telonex-r2
- npx tsx research/gabagool/scripts/deep-dive-04b6.ts --activity
  research/gabagool/data/activity-04b6d7e9-jun12-14.jsonl
