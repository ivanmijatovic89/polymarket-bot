# Status — Pair Game Opus

- Highest passed level: **86** (first 86 eligible markets)
- Current level: **87** (first 87 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: `2026-08-03T11:37:27.659Z-35d1de5f`

## Evidence

Levels 1–45 at commit `4f21eb1e`, runs 3744–3788 (one run per level, level N =
run 3743+N). Levels 46–51 at `3d8055f9`. Levels 52–59 at `e16f30fe`. Levels
60–66 at `18640212`. Level 67 at `80d695a0`. Levels 68–79 at `71e47612`.
Levels 80–83 at `acf79c2e`.

Levels **84–86 at `abe42a69`**, all defaults, one `play-level` run each:
84 → run 4659, 85 → 4661, 86 → 4660. (Level 84 also passed at the intermediate
commit `04c1236c`, run 4635, before the ramp below replaced the gate; the
recorded runs above are all at the shipped configuration.)

## What passed levels 84–86 — the pace needs a size floor too

Level 84's window opens at a coin flip, runs eight cents to UP in seven seconds
and then walks DOWN to settlement. The player took **469 UP inside those seven
seconds** and was finished. The mechanism is exact: `edgeFull` licenses a JOINT
allowance of `qty × edge/edgeFull` shares, the edge was 0.15, the allowance was
470, and the player put all 470 on the leg that reverted. Everything after —
freezing at 469/200 for two minutes, completing UP at 0.32 on a bounce — is the
allowance being spent and the arithmetic then refusing every recovery.

The move happened on a book carrying about **1,000 shares** near the top; the
same window carries 3,000–5,000 for the rest of its life. So the pace now has
the floor the depth cap got at level 80: **`edgeMinDep`, default 1,500**.

`edgeDepRamp=1` (default) makes it a RAMP, not a gate, and that distinction is
the whole of levels 85–86. As a bare gate it passes the first 84 and breaks the
very next window, which opens already leaning, trends for twenty-five seconds
on 600–1,500 shares and only turns after the pair is finished — refusing it
outright completes the leg twenty seconds later at 0.79 instead of 0.74, with
nothing left for the other side. In proportion, a thin book buys a
proportionally smaller position instead of none: level 84's window is held to a
third of its allowance, level 85's still gets to buy.

Band: as a ramp every floor from **1,200 to 2,000** carries the first 86
markets. Failures further out move around inside that band by the size of the
latency jitter (4, 5 or 6 over the first 110 depending on the value; 1,200 and
1,800 give 4, the shipped 1,500 gives 5). As a gate the band is 1,200–1,800
over the first 84 only. `depthMinDep`'s own 2,500 costs five markets either
way — the pace is read on every tick of every window, where the cap arms once.

## Level 87 — the open problem

The added market is `btc-updown-15m-1775165400`. It ends **1000 UP / 343.75
DOWN**, spent $773.4, and it is the same class of loss as level 84 with none of
the same tells.

The window opens at a coin flip (0.510/0.500) on a THICK book (5,500 shares)
and grinds UP for three minutes: 0.52 at t+16, 0.56 at t+30, 0.58 at t+41, 0.61
at t+134, 0.64 at t+201. The player accumulates UP the whole way and **completes
it at t+193–201, buying the last 281 shares at 0.62–0.64 for $183.** The market
then comes all the way back and settles DOWN. By t+609 DOWN is 0.71 and the
player needs 656 more of it with $206.6 left. There is no recovery.

What makes it hard:

- The book is thick throughout (2,400–4,000), so `edgeMinDep` sees nothing
  wrong. The depth share never approaches `depthGate` either.
- The model agrees with the book the whole way up (`pModel` 0.56–0.62), and
  `z` never exceeds 0.34 before the reversal, so the oracle is silent.
- The trend is slow and monotone over 200 seconds — the opposite of the
  seven-second spike level 84 turned on.

The one thing that is arguably wrong on its own terms is the FINISH: at t+193
the player holds 719 UP and pays 0.62–0.64 for the last 281, which is both the
dearest UP has been all window and the top of the move. Check what exempts that
purchase from the pace (`finishShare`/`finishSolv` are the candidates, and
`finishCeil`'s larger budget is what pays for it) before looking anywhere else.

Also worth checking: the 344 DOWN it does hold cost about 0.49 a share, bought
in the opening minute at coin-flip prices, and that average is what `avgCap`
later reads when it refuses to buy DOWN at all.

## The already-known blockers past level 87

Probed individually at shipped defaults over the first 110 markets, the failures
are, with their level numbers:

`…1775165400` (87) 1000/343.75, `…1775172600` (95) 1000/718.75, `…1775179800`
(103) 1000/406.25, `…1775184300` (108) 200/1000, `…1775185200` (109)
343.75/1000.

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
   other leg, which is cheap at exactly the moment the cap fires. `edgeMinDep`
   survives for the same reason it is a ramp and not a gate.

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
  has to be proportional rather than a threshold — see levels 84–86 above.

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
  Roughly ten minutes for a level in the eighties (it replays sequentially in one
  process); three run fine in parallel. Its tail is the market table, so grep for
  `^LEVEL` or score the run afterwards with `level.ts`.
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
- **A fix measured on one level breaks the next one.** The `edgeMinDep` gate
  passed 84 and broke 85 — the very next market. Sweep the first N+5 before
  believing a level, not the first N.
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
