# Status — Pair Game Opus

- Highest passed level: **108** (first 108 eligible markets)
- Current level: **109** (first 109 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: `2026-08-03T11:37:27.659Z-35d1de5f`

**Next step:** there is no live lead. Session 34 built and measured out three
more families — the parity cap, the money-velocity pause, and the
completion clock — and the last of them produced the general fact that explains
all three: **every one of the first 110 windows completes a leg mid-window, and
84 of them do it before t+120s.** Read "why every room cap on the chase dies"
below before designing anything that slows the chase down.

## Evidence

Levels 1–45 at commit `4f21eb1e`, runs 3744–3788 (one run per level, level N =
run 3743+N). Levels 46–51 at `3d8055f9`. Levels 52–59 at `e16f30fe`. Levels
60–66 at `18640212`. Level 67 at `80d695a0`. Levels 68–79 at `71e47612`.
Levels 80–83 at `acf79c2e`. Levels 84–86 at `abe42a69`.

Levels **87–94 at `bd730970`**, all defaults, one `play-level` run each:
87 → 4688, 88 → 4689, 89 → 4690, 90 → 4691, 91 → 4692, 92 → 4693, 93 → 4694,
94 → 4695.

Levels **95–104 at `5c27b8dc`**, all defaults, one `play-level` run each:
95 → 4730, 96 → 4731, 97 → 4732, 98 → 4733, 99 → 4734, 100 → 4735, 101 → 4736,
102 → 4738, 103 → 4737, 104 → 4739.

Levels **105–107 at `f52fa712`**, all defaults, one `play-level` run each:
105 → 4883, 106 → 4884, 107 → 4885. Levels 103 and 104 were recorded on lucky
latency draws at `5c27b8dc`; `f52fa712` is what makes them (and 105–107) real —
`…1775179800` now passes 4 draws out of 4.

Level **108 at `c6669a59`**, all defaults, two independent `play-level` runs:
**4949** and **4950**, both 108/108. A third run at the same configuration
(4932) FAILED on `…1775178000` — see the flake section below; that market is a
pre-existing coin flip, not a consequence of this commit.

Session 34 changed no default. `overtakeCap`, `burstPause`, `burstFrom` and
`lateShare` all ship OFF, each with its measurements in its own doc comment, and
a 110-market sweep at defaults after the change still returns the single known
failure.

## What passed 87–94 — the last leg standing may read the finish budget

`closeFinish=1` (new, default on). A leg whose PARTNER has reached `qty` reads
the `finishCeil` budget when crossing, whatever fraction of its own target it
holds. `finishCeilShare` already does this for a leg that is nearly done, on
the argument that the shares it still owes make everything already bought
unmatchable; that argument is at its strongest when the other leg is COMPLETE,
and the share test cannot see it.

Level 87's market grinds one way for three minutes, the player finishes that leg
at the top of the move, the market comes all the way back, and the only purchase
left in the window is offered at 0.28 against a remaining budget that affords
0.2997 a share. Six hundred shares refused for a cent, and no second offer. The
five dollars `finishCeil - pairCeil` already carries is enough; the pair closes
at 0.966.

Raising the whole ceiling instead buys the same cent and costs market 39
(`pairCeil=0.978`/`finishCeil=0.98` → 110-market sweep repairs 87 and breaks 39).
So the STATUS line that used to say "raising `pairCeil` is safe and inert" was
wrong for anything past level 39 — do not use it.

## What passed 95–104 — the commitment handover needs a clock

`commitDwellMs=12000` (new, default on). The `commitLoss` verdict — the committed
leg trading below what the player paid, on both its last quote and its
thirty-second average — must now stand for twelve CONTINUOUS seconds before the
`commitShare` exemption may be used.

Level 95's market: the player holds 719 of the leg that eventually wins and 531
of the other, two hundred dollars from finishing both. The committed leg spikes
twenty cents against it over fifteen seconds, the verdict flips, 469 shares of
the other leg are taken in FOUR SECONDS at thirteen cents above where that leg
traded thirty seconds earlier, and the spike is fully reverted fifteen seconds
later. Both readings `commitLoss` uses are prices at one instant, and a
twenty-cent move in fifteen seconds drags a thirty-second average with it.

Band over the first 110: 8 s is too short (95 still fails, and an earlier market
breaks too), 10/12/15 s all carry the same three failures with none below level
103, 20 s breaks market 52 whose chase is genuine and starts inside that window.

## What passed 105–107 — the depth cap latches on the rate

`depthLatchRate=1` + `depthRateMs=3000`, and `depthRelease=0.6` +
`depthReleaseMs=5000` (all new, all default on). **Nothing about when the cap
ARMS changed** — only the latch that makes it permanent and hands the chase over.

The cap was never the coin flip. It is recomputed every tick and it does bind:
in both draws of `…1775179800` the leg is stopped dead under 800. The LATCH
waited to observe the leg at or above `depthHold`×`qty`, so at 747 held with 53
shares of room, one draw's fill lands 53 and latches, and the other's lands 32,
stops on 779, loses the reading two seconds later, and eight seconds after that
runs 779 → 1000 while DOWN sits on 406. That is the whole ±20 ms coin flip.

The latch now also engages when the leg is buying faster over `depthRateMs` than
the room the cap has left it — 153 shares in the three seconds before the cap
bit, against 31 shares in the previous half-minute on the market the naive
repair destroys.

The naive repairs, each measured over the first 110:

| Repair | Result |
|---|---|
| latch when the cap would clamp the next CLIP | 103 fixed 4/4, **`…1775172600` (95) broken 4/4** — latches DOWN at 719, buys UP out at 0.40, ends 1000/719 with DOWN winning |
| drop the freshness clock from the RELEASE entirely | 103 fixed, markets 28 and 31 stranded on 800/1000 — the cap survives into windows where the leg it stopped is the WINNER |
| `reserveFull` 0.6 / 0.75 / 0.9 (reserve the second leg's honest cost) | 17 / 17 / 20 failures |

`depthReleaseMs=0` (rate latch alone, no grace) costs market 102. The two
together are what hold.

**The trap that cost an hour:** `pushRate`/`pushDepthRate` sit behind
`if (cfg.commitRate > 0)` and `commitRate` is 0, so the new deque was empty and
the rate rule silently did nothing. The sweeps looked like the idea failing.
`pushDepthRate` now has its own guard. Check the guard on any deque you read.

## What passed 108 — a lag the player just made is not a lag it was carrying

`fairLagLatch=1` plus `ptbFairLagDwellMs=10000` (both new, both default on).
Neither works without the other: the latch alone leaves market 108 at 648/1000,
the dwell alone leaves it at 200/1000, together it passes.

The model-book disagreement may override which leg is chased, and the leg it
names is read against the narrow 0.03 threshold instead of the wide 0.07 once
that leg is `ptbFairMinLag` behind. Two things were wrong with how the narrow
threshold was granted.

1. **The latch did not remember what licensed it.** `fairLatch === fairWant` in
   the `fairEdge` expression means *any* override that has ever opened is read
   at the narrow threshold from then on. Market 108's disagreement clears 0.07
   for eight seconds around t+48s in a balanced window, and then sits between
   0.040 and 0.069 for three minutes — under the wide reading, over the narrow
   one — holding the chase on DOWN while the book walks UP from 0.48 to 0.58.
   `fairLagLatch=1` gives the lag its own latch.
2. **The lag was read as an instant.** With the latch fixed, the player chases
   UP correctly to t+190s, then takes 217 more UP in ONE SECOND as the book
   jumps. That fill *creates* a lag of 342, the floor opens on the same tick,
   the chase is handed to DOWN, and 260 of the remaining 394 dollars buy DOWN
   out at 0.38. 686 UP stranded, UP wins. `ptbFairLagDwellMs` requires the lag
   to have STOOD for ten seconds first.

The dwell band is flat: 5 s, 10 s and 20 s each leave exactly one failure over
the first 110 and it is the same market (109) in all three.

## The completing purchase carries no signal — measured, not argued

`tools/closeScan.ts` reads the observation channel and reports, for every window
in the sweep, what the book looked like at the tick where the player first took a
leg to its target. Market 109 completes DOWN at t+149 with the other leg quoted
at 0.36, 344 of it already held, 792 dollars spent, the volatility-normalised
oracle 0.19 bands in the completed leg's favour and 0.62 of the near depth on its
own side. **Every one of those numbers sits inside the passing distribution, and
about twenty passing windows complete a leg on worse ones** — 1775148300 finishes
its leg with the oracle 0.76 bands AGAINST it and passes; a dozen finish with the
other leg at 0.61–0.68.

So no rule keyed to the moment of completion can reach market 109 without firing
on the field. That is now measured rather than suspected, and it retires a whole
family of ideas: a price cap on the finishing clip, an "is the other leg cheap
enough to sweep yet" gate, a confidence test on the completing purchase, and any
variant of the average-cost guard.

Two mechanisms were built to test it rather than assume it. Both ship disabled
and both keep their measurements in their doc comments:

- **`burstSwap`** — the `depthHold` shape (cap, latch, hand the chase over) on
  money velocity: how much of the ceiling one leg has committed in thirty
  seconds. It is the one reading that does describe all three blockers since
  level 101. Over the first 110: **29 failures at 0.35** (109 repaired), **19 at
  0.45** (109 not), and gating it on the leg already holding six or seven tenths
  of its target changes nothing (29 and 30). A leg spending a third of the
  ceiling in half a minute is ORDINARY.
- **`stallFinish`** — see below.

## The blocker, restated — one pot, and a choice that has to be made at t+115

Market 109 needs the player to own UP rather than DOWN. Everything else about
the window is settled, and two of the three routes to it are now closed by
measurement rather than by argument.

1. **After the flip, UP is not overpriced — it is UNFUNDED.** The obvious
   diagnosis was `underdogMax=0.1`: the priority flips to DOWN at t+115, the 344
   UP shares become an underdog's, and a leg the market never quotes below 0.34
   can never be bought at a ten-cent ceiling. `underdogHeldShare` lifts that
   ceiling for a leg already holding a share of its target, and at 0.2/0.3/0.5/
   0.7 market 109 **does not move by a single share** — 343.75/1000 and the same
   cost to the cent. The binding term is the other half of the second leg's cap,
   `(budgetLeft − needFirst × bidFirst) / needSecond`: with 800 DOWN still to buy
   near 0.6 it is about 0.32 against an UP ask of 0.39. There is one pot and the
   chase has already claimed it. No price ceiling can reach this.
2. **The chase itself cannot be made cheaper.** `jumpPad` with and without
   `jumpCross`, at pads 0.02–0.08 and τ 5–15 s, leaves DOWN at 1,000 in every
   setting and moves the spend by at most fifty dollars (779.7, 790.5, 775.5,
   738.0, 739.6). The cap delays the crossing; the window then spends four
   minutes with DOWN as the favourite and the leg fills passively at much the
   same prices. Two of the five settings make the market strictly worse.
3. **Never flipping the priority is worse than flipping.** `priorityLatch=1`
   re-measured at `4c5b9ce7`: **12 failures** over the first 110, four of them
   ending 0/1000 or 1000/0. Unchanged verdict, now at the current configuration.

So the only surviving route is the one below — commit to UP BEFORE the flip —
and the four gates tried on it all straddle.

## The lead that closed — `stallFinish`, gated four ways

Baseline over the first 110 is one certain failure (109). Every configuration of
the release is worse:

| Configuration | Failures | 109 |
|---|---|---|
| release ungated, 20 s dwell | 6 | repaired |
| + release only after t+90s | 3 | repaired |
| + release only to the leg 0.03 dearer | 6 | repaired |
| both gates | **2** | repaired |
| both, ask lead 0.06 | 3 | repaired |
| both, clock 100 s | 2 | repaired |
| both, dwell 25 s | 2 | **lost** |

Two things killed it.

- **The snapshot does not separate.** `…1775184300` releases DOWN at t+26 with
  ask 0.520 against 0.490 and 344/200 held, and 109 releases UP at t+110 with ask
  0.540 against 0.470 and 344/200 held. Same shares, same allowance (200 vs 219),
  same money left to the dollar, the same unaffordable pair (finish + sweep is
  1.07× the budget in one and 1.06× in the other). Peak allowance, per-leg idle
  time, solvency ratio and the share held were all measured across all seven
  release moments and none of them orders 109 against the field. Only the clock
  does.
- **The clock is not a rule, it is a delay.** A leg over its allowance at t+30 is
  still over it at t+90, so the gate postpones the release rather than refusing
  it — and `…1775109600` passes with an early release and fails with a late one,
  in every clocked variant. That is the opposite of the story the clock tells.

The release moments themselves, for whoever picks this up: 109 fires UP at t+110
with the ask 0.07 dearer; the casualties fire at t+26, t+27, t+30, t+54, t+70 and
t+77 with leads of 0.03, 0.05, 0.05, 0.11 and 0.13 — the repair sits inside the
casualties' range on every axis except elapsed time.

Six of the seven releases hand the window to the leg that goes on to LOSE. The
previous session read the common casualty shape as "the release is sound, the
question is which leg"; the honest reading is that the release is a directional
bet placed while the book is at a coin flip, and it is wrong most of the time.

## Why every room cap on the chase dies — measured, and it is the whole player

`closeScan --tag obs34 --sort t` over the first 110 at shipped defaults:

- **110 of 110 windows complete a leg mid-window.** There is no such thing here
  as a window that accumulates evenly and finishes both legs at the death.
- **84 of the 110 complete that leg before t+120s**, and the earliest are
  absurdly early: 1775116800 holds 200/200 four seconds in and 1000/375 at t+8s.
  Fourteen windows finish a leg inside the first twenty seconds.
- Market 109 completes DOWN at **t+149s — later than three quarters of the
  field.** Its spend at that instant (792) and the other leg's ask (0.36) are
  mid-field on every column.

So "a leg finished this early was finished before the window said anything" is
simply false about this player: finishing early is how it wins, and the shares
are not there to buy again later. Any rule that delays or rations the completing
purchase — by clock, by money velocity, by share of target — blocks the
mechanism in most of the field, and the measurements below are what that looks
like.

| Change (at `d60e48e1`, baseline 1 failure over the first 110) | Failures |
|---|---|
| `lateShare=0.7` + `lateMs=240s` / `300s` (no leg past 0.7 of target early, with a handover) | **50 / 46** |
| `burstShare=0.20` / `0.25` + `burstPause=1` (velocity cap on the chase, chase handed over while paused) | **48 / 36** |
| the same, gated by `burstFrom` 0.5 / 0.6 / 0.7 (cap only a leg already mostly built) | **39 / 41 / 39** |
| `burstShare=0.20` + `burstFrom=0.7`, **pause off** (the cap alone, no handover) | **10**, and 109 unmoved |

The last row is the informative one. A cap that rations only the last 300 shares
of a leg, to a fifth of the ceiling per thirty seconds, still costs nine
markets — every one of them ending with a leg stranded between 600 and 950 and
several hundred dollars of the ceiling unspent. **The finishing burst is not an
anomaly to be restrained; it is the only moment most of these legs are buyable
in.** The handover then adds thirty more failures on top, because exempting the
receiving leg from the edge pace un-paces the whole window.

`burstShare=0.20`+`burstPause=1` DOES repair market 109 (1000/1000 at 0.968), as
does 0.25. That repair is worth nothing at 36 casualties, and it is recorded here
only so nobody re-derives it.

## The parity cap is dead too, now with its deadlock released

`overtakeCap` — a chase pointed at the leg the player holds LESS of may draw
level and no further, chase handed back, latched. Session 32 measured the
ungated version at 12 failures and diagnosed nine of them as a deadlock: the
leader latched by `depthHold` at 800, the trailer pinned at parity with it,
nothing buyable. This session rebuilt it WITH that release (the parity cap stands
down for good the moment `fairHold`/`depthHold`/`burstSwap` latches the leg it is
measured against) and gated it four ways:

| Configuration | Failures |
|---|---|
| ungated | 16 |
| `overtakeFrom` 0.20 / 0.30 / 0.40 (the abandoned leg must already hold this share) | 19 / 17 / 10 |

The release was right about the deadlock and it does not matter. The new failure
shape is `1000/0` and `200/1000`: the pinned leg answers to `underdogMax`, a
loser's price a contested leg is never quoted at, so it never buys at all and the
player buys the LOSER out. Exempting it from `underdogMax` cannot help either —
the budget arithmetic below forbids owning both legs at contested prices.

**The general statement, which is now the strongest thing known about this
player:** the leg the book names is right 109 times in 110, and every rule that
has overridden that choice permanently — `priorityLatch`, `overtakeCap`,
`burstSwap`, `stallFinish` — has cost between 6 and 29 markets by buying the
loser out. Market 109 is the one window where the book is wrong, and it is wrong
in a way no observable the player has can see.

## The old lead's diagnosis, which still stands

Market 109's first two minutes are a total stall, and that is where the money
goes missing. The player holds 344 UP against an edge allowance of 219, its own
bid one cent under an ask it may not take, and **buys nothing at all from t+82 to
t+113** while both asks sit either side of 0.50. Then the book turns. Completing
UP at 0.54–0.56 during that stall costs $360 and leaves $321 for a DOWN leg that
ends at 0.02 — a pair cost near 0.66, by far the largest margin any counterfactual
in this window has.

The cause is that the edge allowance ratchets one way. Shares bought while the
asks were apart stay bought when they come back together, and the pace then reads
the position it licensed itself as an over-commitment and freezes it. That is not
a limit on new commitment; it is a leg the player may neither add to nor sell.

`stallFinish=1` treats a leg that has stood above its own allowance for
`stallFinishMs` as finished rather than paced. Over the first 110, against one
failure with it off:

| Setting | Failures | 109 |
|---|---|---|
| `stallFinishMs=20000`, `stallFinishIdle=0` | 7 | repaired, 1000/1000 at 0.967 |
| `stallFinishMs=30000`, `stallFinishIdle=0` | 5 | lost |
| `stallFinishMs=20000`, idle on | 5 | lost (404/1000) |
| `stallFinishMs=15000` / `10000`, idle on | 7 / 8 | lost (425/1000) |
| `finishShare=0.35` (the blunt version of the same release) | 8 | repaired |

`stallFinishIdle` — also require the player to have bought nothing on either leg
for the dwell — is right about the casualties and wrong about the repair: 109's
silence begins at t+82 but the leg only goes over its allowance at t+91, so the
idle clock pushes the release to t+111, three seconds before the turn.

Every casualty at every setting is one leg at 1,000 and the other stranded
between 200 and 600 — and the gates tried on that shape are in the section
above. The ratchet itself is real and the counterfactual is still the best one
this window has; what has no answer is who gets to take the release.

## The remaining known blocker — market 109

`…1775185200` (109) ends 343.75/1000, outcome UP, and nothing in this session
moved it. Its timeline (`--param debug=1 --param debugEveryMs=2000`):

- t+0–t+113s: quiet, the player holds 344/200 for 289 dollars.
- t+115s: askDown jumps 0.48 → 0.61 in two seconds. Genuine — `pModel` goes to
  0.39 with it. The book is not wobbling; the market really moved.
- t+129s–t+149s: the player buys 800 DOWN at 0.55, 0.62, 0.61, 0.63 and finally
  **329 shares at 0.65**, reaching 1000 for 791.7 total. Note it buys MORE as
  the price goes UP: the cheap fills at 0.53–0.55 are the small ones.
- The move then reverts completely. askUp is 0.34–0.47 for the next four
  minutes; the player has 178 left for 656 UP (0.27 a share) and never fills.

The counterfactual worth knowing: had it stopped DOWN at 671 instead of buying
the last 329 at 0.65, it would have had 398 left, enough to finish UP at
0.36–0.40 and then sweep DOWN at the death (DOWN closes at 0.02). So the fatal
act is the LAST purchase of the chase, not the decision to chase DOWN.

## The flake list is longer than one market

Three sweeps of the first 110 at shipped defaults in one session returned 1, 1
and 3 failures. The two extra markets in the third are `…1775110500`
(562.71/1000) and `…1775136600` (1000/543.75), and both then passed **4 of 4**
single-market probes at the same configuration. They are marginal on the latency
draw exactly the way `…1775178000` is, and neither is new — both appear
intermittently in the experiment sweeps above.

So the honest baseline over the first 110 is "one certain failure and a tail of
draw-dependent ones", and **a level run can fail on a market the sweep has never
shown you**. Treat a single clean sweep as weak evidence. Sweeps are unseeded, so
two sweeps at the same settings are two different draws.

## The flake — `…1775178000` is a reproducible coin flip

Market 101, inside the level 105–108 regression set. It fails about **2 draws in
24** at 718.75/1000, and it does so IDENTICALLY at the pre-`c6669a59`
configuration — same share counts, same cost to the cent. This is not something
this session introduced; levels 101 through 107 were all recorded over it.

It now has a handle. With `tools/lib/seedRandom.mjs`, **`PG_SEED=1` and
`PG_SEED=11` fail; 22 other seeds in 1–24 pass.** Diffing seed 1 against seed 3
at `debugEveryMs=250` locates the split exactly:

- Both draws reach 523/375 at t+25s with a live UP bid at 0.63 and askUp 0.63.
- Seed 3 fills 477 more shares off that one resting order and finishes UP at
  t+26s for 802. Seed 1 fills 53, the re-quote drops the bid to 0.62, and askUp
  never trades below 0.63 again until it collapses to 0.33.
- Seed 1 then ends the window the way markets 108 and 109 end theirs: at t+286s
  it takes DOWN from 509 to 1000 in one burst at ~0.60, leaving 36 dollars for
  281 UP. UP wins.

So the flip is a latency race on ONE resting cross, and the loss it causes is
the same burst-completes-the-losing-leg shape as the other two blockers.

Each market is an independent episode, so a level passes exactly when every
market in it passes on its own. `tools/sweep80.sh` finds the next blocker over
110 markets in about **75 seconds** — far cheaper than climbing level by level.
Note that a marginal market moves in and out of that list between sweeps; run a
suspect market four times in parallel before believing either verdict.

## The budget arithmetic — read this before designing anything

Per-share cost including the 7 bp taker fee is `p + 0.07·p·(1−p)`. A pair bought
symmetrically at a coin flip costs **1.035**; a pair completed after the market
has decided, winner at 0.95 and loser at 0.03, costs **0.985**. So a plan that
holds N pairs from the coin-flip period and completes the rest after the
decision costs `1.035·N + 0.985·(1000−N)` — **$985 at N=0 and rising** — above
the $980 the rule allows. Two consequences:

1. **There is no safe play.** The player must make a directional bet before the
   market has decided and be right.
2. The player's real game is: name the winner, buy it out, and sweep the loser
   for pennies at the death. Its cost distribution is budget-bound in nearly
   every window (median 0.962), so **any rule that withholds money from a leg
   does not make it careful — it makes some market end short.** `depthHold`
   survives only because it does not withhold: it redirects the money to the
   other leg, which is cheap at exactly the moment the cap fires. `edgeMinDep`
   survives for the same reason it is a ramp and not a gate, and `closeFinish`
   because it only ever ADDS budget, and only to the last purchase in the window.

## Measured dead — do not re-try

Everything below was measured over the FULL market set, not a single-market
probe. **A single-market probe is not evidence for a global pace or cap change.**

Over the first 110, at the levels-84–86 configuration (baseline 5 failures):

| Change | Failures |
|---|---|
| `ptbPace=1` (pace on the weaker of book and outside price) | 18 |
| `pairCeil` 0.978 + `finishCeil` 0.98 | 5, but market 39 breaks |
| `jumpPad` 0.05/0.08/0.12 with `jumpCross=1`, τ 8–15 s | market 95 unmoved |
| `commitDwellMs` 8 s / 20 s | 4 / 4 (different markets each) |
| `reserveFull` 0.6 / 0.75 / 0.9 | 17 / 17 / 20 |
| the depth latch on "the next clip would be clamped" | 3, and market 95 breaks |
| the depth release with no freshness clock at all | 4, markets 28 and 31 break |

At `c6669a59` (baseline 1 failure over the first 110):

| Change | Failures |
|---|---|
| `depthGate` 0.60 (the reading misses market 109's burst by 0.05) | 3, and 109 unmoved |
| `depthGate` 0.58 | 4, and 109 unmoved |
| `overtakeCap=0.5` — a chase starting from BEHIND is capped at parity and handed back | **12** |
| `swapEdge` 0.3 / 0.5 — the priority leg is sticky in proportion to what is sunk in it | 10 / 16, 109 unmoved in both. The threshold is fixed while the move that flips the leg is twenty cents, so it delays the swap by one second. |
| `avgGuardFrom=0.9` — the realized-average ceiling applied to the completing clip only | **49**. It stops the leg at 700–800 in almost every window and the money has nowhere to go: the textbook demonstration that a cap without a handover is inert. |
| `burstSwap` 0.35 / 0.45, and with `burstSwapFrom` 0.6 / 0.7 | 29 / 19 / 29 / 30 |

At `4c5b9ce7` (baseline 1 failure over the first 110, 2 on this session's draw —
the second was `…1775110500`, a known flake):

| Change | Failures |
|---|---|
| `stallFinish` gated six ways (see the table above) | 2 at BEST |
| `underdogHeldShare` 0.2 / 0.3 / 0.5 / 0.7 (lift the loser cap on a leg already part-built) | 109 unmoved to the cent — not a price problem |
| `jumpPad` 0.02–0.08 × `jumpCross` 0/1, τ 5–15 s | 109 unmoved; DOWN reaches 1,000 in all five |
| `priorityLatch=1` | **12** |

At `d60e48e1` (baseline 1 failure over the first 110, confirmed twice this
session) — see the two sections above for what each of these is:

| Change | Failures |
|---|---|
| `overtakeCap=1`, ungated / `overtakeFrom` 0.2 / 0.3 / 0.4 | 16 / 19 / 17 / 10 |
| `burstShare` 0.20 / 0.25 with `burstPause=1` | 48 / 36 |
| the same at `burstFrom` 0.5 / 0.6 / 0.7 | 39 / 41 / 39 |
| `burstShare=0.20` + `burstFrom=0.7`, no handover | 10 |
| `lateShare=0.7` + `lateMs` 240 s / 300 s | 50 / 46 |

`overtakeCap` is worth one paragraph because the idea keeps suggesting itself.
Three of the failures — market 101's losing draw, market 108 before the fix, and
market 109 — are the same picture: the player holds 719/509, 686/344, 344/671,
the chase points at the smaller leg, and it runs that leg to a thousand in one
burst while the larger one is stranded. Capping the trailing chase at parity
looks like it addresses all three at once. It does not: it deadlocks windows.
Nine of the twelve failures come to rest at 800/something or something/800 —
the leg that is ahead is stopped by `depthHold` at 800, the leg behind is
stopped at parity, and nothing may be bought at all. This is the same deadlock
`solvDrop`'s comment describes, arrived at from the other direction.

On the level 68 window (baseline was 1 failure over the first 68):

| Change | Failures |
|---|---|
| `edgeFull` 0.45 / 0.50 | 12 / 15 |
| `edgeHoldMs` 20 s / 30 s / gated | 14 / 15 / 9 |
| `holdRamp` 0.3 | 16 |
| `spendPace` 0.35 / 0.40 / 0.45 | 18 / 16 / 13 |
| `maxImbalance` 300 | 43 |
| `oracleHold` 0.6 / 0.7 / 0.8 | 24 / 31 / 29 |
| priority swap on "can't afford both", 4 gates | 24 / 13 / 21 / 23 |
| the same, gated on the chased leg's share of target | 24 / 27 / 24 / 20 |
| `solvDrop` 0.10 / 0.14 / 0.18 / 0.18+gap | 21 / 19 / 19 / 21 |
| `burstShare` 0.15 / 0.18 / 0.20 | 13 / 9 / 12 |
| `reserveLow` 0.7 / 0.8 / 0.9 / 1.0 | 3 / 9 / 9 / 11 |
| `fairHold` (the model-book disagreement as a cap) | 7–9, on four settings |
| `fairHold` + a release on the volatility-normalised oracle | 7–9 — unchanged |
| the parity hold released by the oracle, any band | 7 at BEST, on perfect execution |

Over the first 84, with the `edgeMinDep` gate (baseline 1 failure):
`edgeMinDep` 2,500 → 5 failures, 2,000 → 2, 1,900 → 1 (a different market),
1,000 → 1 (level 84 still failing).

Earlier: `commitRate`, `commitRise`, `underdogMax`/`underdogLift`, `swapEdge`,
`reserveMom`, `reserveLowUntilMs`, `priorityLatch`, `momDeadband`,
`priority=dear`, `reserveLow` escalation/de-escalation, price caps pinned to a
leg's own low, budget averages, `avgGuard`/`avgGuardFrom`, the `earlyShare`
family, `reserveLow=0` globally, `solvSwap`, and the chased leg's ask average as
an "is it running away" test.

**Do not reopen** on any window: the parity hold; `fairHold` with or without a
release; the opening-lean thread (`convDwellMs`, `openCheapMs`); any solvency or
underwater test; any rule that treats the model-book disagreement as a warning
(it is a GOOD direction signal — eight of the nine windows where it is strong
settle the way it points); **any rule that permanently overrides which leg the
book names**; and **any cap that delays, rations or slows the purchase that
completes a leg**, by clock, by money velocity or by share of target — the
completion-time distribution above is why.

**Also dead, from level 87's diagnosis:** `finishShare` and `finishCeilShare` are
NOT what completes the leg at the top of a slow trend. Turning `finishShare` off
on level 87's market changes nothing (still 1000/343.75); the pace is lifted by
`completing`, the `commitShare` exemption, not by the finish exemptions. The old
STATUS pointed at the finish exemptions here and was wrong.

## What is measured about the player, and stays true

- **Going underwater is normal.** `tools/underwaterScan.ts`: the level 68 window
  peaks at 2.20× its remaining budget and is twelfth of 68 — eleven passing
  windows go further, up to 5.69×.
- **Buying dear while unconfirmed is normal.** `tools/buyScan.ts`: 26 of 68
  markets buy 1000+ shares at an ask of 0.55 or more while the oracle has not
  confirmed that leg.
- **The volatility-normalised oracle is an accurate, LATE witness.**
  `tools/volScan.ts`: dividing BTC's distance from the price to beat by its own
  measured volatility instead of a fixed $60 takes the wrong-side rate at 1.6
  bands from 14/68 to 1/68, but moves the median crossing from t+262s to t+680s.
  Useless as a gate on the chase, right as a release. It is in the code as
  `outsideZ` and only `fairHoldZ` reads it.
- **The depth reading needs both a share and a size.** Only 23 of the first 80
  windows ever reach a 0.70 share on the offline reading at all, and the ones
  that reach it in the opening half-minute are carrying a third of the size the
  ones later in the window carry. `tools/depScan.ts` prints both.
- **Absolute near depth belongs on the PACE as well as the cap**, and there it
  has to be proportional rather than a threshold — see levels 84–86.

## What passed the earlier levels

- **47** — `commitShare=0.6` + `commitReserve=1`, gated by `commitLeadMs=12000`,
  `commitLag=0.15`, `commitLoss=0.045`. Arming is one-way.
- **52** — `finishCeil=0.975`, a second higher pair budget that only a leg past
  `finishCeilShare=0.85` may reach, and only by crossing.
- **67** — `oracleReserve=1.5` stands the `reserveLow` floor down once BTC has
  run clear of the price to beat by 1.5 bands in the priority leg's direction.
- **68** — `depthHold=0.8` on `depthGate`, the share of near depth sitting on the
  bid, with `depthFreshMs=30000` so it only arms on a lean under thirty seconds
  old.
- **80** — `depthGate` 0.66 and `depthMinDep=2500` in place of the clock the cap
  used to wait on.
- **84–86** — `edgeMinDep=1500` with `edgeDepRamp=1`.
- **87–94** — `closeFinish=1`.
- **95–104** — `commitDwellMs=12000`.
- **105–107** — `depthLatchRate=1`/`depthRateMs=3000` plus `depthRelease=0.6`/
  `depthReleaseMs=5000`.
- **108** — `fairLagLatch=1` plus `ptbFairLagDwellMs=10000`.

## Tools

- **`tools/sweep80.sh <tag> <N> [--param k=v ...]`** — one parameter set over the
  first N markets in four parallel chunks, printing only the failures. About
  seventy-five seconds for 110 markets. This is the workhorse; use it instead of
  hand-splitting slug lists.
- `tools/probe2.sh <tag> "<slugs>" [--param k=v ...]` — one parameter set over an
  explicit slug list; writes `/tmp/pg/<tag>.{json,err,rows}`. Use this rather
  than `probe.sh`, which swallows stderr. **Running four probes in parallel is
  the cheapest way to sample the latency jitter on one market**; when `.rows`
  comes back empty, read the run id out of the log and re-run `results.ts`.
- **The stall instrument**: with `debug>=2` the player prints ONE line the first
  time the `stallFinish` release fires on each leg, carrying both asks, both
  holdings, the money left, what finishing and sweeping would each cost, the
  oracle, the current and peak edge allowance, and both idle clocks. That one
  line is what showed the repair and its casualties to be the same state. Reads
  nothing and gates nothing; copy the shape for the next rule that needs a
  moment-of-decision measurement rather than a timeline.
- **`--param debug=2` is the observation channel**: one line per market per
  `debugEveryMs` for the WHOLE window, emitted above every early return. It
  carries `depUp=`/`depDown=` (cumulative bid/ask size within three levels),
  `dimb=`/`dabs=` (the player's own smoothed share and absolute near depth),
  `dcap=` (the leg the depth cap has latched) and both best bids. `debug=1` stops
  the moment the player is done, which silently truncates any measurement of what
  happened later. Diffing the same market's timeline across two jitter draws at
  `debugEveryMs=5000` is what located the level 103 bug in one pass.
- **`tools/closeScan.ts --tag <sweepTag>`** — for every window in an observation
  sweep, the book at the tick where the player first took a leg to 1,000: both
  asks, the shares already held on the other leg, the money spent, the oracle
  signed toward the completed leg, and the depth share. Needs
  `sweep80.sh <tag> 110 --param debug=2 --param debugEveryMs=500` first.
  `--sort other|z|p|t|slug`. This is what retired the whole "restrain the
  completing purchase" family in one pass, and `--sort t` is what retired the
  clock version of it — read the completion-time distribution before proposing
  any rule that delays a leg.
- `tools/depScan.ts` — locates each window's arming moment offline (first sample
  where the dearer leg's smoothed share clears `--gate`, the lean is fresh and
  that leg is ahead) and reports the elapsed time, the share and the absolute
  size resting there. `--sort arm|dep|minDep`.
- `tools/bookScan.ts` — finds each window's chase without reference to any rule
  and ranks it against the field on ask, gap, book velocity, lean age, book churn,
  path efficiency and depth imbalance. Needs `/tmp/pg/obs_*.err` observation runs.
- `tools/parityScan.ts`, `tools/buyScan.ts`, `tools/volScan.ts`,
  `tools/underwaterScan.ts` — the other offline analyses of that channel.
- `tools/level.ts --level N --run <id>` — the only place a level may be scored.
  It requires the run's market set to be EXACTLY the level's universe, so every
  level needs its own run.
- `tools/play-level.ts --level N` — run and score one level in one command.
  Roughly four minutes for a level around 100 (it replays sequentially in one
  process); three run fine in parallel. Its tail is the market table, so grep for
  `^LEVEL` or score the run afterwards with `level.ts`.
- `tools/smoke.ts --strategy pair-game-opus-pair.v1` — the scoped smoke test.
  It REQUIRES `--strategy`.
- `tools/lib/seedRandom.mjs` — the ONLY non-determinism in a run is
  `Math.random()` in `BacktestExecution` (the ±20 ms latency jitter), so a
  single-market probe is one sample:
  `PG_SEED=11 NODE_OPTIONS="--import file://$PWD/protocols/pair-game-opus/tools/lib/seedRandom.mjs" probe2.sh tag "<slugs>"`.
  Record level evidence from ordinary unseeded runs.
- The first N slugs:
  `npx tsx protocols/pair-game-opus/tools/universe.ts --first N --slugs-only`.
- Recent run ids:
  `npx tsx protocols/pair-game-opus/tools/sql.ts "select id, batch_uid from backtest_runs order by id desc limit 10"`.

### Traps that have each cost a session

- **A cap you can name is not necessarily the cap that binds.** Market 109's
  abandoned leg was diagnosed as blocked by `underdogMax`; a knob that lifts it
  entirely moved the window by zero shares, because the second leg's cap is a
  `min` and the BUDGET term was the smaller one. Before building a release for a
  ceiling, lift the ceiling to infinity and confirm the market moves at all — it
  costs one probe.
- **A single failing market does not name its own cause.** Level 80 was recorded
  as "the warmup lets it through" on a reading of one timeline; the warmup was
  innocent, and the counterfactual took one sweep to run. Level 87 was recorded
  as the finish exemptions and they were innocent too. Before spending a session
  on a stated cause, turn the suspected rule OFF and confirm the market actually
  changes.
- **A fix measured on one level breaks the next one.** The `edgeMinDep` gate
  passed 84 and broke 85 — the very next market. Sweep the first N+5 before
  believing a level, not the first N. At 75 seconds a sweep, always sweep 110.
- **A level can pass on luck.** Market 103 passes one draw in four, and levels
  103 and 104 are recorded on passing draws. Before treating a level as solid,
  run its newest market four times in parallel.
- **A flaky market can hide behind the sweep.** `…1775178000` passed twelve
  unseeded single-market probes AND five 110-market sweeps in a row, then failed
  a level run. Four parallel probes is not enough resolution for a 1-in-12
  event; when a level run fails on a market the sweep says is fine, scan seeds
  1–24 with `seedRandom.mjs` rather than re-running and hoping.
- **Diff the failing draw against a passing one at `debugEveryMs=250`.** Two
  seeds and one `paste` located market 101's split to a single resting order in
  about a minute. The 5-second timeline showed nothing but the aftermath.
- **`/tmp` is case-insensitive here.** Probe tags `Z1` and `z1` are the same
  files, so a run can silently read a previous session's rows. Delete the target
  `.rows` before waiting on it. `rm -f /tmp/pg/tag.*` fails under zsh when
  nothing matches — list the three files instead.
- **zsh does not word-split unquoted variables.** Never collect `--param` flags
  in a shell variable, and never use `set -- $pair` to split a "a b" string.
  Pass the flags literally to `probe2.sh` / `sweep80.sh` — a sweep that silently
  drops them reproduces the baseline and looks like a result.
- **Per-tick state set inside the `needUp > 0 && needDown > 0` branch is stale
  once a leg completes.** `fairCapSide`/`fairHandover` and `depthCapSide`/
  `depthHandover` are cleared above the branch; check any new per-tick latch the
  same way. `chaseWrongSinceMs` is updated inside the per-side loop but only for
  `side === chaseLeg`, which is the only side that reads it.
- **A per-tick cap that only latches at a share threshold can be stepped over.**
  This hid the real cause of level 80 and it is what made market 103 a coin
  flip; `depthLatchRate` fixed it. Check any new latch the same way, and note
  that the fix is NOT "latch earlier" — it is "latch on the thing the threshold
  was standing in for".
- **A deque you read may not be being written.** `pushRate` sits behind
  `if (cfg.commitRate > 0)` and `commitRate` is 0. A new rule reading it got
  zeros and did nothing, through two full sweeps that looked like an honest
  negative result. Confirm the state you depend on is actually maintained at
  shipped defaults before believing a measurement.
- **The debug line's `dcap=` prints `depthHeld`, the LATCH — not
  `depthCapSide`.** `darm=` prints the arm. A window can be capped for its whole
  length with `dcap=-`.
- **The live reading is not the offline reading.** The depth imbalance measured
  as a boxcar mean over 1 Hz observation samples peaked at 0.83 in the level 68
  window; the same quantity as an EWMA over the dense tick stream peaks at 0.76.
  Offline scans are for finding a separation and ranking windows, never for
  picking a threshold — read the threshold off the player's own debug timeline.

## Needs human

Nothing.
