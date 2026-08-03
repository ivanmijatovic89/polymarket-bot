# Status — Pair Game Opus

- Highest passed level: **36** (first 36 eligible markets, run **3022**)
- Current level: **37** (first 37 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: (no entries)

## Evidence — every level on the shipped defaults

| Level | Run | Level | Run | Level | Run | Level | Run |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 2966 | 10 | 2978 | 19 | 2965 | 28 | 3006 |
| 2 | 2967 | 11 | 2979 | 20 | 2984 | 29 | 3007 |
| 3 | 2968 | 12 | 2980 | 21 | 2988 | 30 | 3008 |
| 4 | 2969 | 13 | 2981 | 22 | 2989 | 31 | 3009 |
| 5 | 2970 | 14 | 2982 | 23 | 2993 | 32 | 3010 |
| 6 | 2971 | 15 | 2983 | 24 | 2994 | 33 | 3019 |
| 7 | 2974 | 16 | 2985 | 25 | 2995 | 34 | 3020 |
| 8 | 2976 | 17 | 2986 | 26 | 3004 | 35 | 3021 |
| 9 | 2977 | 18 | 2987 | 27 | 3005 | 36 | 3022 |

Every one of these runs is on pure defaults (only the level's injected `qty`),
every market ending exactly 1000/1000. Level 19 also passed at **2964** with the
same values passed explicitly before they were promoted to defaults. Pair costs
across level 36 run 0.89–0.97 against a ceiling of 0.98.

## How the player works now

1. **The remaining-budget line is the whole ceiling guarantee.** Both legs
   finish at exactly `qty`, so pair cost = total spend ÷ `qty`.
2. **`ptbFair` — the outside price fades the book.** BTC's distance from the
   price to beat becomes a probability (`Φ(diff / (ptbSigma·√timeLeft))`,
   `ptbSigma` 110) and is compared with the book's own `askUp/(askUp+askDown)`.
   When the two disagree by more than `ptbFairEdge` 0.07, smoothed over
   `ptbFairTauMs` 30 s, the priority leg becomes the one the book is NOT paying
   up for. The override stands down for the first `ptbFairAfterMs` 45 s so the
   book's opening lean is never faded.
3. **`openMs` 5000 / `openShare` 0.2** — before 5 s no leg may hold more than a
   fifth of its target.
4. **`edgeFull` 0.32** — a leg may hold `|askUp − askDown| / edgeFull` of its
   target while both legs are short.
5. **`underdogMax` 0.10** — the non-priority leg may never bid above 0.10.
6. **Momentum priority**, **unthrottled crossing** (`takeFloor` 1), **ack-gated
   cancels** (P-002), **conviction override** (`convEdge` 0.12 / `convFull` 0.20
   / `convUntil` 0.06), **`avgGuard` off** — unchanged from earlier sessions.

The feed request (price to beat + Binance spot + Chainlink) is registered only
when `ptbMode=1`; at `ptbMode=0` the player has no dataset dependency at all.

Measured and shipped disabled, with the numbers next to each in the file:
`ptbPace` (+ `ptbEdge`, `ptbTauMs`), `ptbPriority`, `ptbFairBookMax`,
`ptbFairModelMin`, `chasePad` (+ `chaseAfterMs`, `chaseUntil`,
`chaseLookbackMs`), `pairEdge`, `underdogLift`, `reserveAsk`, `priorityLatch`,
`momDeadband`, `maxImbalance`, `fillPace`, `leadPad`, `underdogRamp`,
`underdogDiscount`, `warmupMs`, `soloShare` below 0.8.

## What the outside price bought, and what it cost to find

The level-19 blocker was a window whose two asks crossed around 0.50 for six
minutes; the player chased UP the whole way, completed it near 0.60, and UP
expired at 0.11. Everything measured before this session refused purchases, and
refusals systematically buy the loser (see the `chasePad` note in the strategy
file). The outside price is a different kind of input, and only one of the three
ways of using it works:

- **Raw distance as a pace** (`ptbPace`): rejected. It has a single scalar to
  trade off and the boundary is sharp — ≥ $60 is needed to hold the whipsaw
  back, ≤ $55 to let two genuinely trending markets through. 17 of 19 at best.
- **Raw distance as priority** (`ptbPriority`): inert. By the time distance is
  decisive the book has already priced it.
- **Disagreement as priority** (`ptbFair`): this is the one. 19 of 19, and it
  carried levels 20–25 without a single further change.

Two guards on the disagreement turned out to be false friends and one was
essential. Limiting it to a near-even book (`ptbFairBookMax` 0.05/0.08) and
requiring the model itself to have moved (`ptbFairModelMin` 0.03/0.06) each fix
the trending markets and each break the whipsaw, because the whipsaw's decisive
disagreements are exactly the ones where the model contributes nothing. What
separates the two cases is the clock: a book that leans in its first 45 seconds
is carrying information from before the window, and BTC — which starts every
window exactly on its own strike — cannot yet contradict it. At
`ptbFairAfterMs` 0 the level is 17 of 19 (two markets end 1000/200 and 200/1000);
at 20 s, 18 of 19; at 45 s, 19 of 19.

Also measured: `ptbSrc=binance` (drop the Chainlink basis correction and compare
the raw Binance tape with the strike) fails one market of level 22, so the basis
correction is load-bearing, not decoration. `blend` ships.

## Level 37 — the new blocker, already diagnosed

Level 37 fails on `btc-updown-15m-1775120400` (1000/375, pair cost 1.135). The
window opens at 0.60/0.41, conviction fires at 0.87, and the player owns the
whole UP leg inside 45 seconds at an average near 0.65 — 846 of its 970 budget.
The market then reverses for good and DOWN settles at 0.99. DOWN is never bought
because the remaining budget allows only 0.19 a share and DOWN's cheapest ask
was 0.28, at t+23 s. The oracle floor is 0.30, so the market is comfortably
winnable by anyone holding a little back.

The relevant tension is explicit: `ptbFairAfterMs` 45 s is what makes the
disagreement rule safe on levels 19–36, and it is exactly the window in which
conviction can complete an entire leg. Shortening the stand-down was measured
and regresses two markets, so the direction to try is the other side of it —
bound how much conviction may commit BEFORE the outside price has had its say.
The price to beat arrives about 3 s into the window, so there is a real signal
available long before 45 s; it is only the OVERRIDE that has to wait. A cap on
holdings until the stand-down expires (the `openMs`/`openShare` idea, extended
to 45 s at a larger share) is the cheapest thing to measure first, and the
single-market probe loop makes it about 12 s a try.

Note the failure shape when reading results: a share-count failure means the
player refused or could not afford a leg; a pair-cost failure means it bought
both legs near 0.50. They have opposite cures. Markets 38 and 40 also fail on
their own (750/1000 and 469/1000), so levels 38 and 40 will need work after 37.

## Next action

Attack level 37 as above, then continue the ladder. Single markets probe in
about 12 s; a full level of 37 markets takes about 8 minutes, and several levels
can run in parallel on this machine.

## Needs human

Nothing.
