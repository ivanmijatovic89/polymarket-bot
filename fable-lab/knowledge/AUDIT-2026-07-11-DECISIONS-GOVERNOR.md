# AUDIT-2026-07-11-DECISIONS-GOVERNOR — R7 closure

_Fresh-context auditor report, preserved verbatim below (U77, session 58).
Commissioning note: the task prompt mis-stated the lessons path as
`protocol/registry/LESSONS.md`; the auditor found and used the real path
`knowledge/LESSONS.md` (report MINOR note 3). No DECISIONS.md entry was
edited in response to this audit — both MINOR findings are wording/
classification observations recorded here, not defects requiring errata._

---

# AUDIT — DECISIONS.md whole-file governor-compliance sweep (residue R7)

**Date:** 2026-07-11
**Scope:** `fable-lab/DECISIONS.md`, all 48 entries D1–D48 including in-entry amendments (1,817 lines), audited against the CHARTER.md evolution governor ("every change must cite the experiment result, measured observation, or concrete friction that motivated it").
**Method:** full read of DECISIONS.md; git history to establish the governor's effective time (charter v2 commit `9f92bb5`, 2026-07-09 22:05 +0200 — D1–D6 were committed at 20:42 in `a8f605c`, i.e. **pre-governor**); existence check of every cited knowledge/tool/fixture/registry artifact; content spot-verification of cited numbers in 15+ artifacts (audit reports, calibration registrations, EXP-001 readout, holdout baseline, venue-drift bands); lesson/unit existence checks (E1–E23 all present in `fable-lab/knowledge/LESSONS.md` — note: the lessons file lives there, not at `protocol/registry/LESSONS.md`; U-numbers cross-checked in STATE.md); source-code citation checks (`strategyRegistry.ts`, `runSingleMarket.ts` worst_queue hardcode, `BacktestExecution.ts:62,90`, `batchStats.ts` computeQuality guard, `schema.ts` trades_from/to, `telonexEligibility.ts` predicates, ambient `.env` `BACKTEST_LATENCY_DELAY=140`); operator commit hashes (`60a1d8e`, `6df3bdb`, `f1cf90b`, `a10b59d`, `c403d7d`) verified in git. Read-only throughout; no backtests run, no DB queried (run-ID claims lean on the two prior DB-level chain audits, noted per row).

## Per-decision table

