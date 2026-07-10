# AUDIT — E22 knowledge propagation (2026-07-10, U44)

_Fresh-context propagation audit per D25: source of truth
(`knowledge/CALIBRATION-3.md`) vs the derived artifacts written in the
E22 propagation commit (LESSONS E22, EDGE-SPACE §1 row + summary bullet +
§4 bar, STATE.md U44 + Next). Report preserved verbatim below; all
findings applied in the same unit._

---

## Verdict
**sound-with-findings**

## Findings

1. **MAJOR — EDGE-SPACE.md §4 (taker bullet, bar sentence, ~line 196): the source's "(this scan)" scoping was dropped, silently over-tightening the bar against mid-involved two-segment shapes the null does not foreclose.** CALIBRATION-3.md's Consequence paragraph licenses exactly: the bar tightens to "conditional structure beyond one- AND two-segment sign paths at these horizons **(this scan)**", and the fresh-context Judge explicitly certified that scoping ("the taker-bar tightening is scoped to 'these horizons (this scan)'"). The registration and verdict both state that the 12,532 mid-involved entries were EXCLUDED from the scan and "the excluded region remains formally open (sub-power window, EDGE-SPACE §4)". §4 as propagated reads "A conditional-structure argument must therefore go beyond one- AND two-segment sign paths at these horizons (e.g. …)". Since `mid` is one of the three frozen sign classes, a two-segment path involving a mid segment (e.g. big-down-then-flat) IS "a two-segment sign path at these horizons" — yet CAL-003 never scanned any such cell. The wording forecloses an escape the frozen method preserves — the exact E20/E21 MAJOR defect class (a). The generic "sub-power windows per the clause above" escape only partially rescues it (that clause demands ~1.5c via another instrument, and a reader has to already know the mid region was never scanned). **Fix:** restore the scoping in-place, e.g. "…must therefore go beyond one- AND two-segment BIG-MOVE sign paths at these horizons (this scan — mid-involved shapes were excluded from the grid and remain a formally open sub-power window), e.g. finer path features…".

