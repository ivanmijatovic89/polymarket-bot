# Constraints — what a family must NOT do

`strategy-research-protocol/modules/ProposeFamily.md` reads this and must not
propose anything that violates it. Curate this over time: when a proposal isn't
what you want, add a line here.

- No live-only signals or unrecorded WS fields (breaks the live/backtest replay
  invariant — any divergence is a bug).
- No cross-exchange / cross-venue arbitrage.