| D# | Evidence class | Citation check | Notes |
|----|----------------|----------------|-------|
| D1 | pre-governor | verified | Design reasoning; cites prompting guide (exists). Committed 82 min before the governor existed. |
| D2 | pre-governor | verified | EPISTEMOLOGY.md exists and carries the derivation. |
| D3 | pre-governor | exists-not-checked-deeply | Design fork; engine `--extend` behavior consistent with CLAUDE.md. |
| D4 | pre-governor | verified | Registry dir + INDEX.md exist as described. |
| D5 | pre-governor | verified | IDEAS.md has the mechanism-class structure described. |
| D6 | pre-governor | verified | CAPABILITIES.md §4 exists; simulator-bias field present in template flow (per D48 audit). |
| D7 | friction | verified | Charter-v2 vs U3–U8 conflict; `strategyRegistry.ts` discovery + `.hooks/pre-commit` confirmed; wrapper `tools/run-backtest.ts` exists. Smoke batchUid not DB-checked. |
| D8 | measurement | verified | Ambient `.env` `BACKTEST_LATENCY_DELAY=140` confirmed live on this machine; submit.ts exists. |
| D9 | measurement | exists-not-checked-deeply | Run 301 truncation; run numbers covered by the U32 DB audit (AUDIT-E9-E17). |
| D10 | measurement | verified | E8 exists in LESSONS; `tools/detach.mjs` exists. |
| D11 | measurement | verified | Cost/power arithmetic internally consistent; EPISTEMOLOGY §5.1 sign-smoothness rule exists. |
| D12 | measurement | verified | Run-315 overflow; `mapToDriverValue` clamp present in run-backtest.ts (line ~204). Amendment: `computeQuality` null-guard confirmed at batchStats.ts:162–174; MERGE-AUDIT file exists. |
| D13 | experiment | verified | EXP-001 reversal (t=−1.1517, EV=−0.1941) confirmed in the EXP file; EPISTEMOLOGY minority-count rule present (line ~105). |
| D14 | experiment | verified | E9–E14 all exist; direction decision matches EDGE-SPACE. |
| D15 | experiment | verified | E17 exists; `worst_queue` hardcode confirmed in runSingleMarket.ts; EDGE-SPACE.md exists. |
| D16 | measurement | verified | AUDIT-E9-E17 discrepancy 1 = exactly the 53/62 wins/losses misread quoted; results.ts exists. |
| D17 | friction (weak — see MINOR-1) | verified | diag-venue.ts, venue-drift.ts, VENUE-DRIFT.md all exist; bands match D27 audit's recomputation. |
| D18 | friction + measurement | verified | BacktestExecution.ts:62,90 exact; AUDIT-D18-UNLOCK exists; amendment findings traceable to it. |
| D19 | measurement (audit) | verified | AUDIT-E19-CHAIN contains the exact 05:57:36Z vs 05:55:40Z / 1m56s finding and runs.ts timestamp defect. |
| D20 | measurement | verified | sync-design.md line 301 carries the quoted "Additional channels" sentence; schema.ts trades_from/to at ~379; trades-coverage.ts exists. |
| D21 | measurement | verified | CALIBRATION.md carries the 63-cell grid, z 3.377, k=126/z 3.565 amendment, E14 control gate. Both audit reports (CAL-001-REG, CAL-001-AMENDMENTS) exist. |
| D22 | friction | verified | CAL-001-VERDICT-CHECKLIST.md exists; amendment-sprawl state is checkable fact. |
| D23 | friction | verified | calib-integrity.sh exists; U43ae prose-drift precedent cited. |
| D24 | experiment | verified | CALIBRATION-2.md: k=60, bar 3.37, reserve-confirmation requirement all present. |
| D25 | measurement | verified | Both E20/E21 propagation audit files exist; SCIENTIST.md carries the rule (line ~67). |
| D26 | experiment | verified | CALIBRATION-3.md: k=40, 3.26 bar (with the anti-conservative-rounding note matching the D26 amendment), 180–380 mid-cell figure present. |
| D27 | measurement (audit) | verified | AUDIT-VENUE-DRIFT contains exactly the 0.0024 trigger / 0.0021 Dec-2025 mean / 1.75× exposure quoted. |
| D28 | measurement | verified | Zero-candidate ⇒ never-executed-branch reasoning; calib-selftest.ts + AUDIT-CALIB-SELFTEST exist; amendment findings traceable. |
| D29 | friction | verified | Committed log has exactly 198 `[diag-venue]` data lines + 7 headers; header self-describes the byte-identity verification. Residue classification (CAL-001 log, touch-probes log) explicit and reasoned. |
| D30 | friction | verified | RUNBOOK carries the "Growing the dataset" control point; each of the three stale claims is checkable against cited units. Amendment discloses its own verifier's four findings. |
| D31 | measurement | verified | Four-for-four defect-class instances each independently documented (three audit files + U49b); SCIENTIST.md rule present (line ~75). |
| D32 | measurement | verified | holdout-lock-audit.ts exists; HOLDOUT-LOCK-AUDIT baseline classifies exactly 67 rows. |
| D33 | friction + measurement | verified | Charter commits 60a1d8e/6df3bdb real; FLEET-GAP.md + fleet-gap-registry.patch exist; operator patch a10b59d real and registry now walks `fable-lab/strategies/` (confirmed in src). |
| D34 | measurement | verified | CALIBRATION-4.md: k=252, z 3.75 with the rounds-UP rationale, verbatim. U58 amendment's fleet facts consistent with FLEET-GAP/RUNBOOK. |
| D35 | measurement | verified | f1cf90b is a real operator merge (2026-07-11 05:58); MERGE-AUDIT file exists; computeQuality guard confirmed in src. |
| D36 | measurement | verified | FLEET-PARITY-2026-07-11.md + parity.ts exist. Run rows not DB-checked. |
| D37 | friction | verified | STATE.md now has In progress/Next/Notes/Operator updates before Done (Done at line 168 of a much longer file). |
| D38 | measurement | verified | DATASET-GROWTH.md exists; universe.ts exists; U64b amendment discloses its own honesty gap (sync spends metered quota). |
| D39 | friction | verified | trades-coverage.ts contains the converted/awaiting-ingestion bucket CASE; U65b amendment corrects its own eligibility overclaim with the exact predicate diff (telonexEligibility.ts:45-74 confirmed). |
| D40 | friction | verified | trades-schema-probe.ts exists; execution note honestly records the 403 blocker (probe produced nothing). |
| D41 | measurement (preventive — see MINOR-2) | verified | CONFIRMATION-010 file frozen with the exact 9,540/5,460/z≥2.00 rule; freeze commit c403d7d real; wakeup.ts pins it. |
| D42 | friction | verified | wakeup.ts exists with all six checks incl. the c403d7d byte-identity check. |
| D43 | measurement | verified | LIFECYCLE/SCIENTIST now carry fleet-reality text (spot-checked); defect class matches D30 precedent. |
| D44 | friction | verified | AUDIT-COVERAGE.md exists with the A–E taxonomy and ranked residues (R7 = this sweep). |
| D45 | measurement (audit) | verified | AUDIT-EPISTEMOLOGY-COHERENCE exists; U73 tags present in EPISTEMOLOGY.md; the deliberate directional loosening (fix 4) is disclosed in-entry, not smuggled. |
| D46 | measurement + friction | verified | index-registry-selftest.ts + AUDIT-U74-INDEX-SELFTEST exist; U74b amendment corrects its own false "SCIENTIST.md already instructs this" claim explicitly. |
| D47 | measurement | verified | spec-selftest.ts, FILLS-RECOMPUTATION-2026-07-11.md, AUDIT-U75-R5-CLOSURE all exist; U75b discloses the 8/11→11/11 scope correction. |
| D48 | measurement (audit) | verified | AUDIT-JUDGE-CONTRACT exists; U76 tags present in JUDGE.md; U76b addendum matches the entry. |

