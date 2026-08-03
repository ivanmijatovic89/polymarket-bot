# Levels — Pair Game Opus

The task never changes: build at least 1,000 matched shares in every included
market under `RULES.md`.

Every new level adds exactly one market:

| Level | Markets that must all pass |
|---:|---:|
| 1 | first 1 eligible market |
| 2 | first 2 eligible markets |
| 3 | first 3 eligible markets |
| 4 | first 4 eligible markets |
| ... | ... |
| N | first N eligible markets |

There is no fixed final level. The Global Runtime session budget limits how
long the player may continue, not how many levels exist.

No level may be skipped. Promotion happens only after one unchanged strategy
and parameter configuration passes every market in the current level with
persisted evidence.
