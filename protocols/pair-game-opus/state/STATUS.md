# Status — Pair Game Opus

- Current level: **5** (1 market, 3,000 matched shares) — **BLOCKED**
- Highest passed level: **4**
- Pair-cost ceiling: **0.98 fee-inclusive**
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`)
- Config: `pairCeil=0.97 stopPostingAt=0.95 minPrice=0.02 maxPrice=0.97 debug=0`
  (`qty` is injected from the level)
- Last processed inbox entry: **none** (INBOX.md has no entries)

## Completed

- Levels 1–4 passed on `btc-updown-15m-1775088000` with runs 1072 / 1073 / 1074 /
  1075, pair cost 0.9700 in every case, all-maker, zero fees. See
  `state/CHAMPION.md`.
- Built the level machinery: `tools/levels.ts` (ladder + fixed universe),
  `tools/level.ts` (the evaluator — the only thing that may declare a level
  passed), `tools/play-level.ts` (run + score in one command),
  `tools/universe.ts`, `tools/repro-risk-cap.ts`.

## Blocker

**Level 5 cannot be attempted.** The shared risk gate
(`src/trading/riskLimits.ts`) hardcodes `maxOrderSize: 2000` and
`maxAbsPosition: 2000` with no configuration seam, so no legal sequence of
player actions can end a market holding 3,000 shares of an outcome. Levels 5,
10, 15, … 300 all sit on the 3,000 rung and are equally blocked. Full
reproduction and the two possible fixes are in `state/PROPOSALS.md` (P-001).
Shared `src/` is read-only for this protocol, and no level may be skipped, so
there is no legal move left.

## Needs human

1. **Decide P-001.** Either raise `maxOrderSize` / `maxAbsPosition` in
   `src/trading/riskLimits.ts` to at least 3,000, or add an optional `limits`
   option to `OrderManager` that the backtest CLI can pass. Both are
   shared-`src/` changes (a normal PR) that this protocol may not make. Note the
   scale implication: a 3,000-share pair is ~$2,900 of working capital per
   market, live as well as in backtest.
2. If the answer is "the ladder should not reach 3,000", that is a change to
   `LEVELS.md`, which this protocol also may not edit.

## Next step

Once P-001 is resolved, re-run Level 5 with
`tsx protocols/pair-game-opus/tools/play-level.ts --level 5`, then continue up
the ladder. Level 6 onward (2+ markets) is where the real difficulty starts: the
player has only ever been tested on one market, and its single lever for a hard
market is the budget split between the two legs.
