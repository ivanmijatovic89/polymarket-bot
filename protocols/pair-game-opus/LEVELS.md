# Levels — Pair Game Opus

The game has 300 ordered levels.

The quantity ladder is:

1. 10 matched shares per market
2. 50 matched shares per market
3. 200 matched shares per market
4. 1,000 matched shares per market
5. 3,000 matched shares per market

For market count `N`, play those five quantities in order on the first `N`
eligible markets. Then add one market and repeat the quantity ladder.

Therefore:

| Level | Markets | Matched shares required in every market |
|---:|---:|---:|
| 1 | 1 | 10 |
| 2 | 1 | 50 |
| 3 | 1 | 200 |
| 4 | 1 | 1,000 |
| 5 | 1 | 3,000 |
| 6 | 2 | 10 |
| 7 | 2 | 50 |
| 8 | 2 | 200 |
| 9 | 2 | 1,000 |
| 10 | 2 | 3,000 |
| 11 | 3 | 10 |
| 12 | 3 | 50 |
| 13 | 3 | 200 |
| 14 | 3 | 1,000 |
| 15 | 3 | 3,000 |
| ... | ... | ... |
| 296 | 60 | 10 |
| 297 | 60 | 50 |
| 298 | 60 | 200 |
| 299 | 60 | 1,000 |
| 300 | 60 | 3,000 |

For any level `L`:

- `markets = floor((L - 1) / 5) + 1`
- `quantity = [10, 50, 200, 1000, 3000][(L - 1) mod 5]`

No level may be skipped. Promotion happens only after persisted evidence shows
that the current level and all earlier regression gates pass under `RULES.md`.

