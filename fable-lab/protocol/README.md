# Fable Protocol — map

A research system for finding durable, replayable +EV strategies on
Polymarket BTC 15m up/down markets, operated by Claude Fable sessions.
Scope is operator-fixed in `fable-lab/CHARTER.md` and non-negotiable.

## Core invariants

1. **Every design element traces to `engine/CAPABILITIES.md`.** If the
   engine doesn't support it, the protocol doesn't assume it.
2. **Decision rules are written before results exist** (pre-registration,
   frozen specs), and applied by a fresh-context Judge, not by the session
   that built the strategy.
3. **Belief is bought with data**: t = qualitySystem · √N, two independent
   chronological samples at t ≥ 2 (exploration, then one-shot holdout).
   Derivations in `EPISTEMOLOGY.md` — thresholds are formulas, not folklore.
4. **No invented cost constants.** Costs enter through the simulator's
   measured output and sensitivity curves; simulator biases are classified,
   not hand-waved (DECISIONS D6).
5. **Files are the only memory.** A fresh session resumes from the registry
   and knowledge files alone.

## File map

| file | owns |
|---|---|
| `../engine/CAPABILITIES.md` | ground truth about the engine (cited) |
| `EPISTEMOLOGY.md` | evidence tiers, thresholds, derivations |
| `LIFECYCLE.md` | experiment mechanics: files, naming, freezing, judging |
| `IDEAS.md` | mechanism-first idea ledger + mechanism classes |
| `templates/EXPERIMENT.md` | the pre-registration spec template |
| `registry/experiments/EXP-*.md` | one file per experiment (spec + runs + verdicts, append-only) |
| `registry/INDEX.md` | generated one-line-per-experiment table (`tools/index-registry.ts`) |
| `../knowledge/LESSONS.md` | transferable mechanism-level knowledge, evidence-cited |
| `sessions/SCIENTIST.md` | the operating session's role contract |
| `sessions/JUDGE.md` | the fresh-context verdict subagent prompt |
| `../tools/` | working scripts (see `../tools/README.md`) |
| `../RUNBOOK.md` | morning operator guide |
| `../DECISIONS.md` | design forks and rejected options |

## The loop, in one paragraph

Pick the top open idea in `IDEAS.md` → register `EXP-NNN` (spec + strategy
committed before any decisive run) → smoke locally → probe 500 random
exploration markets (local sequential, in the background) → Judge decides
kill/iterate/advance →
extend to the full exploration window + robustness battery → Judge decides →
one-shot holdout run → Judge confirms or refutes → distill the lesson,
update the ledger, next idea. Every decisive number is read through
`tools/results.ts` and appended verbatim to the experiment file.
