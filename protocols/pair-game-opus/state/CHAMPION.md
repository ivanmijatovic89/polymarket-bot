# Champion — Pair Game Opus

**Player:** `pair-game-opus-pair.v1` (`protocols/pair-game-opus/strategies/pair.v1.ts`)

**Highest level passed:** 4 (1 market, 1,000 matched shares)

**Configuration that passed levels 1–4** (only `qty` changes per level; it is
injected by `play-level.ts` from the level itself):

```
pairCeil=0.97  stopPostingAt=0.95  minPrice=0.02  maxPrice=0.97  debug=0
```

**Evidence** (persisted runs, latency pinned 140/20 ms, protocol `pair-game-opus`):

| level | markets | qty | run | pair cost | pnl |
|---:|---:|---:|---:|---:|---:|
| 1 | 1 | 10 | 1072 | 0.9700 | 0.30 |
| 2 | 1 | 50 | 1073 | 0.9700 | 1.50 |
| 3 | 1 | 200 | 1074 | 0.9700 | 6.00 |
| 4 | 1 | 1,000 | 1075 | 0.9700 | 30.00 |

All fills are maker fills; zero taker trades, zero fees.

Re-score any of these at any time with:

```
tsx protocols/pair-game-opus/tools/level.ts --level <L> --run <id>
```
