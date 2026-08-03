# Champion — Pair Game Opus

**`pair-game-opus-pair.v1`, all defaults.** Highest level passed: **36** —
persisted run **3022**, thirty-six markets, every one ending exactly 1,000 UP
and 1,000 DOWN inside the 0.98 pair ceiling and profitable.

Levels 1–35 confirmed under the same code and the same defaults at runs
2965–3021 (full table in `state/STATUS.md`).

Reproduce:

```
tsx protocols/pair-game-opus/tools/play-level.ts --level 36
```

Recorded config (run 3022 — pure defaults, only `qty` injected by the level):

```
qty=1000 clip=200 pairCeil=0.97 priority=momentum takeMode=1 takePace=0.05
takeFloor=1 warmupMs=0 openMs=5000 openShare=0.2 edgeFull=0.32 avgGuard=0
underdogMax=0.1 soloShare=0.8 leadReserve=0.9 reserveAsk=0 maxImbalance=1000000
momentumTauMs=30000 momDeadband=0 convEdge=0.12 convFull=0.2 convUntil=0.06
convShare=0.9 convReserve=0.25 convTakePace=0.05 postSecondLeg=1
priorityLatch=0 fillPace=0 leadPad=0 underdogRamp=0 underdogDiscount=0
stopPostingAt=0.95 minPrice=0.02 maxPrice=0.97
ptbMode=1 ptbSrc=blend ptbFair=1 ptbSigma=110 ptbFairEdge=0.07
ptbFairTauMs=30000 ptbFairAfterMs=45000 ptbFairBookMax=1 ptbFairModelMin=0
ptbPace=0 ptbPriority=0 ptbEdge=60 ptbTauMs=0
```

The step from level 18 to level 36 was a single change: the player now compares
the probability implied by BTC's distance from the price to beat with the
probability quoted by the order book, and chases the leg the book is not paying
up for whenever the two disagree persistently after the first 45 seconds.

Earlier champions: level 18 at run 2713, level 6 at run 2085, level 4 at run
1167. Runs 1072–1075 passed the retired quantity ladder with single BUY orders
above the current 200-share maximum and are historical evidence only.
