# Status — Pair Game Opus

- Highest passed level: **18** (first 18 eligible markets, runs **2713** and
  **2764**)
- Current level: **19** (first 19 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: (no entries)

## Evidence

| Level | Run | Level | Run |
|---:|---:|---:|---:|
| 1 | 2696 | 10 | 2705 |
| 2 | 2697 | 11 | 2706 |
| 3 | 2698 | 12 | 2707 |
| 4 | 2699 | 13 | 2708 |
| 5 | 2700 | 14 | 2709 |
| 6 | 2701 | 15 | 2710 |
| 7 | 2702 | 16 | 2711 |
| 8 | 2703 | 17 | 2712 |
| 9 | 2704 | 18 | 2713 |

All eighteen gate runs PASS on **pure defaults** (only the level's injected
`qty`), every market ending exactly 1000/1000.

Runs 2696–2713 predate one behaviour-neutral commit that added the disabled
`reserveAsk` knob (default 0 reproduces the previous expression exactly). Level
18 was re-run afterwards at **2764** (18/18), and levels 7, 14 and 18 sample 4
of 4 on the current file.

Stability on the shipped defaults: levels 1–9 and 11–14 5 of 5 each, levels
15–18 5 of 5 each, level 7 also 25 of 25 earlier in the session.

## How the player works now

1. **The remaining-budget line is the whole ceiling guarantee.** Both legs
   finish at exactly `qty`, so pair cost = total spend ÷ `qty`.
2. **`avgGuard` off** — the realized-average guard reads a leg holding a fifth
   of its target at 0.59 as a "0.59 leg" and locks the other leg out exactly
   when the player needs to recover from a bad opening read. Redundant given 1.
3. **`openMs` 5000 / `openShare` 0.2** — before 5 s no leg may hold more than a
   fifth of its target.
4. **`edgeFull` 0.32** — a leg may hold `|askUp − askDown| / edgeFull` of its
   target while both legs are short: a fifth of it while the book is a coin
   flip, all of it once the market has decided.
5. **`underdogMax` 0.10** — the non-priority leg may never bid above 0.10.
6. **Momentum priority**, **unthrottled crossing** (`takeFloor` 1), **ack-gated
   cancels** (P-002), **conviction override** (`convEdge` 0.12 / `convFull` 0.20
   / `convUntil` 0.06) — unchanged from earlier sessions.

Measured and shipped disabled, with the numbers recorded next to each in the
file: `reserveAsk`, `priorityLatch`, `momDeadband`, `maxImbalance`, `fillPace`,
`leadPad`, `underdogRamp`, `underdogDiscount`, `warmupMs`, `soloShare` below
0.8.

## What was learned this session

- **Which leg wins is irrelevant.** A matched pair pays exactly 1.00, so the
  only question is whether each leg can be bought cheaply at *some* instant.
  Since `askUp + askDown ≈ 1.01` at every instant, the margin on a pair equals
  how far the first leg's price rises between the two purchase moments.
- **Two markets can share an opening book and punish opposite guesses.** Level
  7's market opens UP 0.58 / DOWN 0.44 and rewards buying DOWN; level 12's opens
  UP 0.57 / DOWN 0.45 and rewards buying UP. Nothing in the book at tick zero
  separates them, so the answer is not a better guess but a smaller one — hence
  the opening cap and the edge-driven pace.
- **Plateaus measured** (all on the level that introduced the knob): `openMs`
  1000–10000 pass, 12000 fails; `openShare` 0.1–0.6 pass; `edgeFull` 0.25–0.40
  pass, 0.20 and 0.45 fail; `underdogMax` 0.03–0.15 pass, 0.17 fails.
- **Whipsaw is the remaining structural weakness.** When the two asks cross
  repeatedly the priority role changes hands and both legs get bought near 0.5.
  Lowering `underdogMax` bought back level 14; level 19 is the same shape and
  worse.

## Level 19 — scouted, diagnosed, not yet solved

Level 19 fails on `btc-updown-15m-1775104200`, ending 1000/687 at a pair cost of
1.07. The window oscillates between roughly 0.46 and 0.65 for six minutes with
no clear direction, the player chases UP the whole time, completes it at an
average near 0.60 around t+220 s having spent 929 of its 970 budget, and only
then does DOWN run away for good. The 312 missing DOWN shares would need to cost
0.04 each; DOWN never trades below 0.36.

Its oracle floor is about 0.36 (DOWN at 0.36 mid-window, UP at 0.002 at the
close), so it is easily winnable — by whoever refuses to chase.

Measured and rejected on it: `reserveAsk` 0.2/0.4/0.6/1.0, `maxImbalance`
300/600, `fillPace` 0.5, `edgeFull` 0.40, `priorityLatch`, `momDeadband`
0.02/0.05, `soloShare` 0.5/0.6/0.7, `underdogMax` below 0.10.

The idea not yet tried: the player has no notion of a leg's own price
**history**. Every rule it has is instantaneous. In this market UP traded at
0.46 and the player kept paying 0.60 for it; a rule that refuses to chase a leg
far above its own running low would decline exactly these fills while leaving a
monotone trend untouched (in a trend the running low IS the current price). That
is the next thing to build and measure.

## Next action

Give the player a per-leg running-low memory and cap how far above it the
priority leg may pay. Sweep that cap on level 19, then regress levels 1–18.
Sample any candidate at least 5 times per level before promoting it.

## Needs human

Nothing.
