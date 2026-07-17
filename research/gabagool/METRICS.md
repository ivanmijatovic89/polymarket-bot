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
| rebate income | 20% × Σ venue-fee-curve over own maker fills × pool share | flips the sign in the current meta (G4) | tail: +$1,819/2.6d vs −$1,767 trading |
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
| post-fill drift | mid(t+Δ) − mid(t_fill), Δ ∈ {10s, 60s, end} | direct adverse-selection measurement per fill |
| worst-queue admissibility | % of real fills where bestAsk < fillPrice strictly after fill (engine rule) | D2 — THE sim-credibility number |
| inter-fill gap | within-market gap distribution | cadence fingerprint; tail p50 0s (bursts), successor 11s median |
| time-to-pair | seconds between one leg's fill and the pair-completing fill on the other | quantifies the oscillation-harvest window; sets leg-risk policy timeouts |

## Portfolio/meta metrics

| metric | definition | why |
|---|---|---|
| margin on volume | net PnL / volume | the signature: 0.9–2.0% across active wallets (_META) |
| books traded/day + leading book rotation | which of the ~16 books carried the day | INV: rotates daily; diversification is load-bearing |
| rebate share sustainability | own maker volume / market total maker volume | pool dilution — the competition variable (G8) |
| per-era split | all metrics split at 2026-01-06 (fee introduction) and at any later fee change | the game changed regimes mid-life; never pool across |

## Measurement discipline (inherited)

- Minority-outcome count ≥ ~30 before trusting any high-win-rate cell
  (fable E14).
- Never pool paired/delta replay semantics, or pre/post-fee eras.
- Cash-flow accounting from /activity is complete and oracle-free, but
  requires the v2 puller (no content dedupe — see STATE pitfall).
- Per-leg UI/leaderboard reads are inflated for both-sides wallets (P17);
  lb-api windows mix realized and MTM (P16).
