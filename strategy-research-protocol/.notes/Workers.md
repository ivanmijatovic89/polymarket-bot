## New Family

_Propose New Family + suggestion for experiments to try_
manual step
Input: - `src/strategies/research/INDEX.json`
Output: - `src/strategies/research/<family>/FAMILY.md` - `src/strategies/research/<family>/FAMILY.json` - `src/strategies/research/<family>/Strategy.v0.ts` - status = proposed

## Family Researcher Agent | Research Family Skill

_Load Family and run one research iteration_
Input: - `src/strategies/research/<family>/FAMILY.md` - `src/strategies/research/<family>/FAMILY.json`
Output: - Backtest experiment | CLI - Extend backtest experiment | CLI - Evaluate backtest results | LLM | sub-agent ( new context) - Propose new experiment | LLM - update STATUS - `src/strategies/research/<family>/FAMILY.md` - `src/strategies/research/<family>/FAMILY.json` - update MEMORY - `src/strategies/research/<family>/FAMILY.md` - `src/strategies/research/<family>/FAMILY.json` - Regenerate `src/strategies/research/INDEX.json`

## Research Family Loop ( or as a loop (wip))

_Load Family_
Input: - `src/strategies/research/<family>/FAMILY.md` - `src/strategies/research/<family>/FAMILY.json`
**LOOP:**

- based on status decide next move:

```bash
propose experiment > run backtest > evaluate results > ( extend backtest ) or ( kill and propose new experiment)
```

propose experiment before inventing new experiment check cheklist if there are predefined experiments in family.md or family.json
_LOOP CLOSE_
on minimum 100 experiments or EV > 0.10
