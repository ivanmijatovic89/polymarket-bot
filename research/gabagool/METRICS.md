# METRICS — the metric catalogue for the gabagool concept

Living file (workstream E). What to measure for any variant of "passive
two-sided accumulation → merge/redeem", why, and the reference values
measured so far. Consumers: STRATEGY-BRIEF, HYPOTHESES, and the SRP
family that eventually implements this (its FAMILY.md should adopt these
as its result-inspection vocabulary beyond `evPerMarketTotal`).

## Core per-market metrics

| metric | definition | why it decides | reference values so far |
|---|---|---|---|
| pair cost | `upCost/upShares + downCost/downShares` (bought legs only) | THE rule: <$1 prints, ≥$1 loses (P11) — unless rebates pay | gabagool tail p50 0.99–1.00, showcase 1.020 (rebate-financed); Dec era TBD |
| pair completion | `min(netUp, netDown) / max(netUp, netDown)` | unpaired remainder is the only unhedged risk | gabagool tail ≈ 0.999 (0.13% imbalance) — he completes almost perfectly |
| unpaired exposure $ | `(max−min leg) × avg cost of surplus side` | tail-loss driver (P14) | tail p50 $2–8/market |
| net cash PnL | −BUY + SELL + REDEEM + MERGE (cash flow, no oracle) | ground truth per market incl. abandonment | tail: −0.50% of turnover |
| rebate income | **exact**: 0.20 × Σ 0.07·p(1−p)·size over own maker fills, per market; $0 if < $1/market/day (A22 — pool share cancels, no assumption) | flips the sign in the current meta (G4) | tail: +$1,819/2.6d vs −$1,767 trading; btc-15m pool ≈ $7.3k/day |
| **taker-fee drag** | Σ published-curve fee over own TAKER fills (per era formula, VENUE-MECHANICS) | /activity nets are GROSS of this (A13); the sign of the edge depends on it | Jul actives: 0.9–2.6% of turnover by book (A16) |
| **fee-inclusive margin** | (net cash PnL − taker-fee drag) / buy turnover | the honest edge number; rebates stay a separate line | b55f btc-15m +2.31%; 0xce25 +0.31%; btc-5m cells negative (A16) |
| **taker share of notional** | taker-side notional / total (per-fill role from receipts) | the winning meta is ~62% taker (A16) — pure-maker sims model a minority | archetype 29–45% (fills, D2); Jul edge wallets ~62% (notional) |
| win rate | markets with net cash > 0 | payoff-shape check, NOT edge (fable E14/E31) | tail 39–65% by family (NOT the reported 99%) |
| PnL tails | p10/p90 net$, worst-market | one −$500 market eats 50 winners | tail p10 −$8..−$53 by family; worst −$145 |
| fills/market | count; p50/p90/max | capacity + rebate volume driver | tail p50 45–162, p90 up to ~800, max 2,478 |
| max outlay | −min running cash | capital per market → sizing, ROC | tail p50 $150–610, max $6.4k |
| capital velocity | merged $ per hour / max outlay | live merges recycle capital ~minutes; sim locks to episode end (G5) | gabagool merged every few min, batched cross-market |

## Execution-quality metrics (need book join / live)

| metric | definition | why |
|---|---|---|
| fill offset vs mid | (mid_at_fill − fill price) signed per leg | measures the collected discount; INV P21: only inferable from fills×books |
| fill offset vs fair | fill price vs Binance-anchored fair value | separates "cheap vs mid" from "cheap vs truth" (adverse selection) |
| post-fill drift | mid(t+Δ) − mid(t_fill), Δ ∈ {10s, 60s, end} | direct adverse-selection measurement per fill. A39: this is THE discriminator between the two shallow-ladder wallets — +0.9c@60s (04b6d7e9, +0.30%T) vs −0.4c (b27bc932, ≈0%T); report per sweep cell, it converges long before per-market PnL. A58: ALWAYS stratify by session×class — the deep-class drift flips sign between weekday evening (+1.4c) and US hours (−0.4c) on the SAME policy; an unstratified mean hides the regime |
| worst-queue admissibility | % of real fills where bestAsk < fillPrice strictly after fill (engine rule) | D2 — THE sim-credibility number |
| inter-fill gap | within-market gap distribution | cadence fingerprint; tail p50 0s (bursts), successor 11s median |
| time-to-pair | seconds between one leg's fill and the pair-completing fill on the other | quantifies the oscillation-harvest window; sets leg-risk policy timeouts |
| minute-of-window fill share | % of fills per minute 0–14 | timing fingerprint; A17: edge wallets back-load minutes 10–13 (b55f 39.7%) and cut minute 14; open is ordinary |

## Portfolio/meta metrics

| metric | definition | why |
|---|---|---|
| margin on volume | net PnL / volume | the signature: 0.9–2.0% across active wallets (_META) |
| books traded/day + leading book rotation | which of the ~16 books carried the day | INV: rotates daily; diversification is load-bearing |
| rebate share sustainability | own maker volume / market total maker volume | pool dilution — the competition variable (G8) |
| per-era split | all metrics split at 2026-01-06 (fee introduction) and at any later fee change | the game changed regimes mid-life; never pool across |
| per-session split | all PnL metrics segmented {00–05, 06–11, 12–19, 20–23}Z × {weekday, weekend} | A36/A46/A49 (3/3, month scale): US is the grinder bleed, evening the only current-era positive; session is a policy variable. A59 (n=10 weekend days): the map is WEEKDAY-only — weekends are flat mild-positive in all sessions (+0.5%, structureless) and the favorite-lean collapses there (excessWon ~50%); never pool dow |
| realized vol (Binance 1m, per window) | volBp = sqrt(Σ 1m logret²) | report as covariate ONLY — A49: vol terciles proxy session (storms cluster 12–19Z); never gate on vol alone, at most a US×storm veto |

## Measurement discipline (inherited)

- Minority-outcome count ≥ ~30 before trusting any high-win-rate cell
  (fable E14).
- Never pool paired/delta replay semantics, or pre/post-fee eras.
- Cash-flow accounting from /activity is complete and oracle-free, but
  requires the v2 puller (no content dedupe — see STATE pitfall) — and
  it is GROSS OF TAKER FEES in every fee era (A13/A16): fees are docked
  outside the reported size/usdcSize. Always report gross AND
  fee-inclusive; never add rebate income to a gross number.
- Per-leg UI/leaderboard reads are inflated for both-sides wallets (P17);
  lb-api windows mix realized and MTM (P16).
