## Strategy Proposal

Input:
NAMING - rules
Memory:
src/strategies/research/ALL-STRATEGY-INDEX.json - list of all families
Output:
src/strategies/research/<family>/ - new family folder
src/strategies/research/<family>/FAMILY.md
src/strategies/research/<family>/FAMILY-INDEX.json
src/strategies/research/ALL-STRATEGY-INDEX.json - add with status "proposal"

## Strategy Implementation

Input:
src/strategies/research/<family>/FAMILY.md
src/strategies/research/<family>/FAMILY-INDEX.json
Output:
src/strategies/research/<family>/Strategy.ts (auto-discovered — no registry edit)
src/strategies/research/ALL-STRATEGY-INDEX.json - update with status "implemented"

## Strategy Evaluation

Evaluator Last 1000+3000+9000 is ok:
if(last 1000 > EV_threshold)

Input:
<family>
Output:
