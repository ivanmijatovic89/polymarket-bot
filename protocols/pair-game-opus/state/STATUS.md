# Status — Pair Game Opus

- Highest passed level: **18** (first 18 eligible markets, runs **2713**, **2764**
  and **2863**)
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

Runs 2696–2713 predate two behaviour-neutral commits (the disabled `reserveAsk`
knob, then this session's disabled knobs). Re-verified on the current file:
level 18 PASS at **2764** and **2863**, level 14 PASS at **2866**, level 7 PASS
at **2865**. Level 19 on defaults is **2864**: 18 of 19, failing only
`btc-updown-15m-1775104200` at 1000/687.5 and a pair cost of 1.0662 — identical
to the pre-session baseline, so every knob added this session is inert at its
shipped value.

Stability on the shipped defaults: levels 1–9 and 11–14 5 of 5 each, levels
15–18 5 of 5 each, level 7 also 25 of 25 earlier.

## How the player works now

1. **The remaining-budget line is the whole ceiling guarantee.** Both legs
   finish at exactly `qty`, so pair cost = total spend ÷ `qty`.
2. **`avgGuard` off** — the realized-average guard reads a leg holding a fifth
   of its target at 0.59 as a "0.59 leg" and locks the other leg out exactly
   when the player needs to recover from a bad opening read. Redundant given 1.
3. **`openMs` 5000 / `openShare` 0.2** — before 5 s no leg may hold more than a
   fifth of its target.
4. **`edgeFull` 0.32** — a leg may hold `|askUp − askDown| / edgeFull` of its
   target while both legs are short.
5. **`underdogMax` 0.10** — the non-priority leg may never bid above 0.10.
6. **Momentum priority**, **unthrottled crossing** (`takeFloor` 1), **ack-gated
   cancels** (P-002), **conviction override** (`convEdge` 0.12 / `convFull` 0.20
   / `convUntil` 0.06) — unchanged from earlier sessions.

Measured and shipped disabled, with the numbers next to each in the file:
`chasePad` (+ `chaseAfterMs`, `chaseUntil`, `chaseLookbackMs`), `pairEdge`,
`underdogLift`, `reserveAsk`, `priorityLatch`, `momDeadband`, `maxImbalance`,
`fillPace`, `leadPad`, `underdogRamp`, `underdogDiscount`, `warmupMs`,
`soloShare` below 0.8.

## Level 19 — the blocker, and what it costs to attack it

Level 19 fails on `btc-updown-15m-1775104200`, ending 1000/687 at a pair cost of
1.07. The window oscillates between roughly 0.46 and 0.65 for six minutes with
no direction, the player chases UP the whole time, completes it at an average
near 0.60 around t+220 s having spent 929 of its 970 budget, and only then does
DOWN run away for good. UP — the leg it completed — expires worthless at 0.11.
Its oracle floor is about 0.44, so it is easily winnable by whoever refuses to
chase.

**The one structural finding of this session.** Every mechanism that makes this
market cheaper does so by refusing purchases, and refusing purchases costs share
completion somewhere else. The refused markets consistently finish at pair costs
of 0.65–0.90 — far inside the ceiling — on a leg that reached only 200 of 1,000.
The reason is not tuning: the leg any such rule refuses is the one whose ask is
rising, which in a market that genuinely trends is the WINNER, and the winner is
only ever cheap early. So a refusal rule systematically pushes the budget into
the falling leg — the loser — and the player ends holding all of the wrong
outcome at an excellent price. A leg bought back above its own low looks
identical in a trend and in a whipsaw.

Measured and rejected on level 19 (this session, single-market loop ~3.5 s, full
level ~35 s):

- `chasePad` — cap the priority leg at its own running low plus a pad. Wins the
  blocking market outright on its own (0.03/0.05/0.08 all finish 1000/1000 at
  0.79–0.90) and loses the level at every gating: ungated 8–13 of 19; gated on
  the other leg's realized average 9–10; gated on elapsed time 11–18; measured
  over a trailing window 7–15; released late 10–16. Best point found: pad 0.05
  released at four tenths of the window — wins market 19, loses three others.
- `pairEdge` — pace the two legs against one shared `edgeFull` allowance.
  Neutral: 18 of 19 at `edgeFull` 0.24/0.32/0.40, and it does stop the opening
  double purchase, but after the allowance lapses the player buys the same leg
  at the same price and ends 1000/144. **Free to keep on** — the only change
  measured that costs nothing.
- `underdogLift` — hand the underdog's price cap back as the priority leg fills,
  resolving the contradiction between the budget's reserve and `underdogMax`.
  Inert alone (18 of 19, market unchanged); with `reserveAsk` 0.7/1.0, worse
  (14–17 of 19).
- `underdogEdge` (underdog paced more tightly than the leader) — no effect at
  all, 0.1 through 0.75. Removed.
- `chaseGate` (chase cap gated on the other leg's average) — no separating
  power, identical results at 0.10/0.20/0.30. Removed.
- Re-measured and still rejected: `reserveAsk` 0.4/0.7/1.0 (17/17/14 of 19),
  `maxImbalance` 300/500 (7/12 of 19).

Also still on the rejected list from earlier sessions: `fillPace` 0.5,
`edgeFull` 0.40, `priorityLatch`, `momDeadband` 0.02/0.05, `soloShare`
0.5/0.6/0.7, `underdogMax` below 0.10.

## Next action

Stop looking for a rule that refuses a purchase; the finding above says that
family cannot work. The remaining untried direction is information the player
does not currently use at all: RULES permit price-to-beat, the Binance price and
the Chainlink price, and the player reads none of them. In this market the book
spent six minutes undecided, but BTC's distance from the price to beat, measured
against how much time is left, is an independent read on which outcome is
actually likely — and it is exactly the read the order book was failing to
provide. Build that as a priority signal (not a new cap), sweep it on level 19,
then regress 1–18. Sample any candidate at least 5 times per level before
promoting it.

Second option if that fails: turn `pairEdge` on (free) and find a rule that
governs what happens after its allowance lapses.

## Needs human

Nothing.
