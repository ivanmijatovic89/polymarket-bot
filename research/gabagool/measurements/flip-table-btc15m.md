# Endgame flip table at scale (W4 remainder, A47)

P(current favorite loses) by favorite mid × seconds remaining, over
the 209 stub-filtered books (Jan-15/Mar-16/May-13/Jun-10/Jun-12),
winners from telonex DB. Script: `scripts/flip-table.ts`.

| favorite mid | 600s | 300s | 120s | 60s | 30s | 10s |
|---|---|---|---|---|---|---|
| 0.50–0.60 | 40.8% (49) | 30.4% (23) | 29.4% (17) | 37.5% (8) | 60.0% (5) | 0.0% (2) |
| 0.60–0.70 | 33.3% (60) | 38.1% (21) | 36.4% (11) | 33.3% (3) | 60.0% (5) | 66.7% (6) |
| 0.70–0.80 | 16.3% (43) | 36.1% (36) | 21.1% (19) | 40.0% (15) | 30.0% (10) | 16.7% (6) |
| 0.80–0.90 | 11.9% (42) | 2.3% (43) | 14.3% (21) | 11.8% (17) | 12.5% (8) | 0.0% (5) |
| 0.90–0.99 | 6.7% (15) | 4.1% (74) | 2.4% (83) | 3.7% (81) | 2.7% (73) | 1.7% (60) |
| 0.99+ | – | 0.0% (12) | 0.0% (58) | 0.0% (85) | 0.0% (108) | **0.0% (393 pooled)** |

(n) = markets observed in that cell; favorites concentrate ≥0.9 late,
so mid-band late cells are small-n — treat sub-20 cells as indicative.

## Findings

1. **0.99+ favorites never flipped** (0 of 393 pooled checkpoint
   observations, incl. 12 at five minutes out). Deep-favorite legs
   held to resolution are as safe as the book claims; conversely the
   sub-1c cheap side late is a essentially-never-pays lottery ticket.
2. **0.90–0.99 favorites flip 2–4%** at 30–300s. A cheap-side
   completion at 0.03–0.05 against such a favorite is ~fairly priced
   to slightly negative (2.7% win at 30s vs 3–5c cost) — quantifies
   the endgame-panic-bid family's Phase-1 verdict (P43, "fairly
   priced tail risk") on 4 months of data.
3. **Mid-band favorites are coin-flips** deep into the window
   (0.50–0.70 flips 30–40% at 300–600s): parity discipline in the
   mid-band is protecting against real variance, not imaginary risk.
4. **Calibration check on A34's favorite-lean**: the winner's
   unpaired favorite-side excess won 60% at avg px 0.547 — matching
   the 0.50–0.60 bucket's base rate (~59% hold). The lean earns the
   base rate, not extra selection: its value is avoiding the ADVERSE
   lean (cheap side), not picking winners.

## Lab use

- Leg-risk bounds: cap cheap-side excess (it's the side that pays
  the flip lottery), tolerate favorite-side excess (base-rate fair).
- Endgame: taker-completing INTO a ≥0.99 favorite is safe but earns
  ≤1c − fees (usually negative); leaving the ≥0.99 leg unpaired to
  redemption is the right default (A18 ties→UP unaffected).
- Sim cross-check: any sweep cell whose PnL depends on late
  mid-band flips harvests variance, not edge (30–40% flip ≈ priced).

## Producing command

- npx tsx research/gabagool/scripts/flip-table.ts --dir
  research/gabagool/data/telonex-r2-w4 --recursive
