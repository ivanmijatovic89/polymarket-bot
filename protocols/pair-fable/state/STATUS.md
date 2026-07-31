# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 27 close)

## Current work

**Session 27: E-041 CLOSED (CEIL-NULL; FULL instrument VALIDATED,
B_full = 0.74); pair.v17 (signal (b) spot-vs-priceToBeat leader)
built + smoked + fleet-proven; E-042 (4 × FULL) SUBMITTED.**

E-041 readout (pair-v16.md §12; runs f0a=1003, f0b=1004, f1=1005,
f2=1007; all 10,747 mkts, failures 0, pairwise common = 10,747):
- Instrument: paired per-market sd 38.29 ⇒ SE_pair 0.369 ⇒
  **B_full = max(0.30, 0.739, |Δev| 0.21) = 0.74** (< 0.8 fail bar).
  FULL pairs are the standing ev instrument at B=500 (2σ ≈ 0.74).
- **CEIL-NULL**: F0 −14.865 vs f1 (no ceiling) −14.83, f2 (0.95)
  −15.07 — all Δ ≪ 0.74. E-039's +1.91 and E-040 e1's +1.3 REFUTED
  as pinned-800 jitter tail. Ceiling axis CLOSED at ev; center
  reverts to tiltUnitMax 1.00. E-039: CEIL-UNRESOLVED → REFUTED.
- Context: FULL level of the τ+160 tilt config is ev ≈ −14.8..−15.1,
  p/100 ≈ −4.0 (recent-800 was a friendly slice; monthly ev stable).

pair.v17 (commit a8b1f98; design+grid pair-v17.md, amendments §6 at
4b5047c): v16.2 with leader = binance spot vs priceToBeat (dead zone
spotLeadBps bps of strike; ExternalFeeds plumbing; absent feeds ⇒
neutral). protocol:check PASS; smoke 1001 PASS; activation proven
(1002: τ0 vs τ160 differ materially on identical markets). Fleet
diag run 1006 (198/200): workers fulfill both feeds; 2 failures =
known strike-outage markets (~1.36% of universe, data never existed)
— amended integrity rule: outage failures expected, compare on
common played intersection (pair-v17.md §6.2).

**IN FLIGHT (next session reads FIRST; do NOT resubmit):** E-042,
4 FULL v17 runs @ 140/20, SHA 4b5047c4, universe 10,747 (same
--to-ms 1785196800000 pin as E-041). Queue verified 21:35Z: 4
aggregates (waiting-children), g0 at 2049/10747. ETA ~75 min from
21:35Z. Center: τ per cell, q100 I160 B500 P*.96 doom.99 cool5
ttl90 persist0, tiltUnitMax 1 (c* per E-041 CEIL-NULL):

| # | tiltShares | spotLeadBps | batchUid |
|---|---|---|---|
| g0 | 0 | 10 | pf-e042-g0-20260731T213324-yexm1q |
| g1 | 160 | 10 | pf-e042-g1-20260731T213358-wru9xw |
| g2 | 160 | 20 | pf-e042-g2-20260731T213440-oyquqe |
| g3 | 160 | 40 | pf-e042-g3-20260731T213529-z3r2k6 |

## E-042 readout procedure (bars pair-v17.md §5 + amendments §6)

1. `results.ts --last 4` → g0–g3 runs. Failures must be
   MISSING-priceToBeat outage errors ONLY (expect ~146/cell,
   identical slug sets across cells; any other class = integrity
   break).
2. Universe identity: pairwise common counts across g-cells equal;
   g-vs-1005 (f1) common = g played universe + record delta.
3. Comparisons ON COMMON PLAYED INTERSECTION, B_full = 0.74:
   - Recompute f1 ev on the intersection: `sql.ts "SELECT
     AVG(b.pnl) FROM backtest_run_markets a JOIN
     backtest_run_markets b ON a.slug=b.slug WHERE a.run_id=<g1> AND
     b.run_id=1005"` (and same form for g-cell evs / paired sd).
   - SIGB-BETTER / SIGB-WORSE / SIGB-NULL: best g1–g3 vs f1.
   - TILT-EV-REAL / NEGATIVE / NULL: tilt cells vs g0 (neutral FULL
     reference — first ev-decisive tilt-vs-neutral comparison).
   - Dose read g1→g2→g3.
4. Decision mapping (pair-v17.md §5): SIGB-BETTER ⇒ iterate
   signal (b) levers (threshold, feed-leader persistence, σ√t dead
   zone) at FULL. SIGB-NULL/WORSE + TILT-EV-REAL ⇒ keep signal (a),
   iterate acquisition (maker-only tilt). SIGB-NULL/WORSE +
   TILT-EV-NEGATIVE ⇒ tilt closed at ev on both signals; return to
   neutral FULL levers (P* gate) + priority-2 backlog (time-varying
   τ, imbalance-adaptive tilt).

## Audit note

M1–M5 implemented and verified at 4809a8e (s26 correction stands).

## Next step (priority order)

1. **Read E-042** (procedure above) — GREEN directional-controller
   work under any verdict.
2. Per decision mapping, design + submit the follow-up (signal-b
   iteration, maker-only tilt, or neutral P* at FULL).
3. **P-013 (needs human):** sell-side mirror scope ruling (PROPOSALS).
4. Cross-symbol replication: gated on P-012.
5. Unexplored v15 lever: price gate P* — needs the FULL instrument.

## Alignment gate — session 27 (final)

