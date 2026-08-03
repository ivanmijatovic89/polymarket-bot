# Champion — Pair Game Opus

**`pair-game-opus-pair.v1`, all defaults.** Highest level passed: **4** —
persisted run **1167**, four markets, each ending exactly 1,000 UP and 1,000
DOWN at a pair cost between 0.9355 and 0.9608 against the 0.98 ceiling, every
market profitable.

Levels 1–3 re-confirmed under the same code at runs 1168, 1169 and 1170.

Reproduce:

```
tsx protocols/pair-game-opus/tools/play-level.ts --level 4
```

Recorded config (run 1167):

```
qty=1000 clip=200 pairCeil=0.97 priority=momentum takeMode=1 takePace=0.25
warmupMs=0 soloShare=0.8 leadReserve=0.9 maxImbalance=1000000
momentumTauMs=30000 postSecondLeg=1 stopPostingAt=0.95 minPrice=0.02
maxPrice=0.97
```

Earlier runs 1072–1075 passed the retired quantity ladder with single BUY
orders above the current 200-share maximum and are historical evidence only.
