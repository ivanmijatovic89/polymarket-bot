# AUDIT — JUDGE.md contract text (residue R6, first re-audit since session 1)

_Commissioned session 57, U76. Report reproduced VERBATIM below. Disposition
(U76, same commit): all 7 findings fixed in place in JUDGE.md with a tagged
revision note — decision enumeration now kill | iterate | advance | park |
escalate | confirmed | refuted with the stage/spec-scoping rule (MAJOR-1);
simulator-bias field now explicitly fillable from the spec's exposure field
+ readout only, no outside documents (MAJOR-2); holdout missing-number
exception added ("refuted", never "iterate" — MINOR-3); battery field
aligned with §5.2/§5.3's refusal to binarize latency (MINOR-4); battery.ts
named as the robustness paste source (MINOR-5); run id + batch uid field
added (MINOR-6); After-the-verdict now points at the D25/D31 propagation
audit and the U74b plain-line decision rule (MINOR-7). No threshold value
or isolation rule changed._

---

# Fresh-Context Audit — R6: `fable-lab/protocol/sessions/JUDGE.md`

**VERDICT: sound-with-findings** — the core architecture (isolation, three inputs, spec-as-written, tie-against-advancement, verbatim append, no re-judgment) is intact and matches LIFECYCLE §0/§5 and 12+ rendered verdicts. But the 48-line contract, unrevised since session 1, has one decision-set enumeration that now contradicts three governing documents and D18's binding outcome set, plus an internal isolation contradiction that has been silently papered over by spec practice.

---

## MAJOR findings

**MAJOR-1 — The verdict decision enumeration omits `park` and `escalate`, contradicting current EPISTEMOLOGY (post-D45), the experiment template, D18, and SCIENTIST.md.**
- JUDGE.md:26 (inside the prompt the Judge actually receives): `- decision: kill | iterate | advance | confirmed | refuted`
- Contradicted by EPISTEMOLOGY.md:90 (D5: "Max 3 iterations per mechanism without a *new* falsifiable insight → **park**") and EPISTEMOLOGY.md:93–96, the D45/U73 residual branch: "**residual case** (added U73 …) — **iterate-or-park** within the D5 iteration budget; never advance".
- Contradicted by templates/EXPERIMENT.md:33–34: "probe residual …: **iterate-or-park** per EPISTEMOLOGY §3 (U73), never advance".
- Contradicted by DECISIONS.md D18 (interpretive rules, binding): touch-mode outcome set is `{kill, escalate, park}` only — and both rendered touch verdicts had to cite it around the contract: EXP-008-at-touch-quiet-quoting.md:184 ("Per D18, this outcome set is **{kill, escalate, park}** only") and the EXP-009 verdict's "escalate branch … not remotely met".
- Contradicted by SCIENTIST.md:58: "`- decision: <kill|advance|**park**|...>`".
- Failure mode: a literal-minded fresh-context Judge (the exact reader this file is designed for) cannot render `park` at an exhausted-iteration probe, at the D45 residual branch, or `escalate` at a positive touch-bound result — the current rules demand outcomes the template forbids.

