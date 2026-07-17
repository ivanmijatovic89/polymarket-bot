# Gabagool Lab — STATE

> Resume protocol: read CHARTER.md, then this file, then the tail of
> JOURNAL.md. That is enough to continue. Everything else is detail.

## Status digest

- **Session:** 1 (first working session, started 2026-07-17T03:17Z)
- **Ladder rung:** L0 — building the lab
- **Phase:** 0 — inheriting (reading KB, quarries, verifying engine facts)
- **Branch:** gabagool-lab (worktree at ~/Sites/polymarket-bot-gabagool-lab)
- **Write scope:** gabagool-lab/ + src/strategies/gabagool-lab/ (hook enforces)

## What exists so far

- Bootstrap files only (this file, JOURNAL, DECISIONS, OPERATOR-FEED).
- No lab design docs yet, no strategy code yet, no runs yet.

## Queue (work top to bottom)

1. **Phase 0 reading** — digest KB (`../polymarket-bot-gabagool/research/gabagool/`),
   fable-lab, strategy-research-protocol, repo-root gabagool docs; verify the
   5 engine footguns in code (worst_queue, fee-free maker fills, all-or-nothing
   size, fill-before-cancel, pair auto-credit in marketStats). Write
   INHERITANCE.md with the distilled findings + file citations.
2. **Design docs** — EPISTEMOLOGY.md (experiment lifecycle, proposal policy,
   honesty mechanisms, holdout design) + EVALUATION.md (frozen multi-criteria
   scoring rule with time slices, tails, latency robustness, capital
   efficiency, sample size).
3. **Tools** — minimal: submit backtest, read results, validate verdicts.
   Quarry fable-lab/tools/ first; port, don't rewrite, where possible.
4. **Smoke** — one end-to-end run of a trivial variant through the full
   pipeline (strategy file → backtest → results → evaluation readout).
   L0 complete when this works.
5. **L1 baseline** — simplest honest variant at real coverage with full
   evaluation readout incl. time slices + latency stress.

## Open questions / risks

- Sibling KB shift is live and its STATE.md grows — re-read every session.
- Price-to-beat + Chainlink feeds not yet checked for arrival (check docs/
  + git log each session).
- Remote fleet tracks origin/main — not usable for my branch; plan local.

## Key paths

- KB: `/Users/mijat/Sites/polymarket-bot-gabagool/research/gabagool/`
- fable-lab quarry: `/Users/mijat/Sites/polymarket-bot-fable/fable-lab/`
- SRP quarry: `strategy-research-protocol/` (repo root)
- Telonex data: `data/events/telonex/`
