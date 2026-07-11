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

_Read executed 2026-07-11 session 61 (U87), one shot, after the
SIGNAL-001 read was recorded in SIGNAL-MAP §3 (read-order rule
honored). Same six shard logs; verbatim tool output below._

```
parsed 36092 deduped (slug,off) rows across 8127 markets (0 malformed, 77 drift-discarded)
samples valid=65349 (unresolved-current rows=0, ask-out-of-range=6835); lag1-determinable=65019 (0.9950), streak-determinable=64609 (0.9887)
G1 join-direction UP: n=3623 winRate=0.9459
G1 join-direction DOWN: n=3518 winRate=0.9483
G2 global fairness UP: n=32670 mean=-0.01164 z=-5.21
G2 global fairness DOWN: n=32679 mean=-0.00071 z=-0.32
G3 chain coverage: 0.9950 >= 0.95

== family 1: pooled prevAgree contrast (k=10, bar 3.3) ==
o150 UP: d=-0.03073 z=-2.95 n1=4046 n0=4028
o150 DOWN: d=-0.03062 z=-2.94 n1=4027 n0=4046
o300 UP: d=-0.02614 z=-2.67 n1=4038 n0=4021
o300 DOWN: d=-0.02613 z=-2.67 n1=4018 n0=4041
o600 UP: d=-0.01432 z=-1.69 n1=3782 n0=3691
o600 DOWN: d=-0.01451 z=-1.72 n1=3721 n0=3752
o750 UP: d=-0.00677 z=-0.74 n1=2842 n0=2748
o750 DOWN: d=-0.00546 z=-0.60 n1=2785 n0=2833
o850 UP: d=0.01058 z=0.97 n1=1714 n0=1595
o850 DOWN: d=0.00855 z=0.78 n1=1626 n0=1665
family1 candidates=0 warm=0

== family 2: stratum contrasts (k=30, bar 3.6) ==
o150 UP LO: d=-0.03754 z=-1.68 n1=844 n0=625
o150 UP MID: d=-0.02970 z=-2.11 n1=2499 n0=2415
o150 UP HI: d=-0.02268 z=-1.05 n1=703 n0=988
o150 DOWN LO: d=-0.01527 z=-0.68 n1=893 n0=645
o150 DOWN MID: d=-0.03220 z=-2.30 n1=2449 n0=2486
o150 DOWN HI: d=-0.03715 z=-1.71 n1=685 n0=915
o300 UP LO: d=-0.03130 z=-1.89 n1=1292 n0=994
o300 UP MID: d=-0.00846 z=-0.49 n1=1618 n0=1630
o300 UP HI: d=-0.04065 z=-2.50 n1=1128 n0=1397
o300 DOWN LO: d=-0.04033 z=-2.46 n1=1334 n0=1072
o300 DOWN MID: d=-0.00621 z=-0.36 n1=1645 n0=1615
o300 DOWN HI: d=-0.03469 z=-2.11 n1=1039 n0=1354
o600 UP LO: d=-0.01901 z=-1.62 n1=1646 n0=1376
o600 UP MID: d=-0.03673 z=-1.43 n1=742 n0=712
o600 UP HI: d=0.00212 z=0.17 n1=1394 n0=1603
o600 DOWN LO: d=0.00433 z=0.37 n1=1714 n0=1455
o600 DOWN MID: d=-0.04417 z=-1.72 n1=709 n0=746
o600 DOWN HI: d=-0.01858 z=-1.47 n1=1298 n0=1551
o750 UP LO: d=-0.00924 z=-0.82 n1=1387 n0=1198
o750 UP MID: d=-0.06725 z=-2.02 n1=474 n0=405
o750 UP HI: d=0.02187 z=1.54 n1=981 n0=1145
o750 DOWN LO: d=0.01829 z=1.61 n1=1390 n0=1207
o750 DOWN MID: d=-0.06089 z=-1.84 n1=414 n0=481
o750 DOWN HI: d=-0.00960 z=-0.70 n1=981 n0=1145
o850 UP LO: d=0.02137 z=1.66 n1=918 n0=763
o850 UP MID: d=-0.04646 z=-0.97 n1=197 n0=213
o850 UP HI: d=0.01425 z=0.83 n1=599 n0=619
o850 DOWN LO: d=0.01083 z=0.82 n1=832 n0=771
o850 DOWN MID: d=-0.05627 z=-1.14 n1=206 n0=193
o850 DOWN HI: d=0.02775 z=1.68 n1=588 n0=701
family2 candidates=0 warm=0

== family 3: streak cells (k=60, bar 3.8) ==
o150 UP +1: d=-0.02186 z=-2.16 n=2147
o150 UP +2: d=-0.01176 z=-0.80 n=1029
o150 UP +3p: d=-0.04125 z=-2.58 n=838
o150 UP -1: d=0.00613 z=0.61 n=2152
o150 UP -2: d=0.00008 z=0.01 n=1024
o150 UP -3p: d=0.01824 z=1.11 n=826
o150 DOWN +1: d=-0.01757 z=-1.75 n=2152
o150 DOWN +2: d=-0.01180 z=-0.80 n=1024
o150 DOWN +3p: d=-0.03006 z=-1.82 n=826
o150 DOWN -1: d=0.01043 z=1.03 n=2147
o150 DOWN -2: d=-0.00010 z=-0.01 n=1029
o150 DOWN -3p: d=0.02968 z=1.86 n=838
o300 UP +1: d=-0.01918 z=-2.04 n=2143
o300 UP +2: d=-0.01392 z=-1.01 n=1030
o300 UP +3p: d=-0.03315 z=-2.19 n=836
o300 UP -1: d=0.00450 z=0.48 n=2148
o300 UP -2: d=0.00159 z=0.11 n=1024
o300 UP -3p: d=0.01173 z=0.77 n=823
o300 DOWN +1: d=-0.01623 z=-1.72 n=2146
o300 DOWN +2: d=-0.01303 z=-0.94 n=1023
o300 DOWN +3p: d=-0.02362 z=-1.55 n=823
o300 DOWN -1: d=0.00752 z=0.80 n=2146
o300 DOWN -2: d=0.00226 z=0.16 n=1030
o300 DOWN -3p: d=0.02124 z=1.40 n=836
o600 UP +1: d=-0.02152 z=-2.69 n=2001
o600 UP +2: d=-0.01590 z=-1.33 n=961
o600 UP +3p: d=-0.02149 z=-1.68 n=793
o600 UP -1: d=-0.00605 z=-0.73 n=1967
o600 UP -2: d=-0.00872 z=-0.72 n=942
o600 UP -3p: d=-0.00208 z=-0.16 n=759
o600 DOWN +1: d=-0.00669 z=-0.80 n=1967
o600 DOWN +2: d=-0.00402 z=-0.34 n=958
o600 DOWN +3p: d=-0.00814 z=-0.64 n=774
o600 DOWN -1: d=0.00946 z=1.18 n=1994
o600 DOWN -2: d=0.00312 z=0.26 n=955
o600 DOWN -3p: d=0.01049 z=0.81 n=776
o750 UP +1: d=-0.02884 z=-3.33 n=1503  << warm
o750 UP +2: d=-0.01053 z=-0.79 n=704
o750 UP +3p: d=-0.01817 z=-1.38 n=618
o750 UP -1: d=-0.01291 z=-1.43 n=1473
o750 UP -2: d=-0.01827 z=-1.39 n=716
o750 UP -3p: d=-0.01296 z=-0.93 n=546
o750 DOWN +1: d=0.00026 z=0.03 n=1498
o750 DOWN +2: d=0.00588 z=0.45 n=722
o750 DOWN +3p: d=0.00028 z=0.02 n=553
o750 DOWN -1: d=0.01468 z=1.70 n=1497
o750 DOWN -2: d=-0.00299 z=-0.23 n=721
o750 DOWN -3p: d=0.00472 z=0.35 n=601
o850 UP +1: d=-0.01604 z=-1.53 n=905
o850 UP +2: d=-0.00955 z=-0.63 n=443
o850 UP +3p: d=0.00321 z=0.20 n=358
o850 UP -1: d=-0.01854 z=-1.76 n=845
o850 UP -2: d=-0.03016 z=-1.93 n=430
o850 UP -3p: d=-0.01388 z=-0.76 n=312
o850 DOWN +1: d=0.00122 z=0.12 n=859
o850 DOWN +2: d=0.01360 z=0.90 n=444
o850 DOWN +3p: d=0.00355 z=0.19 n=316
o850 DOWN -1: d=0.00033 z=0.03 n=887
o850 DOWN -2: d=-0.00002 z=-0.00 n=440
o850 DOWN -3p: d=-0.01710 z=-0.99 n=331
family3 candidates=0 warm=1

SUMMARY: candidates f1=0 f2=0 f3=0 | warm f1=0 f2=0 f3=1
```

