# AUDIT — BATCH-002 batch checker (fresh-context, 2026-07-11, session 62)

_One fresh-context checker per batch verdict table, per SCREENING.md §5.
Scope: numbers-vs-DB (runs 462/464/465), verdicts-vs-frozen-bars,
no-post-results-spec-edits (freeze 4d5c7f3), and the 462/463 duplicate
resolution. Report preserved verbatim below; findings disposition at the
bottom._

## Checker report (verbatim)

**Verdict: SOUND-WITH-FINDINGS** (all findings MINOR; no finding changes any verdict, and every kill stands under the frozen text)

### Check A — Numbers match DB: PASS

Ran `npx tsx fable-lab/tools/results.ts --run {462,464,465}` and compared every figure in the table (BATCH-002.md lines 125–129) and bullets:

- **Run 462 (SCR-005):** N=500, played=22, EV/market=−0.2, q=−0.0218, t=−0.4866→−0.49, winRate 0.3636, 8/14, maker/taker 27/0, failures=0 — all match. Derived: pnlTotal=−100; −100/22 = −4.545 ≈ **−4.55** ✓.
- **Run 464 (SCR-006):** N=2000, played=774, EV=0.2215, q=0.0165, t=0.7386→+0.74, winRate 0.8915, 690/84, maker/taker 0/774, failures=0 — all match. Derived: pnlTotal=443.07; 443.07/774 = 0.5725 ≈ **+0.57** ✓ (and the "+0.57c/share" phrasing is consistent at 100 shares/market). Minority (losses) 84 ≥ 30 ✓.
- **Run 465 (SCR-007):** N=500, played=398, EV=−6.8046, q=−0.1418, t=−3.1711→−3.17, winRate 0.4196, 167/227, maker/taker 1488/363, failures=0 — all match. Derived: pnlTotal=−3402.28; −3402.28/398 = −8.548 ≈ **−8.55** ✓. CI95 [−11.0104, −2.5988] excludes 0 ✓.
- "0 failures in all three" ✓.

### Check B — Verdicts follow the frozen bars: PASS (one interpretive note below)

- **SCR-005 kill:** q̂ = −0.0218 ≤ 0 fires the explicit KILL branch; prediction ("EV per played market > 0") contradicted at −4.55. Clean kill.
- **SCR-007 kill:** three explicit branches fire: q̂ ≤ 0, t = −3.17 ≤ −1, prediction contradicted. Clean kill.
- **SCR-006 kill (default):** verified no explicit KILL branch fires: q̂ = +0.0165 > 0; prediction (EV per played > 0 net of fees) held at +0.57; t = +0.74 > −1; E14 skew branch requires minority < 30 and minority = 84. SURVIVE fails on t = 0.74 < +1.5. Not park-design (774 entries). **Which reading does the text license?** SCREENING.md line 67 labels KILL "**(default outcome)**", line 58 says a screen "gets the default", and §What-a-screen-is defines the tier as "KILL-BIASED" with SURVIVE framed as the earned exception ("Survival buys a full registration"). Given verdicts are a closed set {kill, survive, park-design}, a run that earns neither SURVIVE nor PARK-DESIGN falls to the labeled default. I judge "kill (default outcome)" the reading the frozen text licenses, not a stretch — and the verdict bullet discloses the situation honestly rather than pretending a branch fired. See finding 1 for the residual textual gap.

### Check C — No post-results spec edits: PASS

`git diff 4d5c7f3..HEAD -- fable-lab/protocol/registry/screens/BATCH-002.md` is **additions only**: (i) the pre-verdict submission note, (ii) content under the pre-existing `## Verdicts (append-only after runs complete)` header (the header itself was in the freeze commit — it appears as diff context, not an addition). Zero changes to any mini-spec block, mechanism, cells, predictions, kill lines, or N. Intermediate history confirms two commits only: 7516f06 (duplicate resolution, 18:53:04) and ac25b36 (verdicts, 18:55:19).