**MAJOR-2 — Internal isolation contradiction: the prompt requires justification per documents the Judge is forbidden to have.**
- JUDGE.md:3–6: "The Judge must NOT be given the Scientist's working notes … — **only the three inputs below**" (EPISTEMOLOGY.md, the EXP file, the results.ts paste; confirmed by LIFECYCLE.md:12–13 "Sees ONLY: the frozen spec, the tool-read results, EPISTEMOLOGY.md").
- JUDGE.md:30–31, inside the template handed to that Judge: "simulator-bias classification: <… justify from maker share and composition, **per CAPABILITIES §4 and DECISIONS D6**>".
- Neither `engine/CAPABILITIES.md` nor `DECISIONS.md` is among the three inputs, so the field is unfillable "per" its cited authorities as written; and actually supplying DECISIONS.md (47 entries of the Scientist's own reasoning about these experiments — D14, D18, D21…) would breach the isolation JUDGE.md itself calls "the protocol's core bias protection". In practice the gap is bridged only because the spec template carries a "Simulator-bias exposure (CAPABILITIES §4)" field and rendered verdicts leaned on spec-quoted material — a workaround the contract never states.

## MINOR findings

**MINOR-3 — The missing-number rule prescribes an impossible verdict at holdout (D45 defect class).**
- JUDGE.md:40–41: "if any number you need is missing from the readout, the decision is **'iterate'**".
- EPISTEMOLOGY.md:122–131: holdout decides only `confirmed` (t≥2 lineage-adjusted) or `refuted` ("**anything else**. The holdout is burned … No re-runs"). An "iterate" verdict at stage holdout is not in the stage's outcome set and implies a re-run of a burned window — same "prescribes an impossible action" class as the dry-run clause D45 removed from EPISTEMOLOGY.

**MINOR-4 — Battery field demands binary pass/fail for items EPISTEMOLOGY explicitly refuses to threshold.**
- JUDGE.md:29: "battery: <stage main: smoothness / latency curve / day stability / composition — **pass or fail each**>".
- EPISTEMOLOGY.md:176–177 (§5.2): "**No single 'true' latency is asserted; the verdict records the curve**" (with a named `latency-fragile` flag, not a pass/fail); EPISTEMOLOGY.md:181 (§5.3): "**No hard threshold**". The contract asks for a binary the framework deliberately does not define; the D45-fixed economic-floor wording (§2) also hinges on the `latency-fragile` flag, not a pass/fail.

**MINOR-5 — Robustness-readout source drift: no mention of `tools/battery.ts`.**
- JUDGE.md:17–20 sources only "tools/results.ts" plus an unspecified "Robustness readouts … <paste>". LIFECYCLE.md:92: robustness runs are read "**through `tools/battery.ts`**" (tool exists, `fable-lab/tools/battery.ts`, and was independently recomputation-audited in U71). JUDGE.md predates the tool and was never updated; a Scientist following JUDGE.md alone could paste ad-hoc per-run results.ts outputs instead of the canonical battery tabulation.

**MINOR-6 — No run-identification field in the verdict block.**
- EPISTEMOLOGY.md:204–206 (§7) requires "run id, batch uid" recorded with every decisive readout; the JUDGE.md:25–36 template has no field for which run is being judged. Rendered verdicts supplied it ad hoc and inconsistently (EXP-009: in the stage line — "stage: probe (N=500, **run 358, batchUid EXP-009-probe-touch**…)"; EXP-008: nowhere in the verdict itself, only in the Runs section above).

**MINOR-7 — "After the verdict" (JUDGE.md:44–48) presents append-verbatim + obey as the complete post-verdict procedure, omitting the mandatory D25/D31 propagation audit** ("The Judge cannot catch these: it runs before the derived artifacts exist" — DECISIONS.md D25). The duty is the Scientist's and is stated in SCIENTIST.md:64–84, so this is omission, not contradiction — but the section's title claims completeness it no longer has.

## Checks that came back clean

1. **Isolation prescription vs spawn practice (Q4)** — JUDGE.md:3–6's three-input rule matches LIFECYCLE.md:11–14 and SCIENTIST.md:55–57 exactly (modulo MAJOR-2's internal contradiction).
2. **No inlined numeric thresholds** — JUDGE.md hard-codes no t-bars, N sizes, or p-values, so D45's "no threshold value changed" and any future recomputation cannot strand a stale number here. "Apply the decision rules AS WRITTEN IN THE SPEC" (line 22) matches LIFECYCLE.md:117–118 and the frozen-spec doctrine.
3. **Lineage adjustment (Q1)** — the "lineage-adjusted bar" field (JUDGE.md:32–33) is present and consistent with EPISTEMOLOGY §5's promotion tax and the D45-added "(lineage-adjusted per §5)" Stage-2/3 wording; both EXP-008/009 verdicts filled it correctly.
4. **D13 minority-count omission is pinned as intended** — DECISIONS.md D13: "The JUDGE prompt template gains **no new field** — the count is derivable … and the Judge's 'read' line covers it." The rule lives in EPISTEMOLOGY §3, which the Judge reads; both touch verdicts applied it unprompted ("D13 skewed-payoff rule NOT triggered").
5. **D9 (truncated samples)** — no conflict; JUDGE.md's missing-number rule concerns absent statistics, not truncated-but-complete readouts, and D9 judging-at-persisted-N flows through the spec/Runs entry.
6. **Machine-read contract (Q2)** — the template emits `- decision: <value>` as a plain, unquoted, unbolded dash bullet, exactly the shape `tools/index-registry.ts` parses (D46 selftest; U74b `(?!\*)` lookahead excludes only the bold spec-field form). All 10 EXP verdict decision lines in the registry are plain-line parseable. Enforcement of plainness on append correctly lives with the appender (SCIENTIST.md:57–63). CAL verdicts (`null-confirmed`, knowledge/ files) are outside INDEX scope as instructed.
7. **`kill | iterate | advance | confirmed | refuted` per-stage mapping** — for the non-touch, non-residual, non-exhausted cases the enumeration matches EPISTEMOLOGY §3 stage outcomes (probe kill/iterate/advance; main advance/kill/iterate; holdout confirmed/refuted).
8. **File/tool references otherwise live** — `tools/results.ts` exists and is the decisive-readout source (LIFECYCLE §4, EPISTEMOLOGY §1 note); `fable-lab/protocol/registry/experiments/` path correct; DECISIONS D1/D6 exist as cited; skipped-as-zero gloss (JUDGE.md:39) matches EPISTEMOLOGY §1 verbatim in substance.
9. **Verdict-block field set vs template comment** — EXPERIMENT.md:46–48's field list (stage, decision, t/q/N/EV read, battery summary, simulator-bias classification, required next step, reasoning) is a subset of JUDGE.md's template; no divergence between the two documents' field expectations.
10. **Tie-goes-against-advancement and no-spec-changes rules** — consistent with EPISTEMOLOGY §3 ("data is cheaper than a false belief" ethos), LIFECYCLE §5's no-override rule, and observed Judge behavior in all inspected verdicts.

