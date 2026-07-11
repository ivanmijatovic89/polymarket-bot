# SIGNAL-002 — cross-episode conditioning scan (frozen pre-read)

_Registered session 60 (U82), 2026-07-11. Motivating evidence (governor):
(a) the operator's exploration mandate (charter §Data reality — bottom-up
mining of existing data is first-class work); (b) an engine fact settled
this session: `src/backtest/runSingleMarket.ts:117` re-creates the
strategy per market, so NO prior scan or strategy could express
cross-episode conditioning — every CAL scan and SIGNAL-001 is
within-market by construction. The previous window's outcome is a
live-observable input (the live bot watches windows consecutively in one
process), making this a legitimate, unmeasured feature axis._

**Epistemic grade: map-grade** (SIGNAL-MAP §0 applies verbatim —
hypothesis-generating, gross of costs, uncitable; a candidate zone
licenses aiming a screen, nothing more; dead zones are power-scoped).

## Question

Does the entry ask at the SIGNAL-001 fixed offsets misprice the
conditional outcome probability given the PREVIOUS market's outcome
(lag 1) or the current outcome streak (up to 3+)? If BTC 15m outcomes
carry any serial dependence that the book does not price, the residual
(won − ask) differs by previous-outcome agreement. If the book prices it
(or there is none), residuals are flat — another dead zone for the map.

## Inputs (zero new replay)

- The six SIGNAL-001 shard logs (`fable-lab/logs/SIGNAL-001-shard[0-5].log`),
  same parse, dedupe, and drift filter as `signal-scan.ts` (single-launch
  cleanliness of all six logs verified this session: exactly one
  `Loaded` line each, counts 1377/1450/1332/1445/1456/1456 = 8,516,
  latency 0/0 in-log).
- `telonex_markets.result_id` joined ONCE for current markets and their
  predecessors (predecessor slug = `btc-updown-15m-<epoch−900k>`, k=1..3).
  Convention (signal-scan precedent): result_id '0' = UP won, '1' = DOWN
  won; anything else = unresolved → excluded.
- Feasibility (measured OUTCOME-FREE this session, market presence only):
  8,435/8,516 discovery markets (99.0%) have an eligible lag-1
  predecessor; 8,370 (98.3%) a 2-chain; 8,315 (97.6%) a 3-chain.

## Conditioning definitions (frozen)

Per sample (slug, offset, side BUY at its ask, residual r = won − ask):

- **prevAgree ∈ {1, 0}**: previous market's outcome direction equals the
  bought side's direction. Requires lag-1 resolved; else the sample is
  EXCLUDED from this scan (counted).
- **streakBucket ∈ {+1, +2, +3p, −1, −2, −3p}**: length of the run of
  identical outcomes ending at the previous market, capped at 3 ("3p"),
  signed + if the run's direction equals the bought side, − otherwise.
  Bucket 1 requires lag-2 resolved (to confirm the run stopped); bucket 2
  requires lag-3 resolved; bucket 3p requires lags 1-3 all equal (no
  lag-4 needed). Indeterminable chains are EXCLUDED from the streak
  family only (counted).

Sample validity as in SIGNAL-001: deduped (slug, offset), drift-filtered,
ask ∈ [0.02, 0.98], current market resolved. UP/DOWN samples are
mirror-linked, not independent (disclosed; Bonferroni is conservative
under that dependence).

## Frozen statistics and bars

1. **Pooled prevAgree contrast (primary):** per (offset, side), Δ =
   mean r(prevAgree=1) − mean r(prevAgree=0), z = Δ / √(s₁²/n₁ + s₀²/n₀).
   k = 10. **CANDIDATE |z| ≥ 3.30** (family α ≈ 0.01). WARM |z| ≥ 3.
2. **Stratum contrasts:** same contrast within LO/MID/HI ask strata
   (SIGNAL-001 boundaries), arms need n ≥ 30 each. k = 30.
   **CANDIDATE |z| ≥ 3.60.**
3. **Streak cells:** d = mean r per (offset, side, streakBucket), pooled
   across strata, n ≥ 30, scan-se convention. k = 60.
   **CANDIDATE |z| ≥ 3.80.**

Families at ~0.01 each, joint ~0.03. A pooled candidate will usually
also light its strata/streak relatives — one finding, not several.

**Gates (abort exit 2, no table):** G1 join-direction (per side, samples
with ask ≥ 0.90 and n ≥ 30 must win > 75%); G2 global fairness (per
side, |z| of overall mean residual < 6); G3 chain coverage (lag-1
determinable fraction of valid samples ≥ 0.95 — measured 99.0% at
market level; below the gate means a join bug, not physics).

**Power (stated up front):** pooled contrast at n ≈ 8,000 samples/offset/
side split ~50/50, per-sample sd ≈ 0.39 → se ≈ 0.87c → |Δ| ≳ 2.9c at
z=3.30. Streak ±3p cells (fair-coin incidence ≈ 1/8, n ≈ 1,000) resolve
|d| ≳ 4.7c. Anything smaller stays formally open (and is mostly
sub-envelope anyway, U45).

## Pre-committed interpretation

- Zero candidates → dead zone: "no unpriced serial dependence at lag ≤ 3
  visible at these offsets, within stated power". Recorded in SIGNAL-MAP
  §1 seed table; no screen is aimed at outcome-lag features.
- Buyer-adverse candidates → dead zone with sign (avoid, don't trade).
- Buyer-favorable candidates → named zone(s); the next screen batch aims
  at the strongest distinct zone (a live-parity screen design must state
  how a backtestable strategy accesses the conditioning — per-market
  `create()` means engine support or an in-window proxy is required;
  that design constraint is recorded here at registration, before any
  result is known).

## Read order (frozen)

`tools/signal2.ts` runs ONCE on the real logs, only AFTER the SIGNAL-001
one-shot read is complete and its §3 is recorded — one read at a time,
no interleaved freezes. Selftest: `tools/signal2-selftest.ts` (committed
green in the freeze commit; `--outcomes` refused unless every log path
contains "synthetic", calib precedent).

## Results (append-only; nothing above this line changes after the read)
