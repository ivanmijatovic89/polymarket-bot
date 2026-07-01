## New Family
*Propose New Family + suggestion for experiments to try*
manual step
Input:
    - `src/strategies/research/INDEX.json`
Output:
    - `src/strategies/research/<family>/FAMILY.md`
    - `src/strategies/research/<family>/FAMILY.json`
    - `src/strategies/research/<family>/Strategy.v0.ts`
    - status = proposed

## Family Researcher Agent | Research Family Skill
*Load Family and run one research iteration*
Input:
    - `src/strategies/research/<family>/FAMILY.md`
    - `src/strategies/research/<family>/FAMILY.json`
Output:
    - Backtest experiment | CLI
    - Extend backtest experiment | CLI
    - Evaluate backtest results | LLM | sub-agent ( new context)
    - Propose new experiment | LLM
    - update STATUS
        - `src/strategies/research/<family>/FAMILY.md`
        - `src/strategies/research/<family>/FAMILY.json`
    - update MEMORY
        - `src/strategies/research/<family>/FAMILY.md`
        - `src/strategies/research/<family>/FAMILY.json`
    - Regenerate `src/strategies/research/INDEX.json`

## Research Family Loop
*Load Family*
Input:
    - `src/strategies/research/<family>/FAMILY.md`
    - `src/strategies/research/<family>/FAMILY.json`
**LOOP:**
- based on status decide next move:
```bash
propose experiment > run backtest > evaluate results > ( extend backtest ) or ( kill and propose new experiment)
```
propose experiment before inventing new experiment check cheklist if there are predefined experiments in family.md or family.json
*LOOP CLOSE*
on minimum 100 experiments or EV > 0.10
