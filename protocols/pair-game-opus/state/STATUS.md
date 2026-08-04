# Status — Pair Game Opus

- Highest passed level: **114** (first 114 eligible markets)
- Current level: **115** (first 115 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: `2026-08-03T11:37:27.659Z-35d1de5f`

**Next step: market 115 (`…1775190600`) is a wall, and every named lever is
already measured dead.** It ends 200 UP / 1000 DOWN for 718 with UP the winner.
Everything that matters happens in 53 seconds:

- t+8: 200/200 for 208, both asks at 0.50.
- t+24: askUp 0.41, askDown 0.60. 394 DOWN bought at 0.616 average.
- t+53: 1000 DOWN, 718 spent, UP still at 200. DOWN's last 344 cost 0.665 each.
- The window then reverses for good — UP is 0.32–0.43 from t+24 to t+130 and
  0.70 by t+158 — and 800 UP against 252 of remaining budget needs 0.315 a
  share, which UP never trades at again. **115 is won before t+53 or not at
  all.**

The counterfactual that wins it is visible at t+49 (200/656, spent 490, askUp
0.41, askDown 0.60): stop DOWN at 656, buy 800 UP at 0.38–0.41 for ~304, sweep
DOWN at the death — askDown is 0.10 in the last minute — for about 34. That
totals 827. It is exactly the solvency swap, and **all three of the gates that
make the swap safe refuse it**: `solvHeld` (200 UP against 656 DOWN),
`solvZ` (the oracle says DOWN, at 0.34–0.56 bands, and it is wrong), and
nothing else is available. Each of those gates is carrying markets of its own.

What binds DOWN's price is now measured rather than guessed (`debug=3`): its cap
is `(budgetLeft − needUp × reserve) / needDown` with `reserve = 0.6 × UP's own
low` — 0.658 at t+21, 0.838 at t+49. Capping DOWN near 0.55 would need
`reserveLow` around 0.85, and `reserveLow` 0.7/0.8/0.9/1.0 were measured at
3/9/9/11 failures on the level-68 window against a baseline of 1.

Measured on market 115 and moving it by **not one share**: `convUntil` 0.02 /
0.04, `convReserve` 0.4 / 0.6. The conviction mix is not what funds the
overspend — `conv` is 0 here, because the book's edge never reaches `convEdge`
before the money is gone.

## What passed 113 — a projection is an estimate, not a verdict

`solvUnderPad=0.035`, `solvCheap=1`, `solvCheapPad=0.03` (all new).

`solvUnder` required the receiving assignment to project INSIDE `qty ×
pairCeil`. It reads that projection as a verdict, and it is not one: the plan
funds the leg it is NOT chasing at the cheapest price that leg has yet shown,
which deliberately over-estimates what the leg the window is abandoning costs at
the death. Market 113's repair projects 1,004 against a ceiling of 970 and then
completes for 963.

- **`solvUnderPad`** — how far outside the ceiling the receiving plan may still
  project. Alone it repairs 113 and 114 and costs three markets below them
  (`…1775089800`, `…1775129400`, `…1775147400`), because it reopens exactly the
  comparison the old rejection note convicted: two overrunning plans separated
  by a couple of cents of trailing-low noise.
- **`solvCheap`** — settle that comparison with a reading that is not stale. The
  swap may only hand the chase to the leg quoted CHEAPER right now. At the
  moment of decision every casualty hands it to the DEARER leg; the repair hands
  it to the leg quoted four cents under the one it abandons.
- **`solvCheapPad`** — one tick is not enough. The last casualty is blocked one
  cent DEARER and fires a second later one cent CHEAPER on the same book. Three
  cents is still that noise; the repair is four cents clear.

| Configuration (first 115) | Failures |
|---|---|
| baseline (level 112 defaults) | 3 — markets 113, 114, 115 |
| `solvUnder=0` | 4 — 3, 33, 51 and 115 |
| `solvUnderPad` 0.035 / 0.06 | 4 / 4 — same three casualties |
| `+ solvEdge=0.03` | 3 |
| `+ solvCheap=1` (no edge) | 2 — market 3 and 115 |
| `+ solvCheap=1 + solvEdge=0.03` | 4 |
| **`+ solvCheap=1 + solvCheapPad=0.03`** | **1, 2, 1** (three draws) — 115, and 114 once |

The moment of decision, which is the only place these separate:

```
3    t+69s UP→DOWN  askUp 0.520 askDown 0.490  held 219/344  projTo 973  z=0.30
33   t+82s DOWN→UP  askUp 0.540 askDown 0.480  held 656/281  projTo 997  z=0.24
51   t+72s UP→DOWN  askUp 0.480 askDown 0.530  held 200/469  projTo 992  z=0.15
113  t+64s UP→DOWN  askUp 0.530 askDown 0.490  held 313/438  projTo 1004 z=0.27
```

Market 51 receives the DEARER leg; markets 3 and 33 receive a leg cheaper by
exactly three cents, after being dearer a second earlier; market 113 receives a
leg cheaper by four. `projTo` orders them backwards — the repair is the FURTHEST
outside the ceiling — which is why no pad alone can cut this and why the cut has
to be made on the live quotes.

The cheapness test compares the GAP against `solvCheapPad + 0.005` rather than
`askFrom − solvCheapPad`: neither side of that subtraction is exactly
representable and the identical three-cent gap comes out allowed at one price
level and refused at another.

## What passed 114 — a waiting order at the ask does not trade

`takeStale=1`, `takeSmall=0.25` (both new).

Market 114 was a latency coin flip and the whole difference between the draws is
one standoff. At t+135 the losing draw holds 1000 UP / 375 DOWN, has 168 dollars
left, and DOWN is offered at 0.26 — 625 shares would cost 171 against a finish
budget of 173. It buys none of them. Its bid is already resting at 0.26 from
when the ask was 0.28, and a resting bid fills only when the book goes THROUGH
it, while the same price sent fresh walks the asks on arrival. The target price
has not moved, so the player never re-posts.

- **`takeStale`** — re-post at an unchanged price when this tick has decided to
  cross and the live order was sent to wait. One-way: an order that crosses and
  does not fill is never re-sent for this reason again.
- **`takeSmall`** — re-post a CROSSING clip left as dust. A marketable clip
  landing on a level thinner than itself takes what is there and leaves its
  remainder resting, the wrong size and unable to fill, while the level it
  wanted is still quoted. In market 114 that remainder is 34 shares and it
  blocks the other 259.

`takeSmall` is narrow in two ways, and both were paid for. Applied to every
undersized order it costs `…1775110500` on three separate draws: a partially
filled PASSIVE quote is a queue position that has already proved itself, and
re-sending it throws that away and pays the taker fee for the privilege. So it
applies only to orders that were themselves crosses — and even then only to
remainders under a QUARTER of a clip; at half a clip it costs `…1775122200`.

| Configuration (first 115) | Failures |
|---|---|
| `takeStale=1` | 1 — market 115 only |
| `takeSmall=1`, any order | 2 — `…1775110500` and 115 |
| both, `takeSmall` on crossed orders only | 4 / 2 (two draws) |
| **`takeStale=1` + `takeSmall=0.25`** | **1, 1, 1** (three draws) — market 115 |

Market 114 alone, seeds 1–8: 7/8 before, **8/8** after.

## What passed 109–112 — the solvency swap, gated on the oracle

The blocker of the last five sessions is repaired and the first 110 markets now
sweep **0 failures on three independent draws**.

`solvSwap=1`, `solvUnder=1`, `solvHeld=1`, `solvZ=0.12`, `solvZLatch=1` (the
last four are new; `solvAfterMs` stays at its shipped 60 s and `solvHeldPad`
stays at 0).

`solvSwap` is the rule that says: when the assignment the book prefers — finish
the leg it names at today's ask, fund the other at the cheapest it has shown —
cannot come in under `qty × pairCeil`, and the OPPOSITE assignment can, chase
the other leg. It had been measured and rejected twice, and its own rejection
note contains the repair. The note is right that the overrun is uninformative:
two asks on one market sum to about one all window, so nearly every assignment
overruns from the first minute, and the DIFFERENCE between two overrunning plans
is a couple of cents of trailing-low noise. What does not follow is that the
arithmetic is worthless. **An alternative that comes in UNDER the ceiling is not
noise, and neither is the direction the swap points.**

Each gate, measured over the first 110 (baseline before this change: 1 failure):

| Configuration | Failures | 109 |
|---|---|---|
| `solvSwap` bare | 19 | repaired |
| `+ solvEdge=0.05` | 14 | repaired |
| `+ solvUnder` | 16 | repaired |
| `+ solvHeld` | 9 | 592/1000 |
| `+ solvUnder + solvHeld` | **5** | repaired |
| the same `+ solvEdge=0.05` | 5 | repaired |
| the same `+ solvAfterMs=90 s` | 2 | repaired |
| the same `+ solvHeldPad=0.1` | 1 (market 67) | repaired |
| **`+ solvUnder + solvHeld + solvZ=0.12 + solvZLatch`** | **0** (×3 draws) | repaired |

- **`solvUnder`** — the receiving assignment must project inside the ceiling,
  not merely less far outside it. This is the direct answer to the objection
  that killed the rule twice.
- **`solvHeld`** — the chase may only be handed to the leg the player already
  holds at least as much of. Every casualty of the bare swap ends one leg at
  1,000 and the other stranded between 200 and 600, because a DEMOTED leg
  answers to `underdogMax` and is never quoted at a loser's price while it is
  still contested. Swapping toward the smaller leg abandons the larger position
  outright.
- **`solvZ`** — the volatility-normalised outside price must favour the leg the
  chase is being handed to. The swap overrules the book, so the one thing it
  must not be decided by is the book.
- **`solvZLatch`** — once satisfied for a leg, satisfied for the rest of the
  window. Without it the gate blocks the repair it exists to protect.

**Why the oracle test was the one that separated them.** With the first two
gates the survivors were market 109 (the repair) and market 67 (a casualty), and
at the moment of decision they are near mirror images:

```
67   t+96s  UP→DOWN  askUp 0.530 askDown 0.480  held 219/469  spent 375
            projFrom 1044  projTo 966   z=0.04  pModel 0.486
109  t+114s DOWN→UP  askUp 0.480 askDown 0.530  held 344/200  spent 289
            projFrom 1028  projTo 964   z=0.23  pModel 0.542
```

Same clock, same five-cent lead, same pair of projections either side of the
ceiling, and in both the model happens to agree with the direction of the swap.
The only thing that orders them is HOW MUCH: BTC has moved 0.23 bands toward the
leg 109 buys and 0.04 bands toward the leg 67 buys, and four hundredths of a band
is nothing. `solvZ` between 0.10 and 0.12 carries all 110; 0.15 loses a market.

The latch is not optional and the reason is worth keeping. In market 109 the
model favours UP for **four seconds** around the swap and then sits under 0.5 for
the next three minutes. Read at an instant, the gate lets the swap through once
and then hands the chase straight back to the book, which buys DOWN out anyway —
the identical failure `fairLagLatch` was built for. A reading that licenses a
decision has to be remembered, because the decision is re-taken every tick.

## Evidence

Levels 1–45 at commit `4f21eb1e`, runs 3744–3788 (one run per level, level N =
run 3743+N). Levels 46–51 at `3d8055f9`. Levels 52–59 at `e16f30fe`. Levels
60–66 at `18640212`. Level 67 at `80d695a0`. Levels 68–79 at `71e47612`.
Levels 80–83 at `acf79c2e`. Levels 84–86 at `abe42a69`. Levels 87–94 at
`bd730970` (runs 4688–4695). Levels 95–104 at `5c27b8dc` (runs 4730–4739).
Levels 105–107 at `f52fa712` (runs 4883–4885). Level 108 at `c6669a59`
(runs 4949 and 4950).

Levels **109–112 at `47bbd823`**, all defaults, one `play-level` run each:
**109 → 5293**, **110 → 5294**, **111 → 5296**, **112 → 5297**. Three sweeps of
the first 110 at those defaults returned zero failures, and a 115-market sweep at
the same defaults returned three failures, all of them above level 112.

Level **113 at `cbbc24bd`**, all defaults, one `play-level` run: **113 → 5359**,
113/113 markets passed. Level **114 at `d4dbc21b`**, all defaults, one
`play-level` run: **114 → 5437**, 114/114 markets passed.

## Why market 109 fell to this and not to anything else

Its timeline, which five sessions of caps could not touch:

- t+0–t+113s: quiet, the player holds 344 UP / 200 DOWN for 289 dollars.
- t+114s: askDown 0.48 → 0.61 in two seconds. Genuine — `pModel` follows it.
- t+129s–t+149s: 800 DOWN bought at 0.55, 0.62, 0.61, 0.63 and finally 318
  shares at 0.65, reaching 1,000 for 791.7 total. It buys MORE as the price
  rises, because the edge allowance is `|askUp − askDown| / edgeFull` and that
  gap is widest exactly when the leg is dearest.
- The move then fully reverts; askUp is 0.34–0.49 until t+390 and the player has
  178 dollars for 656 shares of it.

The gap was about seventy dollars, and everything that tried to save it by
capping, delaying or rationing the chase failed. What works instead is the one
move that spends nothing: **at t+114, before any of that money is committed,
notice that the plan the book has just switched to cannot be completed and the
plan it is abandoning can, and refuse the switch.** The player then finishes UP
at 0.40 and sweeps DOWN at the death.

## What is still true about the player

- **The budget arithmetic.** Per-share cost including the 7 bp taker fee is
  `p + 0.07·p·(1−p)`. A pair bought symmetrically at a coin flip costs 1.035; a
  pair completed after the market has decided, winner at 0.95 and loser at 0.03,
  costs 0.985. So there is no safe play: the player must make a directional bet
  before the market has decided and be right. Its real game is name the winner,
  buy it out, sweep the loser for pennies at the death.
- **Any rule that withholds money from a leg does not make it careful — it makes
  some market end short.** The surviving rules all redirect rather than withhold:
  `depthHold` hands the chase over, `edgeMinDep` is a ramp, `closeFinish` only
  ever ADDS budget, and `solvSwap` reassigns the chase without spending a cent.
- **110 of 110 windows complete a leg mid-window, 84 of them before t+120s.**
  Finishing a leg early is the mechanism, not a mistake. Any cap that delays,
  rations or slows the completing purchase — by clock, by money velocity or by
  share of target — blocks that mechanism across the field.
- **Going underwater is normal** (`tools/underwaterScan.ts`), **buying dear while
  unconfirmed is normal** (`tools/buyScan.ts`), and **the volatility-normalised
  oracle is an accurate but LATE witness** (`tools/volScan.ts`) — useless as a
  gate on the chase, right as a release, and now right as a gate on a rule that
  overrules the book.
- **The depth reading needs both a share and a size** (`tools/depScan.ts`).
- **Absolute near depth belongs on the PACE as well as the cap**, proportionally.

## Flakes

Three sweeps of the first 110 at the pre-`47bbd823` defaults once returned 1, 1
and 3 failures; the two extra markets were `…1775110500` and `…1775136600`, both
of which then passed 4 of 4 single-market probes. `…1775178000` (market 101) is a
reproducible coin flip that fails about 2 draws in 24 — with
`tools/lib/seedRandom.mjs`, `PG_SEED=1` and `PG_SEED=11` fail and 22 other seeds
in 1–24 pass. The split is a latency race on ONE resting cross: both draws reach
523/375 at t+25s with a live UP bid at 0.63, one fills 477 shares off that order
and the other fills 53.

`…1775189700` (market 114) WAS the same shape — 1000/375 on one draw and
1000/1000 on the next — and is now 8 seeds in 8. Its flake had a cause rather
than being noise, and finding it took one seeded diff at `debugEveryMs=250`:
two draws that are identical to within twenty dollars for two minutes and then
part company over a single order that was in the right place at the right price
and had been sent to wait instead of to take.

**A level run can fail on a market the sweep has never shown you.** Treat a
single clean sweep as weak evidence; sweeps are unseeded, so two sweeps at the
same settings are two different draws.

## Measured dead — do not re-try

Everything below was measured over the FULL market set, not a single-market
probe. **A single-market probe is not evidence for a global pace or cap change.**

At `47bbd823` (baseline 0 failures over the first 110):

| Change | Failures |
|---|---|
| `finishSolv` 0.8 / 1.0 (solvency test on the `finishShare` exemption) | 7 / 13, and 109 unmoved in both |
| `solvZ` 0.15 | 1 |
| `solvHeldPad` 0.15 / 0.2 | 2 / 2 — the pad exceeds market 109's own 144-share gap |

At `c6669a59` / `4c5b9ce7` / `d60e48e1` (baseline 1 failure over the first 110):

| Change | Failures |
|---|---|
| `depthGate` 0.60 / 0.58 | 3 / 4, 109 unmoved |
| `overtakeCap=0.5`; `overtakeCap=1` ungated / `overtakeFrom` 0.2 / 0.3 / 0.4 | 12; 16 / 19 / 17 / 10 |
| `swapEdge` 0.3 / 0.5 | 10 / 16, 109 unmoved |
| `avgGuardFrom=0.9` | 49 |
| `burstSwap` 0.35 / 0.45, ± `burstSwapFrom` 0.6 / 0.7 | 29 / 19 / 29 / 30 |
| `stallFinish` gated six ways | 2 at BEST |
| `underdogHeldShare` 0.2 / 0.3 / 0.5 / 0.7 | 109 unmoved to the cent |
| `jumpPad` 0.02–0.08 × `jumpCross` 0/1, τ 5–15 s | 109 unmoved |
| `priorityLatch=1` | 12 |
| `burstShare` 0.20 / 0.25 with `burstPause=1` | 48 / 36 |
| the same at `burstFrom` 0.5 / 0.6 / 0.7 | 39 / 41 / 39 |
| `burstShare=0.20` + `burstFrom=0.7`, no handover | 10 |
| `lateShare=0.7` + `lateMs` 240 s / 300 s | 50 / 46 |
| `solvUnder=0` | 4 over the first 115 (3 casualties below 113) |
| `solvUnderPad` 0.035 / 0.06 WITHOUT `solvCheap` | 4 / 4 — the same 3 casualties |
| `solvEdge=0.03` with `solvCheap` | 4 |
| `solvCheapPad` 0 (a single tick) / 0.02 | 2 / 2 |
| `takeSmall` on every undersized order | costs `…1775110500`, 3 draws |
| `takeSmall=0.5` | costs `…1775122200` |

Earlier, at the levels-84–86 configuration (baseline 5): `ptbPace=1` 18;
`pairCeil` 0.978 + `finishCeil` 0.98 breaks market 39; `commitDwellMs` 8 s / 20 s
4 / 4; `reserveFull` 0.6 / 0.75 / 0.9 17 / 17 / 20; the depth latch on "the next
clip would be clamped" 3; the depth release with no freshness clock 4.

On the level 68 window (baseline 1 of 68): `edgeFull` 0.45 / 0.50 → 12 / 15;
`edgeHoldMs` 20 s / 30 s / gated → 14 / 15 / 9; `holdRamp` 0.3 → 16; `spendPace`
0.35 / 0.40 / 0.45 → 18 / 16 / 13; `maxImbalance` 300 → 43; `oracleHold` 0.6 /
0.7 / 0.8 → 24 / 31 / 29; priority swap on "can't afford both", 4 gates → 24 / 13
/ 21 / 23; the same gated on the chased leg's share → 24 / 27 / 24 / 20;
`solvDrop` 0.10 / 0.14 / 0.18 / 0.18+gap → 21 / 19 / 19 / 21; `burstShare` 0.15 /
0.18 / 0.20 → 13 / 9 / 12; `reserveLow` 0.7–1.0 → 3 / 9 / 9 / 11; `fairHold` on
four settings → 7–9, unchanged by an oracle release; the parity hold released by
the oracle → 7 at BEST.

Over the first 84, with the `edgeMinDep` gate (baseline 1): 2,500 → 5, 2,000 → 2,
1,900 → 1 (a different market), 1,000 → 1.

Earlier still: `commitRate`, `commitRise`, `underdogMax`/`underdogLift`,
`reserveMom`, `reserveLowUntilMs`, `momDeadband`, `priority=dear` alternatives,
`reserveLow` escalation/de-escalation, price caps pinned to a leg's own low,
budget averages, `avgGuard`/`avgGuardFrom`, the `earlyShare` family,
`reserveLow=0` globally, and the chased leg's ask average as an "is it running
away" test.

**Do not reopen** on any window: the parity hold; `fairHold` with or without a
release; the opening-lean thread (`convDwellMs`, `openCheapMs`); any solvency or
underwater test applied as a CAP (the swap is a reassignment, which is why it
works); any rule that treats the model-book disagreement as a warning (it is a
GOOD direction signal); **any rule that permanently overrides which leg the book
names** — `solvSwap` is not one, it re-evaluates every tick and hands the chase
back the moment the arithmetic changes; and **any cap that delays, rations or
slows the purchase that completes a leg**.

Also dead, from level 87's diagnosis: `finishShare` and `finishCeilShare` are NOT
what completes the leg at the top of a slow trend — the pace is lifted by
`completing`, the `commitShare` exemption.

## What passed the earlier levels

- **47** — `commitShare=0.6` + `commitReserve=1`, gated by `commitLeadMs=12000`,
  `commitLag=0.15`, `commitLoss=0.045`.
- **52** — `finishCeil=0.975`, reachable only by a leg past `finishCeilShare`.
- **67** — `oracleReserve=1.5`.
- **68** — `depthHold=0.8` on `depthGate` with `depthFreshMs=30000`.
- **80** — `depthGate` 0.66 and `depthMinDep=2500`.
- **84–86** — `edgeMinDep=1500` with `edgeDepRamp=1`.
- **87–94** — `closeFinish=1`.
- **95–104** — `commitDwellMs=12000`.
- **105–107** — `depthLatchRate=1`/`depthRateMs=3000` plus `depthRelease=0.6`/
  `depthReleaseMs=5000`.
- **108** — `fairLagLatch=1` plus `ptbFairLagDwellMs=10000`.
- **109–112** — `solvSwap=1` + `solvUnder=1` + `solvHeld=1` + `solvZ=0.12` +
  `solvZLatch=1`.
- **113** — `solvUnderPad=0.035` + `solvCheap=1` + `solvCheapPad=0.03`.
- **114** — `takeStale=1` + `takeSmall=0.25`.

## Tools

- **`tools/sweep80.sh <tag> <N> [--param k=v ...]`** — one parameter set over the
  first N markets in four parallel chunks, printing only the failures. About
  seventy-five seconds for 110 markets. This is the workhorse.
- `tools/probe2.sh <tag> "<slugs>" [--param k=v ...]` — one parameter set over an
  explicit slug list; writes `/tmp/pg/<tag>.{json,err,rows}`. Running four probes
  in parallel is the cheapest way to sample the latency jitter on one market.
- **The swap instrument**: with `debug>=2` the player prints ONE line the first
  time `solvSwap` changes the chase, carrying the time, both asks, both holdings,
  the spend, both projections, the oracle and both probabilities. That one line
  is what separated the repair from its last casualty, in one pass. The
  `stallFinish` release has the same shape. Copy it for the next rule that needs
  a moment-of-decision measurement rather than a timeline.
- **`--param debug=3` names the binding cap.** One line per leg per tick with
  all sixteen room caps by name plus `cap`/`capFin`/`want`/`ask`. Which of them
  is the one refusing a purchase had been guesswork; it is now a grep.
- **`--param debug=2` is the observation channel**: one line per market per
  `debugEveryMs` for the WHOLE window, emitted above every early return. It
  carries `depUp=`/`depDown=`, `dimb=`/`dabs=`, `dcap=` and both best bids.
  `debug=1` stops the moment the player is done, which silently truncates any
  measurement of what happened later.
- **`tools/closeScan.ts --tag <sweepTag>`** — for every window in an observation
  sweep, the book at the tick where the player first took a leg to 1,000. Needs
  `sweep80.sh <tag> 110 --param debug=2 --param debugEveryMs=500` first.
- `tools/depScan.ts`, `tools/bookScan.ts`, `tools/parityScan.ts`,
  `tools/buyScan.ts`, `tools/volScan.ts`, `tools/underwaterScan.ts` — the other
  offline analyses of that channel.
- `tools/level.ts --level N --run <id>` — the only place a level may be scored.
  It requires the run's market set to be EXACTLY the level's universe.
- `tools/play-level.ts --level N` — run and score one level in one command.
  Roughly four minutes for a level around 110; two or three run fine in parallel.
- `tools/smoke.ts --strategy pair-game-opus-pair.v1` — the scoped smoke test.
- `tools/lib/seedRandom.mjs` — the ONLY non-determinism in a run is
  `Math.random()` in `BacktestExecution` (the ±20 ms latency jitter).
- The first N slugs:
  `npx tsx protocols/pair-game-opus/tools/universe.ts --first N --slugs-only`.
- Recent run ids:
  `npx tsx protocols/pair-game-opus/tools/sql.ts "select id, batch_uid from backtest_runs order by id desc limit 10"`.

### Traps that have each cost a session

- **A rule rejected once may have been rejected for the wrong reason.** The
  solvency swap carried a two-paragraph rejection note arguing the arithmetic was
  worthless. The note's OBSERVATION was correct and its CONCLUSION was not, and
  reading it as a description of what to fix rather than as a verdict is what
  passed levels 109 and 110. Before writing a family off, check whether the
  rejection note names a fixable defect.
- **A cap you can name is not necessarily the cap that binds.** Before building a
  release for a ceiling, lift the ceiling to infinity and confirm the market
  moves at all — it costs one probe.
- **A single failing market does not name its own cause.** Before spending a
  session on a stated cause, turn the suspected rule OFF and confirm the market
  actually changes.
- **A fix measured on one level breaks the next one.** Sweep the first N+5 before
  believing a level. At 75 seconds a sweep, always sweep 110–115.
- **A level can pass on luck.** Before treating a level as solid, run its newest
  market four times in parallel.
- **A flaky market can hide behind the sweep.** When a level run fails on a
  market the sweep says is fine, scan seeds 1–24 with `seedRandom.mjs`.
- **Diff the failing draw against a passing one at `debugEveryMs=250`.**
- **`/tmp` is case-insensitive here.** Probe tags `Z1` and `z1` are the same
  files. Delete the target `.rows` before waiting on it.
- **zsh does not word-split unquoted variables.** Never collect `--param` flags in
  a shell variable; pass them literally to `probe2.sh` / `sweep80.sh`.
- **Per-tick state set inside the `needUp > 0 && needDown > 0` branch is stale
  once a leg completes.** Check any new per-tick latch the same way.
- **A per-tick cap that only latches at a share threshold can be stepped over.**
  The fix is not "latch earlier" but "latch on the thing the threshold stood in
  for".
- **A deque you read may not be being written.** `pushRate` sits behind
  `if (cfg.commitRate > 0)` and `commitRate` is 0.
- **The debug line's `dcap=` prints `depthHeld`, the LATCH** — `darm=` prints the
  arm.
- **The live reading is not the offline reading.** Offline scans are for finding
  a separation and ranking windows, never for picking a threshold.
- **A gate that reads a price needs a MARGIN, not a sign.** `solvCheap` bare
  refuses a swap on a leg quoted one cent dearer and allows the identical swap
  one second later at one cent cheaper. Same book, same noise, opposite verdict.
- **Compare prices as a GAP against a padded threshold, never as
  `price − pad`.** Neither side of that subtraction is exactly representable, so
  the identical three-cent gap comes out allowed at one price level and refused
  at another. Half a tick of slack on the gap fixes it.
- **A resting order at the ask is not a trade.** The simulator's worst-queue
  model fills a maker bid only when the ask goes THROUGH it, so a passive quote
  and a marketable one at the same price behave completely differently, and the
  reprice test — which compares prices — cannot tell them apart.

## Needs human

Nothing.
