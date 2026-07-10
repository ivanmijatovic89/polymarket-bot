# CAL-001 verdict-session checklist (derived artifact)

_Compiled session 24 (U43ag), WHILE the discovery run was in flight and
before any outcome read. This file AGGREGATES obligations already frozen
in `knowledge/CALIBRATION.md` (method + amendments #1–#14), STATE.md's
"WHEN COMPLETE" block, and the two CAL-001 audits. It adds NO new rule,
gate, or threshold. On any conflict, CALIBRATION.md governs._

Run: batchUid `CAL-001-discovery-v3`, pid 73037, code ab2acc9,
log `fable-lab/logs/CAL-001-discovery-v3.log`.

_Fidelity-audited by a fresh-context verifier (U43ah, in-flight,
outcome-free): SOUND-WITH-FINDINGS — all numeric constants match the
frozen sources; 4 findings all acted on in this file (report verbatim
in `knowledge/AUDIT-2026-07-10-CAL-001-CHECKLIST.md`)._

## 0. Confirm completion (before anything else)

- [ ] pid 73037 gone; log tail shows the engine's end-of-run summary.
- [ ] Final progress line reads `[backtest][8516/8516]`. If the run was
      truncated, STOP and judge resumability first (D9 governs whether a
      truncated sample is unbiased; the frozen sample rule is ALL 8,516
      discovery markets — a truncation is a deviation to be reasoned
      about in the open, not silently accepted).

## 1. Final integrity battery (outcome-free, on the COMPLETE log)

Same checks sessions 11–24 ran mid-flight, now on the final log:

- [ ] Latency line present: `DELAY=0 JITTER=0` (D8/U41).
- [ ] Zero error/failure/exception lines.
- [ ] UP/DOWN sample counts exactly equal; asset-pairing completeness
      (0 one-sided (slug,offset) keys — session 23 method).
- [ ] Epoch range: max epoch < 1772323200 (the frozen discovery upper
      bound; the window has NO frozen lower bound — 1764460800 is
      merely the observed minimum in mid-run checks, not a gate).
- [ ] Dedupe: 0 duplicate (slug,asset,off) tuples; offsets exactly
      {30,150,300,450,600,750,850}; ≤14 lines/market.
- [ ] Replay-file uniqueness: 0 duplicate parquet paths, contiguous
      [N/8516] index (session 21 method).
- [ ] Mirror check (ROUND 1−UP to 4 decimals — session 22 method note):
      expect all pairs exact except the single known deviant
      (epoch 1764846000, off=850). NEW deviants → disclose count in the
      verdict; they were not present through ~50% of the run.
- [ ] ts monotonicity per (market,asset) series: 0 violations
      (session 24 method).

## 2. Coverage fractions (amendment #11 wording input)

- [ ] Run the frozen script ONCE on the final log:
      `bash fable-lab/tools/calib-coverage.sh fable-lab/logs/CAL-001-discovery-v3.log`
      Record the 7 per-offset fractions; these are the ONLY numbers the
      750s/850s verdict wording may cite for coverage.

## 3. The one-shot read

- [ ] Run ONCE:
      `npx tsx fable-lab/tools/calib.ts fable-lab/logs/CAL-001-discovery-v3.log`
- [ ] Append the FULL output verbatim to CALIBRATION.md → Results
      (append-only). No subset reads, no re-runs, no exploratory queries
      (honor-system per amendment #5; the git timestamp is the audit
      trail).

## 4. Validation gates (read these BEFORE any other cell)

- [ ] Join-direction: UP cell (850s, [0.98,0.995]) winRate > 0.9
      (frozen base decision rule, gate (a)); DOWN side analogously via
      result_id=1 (added by amendment #10). Fail → ABORT analysis,
      suspect the join, do not read further.
- [ ] E14 positive control: ABORT iff |z| ≥ 3.377 on (850s, [0.90,0.98))
      — applies to BOTH sides (amendments #2, #10).
- [ ] Drift-filter discard counts and per-offset coverage are printed in
      the output (amendments #1, #8) — confirm present.

## 5. Judge per the frozen decision rule

- CANDIDATE: net > 0 AND z ≥ 3.565 (k=126) AND minority ≥ 30 AND d > 0
  in all three sub-windows (→2025-12-31, 2026-01, 2026-02; amendment #6
  — else demoted "subwindow-inconsistent", not citable).
- Fee formula: `fee = winRate · 0.0156 · min(meanAsk,1−meanAsk) / meanAsk`
  (amendment #4).
- NEG-FLAG: z ≤ −3.565; minority < 30 → annotate `underpowered-E14`
  (amendment #7).
- Everything else: on-diagonal within power.

## 6. Verdict-wording obligations (ALL binding)

- [ ] Append the amendment #14 erratum text VERBATIM to Results,
      adjusting only the final pair-count (that of §1's mirror check).
- [ ] ADDITIONALLY flag the frozen decision rule's phrase "the DOWN
      side has its own book and spread" (CALIBRATION.md, NEG-FLAG
      bullet) as stale per amendment #13 — #14's verbatim text names
      only amendment #10's rationale and the diag-calib.ts header, but
      #13 requires flagging the decision-rule location too (verifier
      finding 1, U43ah).
- [ ] 750s/850s cells: state the §2 coverage fraction; wording is
      "conditional on a book event at-or-after the offset"; NO
      venue-level efficiency claim for excluded quiet markets
      (amendment #11).
- [ ] Cross-side cell hits sharing samples are NOT independent
      confirmations — any overlapping-sample pair, not only exact
      reflections (amendments #12c, #13).
- [ ] Null result → LESSONS entry closes BOTH taker half-planes "within
      stated power" (amendment #3 half-plane wording + #10 both-sides);
      §Power caveats are binding: mid-range null is a power statement,
      not proof of efficiency.
- [ ] (Non-binding, conservative addition — NOT in the frozen sources,
      which call the deviant "immaterial either way": disclose the
      single mirror deviant if any 850s cell it belongs to is
      discussed. Skipping this is not a process violation.)

## 7. Consequences

- Candidates → register EXP-010 per protocol (spec-before-results,
  D5 dedupe argued, `lineage_cells = 126`); probe ONLY on the reserved
  window 2026-03-01 → boundary−1 (5,460 markets, count re-verified
  session 20); decisive probe bar one-sided p ≤ 0.023/126.
- Null → LESSONS entry (per §6) + EDGE-SPACE update; the gated state of
  STATE.md "Next" continues.
- [ ] Fresh-context Judge verdict appended verbatim (protocol norm,
      as every EXP verdict).
- [ ] STATE.md updated, commit + push.
