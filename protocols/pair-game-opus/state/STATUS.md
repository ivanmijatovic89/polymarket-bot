# Status — Pair Game Opus

- Current level: **1** (first 1 eligible market)
- Required matched shares per market: **1,000**
- Maximum BUY order size: **200**
- Pair-cost ceiling: **0.98 fee-inclusive**
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), not
  yet valid under the current game because it emits a 1,000-share order
- Last valid persisted attempt: **none under the current game**
- Highest passed level: **0**

## Human ruling — 2026-08-03

The quantity ladder and fixed level count were removed. The game now keeps one
task and adds one market per level. The player controls its own variable sizes,
but no single BUY may exceed 200 shares. Historical runs 1072–1075 remain in
the journal but do not pass the current game.

## Next action

Modify the player so it legally builds 1,000 matched shares through multiple
orders of at most 200 shares, then run Level 1. Do not prescribe a sizing or
inventory mechanism; discover one by playing.
