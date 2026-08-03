# Champion — Pair Game Opus

**`pair-game-opus-pair.v1`, all defaults.** Highest level passed: **18** —
persisted run **2713**, eighteen markets, every one ending exactly 1,000 UP and
1,000 DOWN inside the 0.98 pair ceiling and profitable. Re-confirmed at run
**2764** after a behaviour-neutral refactor.

Levels 1–17 re-confirmed under the same code at runs 2696–2712.

Reproduce:

```
tsx protocols/pair-game-opus/tools/play-level.ts --level 18
```

Recorded config (run 2713 — pure defaults, only `qty` injected by the level):

```
qty=1000 clip=200 pairCeil=0.97 priority=momentum takeMode=1 takePace=0.05
takeFloor=1 warmupMs=0 openMs=5000 openShare=0.2 edgeFull=0.32 avgGuard=0
underdogMax=0.1 soloShare=0.8 leadReserve=0.9 reserveAsk=0 maxImbalance=1000000
momentumTauMs=30000 momDeadband=0 convEdge=0.12 convFull=0.2 convUntil=0.06
convShare=0.9 convReserve=0.25 convTakePace=0.05 postSecondLeg=1
priorityLatch=0 fillPace=0 leadPad=0 underdogRamp=0 underdogDiscount=0
stopPostingAt=0.95 minPrice=0.02 maxPrice=0.97
```

Earlier champions: level 6 at run 2085, level 4 at run 1167. Runs 1072–1075
passed the retired quantity ladder with single BUY orders above the current
200-share maximum and are historical evidence only.
