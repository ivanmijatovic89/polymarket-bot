# Status — Pair Game Opus

- Highest passed level: **83** (first 83 eligible markets)
- Current level: **84** (first 84 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: `2026-08-03T11:37:27.659Z-35d1de5f`

## Evidence

Levels 1–45 at commit `4f21eb1e`, runs 3744–3788 (one run per level, level N =
run 3743+N). Levels 46–51 at `3d8055f9`. Levels 52–59 at `e16f30fe`. Levels
60–66 at `18640212`. Level 67 at `80d695a0`. Levels 68–79 at `71e47612`.

Levels **80–83 at `acf79c2e`**, all defaults, one `play-level` run each:
80 → run 4571, 81 → 4572, 82 → 4573, 83 → 4574. Level 80 was also re-run
independently (run 4576) and passes 80/80 again, so it is not a jitter artefact.

## What passed level 80 — a size floor and a wider gate on the depth cap

The blocking window opens at a coin flip, DOWN leans to 0.64 by t+50, the player
takes its entire DOWN leg inside that lean, and the window mean-reverts and
settles UP.

The suspicion recorded last session was that `depthAfterMs=45000` disarmed the
depth cap until t+45 and let the buyout through. **That was wrong, and measuring
it was the whole session.** With the clock removed entirely the window still
fails: at `depthGate=0.70` its smoothed depth reading only grazes 0.71 and falls
back under the gate in the same seconds its leg crosses `depthHold`, so the cap
sets a per-tick room but `depthHeld` never latches, and the leg walks through 800
on an unarmed tick. **The gate was the problem, not the clock.**

Two changes, each measured over the first 80 markets:

- **`depthGate` 0.70 → 0.66.** The clean band is 0.65–0.68; 0.62 and 0.70 each
  cost a market. At 0.66 the cap stops DOWN at 800 at t+49s, hands the chase to
  UP, UP completes by t+54 at 0.36–0.39, and the window ends 1000/1000 at 0.970.
- **`depthAfterMs` 45000 → 0, replaced by `depthMinDep` 2500** — the total size
  resting within three levels of the leading leg, smoothed on `depthTauMs`, below
  which its bid/ask share is not read at all. That is what the clock was a proxy
  for. At the instant they arm, the windows the clock protected carry 1,250–1,750
  shares near the top of the book; the level 80 window carries 3,100.

The floor is preferred to the clock on two measurements, not on taste: it holds a
wider gate band (with the clock, 0.64 already fails), and probed market by market
over the first 110 it leaves five failures beyond level 80 where the clock leaves
six. **Caveat: that 5-vs-6 is inside the jitter.** A repeat of the same
configuration at pure defaults gave six, differing only on `…1775179800`. The
part that repeated is `…1775160000` — level 81 — which the floor holds and the
bare clock-off configuration does not.

Level scale is unchanged: the first 80 are clean at `depthMinDep` 2000, 2500 and
3200 alike, and at `depthGate` 0.65, 0.66 and 0.68.

## Level 84 — the open problem

The added market is `btc-updown-15m-1775162700`. It ends **1000 UP / 200 DOWN**
with $434 unspent, and it is a different failure from the last two levels.

The window opens at a coin flip (0.500/0.510) and the book then walks DOWN all
the way to 0.99, settling DOWN. The player is on the wrong side and cannot buy
its way back:

- By **t+15s** it already holds **469 UP against 200 DOWN**, bought on a book
  that is dead even and if anything favours DOWN. That 269-share head start is
  the whole mistake; everything after it is forced.
- It then sits at 469/200 for over two minutes while DOWN runs from 0.51 to 0.69.
- At **t+135–150s** it completes UP to 1000 for another $178 at 0.25–0.33 —
  cheap, and the right move for a leg it intends to keep — leaving $434.
- 800 DOWN shares then cost $552 at the prevailing 0.69, so the pair can never be
  finished, and DOWN only gets dearer from there.

So the thread to pull is the **opening imbalance**, not the depth cap. The depth
cap behaves correctly here: at t+0 the reading is 0.77 on UP but the book carries
only 1,176 shares near the top, and `depthMinDep` refuses to read it — which is
exactly what the floor is for.

Two things to try, in order:

1. Find what buys 469 UP in fifteen seconds on an even book, and whether it is
   allowed to open that far ahead of the other leg before any evidence. The
   opening machinery is `openMs`, `openShare`, `earlyBoth`, `earlyShare` and
   `earlyMs`; the ordinary paces (`reserveLow`, `leadReserve`) are lifted early.
   Read the player's own timeline at `--param debug=1 --param debugEveryMs=1000`
   over the first 30 seconds before changing anything.
2. Note the budget arithmetic below before proposing a cap. Withholding money
   from the opening does not make the player careful in general — it makes some
   other market end short. Whatever is done here has to be conditioned on the
   book being genuinely undecided, and measured over all 84.

## The already-known blockers past level 84

Probed individually at shipped defaults over the first 110 markets, the failures
are, with their level numbers:

`…1775162700` (84) 1000/200, `…1775165400` (87) 1000/343.75, `…1775172600` (95)
1000/718.75, `…1775179800` (103) 1000/406.25, `…1775184300` (108) 200/1000,
`…1775185200` (109) 343.75/1000.

Each market is an independent episode, so a level passes exactly when every
market in it passes on its own. Probing the new markets in one batch with
`tools/sweep80.sh` finds the next blocker in about two minutes and is far cheaper
than climbing level by level.

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
   other leg, which is cheap at exactly the moment the cap fires.

`pairCeil` can be raised to 0.975 (with `finishCeil` 0.978) or 0.978 (0.98) with
no failures. Half a cent to a cent of budget is available on demand, and on its
own it buys nothing.

## Measured dead — do not re-try

Everything below was measured over the FULL market set, not a single-market
probe. **A single-market probe is not evidence for a global pace or cap change.**

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

## Tools

- **`tools/sweep80.sh <tag> <N> [--param k=v ...]`** — one parameter set over the
  first N markets in four parallel chunks, printing only the failures. About
  ninety seconds for 80 markets, two minutes for 110. This is the workhorse; use
  it instead of hand-splitting slug lists.
- `tools/probe2.sh <tag> "<slugs>" [--param k=v ...]` — one parameter set over an
  explicit slug list; writes `/tmp/pg/<tag>.{json,err,rows}`. Use this rather
  than `probe.sh`, which swallows stderr.
- **`--param debug=2` is the observation channel**: one line per market per
  `debugEveryMs` for the WHOLE window, emitted above every early return. It
  carries `depUp=`/`depDown=` (cumulative bid/ask size within three levels),
  `dimb=`/`dabs=` (the player's own smoothed share and absolute near depth),
  `dcap=` (the leg the depth cap has latched) and both best bids. `debug=1` stops
  the moment the player is done, which silently truncates any measurement of what
  happened later.
- `tools/depScan.ts` — locates each window's arming moment offline (first sample
  where the dearer leg's smoothed share clears `--gate`, the lean is fresh and
  that leg is ahead) and reports the elapsed time, the share and the absolute
  size resting there. `--sort arm|dep|minDep`.
- `tools/bookScan.ts` — finds each window's chase without reference to any rule
  and ranks it against the field on ask, gap, book velocity, lean age, book churn,
  path efficiency and depth imbalance.
- `tools/parityScan.ts`, `tools/buyScan.ts`, `tools/volScan.ts`,
  `tools/underwaterScan.ts` — the other offline analyses of that channel.
- `tools/level.ts --level N --run <id>` — the only place a level may be scored.
  It requires the run's market set to be EXACTLY the level's universe, so every
  level needs its own run.
- `tools/play-level.ts --level N` — run and score one level in one command.
  About three minutes for a level in the eighties; five run fine in parallel.
  Its tail is the market table, so grep for `^LEVEL` or score the run afterwards
  with `level.ts`.
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
  innocent, and the counterfactual took one sweep to run. Before spending a
  session on a stated cause, turn the suspected rule OFF and confirm the market
  actually changes.
- **`/tmp` is case-insensitive here.** Probe tags `Z1` and `z1` are the same
  files, so a run can silently read a previous session's rows. Delete the target
  `.rows` before waiting on it.
- **zsh does not word-split unquoted variables.** Never collect `--param` flags
  in a shell variable, and never use `set -- $pair` to split a "a b" string.
  Pass the flags literally to `probe2.sh` / `sweep80.sh` — a sweep that silently
  drops them reproduces the baseline and looks like a result.
- **Per-tick state set inside the `needUp > 0 && needDown > 0` branch is stale
  once a leg completes.** `fairCapSide`/`fairHandover` and `depthCapSide`/
  `depthHandover` are cleared above the branch; check any new per-tick latch the
  same way.
- **A per-tick cap that only latches at a share threshold can be stepped over.**
  `depthCapSide` is recomputed every tick but `depthHeld` only latches once the
  leg is already at `depthHold`; if the reading dips under the gate in exactly
  those seconds, the leg buys straight past the cap and it never engages again.
  This is what hid the real cause of level 80.
- **The live reading is not the offline reading.** The depth imbalance measured
  as a boxcar mean over 1 Hz observation samples peaked at 0.83 in the level 68
  window; the same quantity as an EWMA over the dense tick stream peaks at 0.76.
  Offline scans are for finding a separation and ranking windows, never for
  picking a threshold — read the threshold off the player's own debug timeline.

## Needs human

Nothing.
