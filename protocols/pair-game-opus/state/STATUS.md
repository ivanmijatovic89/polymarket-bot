# Status — Pair Game Opus

- Highest passed level: **143** (first 143 eligible markets)
- Current level: **144** (first 144 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: `2026-08-03T11:37:27.659Z-35d1de5f`

**Next step: score levels 144, 145 and 146, which the sweeps say are already
solved, and then take the wall at 147.** The look-ahead sweep of the first 152
paid for itself: the shipped defaults leave exactly **147 (`…1775219400`) and 148
(`…1775220300`)** failing, both diagnosed below and neither yet repaired. Levels
144, 145 and 146 have no unsolved market in them — 145 was the wall this session
and is fixed — but every level run since has been lost to `…1775199600`, which
is now the binding problem and is described under Flakes.

## What passed 145 — a licence to overrule the book is not needed when the book's own plan is unaffordable

`solvArith=1`, `solvArithOver=0.05`, `solvArithUnder=0.03`, `solvArithZMax=0.09`
(all new).

Market 145 (`…1775217600`) is a coin flip for ten minutes and then decides DOWN
outright. At t+436 the player holds 625 UP / 531 DOWN with 361 dollars left, and
the book has opened to 0.73 / 0.28. It spends 252 of the 361 completing **UP** at
an average of 0.67 — the dear leg, on the widest gap of the window — and finishes
1000 / 531 with DOWN unbuyable at 0.93. It is the level-109 pathology again: the
licence to own a whole leg and the cheapest price the other leg will ever show
are the same number.

The new `swapmiss` instrument is what found it. **A swap that never fires leaves
no trace at all**, so a window lost to a plan the arithmetic had already
convicted looked exactly like a window nobody questioned. Printed, the solvency
swap is asking to hand the chase to DOWN on nearly every tick from t+60 to t+436,
and at the end it is refused by `solvZ` alone with `projFrom=1040` against
`projTo=901`.

`solvZ` is a **licence to overrule the BOOK** — the swap is about to disagree
with the leg the order book prices as the winner, so the outside price has to
back it first. That argument is about an OPINION. When the plan the book prefers
cannot be paid for at all, the swap is not contradicting the book about who wins:
the book may be perfectly right, and the pair is still unaffordable. Declining to
fund a purchase that leaves the other leg unbuyable needs no licence — the same
shape as the parity waiver, where at parity the swap abandons nothing.

The margins are what make it a decision rather than a restatement of the entry
condition, which is already "the current plan overruns". `projTotal` funds the leg
left behind at the cheapest price that leg has EVER shown, so a plan a dollar over
the ceiling and one a dollar under it are the same plan.

| Configuration (first 152) | Failures |
|---|---|
| baseline (level 142 defaults) | 4 — the `…1775199600` flake, 145, 147, 148 |
| `solvArith=1` at 0.05 / 0.03, no `solvArithZMax` | 4 — `…1775093400`, `…1775162700`, 147, 148 |
| `+ solvArithZMax=0.09` | **3 — the flake, 147, 148** |

Both casualties of the bare waiver are the `solvLevelZMax` shape yet again: the
swap hands the chase to the cheap leg at t+60 with BTC already well onto the other
side (`pModel` 0.069 and 0.419 against the promoted leg), buys it out, and the
market settles where the model was pointing. Market 145's own fire is contradicted
too, but at z=0.07 against their 0.18 and 0.10 — **missing backing and
contradicted backing are not the same state**, for the third rule running.

## What passed 140 — a discount may not be spent on a leg the book is marking up

`ptbFairTakeRise=0.025`, `ptbFairTakeRiseLatch=1`, `ptbFairTakeRiseZ=0.15`
(all new; `ptbFairTakeRiseTauMs` is 20 s).

Market 140 (`…1775213100`) is decided between t+45 and t+80. At t+45, holding 594
UP against 200 DOWN with 449 spent, the fair-lag override takes the chase off UP
and gives it to DOWN; the player pours 337 dollars into DOWN, completes it at
t+80 with 214 left and UP's ask at 0.63, and never comes back. UP settles the
winner. The model leans UP the whole time — 0.518 at t+20 rising monotonically
to 0.94 — so this is the purely RELATIVE override, and `ptbFairModelMin` is
measured dead at 7 and 8.

**The override opened at a gap of 0.032, which only clears the NARROW threshold**
(`ptbFairLagEdge` 0.03, granted because DOWN was 394 shares behind). That
threshold is a discount on evidence, and the diagnosis is about what may be
bought with it.

The override's premise is that the book has not caught up with the model YET. The
instrument prints the column that falsifies it: **`dAskT` +0.030** — DOWN's own
ask has gone 0.410 → 0.440 in the twenty seconds before the reading. The book is
catching up, in the promoted leg's own price, while the reading is being taken;
the smoothed gap cannot see it because it was computed before the move. Across
the first 140, `dAskT` is at or below zero in 24 of the 28 windows that take the
chase this way, and market 140's is the largest by half again.

**Refusing on the move alone is worth nothing** — 594/1000 at 0.005, 0.015 and
0.025 alike, the baseline number. Twenty seconds later the trailing window has
rolled past the move and the same override opens on the same gap. So the refusal
LATCHES: the leg loses the narrow threshold and is read at the wide one for the
rest of the window.

The latch alone costs two markets that need theirs, and the new `fairrise`
instrument shows why. Market 140 and `…1775127600` are near twins:

```
fairrise 1775213100 t+45s side=DOWN rise=0.030 gap=-0.032 ask=0.570/0.440 z=0.24 held=594/200 spent=449
fairrise 1775127600 t+45s side=DOWN rise=0.030 gap=-0.040 ask=0.580/0.440 z=0.03 held=594/136 spent=414
```

Same second, same 0.030 mark-up on DOWN, 594 UP held against 136 and 200, asks a
cent apart. On every column the rule was written from they are the same window.
**They separate on the outside price and nowhere else: 0.24 against 0.03.** A
book marking a leg up while BTC walks away from the strike is repricing; a book
marking it up over a coin flip is noise. That is `solvLevelZMax`'s distinction
again — missing backing and contradicted backing are not the same state — and it
is why the latch also requires the model to lean AWAY from the promoted leg.

Two other things had to be right for the latch to be worth anything:

- **It is recorded only where the discount was actually being SPENT** — an
  override otherwise ready to open, on the strength of the narrow threshold
  alone (`|gap| < ptbFairEdge`). The first version marked a leg on any tick whose
  gap merely pointed at it, which disqualified legs no override ever wanted and
  cost `…1775127600` and `…1775109600`.
- The blunt alternatives are measured dead. Raising the narrow threshold to
  0.045 repairs market 140 and costs 3; `ptbFairRawShare` — requiring the
  INSTANTANEOUS gap to clear the same edge — does not repair it at any setting
  (594 at 0.6 and 0.8, 794 at 1.0 and 1.3, 625 at 1.6, non-monotone).

`ptbFairRawShare` is shipped at 0 and left in place: it is the right question
asked of the wrong quantity, and the answer to the right one is `dAskT`.

## What passed 133 — a bound on abandonment must read the abandoned leg

`solvLevelDemoted=1`, `solvLevelZMax=0.25` (both new).

Market 133 (`…1775206800`) opens dead even, sits at 200 UP / 219 DOWN for two and
a half minutes, then runs UP 0.51 → 0.67 and reverses outright: UP settles at
0.02 and 656 DOWN shares are unbuyable with the 197 dollars left.

The inherited hypothesis — that a price cap wrongly allowed the completing
purchase — was wrong, and `debug=3` disposed of it in one probe. **No price cap
bound anywhere in the run-up**: `cap` sat at 0.776 against asks of 0.51–0.67,
because the priority leg's cap holds back only `leadReserve × underdogMax` ≈ 9
cents per outstanding share of the other leg. What paced UP was `edgeRoom`, and
what released it at 750 shares was `finishShare`. The pair ended at 0.77 — the
market never failed on cost, only on 344 DOWN shares.

`debug=4` named the second the window turns. At **t+147** the solvency swap wants
to hand the chase to DOWN — projections 1031 against 983, holdings 200/219, asks
0.53/0.49 — and is refused. Probes separate the two gates cleanly: `solvHeld=0`
changes nothing at all, `solvZ=0` passes the market 1000/1000 for 959.

The parity waiver satisfies every one of its own conditions there and misses on
`solvLevelMax` by **nine shares**: 219 against a bound of 210. But the leg
holding 219 is the one the swap hands the chase TO. `solvLevelMax` is a bound on
ABANDONMENT — its own note reads "the leg that loses the chase drops to
`underdogMax` holding four hundred shares nobody will finish" — and it was
written on `Math.max(held.UP, held.DOWN)` because at 594/594, 469/469 and 344/344
the two readings coincide.

| Configuration (first 133) | Failures |
|---|---|
| baseline (level 132 defaults) | 1 — market 133 |
| `solvLevelMax=0.22` (the blunt version) | 2 — `…1775136600` and `…1775172600` |
| `solvLevelDemoted=1` | 1 — `…1775172600` |
| `+ solvLevelZMax=0.25` | **0, twice** |

`solvLevelDemoted=1` repairs 133 and breaks `…1775172600`, whose waived swap at
t+41 is almost the same reading in mirror image: 219 against 200 shares, a
four-cent ask gap, the two plans 48 dollars apart, the model leaning at the leg
being abandoned in both. They differ in **how loudly** the model disagrees — 0.17
where the swap is right, 0.30 where it is wrong — and `solvLevelZMax` is that
threshold.

The premise is not a tuned number. The waiver stands in for `solvZ`, and `solvZ`
is a LICENCE: it asks the outside price to back the receiving leg before the swap
may overrule the book. At parity the swap abandons nothing, so the licence is not
needed — that is the entire waiver. What the waiver also quietly did was fire
when the outside price is not silent but pointing the other way. **Missing
backing and contradicted backing are not the same state**, and no part of the
parity argument covers the second.

## What passed 130 — an override may not outlive the reason it was opened on

`ptbFairModelKeep=1`, `ptbFairModelKeepMin=0.02`, `ptbFairModelKeepDrop=0.10`,
`ptbFairModelKeepUntilMs=240000` (all new). `ptbFairModelKeepTauMs` is 20 s and
`ptbFairModelKeepHeld` is measured and off.

Three sweeps of the first 130 at the final settings: **0, 0 and 1** failure, the
one being the known `…1775122200` flake.

### The diagnosis was wrong before it was right

Session 40 left market 130 as "the conviction latch is revoked at t+3 by
`convLatchZ` and the repair is to hold the opening lean for four minutes". That
is a true statement about one repair and it is not where the market is lost.

- The revocation instrument (`latchkill`, `debug>=2`) printed the eight windows
  whose latch is revoked at the defaults. **Every one of them revokes at z ≤ 0.02
  with `pModel` inside 0.5 ± 0.035** — BTC one to eight dollars from the strike
  against a `needDiff` of sixty. The revocation is a sign test on noise, exactly
  as suspected.
- But a margin does not fix it. `convLatchMs=240000` with `convLatchZ` at 0.15
  and 0.3 costs 5 and 6 failures over the first 130 **and does not repair market
  130 at either**; only `convLatchZ` effectively infinite repairs it, at 7. The
  gradient is monotone in the wrong direction and there is no threshold to find.
- The reason is that the latch is not the binding thing. The observation channel
  shows the market standing still from t+15 to t+107 at 344 UP / 469 DOWN with
  540 dollars unspent; the latch's survival across that stretch changes nothing.
  **One handover decides the window**, and `debug=4` names it: at t+107 the
  fair-lag disagreement takes the chase off conviction and gives it to UP. The
  player then spends 270 dollars taking UP from 344 to 1,000 while UP falls
  0.51 → 0.38, and DOWN — the winner — is stranded at 469 and never comes back
  under 0.60.

### The rule

The fair-lag override opens in two quite different ways, and the new instrument
(`fairtake`) shows both across the field:

- the model leans the way the override points — "BTC has moved and the book has
  not caught up";
- it does not, and the override is a purely RELATIVE reading: the book prices one
  leg further from the model's own number than the other, whichever way the model
  itself leans.

The second kind is load-bearing. `…1775109600`, `…1775120400`, `…1775127600`,
`…1775167200` and `…1775201400` all open their override with the model on the
OTHER side, which is why `ptbFairModelMin` — the blanket requirement that the
model back the override — cannot ship: at 0.06 it costs 8 and at a bare sign 7.

The first kind carries a premise the second does not, and a premise can expire.
So the rule is not "the model must back the override", it is **"an override may
not outlive the reason it was opened on"**: an override the model opened keeps
running only while the model is still behind it.

| Configuration (first 130) | Failures | Market 130 |
|---|---|---|
| baseline (level 129 defaults) | 2 — market 130 + the `…1775122200` flake | — |
| `ptbFairModelMin=0.06` | 8 | repaired |
| `ptbFairModelMin=0.005` (a bare sign) | 7 | repaired |
| `ptbFairBookMax=0.10` | 6 | repaired |
| `ptbFairModelKeep=1` alone | 2 | repaired |
| `+ ptbFairModelKeepMin=0.02` | 1 | repaired |
| `+ ptbFairModelKeepDrop=0.10` | 1 (a NEW flake), then 0 | repaired |
| `+ ptbFairModelKeepUntilMs=240000` | **0, 1 (the old flake), 0** | repaired |

Each of the three gates was placed on a printed casualty, not guessed:

- **`ptbFairModelKeepMin`** — a margin, not a sign. `…1775133000` withdraws its
  backing at t+65 with the model 0.004 across even; market 130 needs the
  withdrawal at 0.026 across. 0.04 is too much: market 130 is NOT repaired there
  and the field costs 4.
- **`ptbFairModelKeepDrop`** — the premise dies when BTC MOVES BACK, not when the
  model drifts across even standing still. Market 130 gives up 0.167 of model in
  twenty seconds at its withdrawal; `…1775133000` gives up 0.100 and must be left
  alone until later, when the same withdrawal is harmless. The usable band is
  narrow — at 0.13 market 130 is no longer repaired — which is why the clock
  below is doing the rest of the work rather than a tighter drop.
- **`ptbFairModelKeepUntilMs`** — withdrawing the backing reverses a decision the
  player is already acting on, and that only pays if there is window left to
  re-run the chase in. The two windows that need it withdraw at t+125 and t+128;
  `…1775199600` withdraws at t+301 and fails 1 draw in 4 without this clock (and
  4 in 4 at the defaults, so the flake was ours).
- **`ptbFairModelKeepHeld` is measured and off.** Refusing the withdrawal while
  the override's own leg is BEHIND is the natural `solvHeld` reading and it does
  spare `…1775199600` — but it breaks market 130 itself (1000/669 in two sweeps),
  because the withdrawal that matters there happens while UP is still behind.

The suspension is deliberately not cleared when it fires: `fairModelSide` records
the leg the model opened an override on and is never reset by the suspension, so
the override stays suspended until the model comes back. Clearing it would let
the next tick reopen the override and the rule would do nothing — the trap this
file has now walked into twice.

## What passed 123–129 — a swap may undo a flip it is one tick behind

`solvChase=1`, `solvChaseMs=2000`, `solvChaseMax=0.25`, `solvChaseLatch=1`.

Market 123 whipsaws at t+69. The edge allowance is `qty × |askUp − askDown| /
0.32`, so when the gap trebles the licence to own 1,000 DOWN and the cheapest UP
of the window arrive **on the same tick, because they are the same number**. The
solvency swap wants to fire and is refused by `solvHeld` and `solvZ`; two columns
on the swap line — how long the demoted leg has held the chase, and how long ago
the promoted leg held it — read **1 second and 1 second**. There is no commitment
to abandon and no settled book to overrule.

- **`solvChaseMax`** — the clock tests half the claim. All four casualties of the
  bare clock promote a leg holding 281 to 719 shares, built over minutes; the
  repaired window promotes a leg stopped dead on 200. Being recently chased is
  not the same as being unbought.
- **`solvChaseLatch`** — **every condition `solvChaseMax` tests is destroyed by
  the swap succeeding.** 281/1000 without the latch, 1000/1000 with it.

**`sweepFit` is measured and off**: `budgetOfSecond` reserves the priority leg at
TODAY's bid, and today's bid IS the spike, so the money the sweep needs is the
money the spike is spending (0.324 against an ask of 0.340 at the critical tick).

## What passed 115 — the parity waiver, made into a decision

`solvZLevel=0.02`, `solvLevelMax=0.21`, `solvLevelGap=0.04`,
`solvLevelEdge=0.035`, `solvLevelEdgeMax=0.05`, `solvLevelAfterMs=20000`,
`solvLevelLatch=1`.

Session 37 measured the parity waiver at eight to ten casualties from a table of
three fields. Printed with the two fields it was missing — how much each leg was
HOLDING and how far apart the asks were — the casualties separate cleanly:

| Casualty | Why it is not the case the waiver argues for |
|---|---|
| 594/594, 469/469, 344/344, 219/200 | level is not the same as UNCOMMITTED |
| gaps 0.29, 0.11, 0.06, 0.06 | the waiver skips the licence to overrule the BOOK |
| separations 96 and 64 | the plans are separated by a STALE low, not by the asks |

- **`solvLevelMax`** — a swap at 594/594 abandons six hundred shares, level or not.
- **`solvLevelGap`** — how much licence is needed depends on how loudly the book
  is speaking. Survivors swap across four cents; casualties across six to
  twenty-nine.
- **`solvLevelEdge` / `solvLevelEdgeMax`** — a BAND: the comparison must be
  decided by prices the player can still trade at, not by a trailing low that has
  left the book.
- **A waived swap keeps its earlier clock open for the rest of the window**, or
  the legs stop being level the moment the promoted one is bought and the window
  ends to the cent as if the rule were off.

## What passed 119–122 — remember the opening lean

`convLatch=1`, `convLatchByMs=10000`, `convLatchZ=0`, applied BELOW the fair-lag
reading. The bare latch is worth 5 failures over the first 120 against a baseline
of 1; three conditions turn it into 0 — only an OPENING lean may be recorded, the
outside price revokes it permanently the first time the model disagrees, and it
is applied below fair-lag because that is the reading it has to survive.

Session 41 measured the revocation and found it fires on noise in every window it
fires in (see above). It is still in place because turning it off costs 6 to 7
over the first 130 — the noise reading is right far more often than it is wrong —
but it is **not** a margin and should not be described as one.

## What passed 113 — a projection is an estimate, not a verdict

`solvUnderPad=0.035`, `solvCheap=1`, `solvCheapPad=0.03`. The plan funds the leg
it is NOT chasing at the cheapest price that leg has yet shown, which deliberately
over-estimates the abandoned leg's cost at the death; market 113's repair projects
1,004 against a ceiling of 970 and completes for 963. The pad alone reopens the
comparison the old rejection note convicted, so the swap may only hand the chase
to the leg quoted CHEAPER right now, with a pad, compared as a GAP.

## What passed 114 — a waiting order at the ask does not trade

`takeStale=1`, `takeSmall=0.25`. A resting bid fills only when the book goes
THROUGH it; the same price sent fresh walks the asks on arrival. Re-post at an
unchanged price when this tick has decided to cross, and re-post a CROSSING clip
left as dust — only crosses, only remainders under a quarter of a clip.

## What passed 109–112 — the solvency swap, gated on the oracle

`solvSwap=1`, `solvUnder=1`, `solvHeld=1`, `solvZ=0.12`, `solvZLatch=1`. An
alternative that comes in UNDER the ceiling is not noise, and neither is the
direction the swap points. The chase may only be handed to the leg the player
already holds at least as much of; the outside price must favour the receiving
leg; and that licence latches, because the decision is re-taken every tick.

## Evidence

Levels 1–45 at commit `4f21eb1e`, runs 3744–3788 (one run per level, level N =
run 3743+N). Levels 46–51 at `3d8055f9`. Levels 52–59 at `e16f30fe`. Levels
60–66 at `18640212`. Level 67 at `80d695a0`. Levels 68–79 at `71e47612`.
Levels 80–83 at `acf79c2e`. Levels 84–86 at `abe42a69`. Levels 87–94 at
`bd730970` (runs 4688–4695). Levels 95–104 at `5c27b8dc` (runs 4730–4739).
Levels 105–107 at `f52fa712` (runs 4883–4885). Level 108 at `c6669a59`
(runs 4949 and 4950). Levels 109–112 at `47bbd823` (runs 5293, 5294, 5296,
5297). Level 113 at `cbbc24bd` (run 5359). Level 114 at `d4dbc21b` (run 5437).
Levels 115–118 at `fc890aa7` (runs 5566, 5568, 5569, 5575). Levels 119–122 at
`a2213f53` (runs 5649, 5650, 5657, 5658). Levels 123–129 at `cd795467` (runs
5728–5731, 5736–5738).

Levels **130–132 at `caeed993`**, all defaults, one `play-level` run each:
**130 → 5869**, **131 → 5870**, **132 → 5871**, each with every market passed.

Levels **140–142 at `b17517ce`**, all defaults: **140 → 5972**, **141 → 5973**,
**142 → 5975**, every market passed. Runs 5961, 5962 (`…1775122200`) and 5974
(`…1775199600`) are the three flake losses described under Flakes below. Two full sweeps
of the first 140 at those defaults returned 0 failures. Runs 5961 and 5962 are
the two `…1775122200` flakes described under Flakes below.

Level **143 at `b5e0a36c`**, all defaults (`solvArith` shipped on): **143 →
6010**, every market passed. Two sweeps of the first 152 at those defaults return
**3 and 2** failures, the difference being the `…1775199600` flake and the rest
being markets 147 and 148, which are past the current level. Runs 6011 (level
144) and 6012 (level 145) failed on `…1775199600` alone; market 145 itself passed
in both.

Levels **133–139 at `642f13a7`**, all defaults, one `play-level` run each:
**133 → 5909**, **134 → 5915**, **135 → 5914**, **136 → 5916**, **137 → 5919**,
**138 → 5920**, **139 → 5921**, each with every market passed. Level 137's
first attempt (run 5917) failed on the `…1775122200` flake alone and passed on
the re-run. Two sweeps of the first 133 at those defaults returned 0 and 0
failures; a look-ahead sweep of the first 140 fails only on market 140
(`…1775213100`) and the same flake.

## What is still true about the player

- **The budget arithmetic.** Per-share cost including the 7 bp taker fee is
  `p + 0.07·p·(1−p)`. A pair bought symmetrically at a coin flip costs 1.035; a
  pair completed after the market has decided, winner at 0.95 and loser at 0.03,
  costs 0.985. There is no safe play: name the winner, buy it out, sweep the
  loser for pennies at the death.
- **Any rule that withholds money from a leg does not make it careful — it makes
  some market end short.** The surviving rules all redirect rather than withhold.
- **110 of 110 windows complete a leg mid-window, 84 of them before t+120s.**
  Any cap that delays, rations or slows the completing purchase blocks that
  mechanism across the field.
- **Going underwater is normal**, **buying dear while unconfirmed is normal**, and
  **the volatility-normalised oracle is an accurate but LATE witness**.
- **The depth reading needs both a share and a size.**
- **The edge allowance is the level-109 pathology and it is still there.** The
  licence to own a whole leg and the cheapest price the OTHER leg will ever show
  arrive on the same tick — they are the same number. All FOUR windows it has
  cost were repaired by REASSIGNING the chase instead — never by a cap. Market
  133 is the cleanest case yet: `debug=3` shows no price cap binding anywhere in
  the run-up, `edgeRoom` paces the leg to `finishShare` and `finishShare`
  releases the rest, and the repair is a swap sixty seconds earlier.
- **The price cap on the priority leg is not a pair ceiling.** It reserves only
  `leadReserve × underdogMax` — about nine cents — per outstanding share of the
  other leg, so it sits near 0.78 all window and effectively never binds. Only
  the UNDERDOG's cap is projected against `pairCeil`. Do not reason about the
  chased leg as if the ceiling were guarding it.
- **In a two-sided window the two asks sum to about 1.01 all the way through.**
  Market 133 is never solvent at both current asks, from the first second to the
  last. The pair is only ever bought below the ceiling by buying each leg at a
  DIFFERENT time, which is exactly why every affordability test built on both
  legs' simultaneous asks either never fires or fires everywhere.
- **The model is not a slow book.** Market 130's fair-lag gap stays wide through
  the collapse only because the BOOK moved: `pModel` falls 0.61 → 0.47 while
  `pBook` falls 0.49 → 0.38. Whenever a value reading is derived from a
  difference, ask which of the two terms moved.

## Flakes

**`…1775199600` (market 125) is now the expensive one and it is close to needing
its own fix.** It has cost the first level 142 run, one level 143 run, one level
144 run and one level 145 run — four level runs, against three level runs it has
passed (140, 141, 142). It is not a coin flip in the ordinary sense: in a level it
lands at 536–542 UP against 1000 DOWN, and in isolation it lands at **970.5 pair
cost, four draws out of four**, which is a different outcome entirely and only one
cent inside the ceiling. `…1775109600` (market 25) has just acquired the same
shape — 973.2 in every sweep and every 25-market probe, 781 DOWN shares twice in a
level. **Both markets pass in every context except the one that counts.** The
prefix a level gives a market is 100+ markets of jitter draws deep; a sweep chunk
is at most 38 and a probe is none.

`…1775178000` (market 101) is a reproducible coin flip that fails about 2 draws
in 24. **`…1775122200` was the expensive one.** It has now cost one level 119 run,
one level 137 run and **two consecutive level 140 runs** (5961 and 5962, both
1000/776.21 to the hundredth), before passing on the third. `…1775110500` and
`…1775136600` have each shown the same shape.

**The level run and the probe are different draws, and the level run is the
harder one.** `…1775122200` passed 4 of 4 single-market probes at the shipped
defaults AND 4 of 4 with the new rule switched off, and passed both full sweeps
of the first 140 — while failing two level runs back to back. A level replays all
140 markets down one process, so the jitter stream a late market sees is the tail
of every market before it. **Do not read a clean isolation probe as evidence that
a market is safe in a level.** If this one starts costing three runs in a row it
needs fixing on its own terms, not another re-run.

**`…1775122200`'s flake is the depth handover, not the solvency swap.** `debug=4`
at seeds 6 and 7 prints the SAME five priority changes at the same seconds; the
only difference is how much DOWN was accumulated before the sixth.

**A level run can fail on a market the sweep has never shown you.** Treat a
single clean sweep as weak evidence; sweeps are unseeded, so two sweeps at the
same settings are two different draws.

## The wall at 147 and 148 — what is already known

Both are the same hour as 145 and both settle DOWN. Neither is a chase problem in
the way 130, 133 and 140 were.

**147 (`…1775219400`)** decides in the first sixty seconds and never comes back —
`z` is past 1.0 by t+360 and past 3.0 at the death. The player is 200/200 at t+40,
buys 244 DOWN at 0.72 by t+60, then takes UP from 200 to 1000 for 179 dollars at
an average of 0.22 and stops at 1000/444. **The UP purchase is not the mistake —
it is cheap and it is the loser.** What the window is short of is 556 DOWN shares
at an ask that never comes back under 0.77: 414 dollars left against roughly 460
needed. Trace the money backwards and the window is already lost at t+60, and
comfortably winnable at t+40, where 800 DOWN at 0.61 plus 800 UP at the death
totals about 816.

The chase at t+60 is handed to UP by the solvency swap on a **latched licence
earned at t+22**, when `pModel` was 0.685 UP; by t+60 it is 0.170. That is the
same rule `ptbFairModelKeep` records — a licence may not outlive the reading that
earned it — and the new `solvZKeep` / `solvZKeepChase` levers implement it. They
are **measured and inert**: at 0.12 and 0.20, with and without the chase latch,
market 147 goes from 444 to 514 DOWN shares and no further. **The chase is not
what is binding there.**

The deeper thing 147 exposes: `projTotal` funds the leg left behind at the
cheapest price that leg has EVER shown. In a window that has decided, the loser
keeps getting cheaper and **the winner never returns to its low**, so the
projection systematically flatters the plan that chases the currently-cheap leg.
At t+60 it prefers UP by 1007 against 801, and the 801 is built on a DOWN low of
0.40 that had already left the book forty seconds earlier.

**148 (`…1775220300`)** is shorter to state and harder. Between t+20 and t+40 the
player takes UP from 219 to 1000 — 781 shares for 491 dollars, an average of 0.63
— on a 0.59 / 0.42 book with `pModel` at 0.586 and `z` at 0.18. That leaves 266
dollars for 800 DOWN shares whose ask is 0.42 at that instant and never below it
again. **The window is dead at t+40 and nothing after t+40 matters.** The
projections at the moment of the purchase are 1019 against 972 — over and under
the ceiling, but by 0.039 and 0.008, well inside `solvArith`'s margins, and the
model contradicts at 0.18 in any case.

### The one untried idea both of them point at

`projTotal` funds the leg left behind at `trailingLow(o)` — the cheapest ask that
leg has shown since the window opened. That low never expires. In a window that
has decided, the loser keeps getting cheaper and **the winner never returns to its
low**, so the estimate flatters whichever plan chases the currently-cheap leg,
which in a decided window is the losing one. Market 147 at t+60 prefers UP by 1007
against 801, and the 801 rests on a DOWN low of 0.40 that had left the book forty
seconds earlier.

The obvious experiment is a **shelf life on the low** — fund the abandoned leg at
the cheapest price it has shown in the last N seconds rather than ever. It is one
parameter, it touches `solvSwap`, `solvDrop` and now `solvArith` at once, and it
has never been tried. `solvLevelEdge` / `solvLevelEdgeMax` already record the same
complaint for the parity waiver — "the comparison must be decided by prices the
player can still trade at, not by a trailing low that has left the book" — which
is evidence the axis is real and was only ever patched locally.

## Measured dead — do not re-try

Everything below was measured over the FULL market set, not a single-market
probe. **A single-market probe is not evidence for a global pace or cap change.**

### Session 44 — over the first 152 at `e4e14184` (baseline 4: the flake, 145, 147, 148)

| Change | Failures | Market 145 |
|---|---|---|
| `solvArith=1` at 0.05 / 0.03, no `solvArithZMax` | 4 — two NEW casualties | repaired |
| `+ solvArithZMax=0.09` | **3, then 2** | repaired |

Single-market probes on 147 that did NOT repair it: `solvZKeep` 0.12 and 0.20,
with and without `solvZKeepChase` → 444 DOWN shares becomes 514 and stops.

### Session 43 — over the first 140 at `cded9496` (baseline 1: market 140)

| Change | Failures | Market 140 |
|---|---|---|
| `ptbFairLagEdge=0.045` | 3 — `…1775109600`, `…1775127600`, `…1775145600` | repaired |
| `ptbFairTakeRise=0.025` + latch, latched on ANY tick | 3 — `…1775109600`, `…1775127600`, `…1775167200` | repaired |
| `+ ptbFairTakeRiseZ=0.15`, latched only where the discount was spent | **0** | repaired |

Single-market probes on 140 that did NOT repair it: `ptbFairRawShare` 0.6 / 0.8 /
1.0 / 1.3 / 1.6 → 594 / 594 / 794 / 794 / 625; `ptbFairTakeRise` 0.005 / 0.015 /
0.025 with no latch → 594 at all three. `ptbFairLagEdge=0.06` repairs it exactly
as 0.045 does, to the cent — the two are the same block.

**Two ways of blocking the same override broke the same two markets.** When a
second, unrelated-looking lever costs you the same casualties, you are on the
right axis and the rule is too blunt, not the axis wrong.

### Session 42 — over the first 133 at `687dacea` (baseline 1: market 133)

| Change | Failures | Market 133 |
|---|---|---|
| `solvLevelMax=0.22` | 2 — `…1775136600`, `…1775172600` | repaired |
| `solvLevelDemoted=1` alone | 1 — `…1775172600` | repaired |

Single-market probes on 133: `solvHeld=0` and `solvHeldPad=0` changed NOTHING
(1000/344 either way) — the swap it needed was refused by `solvZ` alone.

### Session 41 — over the first 130 at `42e458f5` (baseline 2: market 130 + the flake)

| Change | Failures | Market 130 |
|---|---|---|
| `convLatchZ=99` + `convLatchMs=240000` | 7 | repaired |
| `convLatchMs=240000` alone | 2 | NOT repaired |
| `convLatchZ=99` alone | 6 | NOT repaired |
| `convLatchMs=240000` + `convLatchZ` 0.15 / 0.3 | 5 / 6 | NOT repaired at either |
| `ptbFairModelMin` 0.06 / 0.005 | 8 / 7 | repaired |
| `ptbFairBookMax=0.10` | 6 | repaired |
| `ptbFairModelKeepMin` 0.04 (with drop 0) | 4 | NOT repaired |
| `ptbFairModelKeepDrop=0.13` | 1 | NOT repaired |
| `ptbFairModelKeepHeld=1` (with min 0.02, drop 0.10) | 1, 2 | NOT repaired |

### Session 40 — over the first 123 at `4b64f934` (baseline 2)

| Change | Failures | Market 123 |
|---|---|---|
| `solvHeld=0` + `solvZ=0` (the bare waiver) | 17, twice | repaired |
| `solvChase=1` on the clock alone, 2 s / 4 s | 5 / 6 | repaired |
| `+ solvChaseMax=0.25`, `solvChaseLatch=0` | 2 | **NOT** repaired — 281/1000 |
| `sweepFit=1`, pad 0 / 0.01 / 0.02 / 0.03 | — | NOT repaired, unmoved |

### Session 39 — over the first 120 at `fc890aa7` / `a2213f53`

| Change | Failures | Market 120 |
|---|---|---|
| `convLatch=1` alone (latch above `ptbFair`) | — | NOT repaired |
| `convLatch=1` below `ptbFair`, no revocation, no record window | 5 | repaired |
| the same `+ convLatchZ=0` | 1 | repaired |
| the same `+ convLatchByMs=5000` / `=10000` | 0 / 0 | repaired |

### Session 38 — over the first 120 at `fc890aa7`

`convEdge=0.10`: 4 failures, market 120 NOT repaired.

### Session 37 — over the first 115 at `c6ebe3e7` (baseline 1, market 115)

| Change | Failures | Market 115 |
|---|---|---|
| `solvDrop=0.10` (the affordability handover) | **34** | repaired |
| `solvZ=0` | 7 | not repaired |
| `solvAfterMs=20000` | 2 | not repaired |
| `solvZ=0` + `solvAfterMs=20000` | 14 | repaired |
| `solvZLevel=0.02` + `solvAfterMs=20000` | 10 / 8 | repaired |
| `reserveLow=0.9` | 18 | repaired |
| `jumpPad=0.04` + `jumpCross=1` (+ `jumpFinishShare=0.8`) | 16 / 14 | repaired |
| `edgeHoldMs=20000` | 25 | repaired |

Single-market probes on 130 that changed NOTHING: `convLatchZ` 0.15 / 0.3 / 0.5
and `convLatchMs` 90 s / 180 s / 400 s, each alone. Probes on 123: `solvHeld=0`
alone and `solvZ=0` alone. Probes on 115: `finishSolv=0.8`, `commitShare=0.75`,
`commitDwellMs=25000`, `commitReserve=0`, `pairCeil=0.975`, `convUntil` 0.02 /
0.04, `convReserve` 0.4 / 0.6.

At `47bbd823` (baseline 0 over the first 110): `finishSolv` 0.8 / 1.0 → 7 / 13;
`solvZ` 0.15 → 1; `solvHeldPad` 0.15 / 0.2 → 2 / 2.

At `c6669a59` / `4c5b9ce7` / `d60e48e1` (baseline 1 over the first 110):
`depthGate` 0.60 / 0.58 → 3 / 4; `overtakeCap` family 10–19; `swapEdge` 0.3 / 0.5
→ 10 / 16; `avgGuardFrom=0.9` → 49; `burstSwap` family 19–30; `stallFinish` gated
six ways → 2 at BEST; `underdogHeldShare` 0.2–0.7 unmoved; `jumpPad` 0.02–0.08 ×
`jumpCross` unmoved; `priorityLatch=1` → 12; `burstShare` family 36–48;
`lateShare=0.7` + `lateMs` 240 s / 300 s → 50 / 46; `solvUnder=0` → 4;
`solvUnderPad` without `solvCheap` → 4; `solvEdge=0.03` with `solvCheap` → 4;
`solvCheapPad` 0 / 0.02 → 2 / 2; `takeSmall` on every undersized order costs
`…1775110500`; `takeSmall=0.5` costs `…1775122200`.

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
four settings → 7–9; the parity hold released by the oracle → 7 at BEST.

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
underwater test applied as a CAP; any rule that treats the model-book
disagreement as a warning; **any rule that permanently overrides which leg the
book names**; and **any cap that delays, rations or slows the purchase that
completes a leg**. `finishShare` and `finishCeilShare` are NOT what completes the
leg at the top of a slow trend.

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
- **115** — the parity waiver made into a decision (six parameters + its latch).
- **119–122** — `convLatch=1` + `convLatchByMs=10000` + `convLatchZ=0`.
- **123–129** — `solvChase=1` + `solvChaseMs=2000` + `solvChaseMax=0.25` +
  `solvChaseLatch=1`.
- **130–132** — `ptbFairModelKeep=1` + `ptbFairModelKeepMin=0.02` +
  `ptbFairModelKeepDrop=0.10` + `ptbFairModelKeepUntilMs=240000`.
- **133–139** — `solvLevelDemoted=1` + `solvLevelZMax=0.25`.
- **140** — `ptbFairTakeRise=0.025` + `ptbFairTakeRiseLatch=1` +
  `ptbFairTakeRiseZ=0.15`.
- **145** — `solvArith=1` + `solvArithOver=0.05` + `solvArithUnder=0.03` +
  `solvArithZMax=0.09`.

## Tools

- **`swapmiss` (new, `debug>=2`)** — one line the first time the solvency swap
  WANTS to change the chase and is refused, naming which of `solvUnder`,
  `solvHeld`, `solvCheap` and `solvZ` said no, with both projections. At
  `debug=6` it is throttled to one line per ten seconds instead of once per
  receiving leg, which is what you want when the refusal that matters is the
  hundredth one rather than the first. It is the instrument that found market
  145, and it is the only way to see a decision the player never took.
- **`tools/sweep80.sh <tag> <N> [--param k=v ...]`** — one parameter set over the
  first N markets in four parallel chunks, printing only the failures. About
  ninety seconds for 130 markets. This is the workhorse.
- `tools/probe2.sh <tag> "<slugs>" [--param k=v ...]` — one parameter set over an
  explicit slug list; writes `/tmp/pg/<tag>.{json,err,rows}`. Four probes in
  parallel is the cheapest way to sample the latency jitter on one market.
- **`--param debug=2` carries five instruments** (strategy output lands in the
  probe's `.err` file, so the sweep grep is `grep -h <name> /tmp/pg/sw<TAG>_*.err`):
  - `swap` — one line the first time `solvSwap` changes the chase, with both
    asks, both holdings, the spend, both projections, the waiver flags, both
    trailing lows, both realized averages, `fAge`/`tGap` and the oracle.
  - **`fairtake`** (new) — one line the first time the fair-lag disagreement
    TAKES the chase, carrying `gap`, both probabilities, `dModel`/`dBook` and
    both asks' moves over the last twenty seconds. This is what showed that the
    override opens in two different ways.
  - **`fairkeep`** — one line when the model withdraws the backing, with the
    lean, the drop and the holdings.
  - **`fairrise`** (new) — one line the first time a leg loses the narrow
    threshold, with the mark-up that took it, the gap it was about to open on,
    both asks, the oracle and the holdings. It is what showed that market 140 and
    `…1775127600` are the same window on every column but `z`.
  - **`latchkill`** (new) — one line when the outside price revokes the
    conviction latch, with `pModel`, `z`, `diff` against `needDiff`, both asks
    and both holdings. It is what proved the revocation is a noise-level sign
    test.
  - `obs` — one line per `debugEveryMs` for the WHOLE window (set
    `debugEveryMs=900000` to silence it and keep the others).
- **`--param debug=3` names the binding cap**; **`--param debug=4` names the rule
  that took the chase**, one line per change of priority; **`--param debug=5`
  prints the underdog's budget**.
- `tools/closeScan.ts`, `depScan.ts`, `bookScan.ts`, `parityScan.ts`,
  `buyScan.ts`, `volScan.ts`, `underwaterScan.ts` — offline analyses of the
  observation channel.
- `tools/level.ts --level N --run <id>` — the only place a level may be scored.
- `tools/play-level.ts --level N` — run and score one level in one command.
  Roughly five minutes for a level around 130; two run fine in parallel but not
  alongside a sweep.
- `tools/smoke.ts --strategy pair-game-opus-pair.v1` — the scoped smoke test.
- `tools/lib/seedRandom.mjs` — the ONLY non-determinism in a run is
  `Math.random()` in `BacktestExecution` (the ±20 ms latency jitter).
- The first N slugs:
  `npx tsx protocols/pair-game-opus/tools/universe.ts --first N --slugs-only`.
- Recent run ids:
  `npx tsx protocols/pair-game-opus/tools/sql.ts "select id, batch_uid from backtest_runs order by id desc limit 10"`.

### Traps that have each cost a session

- **A decision the player never took leaves no trace.** Every instrument in this
  file prints when a rule FIRES. Market 145 was lost by a rule that was asking to
  fire on nearly every tick for six minutes and was refused, and nothing in any
  channel said so. Before diagnosing a window from the rules that acted, ask
  which rule wanted to act and did not — `swapmiss` is that channel for the
  solvency swap and there is no equivalent for anything else yet.
- **A refusal that expires by itself is not a rule.** The mark-up gate refused
  market 140's override on three settings and changed the outcome by nothing at
  all, because twenty seconds later its own trailing window had rolled past the
  evidence. Anything read over a trailing window and used to REFUSE needs a
  latch, or it only ever delays.
- **When a rule needs a state to hold, say WHEN it may be recorded.** The
  mark-up latch fired on any tick whose gap happened to point at a leg — and the
  gap points somewhere on every tick. Restricting it to ticks where an override
  was actually about to open, on the strength of the discount alone, is the
  difference between 3 failures and 0.
- **The rule you can name is usually not the rule that acted.** Market 130's
  window was decided by the fair-lag override at t+107, while the whole diagnosis
  inherited from the previous session was about a latch revoked at t+3 — and the
  latch turned out not to bind at all between t+15 and t+107. Market 120's chase
  was taken by fair-lag too; `…1775122200`'s by the depth handover. Each took one
  `debug=4` run to see and would have taken a session to guess.
- **A parameter sweep that moves monotonically in the wrong direction is telling
  you the axis is wrong.** `convLatchZ` at 0.15, 0.3 and ∞ costs 5, 6 and 7 and
  repairs the target only at ∞: there was no threshold to find because the latch
  was not what decided the window.
- **A latch is a memory, and a memory needs a source, a shelf life and a way to
  be revoked.**
- **"Inseparable" is a claim about the columns you printed.** Before retiring a
  rule as a coin flip, ask which of the rule's own PREMISES you have not measured.
- **A rule whose preconditions are destroyed by its own success does nothing.**
  Written down and walked into twice. `fairModelSide` is deliberately never
  cleared by the suspension it causes.
- **A bound written on `Math.max` of two things is a bound on neither.** The
  parity waiver's abandonment cap read the LARGER of the two holdings for eight
  levels, which is the right number only while the legs are equal — and the
  waiver's own entry condition only requires them equal within one fiftieth of
  `qty`. Nine shares of asymmetry hid market 133. When a rule's sentence names one
  side of something ("the leg that LOSES the chase"), check that the expression
  names it too.
- **A rule rejected once may have been rejected for the wrong reason.** Both
  `ptbFairBookMax` and `ptbFairModelMin` carry two-paragraph rejection notes from
  early sessions. The notes are still right — and the objection they describe is
  real and fixable by asking WHEN the premise applies rather than whether it does.
- **Repairing the blocking market on a single probe is the NORMAL case, not a
  discovery.** Probe to find candidates; only the sweep is evidence.
- **A cap you can name is not necessarily the cap that binds.**
- **A single failing market does not name its own cause.**
- **A fix measured on one level breaks the next one.** Sweep the first N+5.
- **A level can pass on luck.** Run its newest market four times in parallel.
- **A flaky market can hide behind the sweep**, and a new rule can CREATE one:
  `…1775199600` went from 4-in-4 to 3-in-4 and back, and it cost the first level
  142 run (5974, 523/1000).
- **Diff the failing draw against a passing one at `debugEveryMs=250`.**
- **`/tmp` is case-insensitive here.** Probe tags `Z1` and `z1` are the same
  files. Delete the target `.rows` before waiting on it.
- **zsh does not word-split unquoted variables.** Never collect `--param` flags in
  a shell variable; pass them literally.
- **Per-tick state set inside the `needUp > 0 && needDown > 0` branch is stale
  once a leg completes.**
- **A deque you read may not be being written.**
- **The live reading is not the offline reading.**
- **A gate that reads a price needs a MARGIN, not a sign** — and sometimes it
  needs a MOVE as well as a level.
- **Compare prices as a GAP against a padded threshold, never as `price − pad`.**
- **A resting order at the ask is not a trade.**

## Needs human

Nothing.
