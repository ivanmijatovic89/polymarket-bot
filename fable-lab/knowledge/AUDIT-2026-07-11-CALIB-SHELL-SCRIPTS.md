# Fresh-context audit — calib-coverage.sh + calib-integrity.sh (U72 / R1b)

_Commissioned session 56 (U72) as the FIRST direct audit of the two CAL-001
shell instruments (AUDIT-COVERAGE residue R1b). calib-integrity.sh is in the
CONFIRM-010 byte-identity freeze set (c403d7d). Auditor report preserved
verbatim below; session actions follow at the end._

---

**Verdict: sound-with-findings.** Both scripts reproduce every published figure exactly on the fingerprint-verified log, are read-only and outcome-free. However, the integrity battery's exit code covers only 2 of its ~14 checks — a corrupted log demonstrably exits 0 — and the malformed-line detector cannot see the most likely real-world corruption. No finding requires amending the CONFIRM-010 freeze; all corrections are procedural (outside the frozen byte set) or affect only the non-frozen coverage script.

## Verified facts (re-derived, not trusted)

1. **Fingerprint**: `logs/CAL-001-discovery-v3.log` sha256 `f8b7678f...c88364`, 17,161,328 bytes — exact match to CALIBRATION-2.md's committed fingerprint.
2. **Coverage re-run**: denominator 8,133; off 30→1.0000, 150→0.9993, 300→0.9974, 450→0.9942, 600→0.9766, 750→0.8746, 850→0.5993 — all match CALIBRATION.md verbatim.
3. **Integrity re-run**: latency PASS (0/0 pin), errors 0, last=8516/8516 gaps=0 dupfiles=0, lines=104,776 malformed=0, UP=DOWN=52,388, epoch max 1772322300 mismatches=0, badoff/tsbounds/crossed/duptuples/over14/oneSided/tsmono all 0, MIRROR paired=52,388 **deviants=2** (`btc-updown-15m-1764846000/850`, `btc-updown-15m-1771651800/300`) — matches the published Results including the disclosed second deviant. Exit 0.
4. **Read-only**: both scripts contain only grep/awk/echo/printf over `"$LOG"`; no writes, no DB, no network. Confirmed by inspection before running.
5. **Outcome safety**: parsed fields are slug/epoch/asset/off/ts/bid/ask (top-of-book) plus latency/progress/error lines. The fixture (`strategies/_fixtures/diag-calib.ts:82-85`) emits exactly these. No outcome, PnL, or DB access anywhere. Confirmed.
6. **Mirror/ts-bounds logic vs fixture**: 4-decimal sprintf on both sides makes the mirror comparison float-safe against the fixture's `toFixed(4)`; ts∈[off,900] is consistent with the fixture's `elapsedSec >= off && < 900` plus `toFixed(1)` rounding (cannot round below `off` or above 900.0). Sound.

## Findings

**MAJOR-1 — exit code is blind to the entire sample battery** (`tools/calib-integrity.sh:13,30-47,50-117,124`). `FAIL` is set only by the `latency` and `errors` checks. Both awk blocks (progress gaps/dupfiles AND all diag-calib checks: malformed, balance, epoch mismatch, badoff, tsbounds, crossed, duptuples, over14, mirror deviants, one-sided, tsmono) are print-only. Empirically demonstrated: a planted log with dupfiles=1, mismatches=2, badoff=1, tsbounds=1, crossed=1, duptuples=1, oneSided=3, tsmono=1 **exits 0** with no FAIL line. The CONFIRM-010 runner notices a violation only by manually diffing the printout against the spec's frozen expectations. The spec (CONFIRMATION-010 §Frozen instrument item 2) does mandate "read its output against these frozen expectations", so this is a documented-but-fragile human gate, not an undocumented one. **Correction (no unfreeze)**: add to the CONFIRM-010 unlock checklist / pre-run-audit duties an explicit output-comparison step (or a thin wrapper script *outside* the freeze set that greps the battery output for nonzero counters and exits nonzero). Do NOT edit the frozen script.

**MAJOR-2 — malformed-line detection cannot see prefix-mangled lines, and omits `epoch`** (`tools/calib-integrity.sh:51,63`). The awk block only enters on `/^\[diag-calib\]/`; a truncated or prefix-corrupted sample line is *silently excluded* (counted nowhere), not flagged malformed — `malformed` can only fire for correctly-prefixed lines missing a k=v field. Additionally, line 63's malformed test omits `epoch`: a line lacking `epoch=` passes as well-formed and surfaces indirectly as an `epochmismatch` (demonstrated). Mitigation exists: CONFIRM-010 step 3 reconciles line totals via `calib3.ts --expect-totals`, which catches wholesale line loss — but only if the expect-totals themselves come from an independent count, and they are taken "from the two runs' own battery outputs", i.e. from this same anchored regex. **Correction (no unfreeze)**: at unlock, cross-check `SAMPLES lines` against an independent `grep -c 'diag-calib' <log>` (unanchored) per log; a difference means mangled lines.

