# Status — Pair Game Opus

- Highest passed level: **118** (first 118 eligible markets)
- Current level: **119** (first 119 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: `2026-08-03T11:37:27.659Z-35d1de5f`

**Next step: level 119 is blocked by a FLAKE, not by its newest market.**
The 119 run failed on `…1775122200` — market 39 — which passed level 118 and
five sweeps of the first 115. It is now reproducible on demand: it fails at
`PG_SEED=6` and passes at seeds 1, 2, 3, 4, 5, 7 and 8, so roughly one draw in
eight. Fix that, then re-run 119; markets 116–119 themselves are clean.

The failing draw, from `debug=2` at `debugEveryMs=250` (`PG_SEED=6` vs
`PG_SEED=7`): the two draws diverge in the first second and are never
comparable line by line, so diff them by SHAPE rather than by tick. At t+118 the
losing draw holds 344 UP / 776 DOWN for 657 dollars with askUp 0.43 and askDown
0.58. It then finishes **UP** — the leg that is collapsing — for 909 total, and
DOWN, the winner, runs to 0.99 with 224 shares still needed and 61 dollars left.
The arithmetic is not obviously wrong: chasing UP projects about 1,002 against
1,049 for chasing DOWN, so `solvSwap` correctly does nothing. **This is the same
pathology as market 120 below** — the chase settles on the leg that is getting
cheaper, which is the leg that will be worthless — and the two are probably one
problem.

After that, the next new wall is market **120** (`…1775195100`), diagnosed
below.

## What passed 115 — the parity waiver, made into a decision

`solvZLevel=0.02` (was inert at 0), plus `solvLevelMax=0.21`,
`solvLevelGap=0.04`, `solvLevelEdge=0.035`, `solvLevelEdgeMax=0.05`,
`solvLevelAfterMs=20000` and `solvLevelLatch=1` (all new).

Session 37 measured the parity waiver at **eight to ten casualties** and wrote
it off, on the ground that the repair and its casualties are inseparable on
every field the player has. That conclusion was reached from a table of three
fields. Printed with the two fields it was missing — how much each leg was
HOLDING and how far apart the asks were — the casualties separate cleanly, and
the waiver turns out to be three assumptions stacked on one test:

| Casualty | Why it is not the case the waiver argues for |
|---|---|
| `…1775145600` 594/594, `…1775155500` 469/469, `…1775184300` 344/344, `…1775151000` 219/200 | level is not the same as UNCOMMITTED |
| `…1775092500` gap 0.29, `…1775166300` gap 0.11, `…1775115000` and `…1775117700` gap 0.06 | the waiver skips the licence to overrule the BOOK |
| `…1775136600` separation 96, `…1775151900` separation 64 | the two plans are separated by a STALE low, not by the asks |

- **`solvLevelMax`** — the waiver's argument is that at parity the swap abandons
  nothing. That is only true at the OPENING position. A swap at 594/594 abandons
  six hundred shares and six hundred dollars, level or not. 0.21 is one clip.
- **`solvLevelGap`** — position cost is not the only thing a swap spends.
  `solvZ` is the licence to overrule the BOOK, and how much licence is needed
  depends on how loudly the book is speaking. Every survivor swaps across a
  four-cent gap; the casualties swap across six, eleven and twenty-nine.
- **`solvLevelEdge` / `solvLevelEdgeMax`** — a BAND on the separation between
  the two plans. Each plan finishes one leg at today's ask and funds the other
  at the cheapest price that leg has ever shown, so the difference is roughly
  `need × [(ask gap) + (trailing-low gap)]`. At parity with eight hundred
  outstanding and a four-cent gap, the asks are worth about 32 dollars.
  Survivors separate by 40, 40, 48 and 48 — a cent or two of low on top of the
  asks. The last two casualties separate by 64 and 96, which is four and eight
  cents of low that is no longer on the book. The ceiling is not "the
  alternative must not be too good"; it is "the comparison must be decided by
  prices the player can still trade at".
- **`solvLevelAfterMs`** — the opening position is gone by `solvAfterMs`, and
  market 115's swap has to fire at t+21. Lowering `solvAfterMs` itself reaches
  it but moves EVERY swap in the field forward by forty seconds.
- **A waived swap now keeps that earlier clock open for the rest of the window.**
  This is the part that is easy to miss and cost one full sweep: the waiver's
  conditions are all destroyed by the swap succeeding — the legs stop being
  level the moment the promoted one is bought — so on the next tick the block is
  skipped, the chase goes back to the book, and the window ends **to the cent**
  as if the swap had never fired. A rule that only holds while its own
  preconditions hold does nothing at all.

| Configuration (first 115) | Failures |
|---|---|
| baseline (level 114 defaults) | 1 — market 115 |
| `solvZLevel=0.02` + `solvAfterMs=20000` (session 37's version) | 10 |
| `+ solvLevelMax/Gap/Edge`, own clock, no persistence | 2 — and 115 NOT repaired |
| the same with persistence | 4 |
| **the same at `solvLevelGap=0.04` + `solvLevelEdgeMax=0.05`** | **0, 0, 0, 0, 0** (five draws) |

The eight waived swaps at the final settings, four of which used to be
casualties, at their moment of decision:

```
PASS 100600 t+64s UP→DOWN  0.530/0.490  proj 1025→977  z=0.29  pModel 0.555
PASS 129400 t+27s UP→DOWN  0.520/0.480  proj 1012→964  z=0.19  pModel 0.519
PASS 160900 t+40s UP→DOWN  0.530/0.490  proj 1027→987  z=0.01  pModel 0.499
PASS 190600 t+21s DOWN→UP  0.490/0.530  proj 1025→985  z=0.25  pModel 0.461   ← level 115
CUT  115000 t+33s          0.540/0.480  proj 1022→982                        gap 0.06
CUT  117700 t+45s          0.480/0.540  proj 1027→987                        gap 0.06
CUT  136600 t+50s          0.490/0.530  proj  991→895                        separation 96
CUT  151900 t+30s          0.500/0.540  proj 1033→969                        separation 64
```

`z` and `pModel` still do not separate them — session 37 was right about that
much, and both cuts are made on the book and on the arithmetic instead.

## The next wall: market 120 (`…1775195100`)

It is the mirror of 115. The book leans DOWN from the first tick (askUp 0.44,
askDown 0.57) and the player finishes **UP** — the loser — inside sixty
seconds: 1000 UP / 719 DOWN for 859 dollars, of which UP took the bulk while its
ask fell 0.44 → 0.40. DOWN then runs away for the rest of the window (0.61 at
t+60, 0.70 by t+150, 0.99 at the death) and 281 shares of it cannot be bought
with the 111 dollars left. No swap fires at any point.

Unlike 115, the outside price is not ambiguous here: `z` is 0.30 at t+30 and
0.58 at t+60, rising monotonically to 1.5 by t+300, and `pModel` is under 0.48
throughout. The leg the player buys out is the one the book AND the oracle both
call the loser from the start.

Already measured, with `debug=3` at `debugEveryMs=250`:

- **The priority is right for four seconds and then flips.** At t+0 DOWN is the
  chase (`cap=0.7881 want=0.560 ask=0.570`) and UP is the underdog at 0.10. By
  **t+4** UP's cap is 0.7760 and it never gives the chase back. Whatever picks
  the leg in the first seconds is what loses this window; `solvSwap` is not
  involved and cannot be, because UP reaches 1,000 at about t+55 and the swap's
  clock does not open until t+60.
- **What flips it is a two-cent wobble.** Between t+3 and t+4 askUp goes
  0.43 → 0.45 and askDown goes 0.58 → 0.56. The `momentum` reading is
  `(askUp − emaUP) − (askDown − emaDOWN)`, so those four cents hand it to UP, on
  four seconds of EMA history. Nothing overrules it, and the reason is one cent:
  the conviction override (`if (conv > 0) first = the dearer leg`) needs the book
  to lean by `convEdge` = 0.12, and at that tick it leans by exactly **0.11**. At
  t+0 it leaned 0.13 and the override was on. The window is lost in the one
  second the lean spends under the threshold.
- So the question for this market is the OPENING choice, not the reassignment.
  **`convEdge=0.10` is measured and does not do it** — 4 failures over the first
  120 and market 120 unrepaired, because the override names the DEARER leg and
  by t+4 that is briefly UP as well. What has NOT been tried is a LATCH on the
  override: once the book has leaned by `convEdge`, keep chasing the leg it
  named rather than re-reading a four-second momentum EMA every tick. That is
  the same shape as `solvZLatch` and `fairLagLatch`, both of which passed levels,
  and it is the shape the `…1775122200` flake also wants. `openCheapMs` and
  `convDwellMs` stay on the do-not-reopen list; `convEdge` itself is now measured.

## What passed 113 — a projection is an estimate, not a verdict

`solvUnderPad=0.035`, `solvCheap=1`, `solvCheapPad=0.03`.

`solvUnder` required the receiving assignment to project INSIDE `qty ×
pairCeil`. It reads that projection as a verdict, and it is not one: the plan
funds the leg it is NOT chasing at the cheapest price that leg has yet shown,
which deliberately over-estimates what the leg the window is abandoning costs at
the death. Market 113's repair projects 1,004 against a ceiling of 970 and then
completes for 963.

- **`solvUnderPad`** — how far outside the ceiling the receiving plan may still
  project. Alone it repairs 113 and 114 and costs three markets below them,
  because it reopens exactly the comparison the old rejection note convicted:
  two overrunning plans separated by a couple of cents of trailing-low noise.
- **`solvCheap`** — settle that comparison with a reading that is not stale. The
  swap may only hand the chase to the leg quoted CHEAPER right now.
- **`solvCheapPad`** — one tick is not enough. The last casualty is blocked one
  cent DEARER and fires a second later one cent CHEAPER on the same book.

The cheapness test compares the GAP against `solvCheapPad + 0.005` rather than
`askFrom − solvCheapPad`: neither side of that subtraction is exactly
representable and the identical three-cent gap comes out allowed at one price
level and refused at another.

## What passed 114 — a waiting order at the ask does not trade

`takeStale=1`, `takeSmall=0.25`.

At t+135 the losing draw holds 1000 UP / 375 DOWN, has 168 dollars left, and
DOWN is offered at 0.26 — 625 shares would cost 171 against a finish budget of
173. It buys none of them. Its bid is already resting at 0.26 from when the ask
was 0.28, and a resting bid fills only when the book goes THROUGH it, while the
same price sent fresh walks the asks on arrival. The target price has not moved,
so the player never re-posts.

- **`takeStale`** — re-post at an unchanged price when this tick has decided to
  cross and the live order was sent to wait.
- **`takeSmall`** — re-post a CROSSING clip left as dust. Narrow in two ways and
  both were paid for: a partially filled PASSIVE quote is a queue position that
  has already proved itself, so this applies only to orders that were themselves
  crosses, and only to remainders under a QUARTER of a clip.

## What passed 109–112 — the solvency swap, gated on the oracle

`solvSwap=1`, `solvUnder=1`, `solvHeld=1`, `solvZ=0.12`, `solvZLatch=1`.

`solvSwap` is the rule that says: when the assignment the book prefers — finish
the leg it names at today's ask, fund the other at the cheapest it has shown —
cannot come in under `qty × pairCeil`, and the OPPOSITE assignment can, chase
the other leg. It had been measured and rejected twice, and its own rejection
note contains the repair. **An alternative that comes in UNDER the ceiling is
not noise, and neither is the direction the swap points.**

- **`solvUnder`** — the receiving assignment must project inside the ceiling.
- **`solvHeld`** — the chase may only be handed to the leg the player already
  holds at least as much of. Every casualty of the bare swap ends one leg at
  1,000 and the other stranded between 200 and 600, because a DEMOTED leg
  answers to `underdogMax`.
- **`solvZ`** — the volatility-normalised outside price must favour the leg the
  chase is being handed to. The swap overrules the book, so the one thing it
  must not be decided by is the book. 0.10–0.12 carries all 110; 0.15 loses one.
- **`solvZLatch`** — once satisfied for a leg, satisfied for the rest of the
  window. In market 109 the model favours UP for FOUR SECONDS around the swap
  and then sits under 0.5 for three minutes. A reading that licenses a decision
  has to be remembered, because the decision is re-taken every tick.

## Evidence

Levels 1–45 at commit `4f21eb1e`, runs 3744–3788 (one run per level, level N =
run 3743+N). Levels 46–51 at `3d8055f9`. Levels 52–59 at `e16f30fe`. Levels
60–66 at `18640212`. Level 67 at `80d695a0`. Levels 68–79 at `71e47612`.
Levels 80–83 at `acf79c2e`. Levels 84–86 at `abe42a69`. Levels 87–94 at
`bd730970` (runs 4688–4695). Levels 95–104 at `5c27b8dc` (runs 4730–4739).
Levels 105–107 at `f52fa712` (runs 4883–4885). Level 108 at `c6669a59`
(runs 4949 and 4950). Levels 109–112 at `47bbd823` (runs 5293, 5294, 5296,
5297). Level 113 at `cbbc24bd` (run 5359). Level 114 at `d4dbc21b` (run 5437).

Levels **115–118 at `fc890aa7`**, all defaults, one `play-level` run each:
**115 → 5566**, **116 → 5568**, **117 → 5569**, **118 → 5575**, each with every
market passed. Five sweeps of the first 115 at those defaults returned zero
failures each. Level 119 (run 5576) scored 118/119, failing on `…1775122200`.

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
  oracle is an accurate but LATE witness** (`tools/volScan.ts`).
- **The depth reading needs both a share and a size** (`tools/depScan.ts`).
- **Absolute near depth belongs on the PACE as well as the cap**, proportionally.
- **The edge allowance is the level-109 pathology and it is still there.** On
  market 115 (`debug=3`) the binding cap between t+41 and t+50 was the edge
  allowance, not any price cap, and the purchase that lost the market was
  released by that allowance widening as the book gap widened 0.17 → 0.29. The
  leg is bought fastest when it is dearest. Nothing measured so far repairs that
  directly; both windows it has cost were repaired by REASSIGNING the chase.

## Flakes

`…1775178000` (market 101) is a reproducible coin flip that fails about 2 draws
in 24 — with `tools/lib/seedRandom.mjs`, `PG_SEED=1` and `PG_SEED=11` fail and
22 other seeds in 1–24 pass. **`…1775122200` fails about one draw in eight**:
seed 6 fails, seeds 1, 2, 3, 4, 5, 7 and 8 pass, and it is what cost the level
119 run. `…1775110500` and `…1775136600` have each shown the same shape.

`…1775189700` (market 114) WAS the same shape and is now 8 seeds in 8. Its flake
had a cause rather than being noise, and finding it took one seeded diff at
`debugEveryMs=250`.

**A level run can fail on a market the sweep has never shown you.** Treat a
single clean sweep as weak evidence; sweeps are unseeded, so two sweeps at the
same settings are two different draws.

## Measured dead — do not re-try

Everything below was measured over the FULL market set, not a single-market
probe. **A single-market probe is not evidence for a global pace or cap change.**

### Session 37 — over the first 115 at `c6ebe3e7` (baseline 1 failure, market 115)

| Change | Failures | Market 115 |
|---|---|---|
| `solvDrop=0.10` (the affordability handover) | **34** | repaired |
| `solvZ=0` | 7 | not repaired |
| `solvAfterMs=20000` | 2 | not repaired |
| `solvZ=0` + `solvAfterMs=20000` | 14 | repaired |
| `solvZLevel=0.02` + `solvAfterMs=20000` | 10 / 8 (two draws) | repaired |
| `reserveLow=0.9` | 18 | repaired |
| `jumpPad=0.04` + `jumpCross=1` | 16 | repaired |
| the same + `jumpFinishShare=0.8` | 14 | repaired |
| `edgeHoldMs=20000` | 25 | repaired |

### Session 38 — over the first 120 at `fc890aa7` (baseline 1 failure, market 120)

| Change | Failures | Market 120 |
|---|---|---|
| `convEdge=0.10` (the conviction override that misses by one cent at t+4) | 4 | NOT repaired |

Single-market probes on 115 that changed NOTHING: `finishSolv=0.8`,
`commitShare=0.75`, `commitDwellMs=25000`, `commitReserve=0` (all identical to
the cent), and `pairCeil=0.975`. `pairCeil=0.98` makes it worse (367/1000).
`convUntil` 0.02 / 0.04 and `convReserve` 0.4 / 0.6 moved it by not one share —
`conv` is 0 there, because the book's edge never reaches `convEdge` before the
money is gone. `solvDrop` at 0.05, 0.10 and 0.18 (± `solvGap=0.15`) all repair
115 on a probe, which is exactly why the probe is not the evidence.

At `47bbd823` (baseline 0 failures over the first 110):

| Change | Failures |
|---|---|
| `finishSolv` 0.8 / 1.0 | 7 / 13, and 109 unmoved in both |
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
- **115** — `solvZLevel=0.02` + `solvLevelMax=0.21` + `solvLevelGap=0.04` +
  `solvLevelEdge=0.035` + `solvLevelEdgeMax=0.05` + `solvLevelAfterMs=20000`,
  and the waived swap's clock latching once it has fired.

## Tools

- **`tools/sweep80.sh <tag> <N> [--param k=v ...]`** — one parameter set over the
  first N markets in four parallel chunks, printing only the failures. About
  seventy-five seconds for 110 markets. This is the workhorse.
- `tools/probe2.sh <tag> "<slugs>" [--param k=v ...]` — one parameter set over an
  explicit slug list; writes `/tmp/pg/<tag>.{json,err,rows}`. Running four probes
  in parallel is the cheapest way to sample the latency jitter on one market.
- **The swap instrument**: with `debug>=2` the player prints ONE line the first
  time `solvSwap` changes the chase, carrying the time, both asks, both holdings,
  the spend, both projections, whether the parity waiver carried it, the oracle
  and both probabilities. Strategy debug output lands in the probe's `.err`
  file, so the sweep is `grep -h "swap slug" /tmp/pg/sw<TAG>_*.err`. That one
  grep is what separated the waiver's survivors from its casualties.
- **`--param debug=3` names the binding cap.** One line per leg per tick with
  all sixteen room caps by name plus `cap`/`capFin`/`want`/`ask`.
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

- **"Inseparable" is a claim about the columns you printed.** Session 37 measured
  the parity waiver on three fields, found the repair sitting in the middle of
  its casualties on all three, and wrote the family off. Two fields it had not
  printed — how much each leg was holding, and how far apart the asks were —
  separate the same eight cases cleanly. Before retiring a rule as a coin flip,
  ask which of the rule's own PREMISES you have not measured.
- **A rule whose preconditions are destroyed by its own success does nothing.**
  The waived swap fires at parity, buys the promoted leg, and thereby stops the
  legs being level — so the next tick hands the chase straight back and the
  window ends to the cent as if the rule were off. Check every new gate for
  this: does the state it reads survive the action it takes?
- **A rule rejected once may have been rejected for the wrong reason.** The
  solvency swap carried a two-paragraph rejection note arguing the arithmetic was
  worthless. The note's OBSERVATION was correct and its CONCLUSION was not.
- **Repairing the blocking market on a single probe is the NORMAL case, not a
  discovery.** Six unrelated levers did it in session 37 and each cost between 8
  and 34 of the markets below it. Probe to find candidates; only the sweep is
  evidence.
- **A cap you can name is not necessarily the cap that binds.** Before building a
  release for a ceiling, lift the ceiling to infinity and confirm the market
  moves at all — it costs one probe.
- **A single failing market does not name its own cause.** Before spending a
  session on a stated cause, turn the suspected rule OFF and confirm the market
  actually changes.
- **A fix measured on one level breaks the next one.** Sweep the first N+5 before
  believing a level. At 75 seconds a sweep, always sweep 110–120.
- **A level can pass on luck.** Before treating a level as solid, run its newest
  market four times in parallel.
- **A flaky market can hide behind the sweep.** When a level run fails on a
  market the sweep says is fine, scan seeds 1–24 with `seedRandom.mjs`.
- **Diff the failing draw against a passing one at `debugEveryMs=250`.**
- **`/tmp` is case-insensitive here.** Probe tags `Z1` and `z1` are the same
  files. Delete the target `.rows` before waiting on it.
- **zsh does not word-split unquoted variables.** Never collect `--param` flags in
  a shell variable; pass them literally to `probe2.sh` / `sweep80.sh`. zsh also
  fails `rm -f /tmp/pg/tag.*` outright when nothing matches.
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
- **A gate that reads a price needs a MARGIN, not a sign.**
- **Compare prices as a GAP against a padded threshold, never as
  `price − pad`.** Neither side of that subtraction is exactly representable.
- **A resting order at the ask is not a trade.** The simulator's worst-queue
  model fills a maker bid only when the ask goes THROUGH it.

## Needs human

Nothing.