2. **minor — EDGE-SPACE.md §1 summary bullet (line 51, "closed through two-segment sign paths") and LESSONS.md E22 ("mid-involved shapes excluded as disclosed"): same scope loss, weaker form.** The bullet header claims the layer is "closed through two-segment sign paths" without noting only the 4 big-big shapes were scanned; E22 records the exclusion but not that the excluded region remains formally open (a binding sentence in the source verdict's power bullet). **Fix:** header → "closed through two-segment big-move sign paths"; E22 → "…mid-involved shapes excluded as disclosed (that region remains formally open)".

3. **minor — EDGE-SPACE.md §1 summary bullet (line 55): "post-down-move UP asks stale-high ≈ 1.5-2.4c gross (E21)" drops the "from 300s on" conditioning.** In the CAL-002 table the early pairs are UP dn2 d = −0.72c (30-150) and −0.74c (150-300); the 1.5-2.4c range holds only from 300s on (−1.51/−1.92/−2.43/−2.25c). As written it overstates the early-window staleness. **Fix:** "…stale-high ≈ 1.5-2.4c gross from 300s on (E21)".

4. **minor — LESSONS.md E21 entry now internally inconsistent with the corrected E22-era wording and factually wrong per CALIBRATION-2.** E21 still reads "coherent across pairs from 300s on (UP dn2 z: −2.23, −3.00, −3.72, −2.90): … the post-move UP ask is stale-high ≈ 2-2.4c gross" — the exact conflation CAL-003 Amendment #3 corrected pre-read ("1.5-2.4c from 300s on; 2-2.4c only at the late pairs"; published gross d 1.51/1.92/2.43/2.25c). The propagation put the corrected 1.5-2.4c into the new §1 bullet but left the known-wrong 2-2.4c standing one entry above E22. **Fix:** apply the Amendment-#3 correction in-place to the E21 entry (the lab's established in-place-correction pattern, U43bb/bg).

5. **minor — LESSONS.md E22 headline: "reversal shapes concentrate it gross" (plural) over-generalizes.** Only the up-then-dn shape shows concentration (UP −4.39c, z −3.47); the dn-up reversal cells show nothing notable (UP dn-up late-triple d +0.18c/+0.47c, z +0.14/+0.32) and the source names exactly "the one significant deviation". The body (b) is correctly singular ("the reversal shape … after up-then-dn"). **Fix:** headline → "the up-then-dn reversal shape concentrates it gross".

6. **minor — EDGE-SPACE.md §1 summary bullet: cross-side non-independence caveat not carried where both mirror figures are quoted.** The bullet quotes "the tradable mirrors net ≤ +0.75c … and +2.38c … respectively" without the source's binding "SAME book samples … NOT independent evidence" qualifier (present in E22 and in both source verdicts). **Fix:** append "(same book samples as the flags, not independent evidence)".

## Number-trace table

| Number | Source (CALIBRATION-3.md / -2.md) | Derived value(s) | Match |
|---|---|---|---|
| k = 40 = 5 triples × 4 shapes × 2 sides | registration | E22, §1 row, STATE U44 | Y |
| bar z ≥ 3.26, raised from 3.25 (anti-conservative) | Amendment #1 | E22, STATE U44 | Y |
| pre-read audit findings = 5, all applied pre-read | Amendments block | STATE U44 | Y |
| 0 CANDIDATE cells; max positive z = +2.40 | output + verdict | E22, §1 row ("0 candidates"), §1 bullet, STATE | Y |
| NEG-FLAG UP (450-600-750, up-dn), z = −3.47, n = 981, fully powered (minority 345) | output + verdict | E22 (z, n, fully powered), §1 row (z), STATE (z, n) | Y |
| gross staleness −4.39c ("≈ 4.4c") | verdict | E22, §1 bullet, §4, STATE | Y |
| ≈ 1.8× E21's unconditional −2.43c (Judge: 1.81) | verdict + Judge + CAL-002 table (d −0.0243 at 600-750 dn2) | E22, STATE ("≈1.8×") | Y |
| mirror net +2.38c, z = +2.40; cell bar ≈ 4.1c gross; observed d +3.01c | verdict + Judge | E22, §1 bullet, §4, STATE | Y |
| a-priori dn-dn: +0.39c (z +0.79, n 1,475) / +0.59c (z +0.85, n 893) | verdict | E22 & STATE quote +0.39c/+0.59c, "z ≤ +0.85" | Y |
| triple coverage 0.766 (450-600-750) / 0.464 (600-750-850) | verdict (Judge: 0.7658/0.4635 exact) | E22, §1 bullet, §4, STATE | Y |
| loaded-cell resolvable band ≈ 2.3-4.8c gross (erratum-corrected from 2.4-4.7c) | erratum (2) | E22 (c) uses 2.3-4.8c | Y |
| open sub-power band ~1.5-3c | registration power section | E22 (c), §1 bullet | Y |
| mid-involved excluded entries 12,532 / band-dropped 4,050; region formally open | output + verdict | E22: "excluded as disclosed" (counts not quoted; openness NOT carried — finding 2) | N (partial) |
| gate-reproduction matched CAL-002 published 8/8 | Amendments (#5) + Judge ("eight printed values") | E22, STATE | Y |
| "strongest gross staleness" scoped to conditional scans, max \|d\| elsewhere 2.89c | erratum (3) | E22 "(CAL-002/003 family)" | Y |
| E21 mirror ≤ +0.75c (z ≤ +1.75), n 2,708, z −3.72 | CALIBRATION-2 Results | §1 bullet, §1 CAL-002 row, E21 entry | Y |
| E21 gross range from 300s on = 1.5-2.4c (d 1.51/1.92/2.43/2.25c) | CAL-003 Amendment #3 + CAL-002 table | §1 bullet: "1.5-2.4c" but unscoped (finding 3); E21 entry: "2-2.4c" (finding 4) | N |
| segment lengths ~1.7-2.5 min (100-150s), offsets 30-850s | offset grid; E21-audit-corrected figure | E22 (d) | Y |
| CAL-002 = 60 cells / CAL-001 = 126 cells | predecessors | §1 rows, §4, STATE Next | Y |
| reserve unspent; sub-windows never evaluated | verdict | E22, §4, STATE | Y |
| STATE wake-up: 18,635 eligible / last 2026-06-14 | prior STATE entries (unchanged) | STATE U44 | Y |

## Checks performed
- Read CALIBRATION-3.md in full (registration, amendments, verbatim output tables, verdict draft, Judge verdict, erratum); read LESSONS.md E20/E21/E22, EDGE-SPACE.md in full, STATE.md in full; pulled CALIBRATION-2.md Results lines for every E21 cross-reference.
- Traced every number in E22, the EDGE-SPACE §1 row + new summary bullet, the §4 E21/E22 sentences, and STATE U44 + Next back to the source (table above).
- Verified all three erratum corrections propagated (2.3-4.8c band; "conditional scans" scoping of "strongest gross staleness"; 55,320-entry semantics not quoted anywhere derived).
- Audited §4 and STATE Next bar wording against the Consequence paragraph for over-tightening: "e.g." (not "i.e.") present in both; escapes preserved (finer path features, flow/derived features, sub-power windows via another instrument, reserve-window evidence under full pre-registration, VENUE-DRIFT regime change); found the dropped "(this scan)" scope (finding 1).
- Verified no artifact upgrades the up-dn mirror to citable/tradable: E22 "NOT citable, hypothesis-generating only"; §4 "NOT citable … NEW instrument or reserve-window evidence"; STATE "NOT citable, reserve unspent" — all clean.
- Verified in-place survival of binding caveats: coverage fractions 0.766/0.464 present in all four quoting locations; power scoping present in E22 (c), §1 bullet, STATE Next; mirror-deviant caveat correctly inherited-and-immaterial (not quoted derived — acceptable, source marks it immaterial at these n); cross-side non-independence present in E22 but not the §1 bullet (finding 6).
- Checked E22↔E21 internal consistency (segment lengths, coverage fractions, gross-vs-net labeling, +0.75c/+1.75 figures) — found the 2-2.4c/1.5-2.4c range inconsistency (finding 4).
- Checked STATE U44 process claims (registered→audited→read→judged order, 5 pre-read findings, gate 8/8, reserve unspent, one-shot, third log reuse) against the source — all consistent.
- Recomputed early-pair E21 dn2 gross values from the CAL-002 table (−0.72c/−0.74c) to test the §1 bullet's unscoped 1.5-2.4c claim (finding 3).
- No files were modified.