- **Classification:** directional-controller (E-041 close, v17
  implementation, E-042 freeze+submit — all on the directional
  controller's signal/ceiling axes).
- **Contribution:** controller decision changed twice with evidence:
  (1) ceiling lever REMOVED from the center (E-041 CEIL-NULL, runs
  1003–1007) — E-039's iteration path formally refuted; (2) the
  FULL-pair instrument validated as decision-grade (B_full 0.74,
  measured). New variant pair.v17 delivered live-equivalent evidence
  path (a8b1f98, runs 1001/1002/1006) and E-042 submitted (43k jobs
  verified in queue).
- **Time to evidence:** ~2 min (fleet.ts verify of in-flight E-041);
  first new run (smoke 1001) by ~min 8. PASS.
- **Throughput:** 1 experiment closed (4 × 10,747 evaluated with
  paired-noise SQL + identity checks); 1 strategy implemented,
  smoked (2 runs), fleet-diagnosed (200 mkts); 1 experiment
  submitted whole-grid-up-front (4 × 10,747, queue-verified). No
  serial scans; waits were fleet-bound with analysis interleaved.
- **Scale:** closed by E-036 on record; all runs B=500.
- **Next:** read E-042 — GREEN either way.
- **Verdict:** **GREEN.**
- Verdict history: s24 GREEN, s25 GREEN, s26 GREEN, s27 GREEN.
  Next audit: s30 (before new research).

## Blockers

None. E-042 in flight (~75 min from 21:35Z; do NOT resubmit — read
per procedure above).

## Needs human

- **P-013**: sell-side mirror program scope ruling (see PROPOSALS).
- **P-012**: convert eth/sol/xrp 15m telonex datasets — gates
  cross-symbol replication. Not blocking.
- Carried: P-002/P-003/P-005/P-006/P-007/P-009/P-010 (all
  `proposed`). P-009/P-010 remain the binding caveat on every scale
  number (guard-7).

## Standing session guards

- Never end a session waiting on ANY in-flight work — record how to
  resume in STATUS, return `continue` (inbox dad421a6).
- Write .global-runtime/session-result.json BEFORE the final message,
  every session, no exceptions.
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine
  commits (s13–s27: only protocol/harness-contract commits moved
  HEAD).
- Queue submissions require a CLEAN tree pushed to origin/main (push
  via `git push origin HEAD:main`); commit state snapshots before
  submitting.
- **zsh does NOT word-split unquoted variables** — submit grids as
  one LITERAL command per config (inbox c841c329); always keep
  stderr. run-backtest.ts: `--latest` is a BOOL; market count goes
  in `--limit N`. Capture the batchUid line from EVERY submit.
- Verify with fleet.ts after every detached batch; count aggregate
  jobs (waiting-children), not market-job totals.
- Do not push strategy-semantics changes while that strategy's jobs
  are queued/running — workers track origin/main; serialize push →
  submit. (E-042 jobs pinned at 4b5047c4: do NOT touch pair.v17.ts
  or pair.v16.ts while the grid is queued.)
- Screens baseline 874 (v0) and parents 872/873/879 valid ≤
  2026-08-06 (evaluator.md §Universes). FULL references: v1-b = 914;
  v16 τ+160 no-ceiling = 1005 (f1); v16 dup pair 1003/1004. v15
  bridge chain 970 ≡ 960 ≡ 956. v16 bridges: c0 = 978, d0 = 987.
- **NOISE MODEL (validated s27): FULL-pair instrument at B=500 —
  paired per-market sd 38.29, SE_pair 0.369, ev bar B_full = 0.74.
  Pinned-800/B500 single-run ev SE ≈ 1.2 (2σ ≈ 2.4) — structure
  screens only. p/100 bar 0.54 for structure screens. Duplicate sets
  under-sample tails.**
- JOURNAL entries are messages to the human (contract v2): plain
  sentences, tried/happened/means/next, drop run ids/codes unless
  genuinely the point.
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329), verify queue depth after.
- Class kills need an identity argument (evaluator.md §Kill
  standards); N failures kill a family only. Verdict bars must name
  comparison PAIRS. Positive signals measured ON discovery data need
  disjoint confirmation before any build decision (E-039 → E-041 now
  the canonical example: +1.91 at pinned-800 → 0.04 at FULL).
- Fill model: calibrated by E-025 (ToB capacity bound). Guard-7
  whole-size fill optimism: larger-q results depth-optimistic
  (E-036).
- Sibling-memory recheck at session start (`ls protocols/*/memory`)
  — 2026-07-31 s27: only pair-fable has memory (unchanged).
- Smoke cannot catch latency-race bugs AND cannot demonstrate RARE
  fill modes (escalate to a 200-mkt Stage B instead).
- Schema refines AND engine constraints (OrderManager validation)
  can invalidate a frozen grid corner — check every cell when
  freezing (GTD expiry < now+60s rejected; ttlSec ≥ 61).
- A completed run with 0 trades and noActivity=N can mean every
  order was REJECTED — check OrderManager validation before blaming
  data. High noActivity can also be the market slice: latest-200
  before the 07-28 pin has ~48% quiet markets in BOTH v16 and v17.
- The backtest sim is NOT bit-deterministic (latency jitter); jitter
  noise at B=500 is heavy-tailed at run level.
- leadPersistTicks is in TICKS (~138/s on active markets).
- Feed-declaring strategies: RULES guarantees coverage from the
  universe floor; workers fulfill binance+priceToBeat (diag 1006).
  ~1.36% of markets have NO strike anywhere (Polymarket outage days)
  — hard per-market failures, deterministic set, compare on common
  played intersection (pair-v17.md §6.2).

## Inbox processed through

2026-07-31T16:46:43.750Z-82e89da5 (no newer entries at s27 start).
