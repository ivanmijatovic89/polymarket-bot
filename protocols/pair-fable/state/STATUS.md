# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31T23:20Z (mission-02 session 29 close)

## Current work

**Session 29: g0 loss-identity analysis (analysis-only; runs still in
flight).** Session started ~5 min after s28 closed; the 7 FULL runs
were ~12% done (verified 763 markets/min at 23:17Z ⇒ drain ≈ 00:40Z,
2026-08-01). Used the wait for mechanism analysis on run 1008 (the
FULL neutral baseline), recorded in pair-v17.md §10 (commits a473dc4
+ 2 follow-ups):

- **Completion policy has NO lever** — leg-vs-outcome identity: C and
  D fills are ~fair at their prices (D buys the leader at 0.823, it
  wins 81.1% ⇒ EV ≈ fees; doom-completing ≈ EV-equal to holding).
  Mechanically explains E-041 CEIL-NULL.
- **The whole neutral loss is S-flow adverse selection**: maker
  starts fill 58/42 toward the eventual loser, −3.2¢/share ≈ −110k
  of the −144k. The tilt program (E-043/E-044 in flight) attacks
  exactly this term; **baseline S split 58/42 is the engagement
  metric to read on E-044's m-cells.**
- **S-fill toxicity grows with window age** (−2.2..−3.3¢/sh min 0–4 →
  −6..−10¢/sh min 12–13): measured prior for a time-varying-quote
  neutral axis. Start-minute gating separately re-measured dead for
  v17 (minuteev on 1008; matches E-027).

Sibling lab pair-opus: clean start, no results yet (memory/ has only
PRIOR-WORK.md — an accurate digest of our findings — and
capabilities).

**Session 28 (context): E-042 CLOSED (SIGB-BETTER + TILT-EV-NULL +
dose monotone); pair.v17m (maker-only tilt) built + smoked; E-043 +
E-044 + E-045 (7 × FULL) SUBMITTED.**

E-042 readout (pair-v17.md §7; g0=1008, g1=1011, g2=1010, g3=1009 vs
f1=1005; 10,651 common intersection; B_full = 0.74):
- **SIGB-BETTER**: g3 (bps 40) − f1 = +1.87 — spot-vs-strike leader
  beats the book leader. Mostly harm avoidance: neutral g0 − f1 =
  +1.33, i.e. the signal-(a) book tilt was actively costing ev.
- **TILT-EV-NULL**: g3 − g0 = +0.54 < 0.74 (2.5σ by its own pair SE
  0.21 — suggestive, below the frozen bar). Dose monotone in width
  (g3 − g1 = +1.32): false-flip cost real.