### Check D — Duplicate resolution soundness: PASS

- DB confirms runs 462 and 463 both carry `SCR-005-screen` with **byte-identical cmds**, created `18:48:53` / `18:49:00` — exactly the 7-second gap and timestamps recorded in the note. 462 is the lower id / first enqueued, matching the stated deterministic rule.
- Timing is internally consistent: freeze 18:43:36 → submissions 18:48:53–18:52:15 (all after freeze) → resolution commit 7516f06 at 18:53:04 → verdict commit ac25b36 at 18:55:19. The note's claim that SCR-006/007 (enqueued 18:52:01/18:52:15) were still in-flight at note time is plausible at 18:53:04. Git cannot prove the operator hadn't peeked at 462's stats pre-note (462 may have completed by 18:53), but nothing contradicts the outcome-blind claim, the rule chosen (first-enqueued/lowest-id) is the only outcome-independent one available, and refusing to pool is the correct anti-post-hoc call.
- Exactly one non-void run per BATCH-002 batchUid: SCR-005-screen → 462 (463 void), SCR-006-screen → 464, SCR-007-screen → 465. All three cmds spec-conformant: `--random`, `--to-ms 1772323199999`, `--limit` 500/2000/500 per spec (SCR-006's 2000 covered by the pre-frozen D49-amendment-2 deviation at BATCH-002.md line 52), strategy ids `fable-scr-005/006/007`, `--detach` per sample rule.

### Findings

1. **MINOR — protocol text gap, not a verdict error** (fable-lab/protocol/SCREENING.md lines 67–69): the KILL bullet enumerates branches that do not cover the region q̂>0 ∧ −1<t<+1.5 ∧ prediction held; SCR-006 lands exactly there. The "(default outcome)" label plus the closed verdict set carries the kill, and the verdict bullet discloses this correctly, but the bar text should be amended (pre-freeze for future batches) to state explicitly that failing SURVIVE without PARK-DESIGN is a kill, so no future survive-adjacent case can argue the gap the other way.
2. **MINOR — run 465 wins+losses ≠ played** (BATCH-002.md line 129): 167+227 = 394 vs played = 398 (4 markets presumably flat/zero-PnL, and winRate 167/398 = 0.4196 uses the played denominator). The table faithfully transcribes results.ts output, so this is a tool-convention quirk, not a transcription error — but it is unexplained anywhere and worth a one-line convention note.
3. **MINOR — cmd strings recorded as `npm run npx -- ...`** (runs 453–465 in `backtest_runs.cmd`): the recorded command is not literally runnable as written (earlier runs say `npm run backtest --`). All spec-critical tokens (--random, --to-ms, --limit, strategy id, batchUid, --detach) are present and correct, so spec-conformance holds; flagging only because `cmd` is treated as the permanent launch record.

No MAJOR findings. All three kills are correctly derived from DB numbers under the frozen bars, the batch file is append-only since freeze, and the 462/463 resolution is deterministic and internally consistent with the outcome-blind claim.

## Findings disposition (session 62, same day)

1. APPLIED — SCREENING.md KILL bullet amended (D49 amendment 3): a
   screen earning neither SURVIVE nor PARK-DESIGN is killed; the
   enumerated branches are illustrations of the default, not its
   boundary.
2. APPLIED — convention note appended to BATCH-002.md (results.ts counts
   only nonzero-PnL markets as wins/losses; winRate uses the played
   denominator).
3. APPLIED — `tools/submit.ts` now strips `npm_lifecycle_event` /
   `npm_config_argv` from the child env, so the engine's cmd recorder
   (`src/cli/helpers/backtestCmd.ts`, lifecycle-first reconstruction)
   falls back to the truthful `node <entry> ...` form. Root cause: `npx`
   sets `npm_lifecycle_event=npx`. Existing rows 453–465 stay as-is
   (historical record; spec tokens verified correct by this audit).
