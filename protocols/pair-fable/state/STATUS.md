# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-08-01T09:35Z (mission-02 session 42 close — E-051 read and closed; nothing in flight)

## IN FLIGHT

Nothing. Queue drained 09:09Z (verified agg waiting-children=0); all
E-051 rows landed and were read in s42.

## HEADLINE STATE (read this first)

**s42: E-051 earlyTighten READ and CLOSED (pair-v17t.md §18, frozen
bars §14). Integrity clean (common 10,651 everywhere; engine-SHA delta
f0f87f19→7e5f9276 cleared by commit inspection — protocol-only, M4).**

- **EARLY-NULL fired** (e03 +0.280, e06 +0.690, both ≤ bar 0.74);
  curve monotone RISING to e09 +0.799 > bar at the grid edge;
  DEGENERATE tripwire PASS (45.5% ≥ 25%).
- **Channel decomposition (the decisive read):** e06/e09 ev gains are
  100% participation avoidance — kept-flow (played-in-both) paired Δ
  is −$0.3k / −$2.5k NEGATIVE; e09 p/100 WORSE than reference. Axis
  CLOSED at this shape; the above-bar e09 is an avoidance gain, not
  repricing.
- **K-AT-FLOOR-REDUNDANT** (p86k020 +0.643 ≤ 0.74) — k stays 0.12 at
  P* 0.86 (confirms E-050 cross-read).
- **STRATEGIC FINDING (binding input to future freezes, §18):** all
  measured v17t levers decompose ≥72% (P*, §17) to ~100%
  (earlyTighten) avoidance; avoidance is bounded above by ev = 0.
  The +2 target needs kept-flow Δ > 0 — every future freeze must
  carry the channel decomposition (kept-flow paired Δpnl) as a
  PRIMARY bar next to ev; an ev gain with kept-flow ≤ 0 closes its
  axis.
- **Records:** best FULL ev now 1056 (e09, −2.37); chain 1057
  (−2.48), 1055 (−2.53), 1054 (−2.89), 1052 (−3.17), 1049 (−3.83).
  **MECHANISM-TEST CENTER stays 1052 (P*0.86 k012, earlyTighten 0)**
  — do not compose new mechanisms on the closed avoidance dose.
  Standing comparison reference remains 1029 (ev −8.07).
- s42 while-draining analyses: §16 late-window minute×band matrix on
  1052 (late ≥0.40 bands = 63% of late S loss on 41% of late shares;
  0.40–0.50 toxicity peaks m5–6, OPPOSITE the lateTighten ramp shape
  — not k-priceable) and §17 P*-floor gain decomposition 1046→1052
  (72% avoidance / 28% repricing; floor prunes by price level, not
  market quality; participation not nested across P* levels).

## Current work

**Session 42 (~08:05–09:35Z):** E-051 readout + verdicts + close
(above). While the fleet drained: §16 late-window band×minute
calibration and §17 P* gain decomposition — both committed before the
readout. Foreground drain holds 08:11–09:09Z (declared; the wait WAS
the drain — no fleet capacity for new submissions while 43k E-051
jobs queued).

**Session 41 (07:45–08:25Z):** E-051 design freeze (§14, shape
correction: concession confined to m0–5), param added to pair.v17t.ts,
smoke 1053 PASS, 4 FULL cells submitted (sha 7e5f9276); §15 loss
identity on 1052 (residue solved −$125; completions doom-dominant C
$75k vs D $343k; m0–4 = 48% of gross S loss).

## Audit note

M1–M5 implemented and verified at 4809a8e (s26 correction stands).
M4 exercised in s42: cross-SHA comparison accepted only after commit
inspection showed protocol-only changes.

### Five-session audit s35–s39 (done in s40) — PASS

(Summary: 5 GREEN / 0 YELLOW / 0 RED; details in git history and s40
STATUS. Next audit: s45, covering s40–s44.)

