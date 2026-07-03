# Suggestions — open items

No open items. Findings from the post-v2 architecture review (2026-07-03)
have all been resolved; this file stays as the place to record future review
findings before they are implemented.

## Resolved log

**v2.1 (2026-07-04):** cost model now lives in STAGE-GATES.md
(`takerFeeBps` + the fee formula from `src/trading/fees.ts`; cost per market
is computed per strategy, no universal constant); gates simplified to net
profitability per stage (no
train/test split in v1); gate decisions recorded in the experiment `gateLog`;
role handoffs + launch scripts defined in RUNNING.md
(`researcher.sh`/`evaluator.sh`); RESEARCH_SCOPE.md defers to STAGE-GATES.md
and the Evaluator module; cross-family memory added as LESSONS.md (starting
empty by user decision) with the CONSTRAINTS.md promotion rule; the Evaluator
refine grid got a schema home (`search.refine`); CI runs `research:check` +
index freshness; branch policy set to `main` in RUNNING.md (single place to
change); same-family session race prevented by a per-family PID lock in the
launch scripts.
