# AUDIT — D18 touch_or_better unlock (U35/U36), fresh-context verifier

_Session 7, U37. Verifier subagent audited the D18 unlock (hook correctness,
fill semantics, label/cmd integrity, epistemics, charter compliance) with no
memory of building it. Report preserved verbatim below. Actions taken on the
findings are recorded after the report; fixes were applied BEFORE the
EXP-008/EXP-009 probe results were read (probes still running at fix time —
mechanically checkable: the fix commit predates the probes' completion
timestamps in `logs/touch-probes.log`)._

## Verifier report (verbatim)

# Audit findings — D18 touch_or_better unlock (U35/U36)

## 1. Hook correctness — HOLDS, with notes

**1.1 (holds)** `makerFillMode` has exactly one fill-evaluation consumer: `src/trading/execution/BacktestExecution.ts:686` (`buildMakerFillTouchCross` inside `onMarketTick`). Set only at the constructor (`:196`). Verified by repo-wide grep. All other fill paths — FOK and immediate GTC/GTD crossing at placement (`placeLimitNow`/`placeBatchNow` → `buildFillsFromBook`, `:116-167, :365, :393, :506, :535`), cancel handling (`:567-635`), GTD expiry (`:673-682`) — are mode-independent (taker-crossing or bookkeeping). So no fill can be evaluated under the wrong mode before the hook fires: the hook (`fable-lab/tools/run-backtest.ts:170-176`) sets the field before delegating to the original method, and the only maker-fill read happens inside that method.

**1.2 (holds)** Single instantiation site: `src/backtest/runSingleMarket.ts:129-134` (fresh instance per market). Sequential path is a plain in-process for-loop (`src/cli/backtest.ts:700-780`, `useBullMQ = !parsed.sequential` at `:700`), no fork/worker; one run per process, process exits after persist. No leak into a later worst_queue run is possible — a later run is a new process where the wrapper (and hook) either runs with `worst_queue` (hook not installed, `run-backtest.ts:162`) or doesn't run at all. The probe log confirms one process per probe (`fable-lab/logs/touch-probes.log:1`, hook line at `:2009`).

**Note:** the hook is prototype-level and process-global, so if the engine ever gained multi-run-per-process behavior this would silently contaminate; currently unreachable.

## 2. Semantics — HOLDS, with one disclosed contamination channel

**2.1 (holds)** Touch BUY: fills full `remaining` at `o.limitPrice` when `bestAsk <= limitPrice` (`BacktestExecution.ts:62-84`); worst_queue requires strict `<`. Fill price is always the resting limit — never better than the book (strategies only rest strictly non-marketable bids: `EXP-006.ts:200`, `EXP-007.ts:185`). No double fills: `o.remaining = 0` (`:84`) and the order is deleted (`:691-699`).

**2.2 (holds)** No infinite fill loop: a fill clears the tracked quote (`EXP-006.ts:243-245`), the next repost is gated by `inv >= maxInventory` read from the portfolio snapshot (`EXP-006.ts:192-196`, `EXP-007.ts:177-181`); with shares=10 / maxInventory=50 that is ≤ ~5-6 fills per side per episode. Probes pin latency 0/0 (D8), so cancels execute immediately (`cancelOrder` → `cancelOrderNow` when `executeAtMs <= nowMs`, `:598-600`) and there is no in-flight cancel/fill race in these runs.

**2.3 (concern)** Crossed recorded books: under touch, `bestAsk <= P` is spuriously satisfied by self-crossed book states, granting full-size phantom fills same-tick before the strategy's crossed-guard cancel lands. Both specs disclose this (EXP-008 `:60-64`, EXP-009 `:54-58`) but defer detection to "composition diagnostics at judging" with no pre-specified numeric bar — a judgment-time degree of freedom. Impact: phantom-fill PnL could tip a marginal result either way with no mechanical tripwire.

## 3. Label/cmd integrity — HOLDS for the probe; one blocker in the pre-registered extension path

**3.1 (holds)** Engine parser ignores single-token unknown flags: `src/cli/helpers/backtestArgs.ts:338-340` (`arg.startsWith('-')` → break, not pushed to `filePaths`). `cmd` is built from `process.argv.slice(2)` (`src/cli/backtest.ts:187, :294`) with `preferArgv: true`, bypassing the `npm_config_argv` branch (`backtestCmd.ts:22`); `--fill-mode=touch_or_better` matches `quoteInlineArg`'s unquoted charset (`backtestCmd.ts:5`) and lands verbatim in `cmd`. Run 354 verified this per commit d82a815. A wrapper touch run cannot persist without the marker: the batchUid guard (`run-backtest.ts:84-93`) hard-exits before the engine loads.

