# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 12)

## Current work

Session 12 executed E-024 and pre-registered E-025:

**E-024 VERDICT (HF fill probe, no fleet runs).** Built
`tools/fillprobe.ts`, scanned the pinned 800 full-window (foreground
chunks, checkpoint `memory/experiments/data/
fillprobe-2026-07-31-latest800.jsonl`, 800/800, 0 skipped). Result:
**FILL MODEL MATERIALLY BINDING** — optimistic front-of-queue capture
is 235× worst-queue at 0 ms, 29× at 140 ms (frozen bar: 3×; every day
121–385×). Raw ToB bid decrease flow ~6,960 events / ~225k shares per
market ⇒ the 700-trades/window operator is inside observed activity.
Maker kills STAND (guard-6 direction unchanged); "fill-limited"
(E-013) is now model-scoped. Secondary: W-latency INVERSION (W140 =
3.8× W0 — worst-queue fills are pure adverse selection). P-011 filed.
hf-fill-probe.md §Result E-024.

**E-025 pre-registered (hf-fill-probe.md §E-025, design-ts session-12
commit BEFORE any computation)**: trade-print calibration on the 36
locally recorded live-WS btc markets (`data/events/btc/*.parquet`,
slugs from 1784637900). `last_trade_price` carries price+size+side ⇒
compute T (trade-confirmed front-of-queue) quoter next to W and O on
the same stream, cancel-share of level decreases, T/W and O/T ratios,
frozen interpretation bars (T140 ≤ 2×W140 downgrades E-024's verdict;
≥ 3× escalates P-011). Needs a NEW small replayer over recorded parquet
(full WS channel incl. trade prints — delta-typed telonex data has NO
trade events; verified in src/telonex/converters/deltaTyped.ts).

## Next step

Nothing in flight (no fleet runs; all local scans completed in-session).

1. **Execute E-025** (session 13): build `tools/tradeprobe.ts` reading
   `data/events/btc/*.parquet` via the recorded-mode replay path (see
   `src/parquet/replay/replayOrderBookForMarket.ts` — it handles
   last_trade_price), reuse fillprobe's Quoter automaton + add the T
   model per the frozen §E-025 design. 36 markets, fast — no chunking
   expected. Verify SELL-side semantics on a sample first (pre-commit
   fallback recorded in the design).
2. Then axis 4 (size laddering) design + pre-registration (size as
   f(price), multi-round accumulation; mind review-gate M5
   incrementSize bound). Axis 4 runs on the fleet under the current
   fill model — legitimate (maker-entry regime, guard-6 direction),
   unlike HF work which is blocked on P-011/E-025.
3. Axis 5 (time-varying policy) remains undesigned.

## Blockers

None.

## Needs human

- Carried: P-002/P-003/P-005/P-006/P-007/P-009/P-010 (all `proposed`).
- New: P-011 (fill model can't pin maker capture within ~29–235×;
  E-025 self-serve calibration first, engine work only if it escalates).

## Standing session guards

- Never end a session waiting on ANY in-flight work (fleet, local scan,
  background task, monitor) — record how to resume in STATUS, return
  `continue` (inbox dad421a6). Long local jobs: `--checkpoint` +
  `--time-budget-s` foreground chunking (mktselect/bookscan/fillprobe).
- Write .global-runtime/session-result.json BEFORE the final message,
  every session, no exceptions.
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine commits
  (this session: only protocol commits moved HEAD).
- Queue submissions require a CLEAN tree pushed to origin/main (push via
  `git push origin HEAD:main` from the wt/pair-fable worktree).
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes). FULL reference for v1-b: run 914
  (no expiry — FULL runs don't drift).
- JOURNAL entries are for the HUMAN: plain language, 3–6 short lines, at
  most one evidence pointer per conclusion (inbox 330fa938, permanent).
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329).
- Class kills need an identity argument (evaluator.md §Kill standards,
  binding per inbox 8758567d); N failures kill a family only.
- NO HF maker strategy code against the current simulator until the
  fill model is calibrated (E-024 frozen consequence; E-025/P-011).
- Sibling-memory recheck at session start (`ls protocols/*/memory`) —
  2026-07-31 s12: still only pair-fable has memory.
- zsh does not word-split unquoted vars; spell out args in submission
  loops. Also `=word` expansion: quote bare `===` etc. in echo.
- Smoke cannot catch latency-race bugs (≤20 quiet markets): any strategy
  with taker/burst-capable paths needs a mechanical post-run integrity
  check (CAP-BREACH is the template).

## Inbox processed through

2026-07-31T08:30:52.409Z-d904e17d (recorded in memory/market-context.md).
