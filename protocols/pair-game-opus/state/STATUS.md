# Status — Pair Game Opus

- Highest passed level: **107** (first 107 eligible markets)
- Current level: **108** (first 108 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: `2026-08-03T11:37:27.659Z-35d1de5f`

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

## The remaining known blockers — the player backs the wrong horse

Probed at shipped defaults over the first 110 markets, the failures are:

`…1775184300` (108) 200/1000, outcome UP; `…1775185200` (109) 343.75/1000,
outcome UP. Deterministic — 108 fails 4 draws out of 4.

They are consecutive and identical in shape, and they are NOT timing accidents:

- 108: the book wobbles either side of even for three minutes (askUp 0.48–0.58).
  The player takes 200 UP and 344 DOWN in the first ten seconds, then buys
  **nothing at all from t+20s to t+140s** — correctly, the pair is quoted at
  ~1.00 throughout. From t+141s it commits to DOWN and finishes it at t+191s for
  551.9 total. UP is then 0.63 and rising with 420 left for 800 shares (0.525 a
  share), so UP never moves again and the window ends 200/1000 on an UP market.
- The cheapest UP after the opening was 0.48 (t+30–t+80), affordable then.

So the decision that loses these two is the commitment itself, made against a
book that was leaning UP (pBook 0.51–0.62 from t+91s on) while `pModel` sat
below it. Every fix so far has been about caps and latches on a chase that was
already pointed the right way; this one is about which leg to chase. Expect it to
need a different kind of change, and remember the budget arithmetic below: there
is no safe play, so "chase neither" is not an answer.

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
underwater test; and any rule that treats the model-book disagreement as a
warning (it is a GOOD direction signal — eight of the nine windows where it is
strong settle the way it points).

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
- **`--param debug=2` is the observation channel**: one line per market per
  `debugEveryMs` for the WHOLE window, emitted above every early return. It
  carries `depUp=`/`depDown=` (cumulative bid/ask size within three levels),
  `dimb=`/`dabs=` (the player's own smoothed share and absolute near depth),
  `dcap=` (the leg the depth cap has latched) and both best bids. `debug=1` stops
  the moment the player is done, which silently truncates any measurement of what
  happened later. Diffing the same market's timeline across two jitter draws at
  `debugEveryMs=5000` is what located the level 103 bug in one pass.
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
