# EXP-NNN — <short title>

<!-- SPEC — frozen after the first non-smoke run exists. Fill every field.
     "Runs" and "Verdicts" below are append-only forever. -->

## Spec

- **Registered:** <ISO date> (commit: <sha>)
- **Idea:** <IDEAS.md anchor>  **Parent lineage:** <EXP ids or none>
- **lineage_cells:** <k — number of parameter cells inspected across this
  lineage before this registration; 1 if fresh. Decisive p-bar = 0.023/k.>
- **Mechanism class:** <one of the classes in IDEAS.md>
- **Hypothesis (who loses and why):** <2-4 sentences. The counterparty and
  the reason their behavior is systematic, stated so a result can contradict it.>
- **Falsifiable prediction:** <a statement about recorded data/diagnostics
  that is TRUE if the mechanism is real, checkable from the probe run.>
- **Strategy:** `fable-lab/strategies/<mechanism>/EXP-NNN.ts`, id `fable-exp-NNN`
- **Primary parameter cell:** <exact --param list. ONE cell.>
- **Robustness neighborhood:** <the ±1-step grid to run at Stage 2, judged
  on smoothness only>
- **Simulator-bias exposure (CAPABILITIES §4):** <where would this edge sit
  if it exists — maker-fill capacity? taker cost? settlement? State the
  optimistic-side dependencies up front.>
- **Windows (computed by tools/universe.ts at registration):**
  - Exploration: `market_start_ms` < <BOUNDARY_MS> (<ISO>)
  - Holdout: `market_start_ms` >= <BOUNDARY_MS> and <= <REG_LAST_MS>, one-shot
    (upper bound = last eligible market at registration; markets accruing
    later belong to no window)
- **Sample rules:** probe = `--random --limit 500 --to-ms <BOUNDARY_MS − 1>` (E18: `--to-ms` is inclusive; exploration is strictly < boundary);
  main = extend to full exploration window; holdout = full holdout window.
- **Decision rules (copied from EPISTEMOLOGY at registration):**
  - probe kill: q̂ ≤ 0 with t ≤ −1, or prediction contradicted
  - main advance: t ≥ <2 adjusted for lineage_cells> on primary cell +
    battery pass + bias classification not simulator-favored
  - holdout confirm: t ≥ <same bar> on holdout alone
- **Latency curve points:** delay ∈ {0, 150, 300}, jitter 0

## Runs (append-only)

<!-- one block per run, pasted verbatim from tools/results.ts -->

## Verdicts (append-only)

<!-- one block per Judge verdict, pasted verbatim. Fields: stage, decision,
     t/q/N/EV read, battery summary, simulator-bias classification,
     required next step, one-paragraph reasoning. -->
