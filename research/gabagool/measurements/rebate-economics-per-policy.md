# W5 — rebate economics per candidate quoting policy (paper math, no engine runs)

Session 7, 2026-07-17. Inputs: A22 exact estimator + fee curve
(0.07·p·(1−p) $/share, crypto rebate share 20%, $1/day/market payout
threshold), A16 fee-audit margins, A17 fill fingerprint, A24 b27bc932
profile, A23 observed rebate streams. Pure computation — no backtests.

## The per-notional identity (everything follows from this)

Fee-equivalent of a fill at price p, per $1 of notional:
shares = 1/p, so `fee_eq = 0.07·p·(1−p)·(1/p) = 0.07·(1−p)`.

- **Taker pays** `7.0%·(1−p)` of taker notional.
- **Maker earns** `20% × 0.07·(1−p) = 1.4%·(1−p)` of maker notional.
- The same $1 of matched notional costs the taker 5× what it pays the
  maker — the other 80% is the venue's.
- `(1−p)` means the subsidy is NOT flat: maker fills at p=0.10 earn
  1.26% of notional; at p=0.50 earn 0.70%; at p=0.85 earn 0.21%.
  **The rebate curve structurally favors cheap-side accumulation per
  dollar deployed** (max shares per dollar at low p).

Sanity anchors (predicted vs observed daily rebate):

| wallet | maker notional/day est. | E[1−p] of maker fills | predicted | observed |
|---|---|---|---|---|
| b27bc932 (~50% maker of ~$0.7M, balanced two-sided) | ~$0.35M | ~0.55 | ~$2.7k | $3.2k/day (A23) ✓ |
| b55f (37.8% maker of ~$0.2M btc-15m, cheap-side p50 0.14) | ~$76k | ~0.86 | ~$0.9k | $0.77–1.06k/day all books (A22) ✓ |

## Policy table

Assumptions per policy from measured priors; "rebate %T" = rebate as %
of TOTAL turnover (maker+taker legs).

| policy | maker fill price mix | maker share | rebate, % of maker notional | taker fee, % of taker notional | net fee line, %T |
|---|---|---|---|---|---|
| **Seed 1a** pair-accumulator, maker-only | balanced, E[1−p]≈0.50–0.55 | 100% | 0.70–0.77% | — | **+0.70–0.77%** |
| **Seed 1b** pair-accumulator, 50% taker completion (b27bc932 mix) | balanced | 50% | 0.70–0.77% | ~3.0–3.5% (mid-band p 0.5–0.58) | **−1.2 to −1.4%** gross, −0.75 to −0.95% after tier-0 taker rebate 3% |
| **Seed 2** cheap-side accumulator, maker entries p 0.02–0.15 | E[1−p]≈0.88–0.95 | ~40–100% | **1.23–1.33%** | 4–6% if completing via taker at p 0.3–0.4 (b55f p25 0.34) | +1.2%T maker-only; b55f's real mix measures −0.89%T net fee (A16) but +0.45%T rebate |
| **Seed 3** fair-value-gated maker (rich side suppressed) | tilted cheap, E[1−p]≈0.6–0.7 | ~100% | 0.84–0.98% | — | +0.84–0.98% on REDUCED turnover (suppression cuts fill count; per-$ subsidy up, total $ roughly flat at same capital) |
| farmer posture (mid-band big clips, pair cost >$1) | E[1−p]≈0.5 | varies, taker-heavy | 0.70% | 3.5% at p=0.5 | fee-negative by design; viable ONLY at high taker-rebate tiers (50% refund) — cold start gets 3% → **dead for the lab** (A16 moat) |

Observed calibration: b27bc932's total measured subsidy ≈ $3.2k/day on
~$0.75M/day turnover = **+0.43% of turnover** — and its fee-inclusive
trading margin is ≈ breakeven (+0.28% gross). At scale, THE ENTIRE
PROFIT of the strongest living variant is inside the numbers above.

## The $1/day/market threshold — minimum viable density

Rebate/market ≥ $1 requires maker notional/market ≥ $143 (balanced,
0.70%) or ≥ $75 (cheap-side, 1.33%).

- At $3 clips balanced: **≥ ~48 maker fills/market**, else $0. The
  archetype's ~100 maker fills/market clears it; a cautious 10–20
  fills/market baseline sweep cell EARNS NOTHING from rebates.
- Consequence for the lab: the rebate line is a STEP function at low
  density. Sweep cells below ~$150/market maker notional must be
  judged on trading margin alone; cells above it get +0.7–1.3% of
  maker notional. Do not average the rebate across cells.

## Sim-vs-live rebate bias (ties into D2/G-series)

The engine's `worst_queue` admits only 44–49% of real touch fills
(D2). The rebate line computed on sim maker fills therefore
UNDERSTATES live rebate income by ~2.0–2.3× for touch-resting
policies. Deep-rung fills (price goes through the level) are admitted
more faithfully, so the bias shrinks with ladder depth. Report the
sim rebate line as a LOWER BOUND; flag touch-heavy cells.

## Ranking impact on the LAB-HANDOFF seeds

1. **Seed 2 gains the most**: the subsidy curve pays cheap-side maker
   fills nearly double per dollar, on top of the only measured
   POSITIVE fee-inclusive trading margin (+2.31%T, b55f). Paper
   total ≈ +2.7–2.9%T at b55f's mix. Still rank-2 only because its
   tail risk (47% win) needs the sim's tail verdict first.
2. **Seed 1 maker-only** is subsidy-viable standalone (+0.7%T) IF
   density clears the threshold AND trading margin ≥ −0.7%T. The
   existence proof (b27bc932) runs the 1b variant: breakeven trading
   + 0.43%T subsidy. For the lab: sweep completion policy with the
   fee/rebate lines SEPARATED in reporting — the maker-only cells and
   taker-completion cells live in different economics regimes.
3. **Seed 3 unchanged in rank**: suppression trades volume for fill
   quality; rebate math is roughly capital-neutral. Its case rests on
   adverse-selection reduction, not subsidy.
4. Farmer-posture variants: confirmed non-viable for a cold-start
   bot; do not seed. (They exist in the wild only on top taker-rebate
   tiers — powerwinner/0xaaaaa profile.)

Fragility note: all of this rides on program terms that are
DISCRETIONARY and have changed twice in 6 months (rebate share by
category, taker tiers). A21 shows the venue exercising discretion on
payouts. Any strategy whose EV is majority-subsidy inherits venue
policy risk that no sim can price (G8).
