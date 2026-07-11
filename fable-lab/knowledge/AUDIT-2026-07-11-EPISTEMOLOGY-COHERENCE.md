# Fresh-context audit — EPISTEMOLOGY.md whole-doc coherence (U73 / R2)

_Commissioned session 56 (U73) as the first end-to-end coherence re-audit of
the amended rulebook since the session-1 U8 whole-lab review
(AUDIT-COVERAGE residue R2). Auditor report preserved verbatim below;
session actions follow at the end._

---

VERDICT: **sound-with-findings** — the amended doc is internally arithmetic-consistent (all §2 table values, §4 joint-FP math, the √(N/(N−1)) note, and the `batchStats.ts:162-175` citation verify), the U58/U69 fleet reconciliation and the E18 boundary−1 reconciliation are correctly reflected in the current text, and the D13 rule matches E14/D13 verbatim. Findings below are contradictions/ambiguities, none invalidating a past verdict.

**MAJOR**

1. **"Live paper validation (dry-run bot)" contradicts EDGE-SPACE's measured fact that dry-run produces no fills.**
   `fable-lab/protocol/EPISTEMOLOGY.md:127-129`: "The required next step is recorded in the verdict: live paper validation (dry-run bot), sized by the same t arithmetic on live fills."
   vs `fable-lab/knowledge/EDGE-SPACE.md:183-184`: "DRY_RUN=true cannot produce this — unplaced orders get no fills — so it requires real (tiny) orders."
   A dry-run bot places no orders, so there are no "live fills" to run t arithmetic on; the two readings prescribe different (and in one case impossible) post-confirmation handoffs. This clause fires on any future `confirmed` verdict. Fix: drop "(dry-run bot)" and state that live paper validation requires real tiny orders (operator-authorized), citing EDGE-SPACE §3.3.

**MINOR**

2. **Probe verdict space has a hole: q̂ ≤ 0 with −1 < t ≤ 0, prediction holds, no diagnosable leak → no branch fires.**
   `EPISTEMOLOGY.md:84-93`: kill needs "q̂ ≤ 0 with t ≤ −1" OR prediction contradicted; iterate needs "implementation leaks PnL in a diagnosable way"; advance needs "q̂ > 0". A mildly-negative, prediction-consistent probe (e.g. t = −0.6) matches none, and specs copy these rules verbatim (LIFECYCLE §2 step 2), so a future Judge must improvise between iterate and park. Never occurred in the 9 experiments (all kills fired a listed branch — e.g. EXP-006 t=−1.52, EXP-008 both branches). Fix: one sentence assigning the residual case (e.g. "otherwise iterate-or-park at the Scientist's D5 iteration budget").

3. **§3 states the Stage-2/Stage-3 bars as flat "t ≥ 2" without the §5 lineage adjustment.**
   `EPISTEMOLOGY.md:111` "requires ALL of: t ≥ 2 on the exploration window" and `:119` "t ≥ 2 on holdout alone" vs `EPISTEMOLOGY.md:152-156` "future decisive tests require one-sided p ≤ 0.023 / k … the t bar rises with every look." For a lineage with `lineage_cells` > 1 the two clauses license different verdicts. Practice is protected so far (EXP-006 spec:98 copied "t ≥ 2 … lineage_cells=1, p-bar 0.023"; JUDGE.md:32-33 has a lineage-adjusted-bar field), but a k>1 registration copying §3 literally would under-bar itself. Fix: append "(lineage-adjusted per §5)" at both bars.

4. **§2's economic floor "under pessimistic execution" is ambiguous against §5's "no single 'true' latency is asserted".**
   `EPISTEMOLOGY.md:45-48`: "the 95% CI of EV/market must exclude 0 *after* the stress battery … 'positive with confidence, under pessimistic execution'" vs `:164-166`: "No single 'true' latency is asserted; the verdict records the curve." Reading A: CI on the delay-0 primary run, battery merely passed. Reading B: CI at some pessimistic latency point (which one is undefined). The two readings would decide a latency-sensitive advance differently; §5.2's `latency-fragile` flag covers only the die-by-150ms case, not a CI-widens-but-survives case. Never exercised (no experiment reached the economic-floor test). Fix: state which run's CI is decisive.

