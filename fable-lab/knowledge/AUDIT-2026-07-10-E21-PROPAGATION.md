# AUDIT — E21 knowledge propagation (fresh-context, 2026-07-10)

_Commissioned session 41 (U43bg), immediately after the CAL-002 verdict
commit (1530f3c). Scope: do the derived artifacts (LESSONS E21,
EDGE-SPACE updates, STATE.md) faithfully represent CALIBRATION-2.md's
Results? The judge ran BEFORE these artifacts were written. All
recommended actions were applied in the same unit. Report verbatim._

---

VERDICT: sound-with-findings

NUMBERS CHECKED:
- k = 60 (6 pairs × 5 buckets × 2 sides) — CALIBRATION-2.md:59-73 vs E21 (LESSONS.md:319-321), EDGE-SPACE §1 row:31 ("60-cell grid"), STATE.md:403-404 — PASS
- Candidate bar z ≥ 3.37 — source:84 vs E21 ("frozen cells... bar" implicit; no drifted value printed anywhere) — PASS (no derived artifact misstates the bar)
- Zero candidates, max positive z = +1.75 (DOWN 600-750/dn2, net +0.0075) — source:294,305,318 vs E21:322, STATE.md:413 — PASS
- NEG-FLAG UP (600-750, dn2): z = −3.72, n = 2,708, minority 572 ("fully powered") — source:261,311-312 vs E21:322-324, EDGE-SPACE row ("1 buyer-adverse NEG-FLAG at z = −3.72"), STATE.md:414 — PASS
- dn2 UP z-sequence from 300s on: −2.23 / −3.00 / −3.72 / −2.90 — source table rows 251,256,261,266 vs E21:325-326, STATE.md:416-417 — PASS
- Gross continuation "≈ 2-2.4c": late-pair d = −0.0243 (600-750) and −0.0225 (750-850); source verdict says "≈ 2-2.4c gross at late offsets" — E21:327 and STATE.md:415 reproduce the figure. PASS on fidelity, with the note that both attach it adjacent to the "from 300s on" sequence where 300-450 gross is only 1.51c; the "late" qualifier survives in both ("big late moves" / "late in the window"), so no drift.
- Cross-side "nets at most +0.75c (z ≤ +1.75)" vs erratum: erratum corrects the verdict's "+0.31c to +0.75c" to "+0.34c to +0.75c, with 300-450 DOWN dn2 at −0.13c". E21's "nets at most +0.75c" and STATE's "nets ≤+0.75c" state only the upper bound, which is exactly the erratum-safe formulation (−0.13c ≤ +0.75c) — PASS; the erratum is correctly absorbed, not contradicted.
- Gates 0.9869/0.9777 (join-direction) and −1.03/−0.59 (E14-analog) — source:236-237; no derived artifact restates the numbers; STATE.md:418 says "Gates all passed" — PASS (faithful, no drift possible)
- "~90% of segment-samples |move| ≥ 2c": recomputed from printed n's — 30-150 UP (3620+3661)/8112 = 0.898; 300-450 = 0.911; 600-750 = 0.890; 750-850 = 0.879 — "~90%" in E21:335-336 — PASS
- Thin-cell n ≈ 130-330: actual thin-cell n span 134 (DOWN 750-850 flat) to 333 (UP 450-600 up1) — E21:338 — PASS
- Thin-cell resolution "~6-10c": traces verbatim to source:348 (judge-passed); underlying 3.37·se spans ~5.4-12.1c, but the derived artifact copies the source figure faithfully — PASS (fidelity)
- Reserve 5,460 unspent: source:35-37,320; E21:340-342 ("no candidate, no reserve spend"), STATE.md:418 ("reserve NOT spent") — PASS
- Selftest 17/17, audit "all 6 findings fixed pre-read incl. MAJOR" — source:225-226,174-216 (findings 1-6 all addressed, #1 MAJOR) vs STATE.md:408-413 — PASS
- Erratum count: STATE.md "erratum accepting 2 minor reservations" vs source erratum accepting Judge reservations 1-2 (of 3) — PASS
- E21 transfer (a) "segment horizons (2-4 min)": FAIL — pair segment lengths are 120s, 150s×4, 100s (1.7-2.5 min); no source quantity equals 2-4 min (Finding 4)
- EDGE-SPACE §4:168 "carries no net-positive cell on either side": FAIL as literal arithmetic — 12+ cells print net > 0 (e.g. DOWN 600-750 dn2 +0.0075, UP 450-600 dn1 +0.0104); the source claim is "no cell clears the candidate bar" (Finding 5)

WORDING OBLIGATIONS:
- Cross-side non-independence: E21 ("the SAME book samples, not independent evidence"), STATE ("same samples") — PASS
- Thin-cell nulls framed as power statements: E21 transfer (c) — PASS
- No venue-level efficiency claim for excluded quiet markets: none made in any derived artifact — PASS
- Coverage conditioning ("any verdict wording citing a pair must state its coverage fraction", source:136-143): FAIL — E21, the EDGE-SPACE §4 addition, and the STATE Done entry all cite the 600-750 NEG-FLAG (coverage 0.766) and the 750-850 continuation pair (coverage 0.464) with zero coverage mention; the E20 lesson carried "and coverage conditioning" in-place (Finding 1)
- Power scoping on the headline null: source says "within stated power"; E21's headline sentence and EDGE-SPACE §4:168-169 state the null without the in-place qualifier (entry-internal (c) partially mitigates) — MARGINAL (Finding 6; same class as E20-propagation Finding 3)
- §4 tightening licensed by the null: the EDGE-SPACE §4 addition preserves the sub-power escape ("or sub-power windows per the clause above") and matches the source Consequence ("BEYOND single-segment move sign/size... sub-power window still formally open") — PASS, though the parenthetical lacks an explicit "e.g." (Finding 3)
- STATE.md "Next" first bullet: FAIL — "(i.e. multi-segment/flow structure, or sub-power windows...)" uses "i.e." (exhaustive) and drops §4's "derived features", the exact defect class the E20 propagation audit flagged as MAJOR (Finding 2)
- E21 transfer (b) EXP-006 explanation stated as fact rather than hypothesis — FAIL (Finding 7)
- Mirror-deviant caveat (amendment #2): present in source; not repeated in derived artifacts, but no derived artifact cites pairs (150,300)/(300,450) for a claim, so nothing inherits the exposure — PASS

FINDINGS:
1. (MAJOR) Dropped binding caveat: coverage conditioning is absent from all three derived artifacts. The source makes it binding that pair-citing wording state the coverage fraction (CALIBRATION-2.md:136-143; per-pair 600-750 → 0.766, 750-850 → 0.464). LESSONS E21, EDGE-SPACE §4:169-171, and STATE.md:414-417 all present the NEG-FLAG and the "late big down-moves continue" claim as unconditional properties of late-window markets, silently including the 23-54% of sampled markets with no live book in both segments. The E20 lesson carried this qualifier; E21 drops it entirely.
2. (MAJOR) STATE.md "Next" first bullet (STATE.md:430-431) over-tightens with "i.e.": "(i.e. multi-segment/flow structure, or sub-power windows ...)" makes the enumeration exhaustive and drops EDGE-SPACE §4's "derived features". The frozen Consequence only requires "beyond single-segment move sign/size (this scan)" — e.g. a single-segment move × price-level interaction (CAL-002 deliberately has no price dimension, source:72-73) or a within-segment derived feature is preserved by the source but rejected by the STATE list. This is the identical defect class the E20 propagation audit flagged as MAJOR (its Finding 1); "per EDGE-SPACE §4" partially mitigates but the "i.e." recreates the silent protocol tightening.
3. (MINOR) EDGE-SPACE §4:173-175: the E21 parenthetical "(multi-segment paths, flow/derived features, or sub-power windows per the clause above)" lacks the "e.g." that the E20 fix established for the adjacent clause; without it the list can be read as exhaustive. Content is adequate (sub-power escape preserved, "derived features" broad), so MINOR rather than MAJOR.
4. (MINOR) LESSONS E21 transfer (a): "(2-4 min)" is unsourced — the six pair segments span 100-150s (~1.7-2.5 min). Number drift in a quotable transfer bullet.
5. (MINOR) EDGE-SPACE §4:168: "carries no net-positive cell on either side" is literally false against the printed tables (multiple insignificant net-positive cells exist, max net +0.0096); the licensed claim is "no cell clears the candidate bar".
6. (MINOR) E21 headline and transfer (a) drop the source's in-place "within stated power" scoping ("momentum/continuation ideas at segment horizons are now measured" is unqualified; only dn2/up2 cells are powered to ~2-2.7c, thin buckets to ~6-10c). Entry-internal transfer (c) covers it two bullets later — standalone-citation drift risk, same class as E20-propagation Finding 3. Transfer (a)'s "a cheaper expression... in-model does not exist (maker side closed by E16-E19)" also slightly overstates: §4 keeps NEW touch_or_better registrations arguable with an E19-escape argument.
7. (MINOR) E21 transfer (b): "retroactively explains EXP-006's fill-less quiet cells" is stated as fact but is speculative. CAL-002's bimodal endpoint-move distribution (mid at two offsets 100-150s apart, conditioned on valid books at both) is a different object from EXP-006's regime gate, and an endpoint-flat segment can still move intra-segment; also EXP-006's quiet primary cell was 2/8 filled with 5 maker fills (EDGE-SPACE §1:107), i.e. nearly but not literally fill-less. The link is plausible and worth recording, but as a hypothesis ("is consistent with / plausibly explains"), not an established fact.

RECOMMENDED ACTIONS:
- LESSONS E21: (a) add the coverage conditioning in-place, e.g. after the NEG-FLAG numbers: "(cells condition on valid books at both offsets; pair coverage 0.766 at 600-750, 0.464 at 750-850)"; (b) change "(2-4 min)" to "(~2-2.5 min segments)" or drop it; (c) hedge transfer (b): "which plausibly explains EXP-006's near-fill-less quiet cells" and note the gate-definition mismatch; (d) add "within stated power" to the headline claim; (e) soften "which in-model does not exist" to "for which no measured in-model expression survives (E16-E19; a new touch cell needs an E19-escape argument per §4)".
- EDGE-SPACE §4: change "carries no net-positive cell on either side" to "yields no cell clearing the candidate bar on either side"; insert "e.g." before "multi-segment paths"; add the 600-750 coverage fraction to the buyer-adverse parenthetical.
- STATE.md "Next" first bullet: replace "(i.e. multi-segment/flow structure, or sub-power windows ...)" with "(e.g. multi-segment paths, flow/derived features, or sub-power windows ..., per EDGE-SPACE §4)" — mirroring exactly the fix the E20 propagation audit forced for the same bullet.
- STATE.md Done entry: append coverage fractions (0.766/0.464) to the NEG-FLAG sentence.
