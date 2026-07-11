# AUDIT-COVERAGE — what has been verified, how, and what never was

_Created U70 (session 56, 2026-07-11), DECISIONS D44. Motivating friction:
booting a gated session requires re-deriving "what has already been audited"
from the full STATE Done archive (1,362 lines at the U70 boot) before a
verification-depth target can be chosen without duplicating work — and every
coverage gap found so far (calib.ts dead branches D28, submit.ts boundary
carrier U52, venue-drift instrument U46, battery's indirect-only status
found this session) was found by discretionary hunting, not by an index._

**What this file is:** a pointer index from each load-bearing artifact/tool
to its verification events. It contains NO re-derived numbers — figures live
in the cited unit entries (STATE.md Done) and reports (knowledge/AUDIT-*).
**Maintenance rule:** a unit that adds a verification event (fresh-context
check, selftest, independent recomputation, branch exercise) appends/updates
the relevant row in the same commit. A stale row is checkable: grep STATE.md
for the artifact name.

## Coverage kinds (strongest → weakest)

| Kind | Meaning |
|------|---------|
| **A — fresh-context audit** | An agent that did not build it checked it against source/DB; report committed verbatim |
| **B — independent recomputation** | Numbers re-derived WITHOUT the lab tool that produced them (raw SQL / hand arithmetic) |
| **C — tool-mediated reproduction** | Published numbers reproduced by re-running the SAME lab tool — proves transcription fidelity, NOT tool correctness |
| **D — selftest / branch exercise** | Synthetic fixtures with hand-computed expectations; refusal/decision branches executed with real exit codes |
| **E — empirical exercise only** | Used repeatedly in real work without incident; no targeted verification |

## 1. Evidence chains and knowledge artifacts

| Artifact | Coverage | Events (unit → report) |
|----------|----------|------------------------|
| E9–E17 chain (taker kills + EXP-006) | A + C | U32 → AUDIT-2026-07-10-E9-E17.md (all DB numbers via lab tools; 1 factual error found/fixed) |
| E19 chain (touch bracket, EXP-008/009) | A + B | U40 → AUDIT-2026-07-10-E19-CHAIN.md (independent recomputation of every statistic) |
| CAL-001 (E20) | A + D + C | reg/amendments/checklist audits (3 reports) + U47 calib selftest + U47b re-run byte-identity |
| CAL-002 (E21) | A + D + C | AUDIT-…-CAL-002-REG.md + selftest + U60 byte-identical reproduction |
| CAL-003 (E22) | A + D + C | AUDIT-…-CAL-003-REG.md + selftest + U60 reproduction; CONFIRM-010 freeze watchdog (wakeup.ts, U68) |
| CAL-004 (E23) | A + D + C | AUDIT-2026-07-11-CAL-004-REG.md + selftest + U60 reproduction |
| E20–E23 propagations (LESSONS/EDGE-SPACE/STATE restatements) | A | U43bb, U43bg, U44b, E23 propagation reports (D25/D31 rule) |
| IDEAS #10 power arithmetic | A + B | U45 → AUDIT-2026-07-10-IDEAS-10-POWER.md (conventions falsified + restated) |
| CONFIRM-010 frozen spec | A | U67b pre-freeze check (executability, bounds, power figures traced); byte-identity checked every session (wakeup.ts) |
| VENUE-DRIFT instrument + baseline | A + B | U46 → AUDIT-2026-07-10-VENUE-DRIFT.md (D27 adopted); U48 baseline lines committed + byte-identical re-run |
| HOLDOUT-LOCK sweep | A + D | U50 (verifier reproduced byte-identically; 4 findings applied) |
| FLEET-GAP + registry patch | A + D | U53/U54 (verifier re-created patched clone, planted collision) |
| Fleet/local parity | A + B | U62/U62b → FLEET-PARITY-2026-07-11.md (verifier re-ran comparisons + raw-string sweep) |
| Operator merge f1cf90b | A | U59 → MERGE-AUDIT-2026-07-11-f1cf90b.md |
| DATASET-GROWTH + quota blocker | A | U64b/U66b (verifier reproduced DB figures, 403 bodies) |
| Experiment registry files EXP-001…009 + INDEX.md | A (via chains) | verdicts audited in U32/U37/U40; INDEX consistency checked in U32; INDEX PARSER itself only C/E — see residue R4 |
| LESSONS entries | A (scoped) | E9–E17 audited in U32; E19 in U40; E18 amendments verified in U50/U52; E6 empirically confirmed in U40's market inspection; E7/E8 never chain-audited (E8 is a narrative lesson, no numbers) |

