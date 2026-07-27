# PRIORS — inherited knowledge (optional, verify before relying on it)

> Distilled from earlier on-chain research of profitable bots running this
> exact strategy class (measurements through July 2026) and from prior
> backtests of it in our own simulator. **These are PRIORS, not truths of
> this protocol**: nothing here has been re-verified by this team. Use them
> as leads and shortcuts, re-verify anything you build on (per RULES
> evidence discipline), and feel free to ignore them. Do NOT start by
> reading this file — start from RULES.md; come here when you want context
> or hypotheses.

## Venue & fee mechanics (highest confidence — measured exactly)

- **Fees (current era)**: maker pays **$0**; taker pays **0.07·p·(1−p) per
  share** (peak 1.75¢/share at p=0.5). Earlier eras differed (zero-fee
  until 2026-01-06; steeper curve until ~2026-05-08) — never pool
  measurements across fee eras.
- **Maker rebates**: ~20% of taker fees recycled to makers,
  ≈ `1.4%·(1−p)` per $1 of maker notional; volume-proportional, same rate
  at every tier. The btc-15m maker rebate pool is ~**$6.8k/day total**
  (measured 2026-07-16) — all makers on the book share it.
- **Ties resolve UP** (oracle = Chainlink BTC/USD data stream; end ≥ start
  → UP): tiny structural asymmetry favoring the UP leg in dead-flat
  windows.
- Tick 0.01, min order 5 shares, negRisk = false.

## What profitable bots actually did (on-chain forensics)

- **Buy-only, always**: the most profitable measured bot placed zero sells
  ever, across all eras. Exits were batched merges (~99% of exit dollars)
  plus redeem dust.
- **Small clips, huge counts**: median buy ~$4 (p90 ~$13), tens to
  hundreds of fills per market; wide quoting band (~0.11–0.85), not just
  cheap tails.
- **Two proven roads to sub-$1 pairs today**:
  1. **Deep patient ladders** — resting rungs down to −12c below best bid,
     cheap-side rests at the touch; back-loaded fills.
  2. **Shallow fast requoting + timed taker completion** — seconds-scale
     requotes near the touch, completing the lagging leg as taker when
     pair margin + rebate > fee.
  Current winners are ~62% taker by notional and still clear ~+2.3% of
  turnover fee-inclusive.
- **Timing inside the 15m window**: winners' fills concentrate in
  **minutes 10–13**; the final minute is cut; the open gets no special
  weight. Books are ~1c-tight the whole window — the opportunity is depth
  sweeps, never wide spreads.
- **Session structure (weekdays)**: 20–24Z is the only robustly positive
  session for passive grinding; the US session 12–19Z is toxic for it
  (adverse flow by clock, not by quoting policy); weekends are mildly
  positive and structureless. Hour-of-day is a policy variable.
- **Leg imbalance is a knob, not a sin**: today's winners tolerate 20–40%
  per-market leg imbalance and lean the excess toward the FAVORITE side
  (that leg won ~60%); the one perfect-parity wallet measured is
  trading-negative and lives on rebates. In the fee era, forcing parity
  means paying the tax on the completing leg. Sweep imbalance tolerance
  (strict → ~40%); cap cheap-side excess tighter than favorite-side.
- **Cold-start economics**: maker-pure new entrants win today (rebates pay
  the same at every tier); the entry risk is taker completion at tier-0
  fees — a tier-0 bot must budget the FULL 0.07 curve on every taker leg.

## Economics expectations

- Realistic planning number for a single-book (btc-15m) v1: **~$1–3k/day**
  — inferred from per-wallet history, not a measured single-book ceiling.
  Margin compression is measured per-book and is the expected end state:
  the strategy dies by slow squeeze, not blow-up (no large-loss example
  exists in the measured class; worst downside was a slow bleed from bad
  taker-fee management). A multi-book, multi-wallet, tier-maxed operator
  demonstrably still extracts ~$15k/day today — scaling beyond one book
  means more books, not more size on this one.

## Simulator lessons (from prior backtests of this strategy class HERE)

- **The sim sees only ~44–49% of real fills** (worst_queue maker model
  admits roughly half of live fill reality). Backtests are a lower bound
  and a screening tool; final validation needs live-paper or live-probe
  data.
- **Requote churn × latency is the latency killer**: at 140 ms simulated
  latency, a variant that requoted on small book moves multiplied its
  fills 8.3× and turned 34% of them into fee-paying taker fills. Quote
  stability is a design axis; every variant must survive a latency battery
  (0 ms AND 140 ms+) — this is what "not latency dependent" means
  operationally.
- **Shallow blind rungs don't pair**: a [−1c, −3c] ladder at 0 latency
  ended the median market fully one-sided. The pair discount must be
  engineered by placement depth and completion policy, not harvested from
  quote noise.
- **Guard placement, free the rescue**: capping the pair cost you BUILD
  (placement-side never-overpay) improved results monotonically; capping
  the pair you RESCUE (completion-side) blocked exactly the completions
  that mattered — harmful.
- **The first lever that beat the reference used an external level signal**
  (spot vs strike — our priceToBeat feed): conditioning "stop standing on
  the side price is leaving" on that signal tripled the winner-remainder
  value; doing the same mechanically (freezing quotes) destroyed it.
  Information beats mechanics.