Nothing was fixed; all findings are report-only.

---

## U76b addendum — D31 application-fidelity check on the U76 rewrite

A second fresh-context checker verified the U76 fixes (verdict:
sound-with-findings; 6 of 7 findings faithfully applied, named invariants
byte-unchanged, propagation accurate). Three findings, all applied in the
same session:

1. **MINOR — the MINOR-4 fix was half-applied and misattributed.** The
   rewritten battery field kept "pass or fail" for day stability — the very
   item §5.3 refuses to threshold — and cited "§5.3 no hard composition
   threshold" (§5.3 is Time stability; §5.4 Composition has no
   no-threshold statement). Fixed: the field now states §5's own reading
   per item (smoothness pass/fail §5.1; latency curve + latency-fragile
   flag §5.2; time stability positive-day fraction + cliff clause §5.3;
   composition diagnostics §5.4).
2. **MINOR — wrong pointer:** the holdout missing-number exception cited
   EPISTEMOLOGY §4; the outcome set and burn semantics live in §3 Stage 3.
   Fixed (rule itself was verified consistent).
3. **MINOR (low) — undisclosed one-word tightening:** the robustness paste
   gained ", verbatim". Consistent with the decisive-readout discipline;
   kept and now disclosed in the revision note.

Checker clean-list highlights: MAJOR-1 scoping examples all grounded and
fillable from the three inputs; the scoping + holdout exception jointly bar
illegal outcomes at every stage; MAJOR-2 fix adds no input (D6 semantics
reachable via §5.4 which the Judge reads); isolation / as-written /
tie-against-advancement / skipped-as-zero byte-unchanged; no numeric
threshold anywhere in the new text.