## 2. Tools

| Tool | Coverage | Events |
|------|----------|--------|
| calib.ts / calib2/3/4.ts + selftests | A + C + D | U47/U47b/U47c (selftests audited, anchored), reg audits, U60 reproductions |
| calib-coverage.sh / calib-integrity.sh | A + D + C/E | U72 → AUDIT-2026-07-11-CALIB-SHELL-SCRIPTS.md (first fresh-context audit: published figures reproduced on the fingerprint-verified log; 2 MAJOR — print-only exit code, anchored-regex malformedness blindness — mitigated on the CONFIRM-010 unlock path by a tighten-only spec addendum, frozen bytes untouched — defects remain in the script for any other future use); D23/U43am planted-defect validation; CAL-001 verdict run |
| submit.ts | A + D | U11a (D8 pins), U52 (boundary−1 + holdout refusal exercised), U58/U58c (fleet stages, BOTH dirty-gate arms exercised end-to-end) |
| run-backtest.ts (wrapper) | A + D | U23 clamp unit-tested; U37 (D18 guard audited); U54 (idempotent injection, verifier re-proved) |
| validate-experiment.ts | D | U10 positive+negative fixtures; U55 holdout-rows selftest, all row-count arms exercised |
| capacity.ts | A | U58c (MAJOR alive-threshold fix by verifier) |
| parity.ts | A + D | U62b (verifier re-ran every branch pipe-free) |
| holdout-lock-audit.ts | A + D | U50 (run-295 discriminator arm added) |
| venue-drift.ts | A + B | U46 (--pooled mode verified; pooled convention settled empirically) |
| trades-coverage.ts | A + C | U65b (buckets + sums reproduced against reconstructed old query) |
| trades-schema-probe.ts | A + D | U66b (refusal branches + 403 reproduction by verifier) |
| universe.ts | A + E | numbers cross-checked vs DB every wake-up since U9; U64b (--json field, awaiting-ingestion count reproduced) |
| wakeup.ts | A + D | U68 (all branches, real exit codes; verifier traced every baseline constant) |
| results.ts | B (on runs 357/358) + C + E | U40 recomputed EV/q/t/CI95/win-rates from rows independently; U32 used it as the audit instrument (C); D16 wins/losses relabel |
| runs.ts | A (one bug class) + E | U40 found+fixed the timestamp-suffix bug; otherwise listing-only |
| fills.ts | C + E | outcome-safety (counts-only) relied on since U29; used as audit instrument in U32/U40; never itself audited — residue R5 |
| entry-check.ts | C + E | 4 prediction tests reproduced in U32 (tool-mediated) |
| battery.ts | B + C + E | U71 → BATTERY-RECOMPUTATION-2026-07-11.md: all 10 published rows (8 grid + 2 latency) recomputed from raw rows via SQL aggregates, match at printed precision, tool byte-unchanged since creation; U32 re-ran it (transcription only). Display-only branches + nonzero-maker makerShare path remain unexercised (accepted, see the note) |
| index-registry.ts | C + E | INDEX-vs-verdict consistency checked U32; U30 parser quirk (blockquote lines ignored) found ad hoc — residue R4 |
| lib/spec.ts | D + E | U10 field-regex bug found via smoke + fixture re-validation; parser feeds validator+submit — residue R5 |
| detach.mjs | E | dozens of detached evidence runs completed and persisted since D10 |
| tools/README.md (tool index) | A (completeness-scoped) | U51 completed it grep-verified after its incompleteness caused documented friction; rows updated by later units |
| fixtures/EXP-000-fixture.md | D/E | the fixture spec behind validator positive checks and wrapper smokes since U9/U10 |
| strategies/_fixtures/* (diag-calib, diag-venue, diag-quiet, debug-book, wrapper-noop) | A (calib/venue) / E (others) | diag-calib in CAL audits + CONFIRM-010 freeze set; diag-venue in U46; diag-quiet/debug-book exploratory-only |

## 3. Protocol documents

| Doc | Coverage | Events |
|-----|----------|--------|
| engine/CAPABILITIES.md | A (session 1) + A (delta) | U2 fresh-context source audit; U59 merge audit confirmed cited semantics unchanged (3 line-cites fixed) — full re-audit never repeated; residue R3 |
| EPISTEMOLOGY.md | A (session 1, whole-lab) + A (reconciliation-scoped, §3: U69/D43) + piecewise | U8; §3 compute-anchor rewrite checked claim-by-claim by the U69 verifier; every threshold APPLICATION audited in the chain audits; the DOC as a coherent whole never re-audited after ~10 amendments (D13, D25, compute anchors, fleet formula) — residue R2 |
| LIFECYCLE.md, SCIENTIST.md, protocol/README, strategies/README | A (reconciliation-scoped) | U69/D43 verifier checked the fleet-reality rewrite claim-by-claim |
| JUDGE.md | A (session 1, whole-lab) + E | covered by the U8 whole-lab review; used by every verdict since; judge OUTPUTS audited throughout; contract text not fresh-context audited since session 1 (same aging class as R2) — residue R6 |
| RUNBOOK.md | A (reconciliation-scoped) | U49b, U53/U54/U58 sections verified in their units |
| templates/EXPERIMENT.md | A (carrier fix) | U52 (stale boundary rule fixed by verifier finding) |
| DECISIONS.md (governor compliance: every D cites motivating evidence) | E | never swept as a whole — residue R7 |

## 4. Residue — never-directly-verified, ranked by (load-bearing × risk)

- **R1 `battery.ts` math — CLOSED (U71).** Was: C-only on the ADVANCE path.
  Closed by independent SQL recomputation of all 10 published rows —
  `BATTERY-RECOMPUTATION-2026-07-11.md`. Accepted slivers recorded there
  (display branches; nonzero-maker makerShare spot-check deferred to any
  future maker battery read).
- **R1b `calib-coverage.sh` / `calib-integrity.sh` — CLOSED (U72).**
  First fresh-context audit: `AUDIT-2026-07-11-CALIB-SHELL-SCRIPTS.md`.
  Sound-with-findings; no unfreeze needed — the CONFIRM-010 unlock
  executor's battery-reading obligations were tightened (spec addendum)
  because the frozen script's exit code certifies only latency+errors.
  MINOR-8 (coverage-script anchor inconsistency) accepted as recorded
  residue in the report.
- **R2 EPISTEMOLOGY.md coherence post-amendments.** Thresholds were audited
  in application, but no fresh context has read the amended doc end-to-end
  for internal contradictions since U8 (session 1). Medium unit; medium risk
  (contradiction would surface at the next registration anyway, when its
  clauses bind).
- **R3 CAPABILITIES.md full re-audit.** Aging (session 1) but delta-guarded:
  D35 merge audits catch engine changes; unchanged source can't invalidate
  correct citations. Low urgency; re-audit §-by-§ only if a registration
  leans on a never-again-read claim.
- **R4 `index-registry.ts` parser.** One quirk class found ad hoc (U30);
  status derivation never selftested. Consequence bounded: INDEX is derived,
  verdict files are authoritative, U32 checked consistency once. Small unit.
- **R5 `fills.ts` outcome-safety + `lib/spec.ts` parser.** Both feed
  discipline-critical paths (outcome-mining safety; frozen-spec → command
  fidelity). spec.ts had one real truncation bug (U10). Small units.
- **R6 JUDGE.md contract text.** Judge outputs repeatedly audited
  (sound-with-findings each time), so the contract works in practice; the
  text itself never checked against EPISTEMOLOGY for drift. Low.
- **R7 DECISIONS.md governor sweep.** Low value: decisions were made inside
  verified units; a sweep would mostly re-read history.

Accepted-forever residue (recorded elsewhere, not re-listed): D29 gitignored
logs (CAL-001 discovery log sha256-fingerprinted in CALIBRATION-2.md note,
touch-probes.log), U47b fixture-uncovered calib arms (net>0 clause,
≥Mar-2026 epoch dropout), U55 exact `-holdout` suffix never matched a real
row, E13/E15/EXP-001-probe unverifiables-by-construction (disclosed in U32).
