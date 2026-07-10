# AUDIT — CAL-001 verdict checklist fidelity (2026-07-10, U43ah)

_Fresh-context verifier (read-only Explore agent), launched session 24
while the CAL-001-discovery-v3 run was in flight, BEFORE any outcome
read. Task: text-fidelity audit of
`knowledge/CAL-001-VERDICT-CHECKLIST.md` against the frozen sources
(CALIBRATION.md method + amendments #1–#14, STATE.md WHEN-COMPLETE
block, the two CAL-001 audits). Verdict: SOUND-WITH-FINDINGS. All 4
findings were acted on in the checklist in the same unit (commit
U43ah), before the run completed. Report preserved verbatim below._

---

I have now read all frozen sources (CALIBRATION.md full, both audits, STATE.md CAL-001 sections + WHEN COMPLETE) and the checklist in full. Every numeric constant in the checklist matches the frozen spec — I verified each one. The findings below are about one genuine coverage gap plus minor citation/scope imprecisions. This is a text-fidelity audit only; I did not run any tool or read any price/outcome field.

---

## VERDICT: SOUND-WITH-FINDINGS

The checklist is numerically faithful: k=126, z≥3.565 (candidate/NEG-FLAG), |z|≥3.377 (E14 control — correctly NOT bumped to 3.565), minority≥30, winRate>0.9 join gate, fee `winRate·0.0156·min(meanAsk,1−meanAsk)/meanAsk`, offsets {30,150,300,450,600,750,850}, 8,516 discovery / 5,460 reserve, p≤0.023/126, lineage_cells=126, sub-windows (→2025-12-31, 2026-01, 2026-02), deviant epoch 1764846000/off=850 — all match the frozen source. No threshold is inverted or mis-copied. But one binding erratum obligation is under-covered, and there are three minor imprecisions.

### Findings

**1. (MISSING BINDING OBLIGATION — material) The checklist discharges the amendment #13 erratum obligation via #14 alone, but #14's text omits the decision-rule location that #13 explicitly requires flagging.**
- Amendment #13 (CALIBRATION.md:238-245) requires the Results erratum to flag the stale independent-spread premise in **two** frozen locations: "(A) the frozen decision rule ('the DOWN side has its own book and spread')" (that phrase lives at CALIBRATION.md:86-88) "and (B) the diag-calib.ts header."
- Amendment #14's pre-drafted erratum text (CALIBRATION.md:255-257) flags only "(1) Amendment #10's rationale 'the DOWN ask has its own spread…' and (2) the diag-calib.ts header." It does **not** name the decision-rule phrase (A).
- Checklist §6 (CAL-001-VERDICT-CHECKLIST.md:80-81) discharges the whole obligation with "Append the amendment #14 erratum text VERBATIM… adjusting only the final pair-count," and nowhere restates #13's requirement to flag the decision-rule location. STATE.md:596-597 reaffirms "The Results erratum MUST flag the stale independent-spread premise per amendment #13."
- Consequence: a verdict session executing the checklist top-to-bottom appends #14, treats #13 as satisfied, and never flags the frozen decision rule's "the DOWN side has its own book and spread." This is a documentation-process violation of a binding obligation. (Root cause is a latent #13-vs-#14 tension in the frozen source, but a pure aggregation must surface #13's decision-rule flag rather than fold it entirely into #14's narrower text.)

**2. (WRONG/INCOMPLETE CITATION — minor) §4 attributes the entire join-direction gate to amendment #10.**
- Checklist §4 (CAL-001-VERDICT-CHECKLIST.md:59-61): "Join-direction: UP cell (850s, [0.98,0.995]) winRate > 0.9; DOWN side analogously via result_id=1 (amendment #10)."
- The UP-side gate (winRate>0.9 on that cell) is frozen in the base **decision rule** (CALIBRATION.md:95-98), not amendment #10. Amendment #10 (CALIBRATION.md:174-176) only adds the DOWN-side / result_id=1 half and "runs per side." Citing solely "(amendment #10)" mis-locates the origin of the gate.

**3. (INVENTED BOUND — minor) §1 imposes a lower epoch bound not present in the frozen discovery-window definition.**
- Checklist §1 (CAL-001-VERDICT-CHECKLIST.md:29): "Epoch range within [1764460800, <1772323200]."
- The frozen discovery window (CALIBRATION.md:52-54) specifies only an **upper** bound (`market_start_ms ≤ 1772323199999`, i.e. < 2026-03-01) with no lower bound. The upper side is faithful (1772323200 s), but the lower bound 1764460800 is an *observed* minimum reported in STATE session checks, not a frozen requirement. As written it would falsely flag a completed log whose earliest eligible market predates that value. Low severity, but strictly it adds a gate absent from the frozen source.

**4. (ADDED INTERPRETATION — minor) §6 deviant-disclosure obligation is not in the frozen sources.**
- Checklist §6 (CAL-001-VERDICT-CHECKLIST.md:93-94): "Disclose the single mirror deviant if any 850s cell it belongs to is discussed."
- Amendments #12/#13 mandate non-independence wording and the erratum; they state the single deviant is "immaterial either way" (CALIBRATION.md:213-216) and do not impose a per-cell disclosure obligation. This is a conservative addition, not a copied obligation. (Distinct from §1's "NEW deviants → disclose count," which is a reasonable integrity readout.) Low severity.

### Notes (not findings)
- The §1 integrity battery (latency, zero-error, UP/DOWN equality, dedupe, replay uniqueness, mirror 4-dp rounding, ts monotonicity) is aggregated from STATE.md session-11–24 methods rather than from CALIBRATION.md; it re-runs established outcome-free checks and introduces no new statistical gate. Faithful to STATE.
- §5 NEG-FLAG omits amendment #10's reinterpretation that a NEG-FLAG is now "directly cross-checkable against the other side's table" (superseding the base rule's "motivates a separately pre-registered DOWN-ask study"). Non-binding interpretive note; §6 does capture the #12 non-independence constraint that qualifies it. No action required.
- The E14 control bar at 3.377 (not 3.565) is correctly preserved — a place an aggregator could easily have wrongly "updated" to match k=126. Verified correct against amendment #2.

Recommend the checklist add an explicit §6 line: "Also flag the frozen decision rule's 'the DOWN side has its own book and spread' (CALIBRATION.md decision rule) as stale per amendment #13 — #14's verbatim text covers only #10's rationale and the diag-calib.ts header," to close Finding 1.

---

_Actions taken (U43ah, same commit): (1) checklist §6 gained the
explicit decision-rule flag line; (2) §4 citation corrected to base
decision rule + amendment #10 for the DOWN half; (3) §1 epoch check
reworded to upper-bound-only, observed minimum labeled non-gate;
(4) §6 deviant-disclosure line labeled a non-binding conservative
addition. No frozen source was edited._
