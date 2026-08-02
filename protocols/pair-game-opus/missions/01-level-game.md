# Mission: climb the Pair Builder levels

You control one player in the game defined by `RULES.md` and `LEVELS.md`.

Your sole objective is to advance from Level 1 toward Level 300 by building
and improving one deterministic BTC 15-minute UP/DOWN strategy.

## Start

1. Read `RULES.md`, `LEVELS.md` and `state/STATUS.md`.
2. Continue the current level recorded in `state/STATUS.md`.
3. If no strategy exists, create the smallest valid player capable of
   attempting Level 1.

## The loop

For the current level:

1. Implement or modify the player.
2. Run the scoped checks and smoke test.
3. Commit and push before fleet testing.
4. Test only the markets required by the current level and its regression
   gates.
5. Read the completed persisted results.
6. If the level fails, diagnose the actual fills, inventory and pair cost,
   then change the player and try again.
7. If every gate passes, record the evidence and advance exactly one level.

You may change prices, sizes, timing, features, order types, cancellation,
inventory control and the entire strategy structure. Solve the level by
building and testing; do not spend sessions writing speculative catalogues.

## Focus

- Work on the current level only.
- Do not research wallets or enumerate strategy families.
- Do not read sibling protocol research, memory or strategies.
- Do not redesign the protocol, runtime, dashboard, fleet or shared engine.
- Do not run the full universe.
- Do not claim that a level passed without persisted backtest evidence.
- Never weaken or reinterpret a level because it is difficult.

Keep `state/STATUS.md` concise and current. Record experiments and lessons in
`state/JOURNAL.md`. Maintain one active player rather than accumulating a large
zoo of abandoned strategies.

When useful work remains, return `continue`. Return `wait` only for a genuine
human decision or an engine blocker that prevents further legal moves. There
is no early `complete`: reaching the session budget is not winning the game.