### Interpretation (map-grade, per SIGNAL-MAP §0)

**NULL on all three families.** Pooled prevAgree contrasts (k=10, bar
3.30): 0 candidates, 0 warm — max |z| = 2.95. Stratum contrasts (k=30,
bar 3.60): 0/0. Streak cells (k=60, bar 3.80): 0 candidates, 1 warm
(o750 UP +1: d=−2.88c z=−3.33 n=1,503 — sub-bar). All gates passed
(G1 0.9459/0.9483; G2 −5.21/−0.32 within ±6, the same UP-side global
asymmetry recorded map-grade in SIGNAL-MAP §3; G3 lag-1 determinable
0.9950 ≥ 0.95).

**Recorded sub-bar structure (honest map annotation, uncitable):** the
prevAgree contrast is consistently NEGATIVE early-window and decays
with offset — o150 d ≈ −3.1c (z=−2.95/−2.94, both sides
mirror-identical as expected), o300 ≈ −2.6c (−2.67), o600 ≈ −1.4c,
o750 ≈ −0.6c, o850 sign flips (+1c, z≈+0.9). Direction: buying the side
that AGREES with the previous window's outcome does ~3c worse gross
early in the window, i.e. the book slightly OVERprices cross-episode
continuation (mild anti-momentum), and the streak family shows the same
sign (all early +streak cells negative, −streak cells positive) without
any cell nearing its bar. Everything sub-bar, gross of costs, and the
~3c magnitude sits inside the U45 mid-price envelope (needs ≥ ~2.4-3.4c
NET to ever be reserve-confirmable — a fee-paying taker fade of this
would start from −1.56c fees against ≤3c gross with the sign already
sub-bar). No screen is licensed by this; it is a dead zone with a noted
lean.

**Map consequence:** cross-episode conditioning (lag-1 outcome, streaks
to 3+) joins the dead map — the last unmeasured live-observable feature
axis the recorded dataset expresses is now measured. BATCH-002 aims at
mechanism-level gaps (per SIGNAL-MAP §3's pre-committed branch),
not at any feature or cross-episode zone.
