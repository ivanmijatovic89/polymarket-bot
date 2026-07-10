# AUDIT — E20 knowledge propagation (fresh-context, 2026-07-10)

_Commissioned session 41 (U43bb), immediately after the CAL-001 verdict
commit (929af34). Scope: do the derived artifacts (LESSONS E20,
EDGE-SPACE updates, STATE.md) faithfully represent CALIBRATION.md's
Results? The judge ran BEFORE these artifacts were written, so this
audit covers what the judge could not see. Report preserved verbatim
below; all recommended actions were applied in the same unit._

---

VERDICT: sound-with-findings

NUMBERS CHECKED:
- 8,516 discovery markets — CALIBRATION.md:54,275 vs E20 (LESSONS.md:280,284), EDGE-SPACE.md:41, STATE.md:366 — PASS
- 126 cells / candidate bar z ≥ 3.565 — CALIBRATION.md:171,315 vs E20:285-286, EDGE-SPACE §1 row:30, STATE.md:373 — PASS
- Join-direction gates 0.9854 (UP, n=687) / 0.9778 (DOWN, n=721) — CALIBRATION.md:312-313 vs E20:287, STATE.md:374 — PASS
- E14 positive controls z = −1.02 / −0.59 — CALIBRATION.md:312-313 vs E20:288, STATE.md:374 — PASS
- Extremes z = −3.26 (DOWN 600s [0.02,0.10)) and −3.02 (UP 750s [0.20,0.35)), both negative — CALIBRATION.md:364,419,491-493 vs E20:288-289, STATE.md:374-375 — PASS
- Coverage 0.8746 / 0.5993, denominator 8,133 slugs, 383 no-line markets — CALIBRATION.md:298-302 vs E20:293-294 (exact fractions + 8,133), STATE.md:370-372 (adds 600s→0.9766, matches line 301) — PASS; EDGE-SPACE.md:45 uses rounded 0.87/0.60 with the conditioning wording — PASS (rounding acceptable, conditioning present)
- Mirror pairs 52,386/52,388, two deviants (1764846000/850 known + 1771651800/300 new) — CALIBRATION.md:285-295,457 vs E20:296-297, STATE.md:368-370 — PASS (52,388 − 2 = 52,386 ✓)
- Power: mid-range |d| ≳ 3.8c; tail candidate bar ≈ 1.3c vs fee ~0.08c — CALIBRATION.md:108-116,505,510 vs E20:290-291,294 — PASS; EDGE-SPACE.md:43 "power beat the fee floor by 15×" — FAIL (1.3/0.08 = 16.25, not 15; and the phrasing inverts the relation — see Finding 2)
- Probe reserve 5,460 unspent — CALIBRATION.md:57,516-517 vs E20:307, STATE.md:379-380 — PASS
- Run facts pid 73037, code ab2acc9, 174m21s, 952,211,001 events, 104,776 lines, UP/DOWN 52,388 each, 0 errors — CALIBRATION.md:274-284 vs STATE.md:365-368 — PASS
- Zero CANDIDATE / zero NEG-FLAG — CALIBRATION.md:447-448,481 vs all three artifacts — PASS
- Judge checks bullet "104,776 − 200 − 4,372" — FAIL as arithmetic (= 100,204 ≠ 100,404). The verbatim calib.ts line (CALIBRATION.md:308) prints "4172 ask outside [0.02,0.995]", the verdict body (line 490) says 4,172, and the judge's own basis paragraph (line 523) says 4,172; 104,776 − 200 − 4,172 = 100,404 ✓. The checks bullet's "4,372" is a transcription typo in the judge's text. No derived artifact propagates 4,372 — PASS on propagation.