**3.2 (BLOCKER — pre-registered ambiguity path is unexecutable)** Both specs' extension rule (`EXP-008 :90-97`, `EXP-009 :87-93`) mandates `--extend RUNID ... --fill-mode=touch_or_better` *through the wrapper*. But the wrapper's D18 guard demands a `--batchUid` containing "touch" (`run-backtest.ts:87-92`), while the engine rejects `--batchUid` combined with `--extend` (`backtestArgs.ts:404, :425-431`). Deadlock: no argument combination satisfies both. If either probe lands in the ambiguous band, the frozen decision rule cannot be executed without amending the tool mid-experiment — exactly the post-hoc modification window pre-registration exists to close.

**3.3 (concern)** A touch run *can* be silently corrupted the other way: nothing mechanical stops `npm run backtest -- --extend <touchRunId>` run directly (bypassing the wrapper), which would append worst_queue markets to a touch-labeled run. The specs disclose this voids the run and require checking the hook log line — honor-system only, and the DB row would remain labeled "touch" forever.

**3.4 (note, fail-closed)** The guard reads only the two-token `--batchUid X` form (`run-backtest.ts:85-86`); `--batchUid=EXP-008-probe-touch` (single-token) is wrongly rejected. Also `--fill-mode` with a missing value is silently dropped → runs worst_queue (`run-backtest.ts:65-68`, `v` undefined). Both fail safe, not open.

## 4. Epistemic holes

**4.1 (concern — "bound dominance" is not a theorem for these strategies)** Per-order, touch fills strictly dominate worst_queue (trigger `<=` vs `<`, same price, full size). But the specs claim the bound "dominates every intermediate fill model" and stake CONCLUSIVE-kill wording on it (EXP-008 `:41-44`, EXP-009 `:36-41`). That does not follow at strategy level, for two reasons visible in the code: (a) **path dependence** — `maxInventory` caps plus requoting mean fill *sets* differ rather than nest: under touch the cap binds on early, higher-priced quotes (requotes chase falling fair, `EXP-007.ts:182`), while a realistic queue model fills later requotes at lower prices with identical settlement value — realistic EV/market can exceed touch EV/market; (b) **full-size toxic fills** — touch fills full remaining size (`BacktestExecution.ts:80`) even where a realistic model gets a small partial fill of the same toxic flow, so touch can lose *more* per adverse event than reality. Both mechanisms point the dangerous way: a touch-mode EV ≤ 0 does not strictly prove all realistic queue models ≤ 0, so a kill is very strong evidence but "conclusively, because the bound dominates every intermediate fill model" is an overclaim. The escalate branch is unaffected (it claims only a bracket).

**4.2 (concern — one-market holdout leak in the pre-registered command)** `--to-ms` is **inclusive** (`lte`, `src/db/telonexEligibility.ts:63`; documented "inclusive upper bound", `backtestArgs.ts:85-88`), while the specs define exploration as `market_start_ms < 1777237200000` and holdout as `>= 1777237200000`. The boundary is an actual market's start (universe.ts sets `holdoutBoundaryMs = markets[boundaryIdx].marketStartMs`, `fable-lab/tools/universe.ts:45,58`), i.e. the *first holdout market* is inside the probes' `--to-ms 1777237200000` sampling pool (~3.5% chance of being drawn per 500-draw). Pre-existing systemic flaw: the killed parents used the same command (EXP-006 `:91`, EXP-007 `:90`). Impact: statistically negligible, but it is a mechanical contradiction of "holdout untouched" that the lab has not noticed.

**4.3 (note — decidable, with one derivation gap)** `tools/results.ts` prints `q`, `t`, N, EV/market, CI95, winRate, positiveDayFrac (`results.ts:150-170`) — the kill/escalate/ambiguous partition is decidable and exhaustive (sign(q) = sign(EV(played)) = sign(pnlTotal), since skipped markets carry pnl 0; so "prediction contradicted" ⟺ t ≤ 0, ambiguous ⟺ 0 < t < 2, escalate ⟺ t ≥ 2). However **EV(played)** — the quantity named in the decision rules — is not an emitted field; the judge must derive `pnlTotal / played`. Small mismatch between rule wording and the tool whose output must be pasted verbatim.

