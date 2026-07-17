# Window lifecycle + endgame flip table (D3 + D5), btc-15m June 2026

One replay pass over 288 markets sampled evenly from the 1,286 June 1–14
markets on local disk (the newest era-consistent replayable slice, G9).
Script: `scripts/window-lifecycle.ts`. 261 markets with a decisive
outcome; 27 (9.4%) ambiguous (book never pinned in the last 30s —
disproportionately the closest calls; the flip table therefore slightly
UNDERSTATES tail flip risk). Descriptive priors: 15s-grid samples within
a market are serially correlated; no significance claims.

## D5 — lifecycle by minute (asset0 book; side-symmetric)

| min | spread p50/p90 | L1 bid/ask sz p50 | updates p50 | midTravel p50 | \|mid−.5\| p50 |
|---|---|---|---|---|---|
| 0 | 0.010/0.010 | 151/192 | 1774 | 0.420 | 0.045 |
| 1 | 0.010/0.010 | 208/160 | 2027 | 0.420 | 0.095 |
| 2 | 0.010/0.010 | 230/214 | 2115 | 0.410 | 0.125 |
| 3 | 0.010/0.010 | 236/233 | 2051 | 0.370 | 0.155 |
| 4 | 0.010/0.010 | 227/242 | 2051 | 0.350 | 0.195 |
| 5 | 0.010/0.010 | 240/237 | 1825 | 0.360 | 0.225 |
| 6 | 0.010/0.010 | 207/223 | 1775 | 0.350 | 0.255 |
| 7 | 0.010/0.010 | 219/229 | 1727 | 0.320 | 0.265 |
| 8 | 0.010/0.010 | 251/230 | 1536 | 0.260 | 0.295 |
| 9 | 0.010/0.010 | 237/233 | 1488 | 0.250 | 0.315 |
| 10 | 0.010/0.020 | 205/246 | 1438 | 0.250 | 0.335 |
| 11 | 0.010/0.020 | 244/248 | 1270 | 0.220 | 0.365 |
| 12 | 0.010/0.010 | 212/226 | 1039 | 0.150 | 0.395 |
| 13 | 0.010/0.020 | 178/274 | 798 | 0.070 | 0.415 |
| 14 | 0.010/0.020 | 129/154 | 235 | 0.000 | 0.415 |

- **The book is 1c-tight the whole window** (p90 widens to 2c only from
  minute 10). L1 sizes are stable ~150–250 shares until a minute-14
  thinning. There is no wide-spread regime to harvest — the "temporarily
  cheap side" is a 1–2c phenomenon plus depth sweeps, never a gaping
  spread. (Minute-14 rows condition on the book still being two-sided —
  decided markets empty the winning ask side first.)
- **Mid oscillation is FRONT-loaded**: midTravel p50 falls monotonically
  0.42 (min 0) → 0.25 (min 9) → 0.00 (min 14); update rate peaks minutes
  1–4 and collapses to ~1/8 by minute 14. Decision accumulates smoothly
  (|mid−0.5| p50 0.045 → 0.415) — no late "decision cliff" on the median
  market.
- **Tension with A17 (deliberate, not contradictory)**: the raw
  pair-harvest fuel (two-sided oscillation) is richest in minutes 0–5,
  yet the edge wallets' fills concentrate in minutes 10–13. They are NOT
  oscillation-harvesting at max churn; they position/complete late, when
  prices carry the most information and the fee curve is escaped by the
  price being away from 0.5. Fable E24 explains the missing piece: the
  open's oscillation comes with adverse selection from the first seconds
  (opening touch quoting winRate 0.237) — the early churn is not free
  money, and the winners' revealed preference (skip the open, load
  minutes 8–13) is consistent with both facts.

## D3 — P(leading side at t loses) by band × seconds left

n per cell in parens; leading prob = max(mid, 1−mid) at sample time.

| band | 0-30s | 30-60s | 60-120s | 120-300s | 300-600s | 600-900s |
|---|---|---|---|---|---|---|
| 0.50-0.60 | 72.7% (11) | 75.0% (12) | 35.7% (42) | 45.1% (286) | 44.5% (839) | 44.2% (2323) |
| 0.60-0.70 | 40.0% (10) | 29.4% (17) | 36.5% (52) | 31.1% (251) | 32.5% (875) | 31.5% (1411) |
| 0.70-0.80 | 40.0% (5) | 33.3% (12) | 12.7% (63) | 27.4% (350) | 25.6% (943) | 21.5% (874) |
| 0.80-0.90 | 5.3% (19) | 12.5% (40) | 9.0% (100) | 10.5% (524) | 13.8% (1167) | 15.0% (461) |
| 0.90-0.95 | 0.0% (20) | 2.6% (39) | 5.6% (108) | 5.5% (452) | 4.0% (745) | 4.0% (126) |
| 0.95-1.00 | 4.2% (72) | 1.8% (110) | 1.4% (292) | 1.9% (775) | 0.5% (571) | 0.0% (25) |

- **Calibration read**: a band's implied flip rate is 1 − band-mid
  (0.80-0.90 → ~15%). Measured flips sit AT or BELOW implied in every
  band ≥ 0.60 at most horizons (0.85-band: 10.5–13.8% vs 15% implied;
  0.925-band: 4.0–5.6% vs 7.5%; 0.975-band: 0.5–1.9% vs 2.5%). The
  leading side at mid is slightly UNDERpriced — equivalently the cheap
  trailing side is slightly OVERpriced. This is the same regularity
  fable measured from the other leg (E25/E14: cheap longshots lose
  ~1c gross; "the stale cheap side is a trap") and it brackets EPB's
  breakeven result (P43). Magnitude: ~1–5c gross depending on cell —
  below fee+spread for a taker, and the maker version was measured
  adversely selected (E24). A knowledge prior, not an edge.
- **Endgame bounds for quoting policy** (H1/H2): above 0.90 leading
  prob with <5 min left, flips are 0–6% — resting bids on the FAVORITE
  side there are near-safe but earn ≤ the few cents left; bids on the
  TRAILING side (buying the longshot leg to complete a pair) face the
  overpriced-side trap unless bought at deep discounts (b55f's touch
  rests at px p50 0.14 are exactly this, done at −85% of parity price).
  Below 0.60 leading prob, the window is a coin toss at EVERY horizon
  including 60–120s — "the book has decided" is only true above ~0.8.
- The 0.50-0.60 × <60s cells (73–75% flip, n=23 pooled, correlated)
  hint that a dead-heat final minute flips MORE often than implied —
  too little data to claim; noted for the lab as a cell worth watching
  in any endgame sweep, not a finding.
- Ambiguity bias: the 27 excluded no-decisive-pin markets are the
  closest finishes, so true tail-band flip rates are a touch higher
  than shown.

## D4 disposition (no new measurement)

Open dynamics is resolved by priors: A17 (edge wallets show NO open
concentration) + fable E24 (opening 90s two-sided touch quoting is
adversely selected from the first seconds, winRate 0.237) + this file
(open churn is the highest of the window but comes with the E24 result).
The lab should NOT build an own-the-open variant (Game F negative for
this concept).

## Producing command

- npx tsx research/gabagool/scripts/window-lifecycle.ts
  --from 2026-06-01T00:00:00Z --to 2026-06-14T09:30:00Z --sample 288