**MINOR-3 — asset value unvalidated; unknown assets silently join the DOWN side** (`calib-integrity.sh:90-91,111`). Any `asset` ∉ {UP,DOWN} passes malformed, is invisible in the BALANCE print (demonstrated: lines=4 but UP+DOWN=3), and is stored as the DOWN mirror leg, potentially clobbering a real DOWN entry. Cannot occur with the current TypeScript fixture, but the battery should not rely on that. Detection at unlock: verify `lines == UP + DOWN` by hand.

**MINOR-4 — silent all-zeros pass on a diag-free log** (`calib-integrity.sh:110-116`). A log containing the latency line but zero `[diag-calib]` lines prints lines=0, all counters 0, MIRROR paired=0, and exits 0. (My empty-file test exited 1 only because the latency line was also absent — an accidental guard.) Mitigated for CONFIRM-010 by expect-totals; still, "lines=0" should be treated as an automatic abort in the runner's checklist.

**MINOR-5 — stale trailer even for CAL-001** (`calib-integrity.sh:123`). The trailer says "deviants=1 (known: btc-updown-15m-1764846000/850)" but the final CAL-001 log has 2 deviants (second: 1771651800/300, disclosed in CALIBRATION.md Results). U67b already flagged the trailer's discovery framing (8516/8516, `max<1772323200` at line 112/121) and the spec pins run-specific epoch ranges; this audit adds that the deviant count in the trailer is stale against the script's own output on its own reference log. Print-only; no unfreeze — the spec's "read against frozen expectations" governs.

**MINOR-6 — dead code and degenerate print in the progress block** (`calib-integrity.sh:41,46`). Line 41's `sub(...)` into `f` is a no-op whose result is never used (the real dupfile logic is the field loop at line 42). With zero matching progress lines the END prints `last=0/` (empty total) rather than a FAIL — visible but not machine-detectable (same class as MAJOR-1).

**MINOR-7 — GNU-ism `\|` in BRE grep** (`calib-integrity.sh:25`). `grep -ci 'error\|failed\|exception'` relies on non-POSIX BRE alternation. Works on this macOS (BSD grep 2.6.0 "GNU compatible", verified matching) and on GNU grep; on a strictly POSIX grep it would match nothing and silently PASS with errors present. Since the script is frozen, pin in the unlock procedure that the battery runs on the same host/grep family (or verify `echo failed | grep -ci 'error\|failed'` prints 1 before trusting the errors line).

**MINOR-8 — regex-anchor inconsistency between the two scripts** (`tools/calib-coverage.sh:17` vs `calib-integrity.sh:51`). Coverage matches `[diag-calib]` anywhere in the line; integrity requires it at line start. A prefixed-but-valid line would count toward coverage yet be invisible to the integrity battery. calib-coverage.sh is NOT in the CONFIRM-010 freeze set (spec item 3 lists only calib3.ts, diag-calib.ts, calib-integrity.sh), so it may be aligned freely; note it also skips (rather than flags) lines missing slug/off, which is acceptable for a coverage-only tool given the integrity script owns malformedness.

## CONFIRM-010 freeze impact

**No finding requires amending the freeze.** MAJOR-1/2 and MINOR-4/5/7 are all addressable by strengthening the unlock *procedure* (pre-run audit checklist, an out-of-freeze wrapper, independent line-count cross-checks) — the frozen bytes stay untouched, consistent with the spec's own "do not edit the script to fix this" instruction. The spec's assumptions about the script (print-only EPOCH/trailer residue, per-log battery runs, expect-totals reconciliation) hold as written; this audit's contribution is that the reconciliation and output-reading steps are *load-bearing*, not belt-and-suspenders, because the script's exit code alone certifies almost nothing.

---

## Session actions (U72, applied same unit)

- Tighten-only addendum appended to
  `knowledge/CONFIRMATION-010-REVERSAL-MIRROR.md` (the D41 unlock's own
  "tighten/abort only" rule): the unlock executor's battery-reading step now
  carries the five mechanical obligations from MAJOR-1/2 and MINOR-3/4/7.
  The three frozen files are untouched (wakeup.ts freeze check unaffected).
- `calib-coverage.sh` left byte-unchanged: MINOR-8's alignment is optional,
  the tool is not frozen, its published read is closed and reproduced —
  churn without a consumer. The inconsistency is recorded here.
- AUDIT-COVERAGE.md: R1b closed; shell-scripts row upgraded to A + D + C/E
  citing this report.