- **Next-five plan (s40–s44) progress:** (1) s40 E-050 freeze/submit/
  read GREEN ✓; (2) s41 E-051 freeze/build/submit GREEN ✓ (plan said
  E-050 readout — it landed in s40 itself; s41 advanced to the next
  mechanism); (3) s42 E-051 readout + loss-identity work GREEN ✓;
  (4) s43 next-mechanism build + smoke + submit (late-band
  concession); (5) s44 readout. ≥3 GREEN already satisfied ✓.

## Next step (priority order)

1. **s43 (GREEN neutral-controller): late-window price-conditioned
   concession — design freeze + build + smoke + submit.** Calibration
   is banked in §16: scope m5+, threshold ~0.40, minute-flat; dose
   ladder analog 0.03/0.06/0.09 but expect the E-051 lesson (response
   may need ~3× the toxicity-calibrated dose — consider 0.04/0.08/
   0.12 or similar; freeze at design time). MANDATORY new bar (§18):
   kept-flow paired Δpnl > 0 as PRIMARY success metric next to the ev
   bar 0.74; degeneracy tripwire at BOTH granularities (late ≥0.40
   fill count ≥ 25% of 1052's base AND a noActivity growth cap —
   freeze exact numbers at design). Center 1052. Non-equivalence
   sketch already in §16 (vs lateTighten shape-orthogonality, vs P*,
   vs earlyTighten disjoint support).
2. If the late-band mechanism also lands avoidance-only: the §18
   strategic finding says the maker-cap lever family is exhausted as
   a repricing channel at this center — next genuinely different
   mechanisms from the §15 identity: the doom-backstop completion
   price (D $343k dominates completions; unitMax 0.99 pays near-full
   for the second leg) and the C/D completion mix. Treat as backlog,
   not a commitment.
3. Open-but-unscheduled: P* floor < 0.85, k > 0.28 — both decaying
   sub-bar, avoidance-dominant channels; revisit only with a
   composition reason.
4. **P-013 (needs human):** sell-side mirror scope ruling (PROPOSALS).
5. Cross-symbol replication: gated on P-012.

## Alignment gate — session 42 (final)

- **Classification:** neutral-controller (E-051 readout + verdicts +
  close under frozen bars; §16/§17 calibration analyses on the
  reference cell — all controller math).
- **Contribution (controller decision changed):** the entry-window
  concession axis is CLOSED (EARLY-NULL + channel decomposition:
  gains 100% avoidance, kept-flow Δ negative — pair-v17t.md §18,
  runs 1054–1057 vs 1052, LEDGER E-051); k confirmed redundant at
  the deep floor (K-AT-FLOOR-REDUNDANT). New binding freeze rule
  derived from measurement: kept-flow channel Δ > 0 becomes a
  primary bar (avoidance is bounded by ev 0 and cannot reach the +2
  target). Next mechanism selected and calibrated from data (§16
  late-band term). Evidence: §16/§17/§18, LEDGER E-051, commits
  330b3da/9045629 + this close.
- **Time to evidence:** min ~4 state recovered; min ~7 first
  substantive action (results.ts + fleet check → drain still ~1h
  out); min ~12 first analysis query landed (§16 matrix). PASS.
- **Throughput:** 4 FULL runs read and verdict-bound (10,651 common
  pairs each); 1 experiment closed (E-051, 2 axes); 2 analysis
  products (§16, §17) + 2 channel decompositions (§18); ~10 read-only
  DB queries; foreground drain holds declared (queue held 43k jobs of
  our own grid — no capacity for parallel submissions; analysis-only
  work during the wait per mission §6.2).
- **Scale:** closed by E-036 on record; all cells B=500.
- **Next:** s43 — late-band concession design freeze + build + smoke
  + submit (GREEN neutral-controller), per Next step 1.
- **Verdict:** **GREEN.**
- Verdict history: s31–s42 all GREEN. Next audit: s45 (s40–s44).

## Blockers