**4.4 (note — pre-registration timing holds; one disclosed peek)** Specs committed at 30dc724 (2026-07-10 07:42 +0200); probes detached at 05:44:07Z = 07:44 +0200 (5819430, log line 1) — after. But U35's verification run 353 executed touch mode on the *exact* EXP-008 primary cell over 8 markets before registration; STATE discloses "counts read via fills.ts, no PnL" (`STATE.md:256-259`), and the spec uses that fill-density observation to waive the design-failure clause (EXP-008 `:42-44`). The PnL-abstention is honor-system — run 353's per-market PnL sits in the DB and its non-inspection is unverifiable. Disclosed, low N, but it slightly weakens "no touch-mode outcome observed before registration" (EXP-008 `:13-15`) since fill density *is* an outcome dimension.

**4.5 (note — stale decision text)** DECISIONS D18 still says the flag is "stripped from argv before the engine parser sees it" (`DECISIONS.md:425`), but U35b changed the behavior to normalize-and-leave (`run-backtest.ts:52-61, :82`). The wrapper comment is current; the decision record was not amended.

## 5. Charter compliance — HOLDS

- `git diff main...HEAD --stat -- src/` → empty; `git status --short -- src/` → empty. No src file modified; the unlock is runtime-only. Confirmed.
- `--sequential` mechanically enforced by the wrapper (`run-backtest.ts:99-104`); probes run locally, detached via `detach.mjs` (setsid, no remote).
- No live-trading surface: the hook touches only `BacktestExecution`, unreachable from live paths.
- Holdout: the specs' stated boundary (1777237200000) matches the probes' `--to-ms` — but see finding 4.2: because `--to-ms` is inclusive and the boundary equals the first holdout market's start, the pre-registered command technically overlaps the holdout by exactly one market. Everything else about holdout discipline (D18 lock, no advance path) is consistent and mechanically hard to violate through this experiment.

## Summary

The hook is technically sound (findings 1-2), labeling is robust for probe runs (3.1), and pre-registration timing is clean (4.4). The three things the builder cannot see from inside: the **extension-path deadlock** (3.2, blocker — the ambiguous-outcome rule as frozen cannot be run), the **inclusive `--to-ms` one-market holdout overlap** (4.2, concern, systemic since EXP-006), and the **overclaimed dominance in the CONCLUSIVE-kill wording** (4.1, concern — kill would still be strong evidence, but not the theorem the verdict template asserts).

## Actions taken (U37, pre-results)

- **3.2 (blocker) FIXED in tools/run-backtest.ts:** in touch mode with
  `--extend`, the batchUid guard now checks the PARENT run's batch_uid in
  the DB (must contain `touch`) instead of requiring a forbidden
  `--batchUid` flag. This also closes most of 3.3 for wrapper-launched
  extends (extending a non-touch parent in touch mode is refused; extending
  a touch parent without `--fill-mode` is still possible only OUTSIDE the
  wrapper, which remains documented as voiding the run).
- **3.4 FIXED:** guard accepts `--batchUid=X` single-token form; missing
  `--fill-mode` value is now a hard error instead of silent worst_queue.
- **4.1 AMENDED in both specs (pre-results amendment, recorded with
  timing):** CONCLUSIVE-kill wording weakened to "decisive evidence against
  the at-touch version under the most favorable fill assumption the engine
  can express; not a theorem over all queue models (path dependence via
  inventory caps + full-size toxic fills — audit 4.1)". Decision BARS
  unchanged.
- **4.2 RECORDED as LESSONS E18** (inclusive `--to-ms` overlaps the single
  boundary market; affects EXP-006/007/008/009 probes equally; judging must
  check whether slug btc-updown-15m-1777237200 was drawn and disclose).
  Future sample rules use `--to-ms <boundary − 1 ms>`.
- **4.5 FIXED:** amendment note appended to D18.
- **2.3 and 4.3 NOTED in both specs:** phantom-fill tripwire pre-specified
  (if any of the run's top-5 |PnL| markets is dominated by fills at prices
  a crossed book would explain, run the diag fixture on those slugs before
  judging); EV(played) defined as pnlTotal / played derived from the
  verbatim results block.
- **4.4:** stands as disclosed; no action possible retroactively (the
  fill-density peek is permanent record in EXP-008's amendment note).