5. **§4's false-confirmation arithmetic rests on a stale rate assumption.**
   `EPISTEMOLOGY.md:138-139`: "At ~50 advanced lineages a year, expected false confirmations ≈ 0.03/year." After D15 and the EDGE-SPACE §4 registration bar (EDGE-SPACE.md:190-263), the realized rate is ~1 advanced lineage in 55 sessions and the bar makes ~50/year unreachable. Direction-safe (fewer lineages → fewer false confirms), so the derived thresholds stand, but the stated justification no longer describes the lab. Fix: mark it "upper-bound assumption" or update the rate.

6. **§3's compute paragraph mixes two anchors with an unexplained clause.**
   `EPISTEMOLOGY.md:67-73`: "…the *most recent* markets are finite and burn on first read" sits in a sentence about R2 download cost, but "burn" elsewhere in the doc means holdout consumption (`:122-124`). Two readings (quota consumption vs holdout burning); harmless today but this paragraph was amended twice (U9 local-only → U69 fleet) and the residue clause no longer parses cleanly. The fleet number itself matches `CHARTER.md:127` (markets × 1.75s / slots). Fix: reword or delete the clause.

**Checks that found no defect (for the coverage record):** §2 detectable-effect table exact (2/√N); kill bar as applied in EXP-006/008/009 verdicts matches doc text verbatim; D13 clause (EPISTEMOLOGY:96-106) matches DECISIONS D13 and E14 ("outside [0.1,0.9]", <30 minority ⇒ provisional), and CAL-001 adopted minority ≥ 30 into its candidate bar (CALIBRATION.md:84); the promotion-tax formula p ≤ 0.023/k reproduces every CAL bar (z 3.377/3.565 @k=63/126, 3.75 @k=252); §3 "older than the holdout boundary" and §6's absolute `market_start_ms` agree with the E18/U52 reconciliation (the −1 mechanics correctly live in LIFECYCLE:87, template, and submit.ts, not here); fleet text agrees with the U58/U69/D43 reconciliation; the CAL discovery-scan pathway is not described in EPISTEMOLOGY but D21 explicitly grounds it in §5's multiplicity machinery, so no contradiction — at most a scope note; JUDGE.md's decision enum (kill|iterate|advance|confirmed|refuted) lacks the spec-defined `escalate`/`park` outcomes the EXP-008/009 Judges used, but JUDGE.md's "apply rules AS WRITTEN IN THE SPEC" clause resolves precedence, so not charged as a finding.

---

## Session actions (U73, applied same unit — DECISIONS D45)

All six findings fixed in EPISTEMOLOGY.md with minimal in-place edits, each
tagged `U73`: (1) post-confirmation handoff corrected to real tiny orders
per EDGE-SPACE §3.3; (2) probe residual case assigned to iterate-or-park
within the D5 budget, never advance on q̂ ≤ 0; (3) both decisive t ≥ 2 bars
now say "(lineage-adjusted per §5)"; (4) the economic-floor CI pinned to
the PRIMARY delay-0 run with the battery as qualitative gate (reading A —
the only reading the existing §5.2 machinery supports; a pessimistic-
latency CI would be a NEW bar needing its own derivation); (5) the ~50
lineages/year labeled an upper-bound assumption; (6) the burn clause
deleted from the compute paragraph. Bar DIRECTION check (corrected by
the U73 propagation verifier): fixes 2/3 can only tighten or leave
verdicts unchanged; 1/5/6 are factual/wording; fix 4 is a DELIBERATE
directional loosening relative to reading B of the old ambiguous text —
the CI-widens-but-survives latency case is advance-licensed under
reading A where B would have blocked it; accepted and recorded with the
pre-identified future tightening in D45. Second verifier finding: the
probe residual case is also propagated to
protocol/templates/EXPERIMENT.md's decision-rules block (the D43
stale-boot-doc class — a spec filled from the template would otherwise
have re-opened the hole).
