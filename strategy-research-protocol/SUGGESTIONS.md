# Suggestions — open items

No open items. Findings from the post-v2 architecture review (2026-07-03)
have all been resolved; this file stays as the place to record future review
findings before they are implemented.

## Resolved log

**v2.2 (2026-07-08):** the Evaluator role was merged into the Researcher
(issue #83). One role now specs, runs, reads, and judges; `evaluator.sh` and
`modules/Evaluator.md` were removed. Bias containment moved from role
separation to mechanics: `hypothesis` + `successCriteria` freeze once an
experiment is `running`, every judgment (pass `note`, gateLog `note`,
`outcome.reason`) must quote the measured numbers it rests on, gateLog and
Research log stay append-only, and gates/stopping rules remain defined only
in STAGE-GATES.md. Historical FAMILY.md logs keep their "Evaluator" wording
(append-only records are never rewritten).

**v2.1 (2026-07-04):** costs are measured, never modeled — no cost formula
or constant anywhere; all real fees/EV come from `backtest_run_segments`
(`evPerMarketTotal` net, `totalFeesPaid`), and Edge economics is a mechanism
argument citing measured comparables; gates simplified to net profitability
per stage (no
train/test split in v1); gate decisions recorded in the experiment `gateLog`;
role handoffs + launch scripts defined in RUNNING.md
(`researcher.sh`/`evaluator.sh`); RESEARCH_SCOPE.md defers to STAGE-GATES.md
and the Evaluator module; cross-family memory added as LESSONS.md (starting
empty by user decision) with the CONSTRAINTS.md promotion rule; the Evaluator
refine grid got a schema home (`search.refine`); CI runs `research:check` +
index freshness; branch policy set to `main` in RUNNING.md (single place to
change); same-family session race prevented by a per-family PID lock in the
launch scripts.
