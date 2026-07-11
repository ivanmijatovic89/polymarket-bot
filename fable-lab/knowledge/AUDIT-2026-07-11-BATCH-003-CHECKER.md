# AUDIT — BATCH-003 fresh-context batch checker (2026-07-11, session 63)

_Checker: fresh-context subagent (did not watch the batch being built or
judged). Scope: SCREENING.md §5 incl. amendment 4, D18/D49/D50/D51.
Both findings applied same-unit (see BATCH-003.md checker section).
Report verbatim below._

---

VERDICT: SOUND-WITH-FINDINGS

The SCR-008 kill on run 472 is correct, the mini-spec was not touched after the freeze, the erratum/void of run 467 is factually grounded, and every statistic in the verdict section reproduces from MySQL independently. Two findings, one of which is exactly the artifact-fidelity failure class amendment 4 exists to catch, though it is verdict-neutral.

FINDINGS

1. MAJOR (verdict-neutral) — misquoted artifact line in the verdict's pre-verdict checks. `fable-lab/protocol/registry/screens/BATCH-003.md` line 141 pastes: "`[fable] D18 fill-mode hook: 500 BacktestExecution instance(s) forced to touch_or_better`". The actual log `fable-lab/logs/SCR-008-touch-screen-r2.log` line 11715 reads "479 BacktestExecution instance(s)" (479 = played markets; the 21 `no_in_window_activity` skips never instantiated an execution — the number is coherent, the quote is not). Grep count for "D18 fill-mode hook" is exactly 2 as claimed (line 2013 activation + line 11715 summary), so the hook was active; but per SCREENING amendment 4 / E28 ("any 'X verified in-log' sentence must be written by pasting the log line, not from intention"), a pasted line that does not match its artifact is precisely the flagged defect class. Note this misquote also propagated into my own checklist ("one saying 500 instances forced"). No effect on the kill.

2. MINOR — derivation kill #1 wording overstates: "Every sell-side maker idea is therefore the already-measured buy-side ... family" (BATCH-003.md lines 21-23). The ungated buy-side touch cell was NOT already measured at freeze — it is SCR-008 itself, screened in the same batch (the mini-spec's own not-a-reskin section says no prior cell measured this contest). The mirror-identity reduction is sound and consistent with CAL-001 amendment #12 (verified: `fable-lab/knowledge/CALIBRATION.md` lines 456-464, exact mirrors at 52,386/52,388 pairs); "already-measured" is only true jointly with SCR-008 running. Zero-cost wording nit; the kill logic stands because the family's coverage is completed within the batch.

VERIFICATION DETAIL (all passed)

1. DB re-derivation (my own SQL against `backtest_run_markets` where `run_id=472`, plus `backtest_run_failures`): N=500, played (trade_count>0)=479, pnlTotal=+79.0000, EV/market=0.1580, std(all-N)=47.9772, q̂=0.15800/47.9772=0.00329, t=0.00329×√500=0.0736, wins/losses=245/234 (winRate 0.5115, zero flat-PnL played markets so the zero-PnL convention is moot), maker/taker trades=479/0, fees=0, CI95=0.158±1.96×(47.9772/√500)=[−4.05,+4.36], UTC-day buckets per results.ts logic: 50/91 positive=0.5495≈0.55, failures table: 0 rows, skips: 21×no_in_window_activity. Every quoted number in BATCH-003.md lines 146-149 matches. Run row 472: batchUid `SCR-008-touch-screen-r2` (contains "touch" per D18 label guard), status completed, cmd matches the frozen sample rule (`--random --limit 500 --to-ms 1772323199999 --sequential --fill-mode=touch_or_better`). Exactly one run carries that batchUid.

2. Bar application: t=+0.074 ≪ +1.5 so SURVIVE fails; no enumerated kill branch fires (q̂>0, t>−1, prediction "EV/played>0" held at 79/479=+0.1649≈+0.165); not PARK-DESIGN (479 entries). D49 amendment 3 default-kill is the correct outcome, same shape as the SCR-006 precedent it cites. All-N convention (D49 amendment 1) correctly applied — results.ts computes q̂/t over all N=500, which I reproduced. D18 respected: outcome is kill, escalation explicitly declined with the correct bound-side reasoning, no advance/live-EV language.

3. No post-results spec edits: `git log --follow` shows 5 commits (6be18b0 freeze → 34cefc2 smoke → bc0d602 erratum+void → 5c816d3 re-smoke → ddc9151 verdict). The only removed lines since freeze are the three-line smoke placeholder ("_To run before the screen..._"), replaced by the smoke result; byte-diff of the mini-spec block (lines 45-81) between 6be18b0 and HEAD: IDENTICAL. Strategy file `fable-lab/strategies/screens/SCR-008-down-touch.ts` was in the freeze commit. Erratum recorded as claimed, with the outcome-exposure disclosure (70 played / winRate 0.4571 seen pre-void) disclosed and never cited.

4. Log claims: `SCR-008-touch-screen-r2.log` line 2 = `BACKTEST_LATENCY_DELAY=0 BACKTEST_LATENCY_JITTER=0`; boundary market 1777237200: 0 hits. `SCR-008-touch-screen.log` (VOID run 467) line 2 = DELAY=140 — void's factual basis confirmed; DB run 467 = 73 markets, completed, 0 failures, exactly as the erratum states. `SCR-008-touch-smoke.log` (run 466) line 2 = DELAY=140 — smoke erratum confirmed. `SCR-008-touch-smoke-r2.log` line 2 = DELAY=0/JITTER=0, hook lines at 69 and 395 (15 instances). D51 guard verified present in `fable-lab/tools/run-backtest.ts` (refusal at line ~206 unless batchUid contains "lat").

5. D50 invariants line: present in the mini-spec (BATCH-003.md lines 63-70) and addresses all five E27(c) invariants (mirror books — used, not fought; crossed books/E6; boundary/--to-ms/E18; worst-queue-vs-touch/D18; results.ts zero-PnL convention). Coherent with `fable-lab/knowledge/LESSONS.md` E27(c).

6. Derivation kills: #1 consistent with amendment #12 (see finding 2 for the wording nit). #2 internally consistent (0c bucket 19.1% < 20% uniform supports "no anchoring carrier"; outcome-free by construction). #3 verified against the engine: `src/backtest/runSingleMarket.ts` `buildRunnerForMarket` creates a fresh Strategy/Runner/OrderManager/BacktestExecution per market ("no sharing between markets"), matching D50's recorded engine fact — cross-episode conditioning is genuinely inexpressible in replay; the claim that SIGNAL-002 already measured the axis post-hoc (NULL) is consistent with DECISIONS.md D50.
