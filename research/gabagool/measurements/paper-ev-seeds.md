# W6 — paper EV of the family seeds (measured numbers only, no engine runs)

Session 7, 2026-07-17. Purpose: give the lab prior EXPECTATIONS and
sharpened kill lines per seed before any sweep. Every number's
provenance is a ledgered amendment; bands are honest (these are priors,
not validation — the lab owns validation).

Scope: btc-15m, 96 markets/day. "T" = turnover (both legs). Rebate
math from A28 (1.4%·(1−p) per $ maker notional; $1/day/market step).
Cold-start rules from A32 (taker legs at tier-0: 3% refund only).

## Per-seed expectation table

| seed / cell | trading margin, %T | fee drag, %T | rebate, %T | net EV, %T | anchors |
|---|---|---|---|---|---|
| 1a parity, maker-only | −0.5 … +1.0 (adverse selection vs pair discount; unproven corner) | 0 | +0.70–0.77 (if ≥$143/mkt maker notional) | **+0.2 … +1.7** | 0x13e0d447 (maker-pure, ≈+$121k/5wk); archetype zero-fee +1.9%T is the ceiling, NOT the expectation |
| 1a **deep-pair cell** (pair ≤0.98, ~20% unpaired) | +0.2 … +0.5 | 0 | +0.7–0.9 (maker share ~0.9–1.0) | **+0.9 … +1.4** | 0x04b6d7e9 +0.30%T live (A30); livebreathevolatility historical (A31); ohio-house week-1 (A32) |
| 1b parity, taker completion (cold-start) | +0.3 … +1.0 gross | −1.2 … −1.4 (mid-band taker legs ~50% × 3.0–3.5%, tier-0) | +0.35–0.4 | **−0.7 … +0.2** | b27bc932 runs this at breakeven WITH better execution than a v1 bot will have |
| 2 cheap-side accumulator | +1.5 … +2.5 (fee-inclusive) | included | +0.4–0.6 (maker ~40% × 1.3%) | **+2.0 … +3.0** — but tail-shaped | b55f +2.31%T fee-inclusive (A16; on-chain fees, excludes tier refunds → valid for cold-start execution) |
| 3 fair-value-gated | = 1a + unquantifiable suppression benefit | 0 | ≈ 1a on lower volume | not paper-computable | BLOCKED on feed merge; the gating benefit has no measured anchor |
| farmer postures | −2 … −3 | dominates | +0.7 | **negative at tier-0** | A28/A32 (0x76d4d470's −0.98%T trading is the BEST measured farmer trading line) |

## Dollars per day at plausible v1 scale

Assume $150–500 maker notional per market (clears the $1/day/market
rebate step at the low end), 96 markets/day → $14k–48k/day turnover
(capital ≪ turnover with merge/redeem recycling — the archetype ran
~$3.2k per-market outlay p50, recycled).

- deep-pair cell: net +0.9–1.4%T → **$130–670/day**.
- 1a maker-only: +0.2–1.7%T → $30–820/day (band wide because the
  maker-only adverse-selection corner has no live pure anchor at
  0.99+ pair targets — 0x13e0d447 runs 0.89 pairRate, i.e. partly
  deep).
- 2 cheap-side: +2.0–3.0%T but per-market distribution is
  tail-shaped (47% win rate at b55f): daily P&L swings dominate the
  mean until n(markets) is large; judge on ≥30 minority outcomes
  (fable E14), never on mean-of-few-days.
- 1b at tier-0: possibly negative; run ONLY as comparison cells to
  measure the completion premium, not as a candidate.

## Sim-reading rules (so the lab doesn't mis-kill or over-believe)

1. **worst_queue admits 44–49% of touch fills (D2)** → sim
   fills/market and sim rebate line are ~2× LOWER bounds for
   touch-heavy cells; deep-rung cells are closer to faithful. A cell
   that shows HALF the expected fills at positive EV is on target.
2. **Rebate step**: cells below ~$143/mkt maker notional earn $0
   rebate — do not average the rebate line across cells (A28).
3. **Fee lines**: taker legs at tier-0 (A32); maker legs fee-free;
   matched pairs auto-credit $1 (engine fact, ENGINE-GAPS).
4. **Kill lines sharpened**:
   - deep-pair cell: kill if fee-inclusive trading margin < −0.9%T
     (i.e. worse than rebate can cover) across the whole cell range.
   - seed 2: kill per H2 (sim EV < 0 at every band cell, maker-only,
     Jun window) — unchanged.
   - 1b: expected to hover ≈ 0; its job is measuring the completion
     premium (H6 U-shape), not passing.
5. Subsidy share of net EV should be REPORTED per cell (H3): a cell
   that is >80% subsidy inherits venue-policy risk (G8) and should
   rank below a thinner but trading-driven cell.

## Ranking for the lab (updated from LAB-HANDOFF)

1. **Seed 1 with the deep-pair cell as the primary target** (was:
   plain parity). Two live existence proofs, tier-immune, positive
   expected net, smallest tail risk.
2. **Seed 2 cheap-side** — highest expected EV, tail-shaped; needs
   the sim's minority-outcome verdict before any live consideration.
3. Seed 1a plain parity (0.99+ targets) — run as the baseline sweep
   around the deep-pair cell; may be the adverse-selection trap P42
   found on the sell side.
4. Seed 1b taker-completion — comparison cells only at tier-0.
5. Seed 3 — still blocked on the Binance feed merge; do not start.

Residual unknowns the sweep itself must answer: maker-only fill DENSITY
at deep offsets on btc-15m (whether $143/mkt is reachable at clip $3–5
without touch-chasing), and the deep-pair completion rate under
worst_queue (live 0.78 → sim expectation ~0.4–0.5 by D2).