WORDING OBLIGATIONS:
- "Within stated power" scoping — E20 headline (line 278-281) and scope-limits sentence: PASS; EDGE-SPACE §1 taker bullet (line 44): PASS; E20 transfer (b) restates the claim absolutely without an in-place qualifier: MARGINAL (Finding 3); EDGE-SPACE §4 bullet and STATE.md "Next" first bullet drop the power scoping entirely where they gate registrations: FAIL (Finding 1)
- 750s/850s conditionality + coverage fractions (amendment #11) — E20: PASS (exact fractions, "conditional on a book event at-or-after the offset"); EDGE-SPACE §1 bullet: PASS (0.87/0.60 + conditioning); STATE.md: PASS
- No venue-level efficiency claim for excluded quiet markets — none made in any derived artifact: PASS
- Cross-side non-independence (amendments #12/#13) — E20: "buy-DOWN cells are the sell-UP-at-bid economics, not independent evidence": PASS; STATE.md cites "#12/#13 non-independence": PASS; nothing presents UP and DOWN as double evidence: PASS
- Half-plane / both-half-planes wording (amendment #3/#10) — E20 "both taker half-planes", STATE.md same: PASS
- Tail-cleanliness offset restriction — source restricts "clean on both sides" to 600s/750s/850s (line 505-506); E20 keeps it ("clean at 600/750/850s"): PASS; EDGE-SPACE §1 bullet drops it ("the extreme-price tails … are clean on both sides", no offsets): FAIL (Finding 4)

FINDINGS:
1. (MAJOR) EDGE-SPACE §4 taker bullet (line 159-162) and STATE.md "Next" first bullet (line 389-392) harden the null beyond what it licenses: "must ALSO explain why the edge is invisible to a fixed-time state scan — i.e. it must live in conditional/path structure within the window, not in price level × time alone." The "i.e." makes conditional/path structure the ONLY admissible explanation, silently foreclosing the power-based one the frozen method explicitly preserves (CALIBRATION.md:114-116, 510-512: mid-range cells resolve only |d| ≳ 3.8c; "a power statement, not proof of efficiency"). A hypothetical fixed-time mid-range edge in (~1.5c, ~3.8c) clears the §4 fee floor, is invisible to CAL-001 for power reasons alone, and is not excluded by the null — yet the new bar would reject it as non-conditional. E20 transfer (a) ("must argue why its edge is invisible to BOTH…") is correctly permissive; the §4/STATE "i.e." clause is a silent protocol tightening.
2. (MINOR) EDGE-SPACE §1 taker bullet (line 43): "where power beat the fee floor by 15×" — number drift (1.3c/0.08c = 16.25×, and no source ratio equals 15) and directionally misleading: the candidate bar EXCEEDS the tail fee ~16×, i.e. tail deviations between ~0.08c and ~1.3c clear fees but were undetectable. "Power beat the fee floor" reads as sensitivity finer than fees, which is backwards.
3. (MINOR) LESSONS E20 transfer (b) (line 302-304): "fixed-time top-of-book state alone carries no taker-exploitable signal on this venue" — the quotable transfer bullet carries no in-place power/conditioning qualifier. The entry's headline and scope-limits sentence do qualify it two sentences earlier, so this is a drift risk when the bullet is cited standalone, not a standalone overclaim. (EDGE-SPACE's copy of the same claim, line 44-46, is correctly qualified in-sentence.)
4. (MINOR) EDGE-SPACE §1 taker bullet (line 42-43): "the extreme-price tails … are clean on both sides" drops the source's frozen restriction "at 600s/750s/850s" (CALIBRATION.md:505-506). Early-window tail cells (30s/150s) are empty or near-empty (n = 0-28) — unmeasured, not clean — and early-window extremes were the study's stated motivating target (CALIBRATION.md:24-27).
5. (MINOR) Appended judge verdict, checks bullet (CALIBRATION.md:530): "104,776 − 200 − 4,372" is arithmetically wrong (= 100,204); correct subtrahend is 4,172 per the verbatim calib.ts output (line 308) and the judge's own basis line (523). Verbatim appending is the right handling (do not edit a judge's text), but the file currently carries an uncorrected false arithmetic identity with no adjacent flag — the same file already sets the precedent of adjacent italic notes for frozen-text tensions (lines 466-477).

RECOMMENDED ACTIONS:
- EDGE-SPACE §4 taker bullet and STATE.md "Next" first bullet: soften "i.e. it must live in conditional/path structure…" to "e.g." or append "— or argue it sits below CAL-001's stated power (mid-range resolves only |d| ≳ 3.8c) while still clearing the ~1.5c floor with recorded-data evidence from another instrument", restoring the frozen power scoping.
- EDGE-SPACE §1 taker bullet: replace "where power beat the fee floor by 15×" with "where the candidate bar (≈ 1.3c) is ~16× the local fee (~0.08c)", and append "at 600/750/850s" to "clean on both sides".
- LESSONS E20 transfer (b): insert "within CAL-001's stated power and coverage conditioning," before "fixed-time top-of-book state alone…".
- CALIBRATION.md: add an append-only italic note beneath the judge verdict (same pattern as the existing pair-count note) stating that the checks bullet's "4,372" is a transcription typo for 4,172, per the verbatim calib.ts line and the judge's own basis paragraph. Do not edit the verbatim text itself.