None. Nothing in flight; queue empty at close. pair.v17t.ts may be
edited (no jobs queued).

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
  commits (through s42: only protocol/harness commits moved HEAD;
  f0f87f19→7e5f9276 verified protocol-only in s42).
- **Sibling labs:** `protocols/pair-opus` — reads allowed both ways
  (inbox c68ea4ce); s42 check: still no results (memory/ =
  PRIOR-WORK.md + capabilities only).
- Queue submissions require a CLEAN tree pushed to origin/main (push
  via `git push origin HEAD:main`); commit state snapshots before
  submitting. If push is rejected (sibling labs push too), rebase
  then push — check what the rebase pulled.
- **zsh does NOT word-split unquoted variables** — submit grids as
  one LITERAL command per config (inbox c841c329). `echo ===` breaks
  zsh. Always keep stderr. run-backtest.ts: `--latest` is a BOOL;
  market count goes in `--limit N`. Capture the batchUid line from
  EVERY submit.
- Verify with fleet.ts after every detached batch; count aggregate
  jobs (waiting-children), not market-job totals. Rows land at FULL
  queue drain (s32 model; re-confirmed s42: 4 rows created 09:08:44–
  09:08:54Z as the last aggregates settled).
- Do not push strategy-semantics changes while that strategy's jobs
  are queued/running — workers track origin/main; serialize push →
  submit. (Queue EMPTY at s42 close — pair.v17t.ts is editable.)
- Screens baseline 874 (v0) and parents 872/873/879 valid ≤
  2026-08-06 (evaluator.md §Universes). FULL references: **standing
  comparison reference 1029 (v17 τ0 P*0.92, ev −8.07); MECHANISM-TEST
  CENTER 1052 (v17t P*0.86 k012, −3.17); best FULL ev on record 1056
  (1052+e09 avoidance dose, −2.37); chain 1057 (−2.48), 1055 (−2.53),
  1054 (−2.89), 1049 (−3.83), 1051 (−4.00), 1050 (−4.23), 1046
  (−4.83), 1047 (−4.98), 1043 (−5.89); older: g0=1008, g3=1009,
  m10=1026.** v15 bridge chain 970 ≡ 960 ≡ 956; v16 bridges c0=978,
  d0=987.
- **NOISE MODEL: FULL-pair instrument at B=500 — same-config paired
  sd 21.5–38.3 (E-041: 0.21 dup Δ; s39: 0.007 dup Δ), SE_pair
  0.19–0.24 on 10,651, ev bar B_full = 0.74. Cross-config paired sd
  larger (22–66). Pinned-800/B500 single-run ev SE ≈ 1.2 — structure
  screens only. p/100 bar 0.54 for screens.**
- **CHANNEL BAR (new, §18):** every future mechanism freeze on this
  family must include kept-flow paired Δpnl (played-in-both markets)
  as a PRIMARY success bar; ev gains with kept-flow ≤ 0 close their
  axis. Degeneracy tripwires must police market-level participation
  (noActivity), not only within-market fill counts.
- JOURNAL entries are messages to the human (contract v2): plain
  sentences, tried/happened/means/next, drop run ids/codes unless
  genuinely the point.
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329), verify queue depth after.
- Class kills need an identity argument (evaluator.md §Kill
  standards); N failures kill a family only. Verdict bars must name
  comparison PAIRS. Positive signals measured ON discovery data need
  disjoint confirmation before any build decision.
- Fill model: calibrated by E-025 (ToB capacity bound). Guard-7
  whole-size fill optimism: larger-q results depth-optimistic
  (E-036). Maker-tilt fills are worst-queue conservative.
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
  engaged.
- leadPersistTicks is in TICKS (~138/s on active markets).
- Feed-declaring strategies: workers fulfill binance+priceToBeat
  (diag 1006). 96 of the 10,747 universe markets have NO strike
  anywhere — deterministic set; compare on common played intersection
  (pair-v17.md §6.2).

## Inbox processed through

2026-07-31T16:46:43.750Z-82e89da5 (no newer entries at s42 start).
