# Edge-source: how the edge wallets actually trade btc-15m (fills × books)

Question 1 of OPEN-QUESTIONS: what does the +2.3% fee-inclusive btc-15m
edge (A16) actually DO against the book?

Method: `scripts/edge-source.ts` — joins a wallet's /activity BUY fills
with the Telonex delta-typed book replay (same helper as D2); per fill:
level class at fill time (taker ≥ ask / at-touch = bid / inside spread /
deeper-than-bid), offset vs touch, minute-of-window, post-fill mid drift
(+10s/+60s). Window: **Jun 12–14 2026** (Telonex coverage ends
2026-06-14 globally — July books do not exist; June is era-consistent:
post taker-rebates, current fee formula). Pulled fresh June activity for
both wallets (39k + 33k rows). ~190 markets, 7.7k/8.7k fills joined,
<1% unmatched.

## Level-class mix (the execution fingerprint of the current edge)

| class | b55f fills% / notional% | 0xce25 fills% / notional% | px p50 (b55f / ce25) |
|---|---|---|---|
| taker (≥ ask) | 32.4 / 43.0 | 35.6 / 42.6 | 0.58 / 0.58 |
| at-touch | 25.1 / 15.7 | 20.7 / 18.5 | 0.14 / 0.45 |
| inside spread | 7.0 / 6.2 | 4.4 / 3.4 | 0.47 / 0.50 |
| deeper ladder | 35.5 / 35.0 | 39.3 / 35.6 | 0.40 / 0.42 |

- **~43% of notional is TAKER** for both (consistent with July's
  on-chain 62%/55% including sells and other flows; A16) — the current
  edge expression is maker-biased accumulation + heavy taker completion,
  the same mix D2 found for the archetype (29–45%), shifted further
  taker.
- The deep ladder is REALLY deep: offset vs touch p10 = **−12/−13c**
  below best bid (p25 −2c). These are patient discount bids waiting for
  sweeps, not touch-hugging quotes.
- b55f's at-touch resting concentrates on the CHEAP side (px p25 0.03,
  p50 0.14 — longshot bids at the touch), while its taker completions
  are mid-band (0.34–0.71 IQR). 0xce25 rests at-touch across the band.
- Post-fill mid drift at +10s/+60s is small and mixed (±0.5c, no strong
  adverse signature in EITHER direction) — at this granularity the June
  fills do not look like they're being run over; the worst_queue
  "adverse subset" story (A9) is about which resting fills HAPPEN, not
  visible post-fill collapse.

## Timing within the window (minute of 15)

| minutes | b55f fills% | 0xce25 fills% |
|---|---:|---:|
| 0–4 (open) | 24.8 | 30.9 |
| 5–9 | 28.7 | 31.1 |
| 10–13 (late) | **39.7** | 32.8 |
| 14 (final) | 6.8 | 5.3 |

- Both are **back-loaded**: the last third of the window carries the
  most fills (b55f minute-12 peak: 12.1% of all fills), and both cut
  activity in the final minute. The open (minute 0) is ordinary — no
  own-the-open concentration (Game F prior: negative for this cohort).
- b55f back-loads harder than 0xce25 AND taker-completes cheaper (taker
  px p25 0.34 vs 0.42, implied taker fee 2.07% vs 2.35% of taker
  notional in June; on-chain July: 1.43% vs 2.64%). Combined with A16's
  margin gap (+2.31% vs +0.31%), the H6 reading sharpens: **the better
  wallet waits longer and crosses at prices further from the fee peak.**

## Implications for the lab (priors)

1. Ladder priors for H1: levels at touch AND −2c to −13c below touch;
   cheap-side touch-resting is where passive longshot accumulation
   happens; expect ~1/3 of fills from sweeps into the deep ladder.
2. A completion policy that crosses mid-band pays ~2.1–2.4% of that
   notional in fees — it must be reserved for pair-cost-improving
   completions (H6 cap rule), and preferentially executed AWAY from
   p=0.5 (fee peak).
3. Time-weighting: weight quoting toward minutes 8–13; de-risk minute
   14. The open needs no special treatment.
4. worst_queue sim note: the deep-ladder third of real fills IS the
   part worst_queue models best (price must trade through); the
   at-touch/inside 30% and taker 35% need the trades-channel model /
   taker legs respectively (G1/G2).

## Producing commands

- scripts/pull-activity.ts --label {b55f,0xce25}-jun --start 1781222400
  --end 1781429400
- scripts/edge-source.ts --activity data/activity-{b55f,0xce25}-jun.jsonl
  --dir data/events/telonex/delta-typed/btc/15m --from
  2026-06-12T00:00:00Z --to 2026-06-14T09:30:00Z
- scripts/pull-telonex-r2.ts exists for future R2 pulls (July books
  turned out not to exist; kept for when Telonex sync resumes).