## Findings

**MAJOR** — none. No entry lacks motivating evidence, no cited artifact is missing or contradicts its claim, and no decision's change exceeds what its evidence motivates. Notably, several entries (D30, D38, D46, D47) contain amendments that correct their *own* earlier overclaims — the opposite of governor drift.

**MINOR**

1. **D17 — weakest evidence-class fit in the governor era.** The motivation is: *"A decision rule with no instrument is dead text — concrete gap found while reconciling RUNBOOK (U33)."* The underlying fact ("nothing in the lab measures venue statistics over time") is checkable and true at the time, but no experiment, measurement, or actually-encountered failure motivated it — the rule had never failed to fire on a real event; the gap was noticed, not hit. It reads as a design-consistency observation dressed as friction. Recoverable: the observation is concrete and falsifiable, and the instrument's pre-specified bands later proved their worth (D27's audit). Flagged as the entry a stricter governor reading would question, not as a violation.

2. **D41 — preventive motivation, one inferential step from the sanctioned classes.** The stated motivation is a projected risk: *"Left to the unlock moment, the spec would be written by a session that may already have seen fresh-window drift stats … the exact after-the-fact design surface D25/D31 keep catching in weaker forms."* No new observation motivated the freeze; the anchors are the (real, measured) four prior defect-class instances plus the (verified) U66 quota fact making the moment provably pre-data. Compliant via the D25/D31 chain, but the entry's own header word "observation" overstates it — it is extrapolation from prior measured defects. Wording-level only.

3. **Task-prompt path drift (report note, not a DECISIONS defect):** lessons live at `fable-lab/knowledge/LESSONS.md`, not `fable-lab/protocol/registry/LESSONS.md` as the residue description assumes. All E-number citations were checked against the real file (E1–E23 all present). AUDIT-COVERAGE's R7 row should carry the correct path when this residue is closed.

**Depth caveat, disclosed:** run-ID claims (runs 301, 315, 336, 342, 352–358, 421–424) were not re-checked against the DB in this sweep; they were verified at DB level by the two prior chain audits (AUDIT-E9-E17, AUDIT-E19-CHAIN) and by FLEET-PARITY, which this sweep confirmed exist and say what the decisions claim. Citation-check "verified" for those rows means artifact-and-content verified, DB one-hop-indirect.

## Overall verdict

**Sound.** D1–D6 legitimately predate the governor (82 minutes before charter v2) and are classified pre-governor, not violations. Every governor-era entry D7–D48 states motivating evidence of a sanctioned class, every spot-verified citation exists and is content-consistent with the claim (including exact quoted numbers in nine audit reports, four calibration registrations, source-code line citations, five operator commit hashes, and the live `.env` latency value), and no scope creep was found — the two MINOR items are wording/classification weaknesses, both recoverable without changing any decision. Residue R7 can be closed on this report.