- **ANATOMY (the session's key finding)**: tilted residue WINS 88–90%
  of markets at bps 10–20 (neutral base 30%) — the signal is genuinely
  predictive — but doom/taker acquisition spends more than the residue
  earns (g1: +163k residue vs −161k extra pairs cost + 11k fees).
  The lever is acquisition COST, not signal quality ⇒ E-044.
- Standing references: g0 = 1008 is the FIRST FULL neutral at the
  E-040 e0 center (ev −13.51, p/100 −5.93); g3 = 1009 best
  directional on record (−12.97). Universe = 10,651 (96-slug
  deterministic priceToBeat-outage set, all-cells-identical verified).

pair.v17m (commit 18ce0a4; design pair-v17m.md FROZEN at f107234
before code): v17 with maker-only tilt acquisition — FOK tiltDef =
min(T, 0) (taker never chases the leader; held tilt respected; doom
salvage on flip preserved); tiltUnitMax dropped. protocol:check PASS;
smoke 1012 PASS; activation 1013: τ160 taker ≤ τ0 taker on EVERY
market (16 vs 24) — no-chase verified. τ0 ≡ v17 τ0 by code identity.

**IN FLIGHT (next session reads FIRST; do NOT resubmit):** 7 FULL
runs @ 140/20, universe 10,747 (submitted 10,747; expect 96 outage
failures each), --to-ms 1785196800000. E-043/E-045 at SHA f107234
(params-only on pair.v17), E-044 at 18ce0a43. Queue verified 23:04Z:
7 aggregates waiting-children, h80 at 6794/10747.

| exp | # | strategy | key params | batchUid |
|---|---|---|---|---|
| E-043 | h80 | v17 | τ160 bps80 | pf-e043-h80-20260731T225501-e9pec4 |
| E-043 | h160 | v17 | τ160 bps160 | pf-e043-h160-20260731T225536-gxoe2a |
| E-045 | p92 | v17 | τ0 P*0.92 | pf-e045-p92-20260731T225614-q260og |
| E-045 | p94 | v17 | τ0 P*0.94 | pf-e045-p94-20260731T225654-ydl2ao |
| E-045 | p98 | v17 | τ0 P*0.98 | pf-e045-p98-20260731T225738-4q7e3p |
| E-044 | m10 | v17m | τ160 bps10 | pf-e044-m10-20260731T230254-9z7pbg |
| E-044 | m40 | v17m | τ160 bps40 | pf-e044-m40-20260731T230348-t7ujlc |

Center everywhere else: q100 I160 doom.99 cool5 ttl90 persist0
lagAggr0 B500 (P* 0.96 except E-045 cells; tiltUnitMax=1 on v17,
absent on v17m).

## Readout procedure (bars in pair-v17.md §8/§9 + pair-v17m.md §4)

1. `results.ts --last 8` (grep -v "FAILURE btc-updown" for summaries).
   Failures must be the identical 96-slug outage set per cell (SQL:
   `backtest_run_failures` reason 100% MISSING-priceToBeat, common
   count 96); pairwise common = 10,651 vs E-042 runs.
2. All comparisons paired per-market SQL on the common intersection
   (JOIN backtest_run_markets a/b ON slug), bar B_full = 0.74.
3. E-043: h80 vs g3(1009) → DOSE-CONT/PEAKED/FLAT; h80/h160 vs
   g0(1008) → TILT-EV-REAL retest; h160 vs g0 |Δ| ≥ 0.74 = anomaly.
4. E-044: m10 vs g1(1011), m40 vs g3(1009) → MAKERTILT-BETTER/…;
   any m vs g0 > 0.74 ⇒ TILT-EV-REAL (first ev-positive tilt).
   Mechanism metric: residue win% per anatomy.ts (DEAD needs ≤ 60%).
5. E-045: each p-cell vs g0(1008) → P*-LIVE (either direction) or
   P*-FLAT-FULL; read monotonicity across 0.92→0.98.
6. Decision mappings are frozen in the files — follow them.

## Audit note

M1–M5 implemented and verified at 4809a8e (s26 correction stands).
**Session 30 = five-session audit (s26–s30) BEFORE new research.**
Reading the already-frozen E-043/E-044/E-045 results is evaluation of
completed work (§6.3), not new research — do the readout when runs
are done; run the audit before designing/submitting anything NEW.

## Next step (priority order)

1. **Read E-043/E-044/E-045** per procedure above (runs should be
   done ≈ 00:40Z 2026-08-01; verify with fleet.ts first — do NOT
   resubmit). Add to the frozen metrics: E-044 m-cells' S-fill
   win/lose split vs the 58/42 neutral baseline (pair-v17.md §10) as
   the tilt-engagement metric.
2. **Five-session audit s26–s30** before any new design/submission.
3. Follow the frozen decision mappings (maker-tilt iteration, width
   extension, or P* follow-up).
4. **P-013 (needs human):** sell-side mirror scope ruling (PROPOSALS).
5. Cross-symbol replication: gated on P-012.

## Alignment gate — session 29 (final)

- **Classification:** neutral-controller (mechanism identity analysis
  on the FULL neutral baseline run 1008; analysis-only session, 7
  FULL runs in flight from s28 — declared: no new fleet submissions).
- **Contribution:** controller decision frame changed with evidence
  (commits a473dc4, 26362a0, 6c55e3a): completion-price policy
  shown mechanically leverless (D EV-neutral vs hold; explains E-041
  CEIL-NULL, closes that axis's WHY); neutral loss localized to
  S-flow adverse selection 58/42 / −3.2¢ per share (the tilt
  program's exact target term, now with a baseline engagement metric
  for the E-044 readout); time-varying-quote axis given a measured
  prior (toxicity ×2–3 late-window).
- **Time to evidence:** ~5 min (fleet queue verification + minuteev
  scan on run 1008 launched 23:10–23:14Z). PASS.
- **Throughput:** analysis-only (declared): 4 read-only scans over
  the 10,651-market run 1008 (minuteev, anatomy, 2 × JSON_TABLE
  identity queries); no new runs (7 × 10,747 already in flight,
  progress verified twice, 763 markets/min). No serial-scan issue.
- **Scale:** closed by E-036 on record; all in-flight runs B=500.
- **Next:** read E-043/E-044/E-045 vs frozen bars + s30 audit —
  GREEN (directional + neutral controller evaluation).
- **Verdict:** **GREEN.**
- Verdict history: s25 GREEN, s26 GREEN, s27 GREEN, s28 GREEN,
  s29 GREEN. Next audit: s30 (before new research).

## Blockers

None. 7 FULL runs in flight (drain ≈ 00:40Z 2026-08-01; do NOT
resubmit — verify with fleet.ts, then results.ts --last 8).

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
  commits (s13–s28: only protocol/harness commits moved HEAD;
  s28 rebase pulled protocols/pair-opus only — no engine change).
- **Sibling labs:** `protocols/pair-opus` created 2026-08-01 — an
  independent clean-start lab on the SAME strategy problem (reads
  allowed both ways per inbox c68ea4ce; writes own-protocol only).
  Worth reading their memory/ once they produce results.
- Queue submissions require a CLEAN tree pushed to origin/main (push
  via `git push origin HEAD:main`); commit state snapshots before
  submitting. If push is rejected (sibling labs push too), rebase
  then push — check what the rebase pulled.
- **zsh does NOT word-split unquoted variables** — submit grids as
  one LITERAL command per config (inbox c841c329); also `echo ===`
  breaks zsh (=cmd expansion) — avoid `=`-leading words. Always keep
  stderr. run-backtest.ts: `--latest` is a BOOL; market count goes in
  `--limit N`. Capture the batchUid line from EVERY submit.
- Verify with fleet.ts after every detached batch; count aggregate
  jobs (waiting-children), not market-job totals.
- Do not push strategy-semantics changes while that strategy's jobs
  are queued/running — workers track origin/main; serialize push →
  submit. (E-043/E-045 pin pair.v17.ts at f107234; E-044 pins
  pair.v17m.ts at 18ce0a43: do NOT touch either file while queued.)
- Screens baseline 874 (v0) and parents 872/873/879 valid ≤
  2026-08-06 (evaluator.md §Universes). FULL references: v1-b = 914;
  v16 τ+160 no-ceiling = 1005 (f1); **v17 neutral g0 = 1008 (the
  standing FULL neutral baseline); v17 best directional g3 = 1009.**
  v15 bridge chain 970 ≡ 960 ≡ 956. v16 bridges: c0 = 978, d0 = 987.
- **NOISE MODEL: FULL-pair instrument at B=500 — paired per-market
  sd 38.29 (same-config), SE_pair 0.369, ev bar B_full = 0.74.
  Cross-config paired sd is LARGER (22–66 measured in E-042,
  behavior-divergence dependent). Pinned-800/B500 single-run ev
  SE ≈ 1.2 — structure screens only. p/100 bar 0.54 for screens.**
- JOURNAL entries are messages to the human (contract v2): plain
  sentences, tried/happened/means/next, drop run ids/codes unless
  genuinely the point.
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329), verify queue depth after.
- Class kills need an identity argument (evaluator.md §Kill
  standards); N failures kill a family only. Verdict bars must name
  comparison PAIRS. Positive signals measured ON discovery data need
  disjoint confirmation before any build decision (E-039 → E-041
  canonical: +1.91 at pinned-800 → 0.04 at FULL).
- Fill model: calibrated by E-025 (ToB capacity bound). Guard-7
  whole-size fill optimism: larger-q results depth-optimistic
  (E-036). E-044's maker-tilt fills are worst-queue conservative
  (adverse-selection direction — the honest side for this test).
- Sibling-memory recheck at session start (`ls protocols/*/memory`).
- Smoke cannot catch latency-race bugs AND cannot demonstrate RARE
  fill modes (escalate to a 200-mkt Stage B instead).
- Schema refines AND engine constraints (OrderManager validation)
  can invalidate a frozen grid corner — check every cell when
  freezing (GTD expiry < now+60s rejected; ttlSec ≥ 61).
- A completed run with 0 trades and noActivity=N can mean every
  order was REJECTED — check OrderManager validation before blaming
  data. High noActivity can also be the market slice.
- The backtest sim is NOT bit-deterministic (latency jitter); a
  per-market pnl diff between two runs is NOT proof a mechanism
  engaged (s28: g3-vs-g0 differ on 8,789 mkts, mostly jitter).
- leadPersistTicks is in TICKS (~138/s on active markets).
- Feed-declaring strategies: workers fulfill binance+priceToBeat
  (diag 1006). 96 of the 10,747 universe markets have NO strike
  anywhere (0.89% universe-wide; deterministic set) — hard per-market
  failures, compare on common played intersection (pair-v17.md §6.2).

## Inbox processed through

2026-07-31T16:46:43.750Z-82e89da5 (no newer entries at s28 start).
