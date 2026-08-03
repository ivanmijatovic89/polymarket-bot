# Status — Pair Game Opus

- Highest passed level: **79** (first 79 eligible markets)
- Current level: **80** (first 80 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: `2026-08-03T11:37:27.659Z-35d1de5f`

## Evidence

Levels 1–45 at commit `4f21eb1e`, runs 3744–3788 (one run per level, level N =
run 3743+N). Levels 46–51 at `3d8055f9`. Levels 52–59 at `e16f30fe`. Levels
60–66 at `18640212`. Level 67 at `80d695a0`.

Levels **68–79 at `71e47612`**, all defaults, one `play-level` run each:

| Level | 68 | 69 | 70 | 71 | 72 | 73 | 74 | 75 | 76 | 77 | 78 | 79 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Run | 4485 | 4486 | 4491 | 4489 | 4490 | 4492 | 4493 | 4494 | 4495 | 4496 | 4497 | 4498 |

## What passed level 68 — `depthHold`, the size behind the quote

Level 68 had blocked five sessions. Seven families of rule had been tried and
each cost between seven and forty-three of the sixty-seven markets that already
passed. Every one of them scored a PRICE: the ask gap, the leg's own ask, the
model, the oracle, the player's own spend and inventory. `tools/bookScan.ts`
measured the level 68 window against the whole field on all of them and it is
unremarkable in each — 26th of 68 in the ask it chases and in the gap it chases
on, near the top in how fast the book moved, twelfth in how far it commits past
its own cash. That is why the price rules all died the same death.

The SIZE behind the quote separates them. At the instant each window commits,
`bookScan.ts` reads how much of the depth within three levels of the chased leg
sits on the bid rather than the offer. The level 68 window reads **0.85** —
third of 68, and above all eighteen windows measured to break when money or
shares are withheld. `…1775110500`, the window whose chase is most essential,
never reaches the gate at all. The lean the player was chasing was one nobody
funded: the price was high because there was nothing left to sell.

`depthHold=0.8` stops the leading leg at 0.8 of its target while its own
smoothed offer is that thin (`depthGate=0.7`, `depthTauMs=10000`,
`depthLevels=3`) and hands the chase to the other leg, which is cheap for the
same reason. Two conditions keep it off the windows it would otherwise ruin:

- `depthAfterMs=45000` — a window that has just opened is thin on both sides, so
  the ratio is noise. Every casualty that survived a tighter gate armed between
  t+10s and t+27s; the lean it is built to refuse arrives at t+70s.
- `depthFreshMs=30000` — the cap only arms on a lean under thirty seconds old.
  A leg the book has priced above even for a full minute has had its offer
  bought through; a leg that crossed the coin flip eleven seconds ago and is
  already at 0.61 has an empty offer because nobody has posted one. The last
  surviving casualty (`…1775112300`) is 63s old at the moment the cap would arm;
  the level 68 window is 11s old.

It is not a knife edge. The specimen is repaired across `depthHold` 0.35–0.80
and `depthGate` 0.68–0.74, and the whole first 68 comes in at zero failures at
`depthFreshMs` 30000 **and** 40000, and at `depthGate` 0.72 as well as 0.70.

## Level 80 — the open problem

The added market is `btc-updown-15m-1775159100`. It opens at a coin flip, DOWN
leans to 0.64 by t+50, the player takes its ENTIRE DOWN leg inside that lean —
1000 shares for $706 in fifty seconds — and the window then mean-reverts to a
coin flip and settles **UP**. It ends 200/1000.

This is the level 68 shape with the sides swapped and the clock moved forward,
and the depth reading DOES see it: DOWN's smoothed imbalance runs 0.64 at t+35,
0.67 at t+40, **0.71 at t+45** — over the gate. The cap does not fire because
`depthAfterMs=45000` has it disarmed until t+45s, and by t+50 the leg is
already complete. **The warmup that saves three other windows is what lets this
one through.**

Two things to try, in order:

1. Replace the time warmup with what it is actually a proxy for. The reason a
   just-opened book gives a noisy ratio is that there is almost nothing resting
   on either side — one order empties an offer only a few hundred shares deep.
   So gate on ABSOLUTE near depth (require `bid+ask` within three levels to
   exceed some size before the ratio is trusted) instead of on elapsed time.
   That is the same idea stated causally, and it would let the cap arm at t+35
   here if the book is thick by then. Measure the absolute depth at the arming
   moment in all 80 windows first — `bookScan.ts` already parses `depUp`/
   `depDown` from the observation channel and reports `askDep`.
2. If depth at t+35 in this window is genuinely thin, shorten `depthAfterMs`
   toward 30000 and re-measure the three windows the warmup was added for
   (`…1775096100`, `…1775112300`, `…1775116800`).

## The already-known blockers past level 80

Probed individually at shipped defaults, markets 70–110 give seven failures, and
all seven are IDENTICAL with the depth cap turned off (`depthHold=1`) — they are
pre-existing, not caused by the new rule:

`…1775159100` 200/1000 (level 80), `…1775162700` 1000/200, `…1775165400`
1000/343.75, `…1775172600` 1000/718.75, `…1775179800` 1000/406.25,
`…1775184300` 200/1000, `…1775185200` 343.75/1000.

Each market is an independent episode, so a level passes exactly when every
market in it passes on its own. Probing the new markets in one batch finds the
next blocker in about a minute and is far cheaper than climbing level by level.

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

## What passed the earlier levels

- **47** — `commitShare=0.6` + `commitReserve=1`, gated by `commitLeadMs=12000`,
  `commitLag=0.15`, `commitLoss=0.045`. Arming is one-way.
- **52** — `finishCeil=0.975`, a second higher pair budget that only a leg past
  `finishCeilShare=0.85` may reach, and only by crossing.
- **67** — `oracleReserve=1.5` stands the `reserveLow` floor down once BTC has
  run clear of the price to beat by 1.5 bands in the priority leg's direction.

## Tools

- `tools/probe2.sh <tag> "<slugs>" [--param k=v ...]` — one parameter set over an
  explicit slug list; writes `/tmp/pg/<tag>.{json,err,rows}`. Use this rather
  than `probe.sh`, which swallows stderr.
- **`--param debug=2` is the observation channel**: one line per market per
  `debugEveryMs` for the WHOLE window, emitted above every early return. It now
  also carries `depUp=`/`depDown=` (cumulative bid/ask size within three levels)
  and both best bids. `debug=1` stops the moment the player is done, which
  silently truncates any measurement of what happened later. One pass over 68
  markets takes about four minutes in four parallel chunks.
- `tools/bookScan.ts` — finds each window's chase without reference to any rule
  (largest rise in spend over five seconds on a leg priced at least 0.55) and
  ranks it against the field on ask, gap, book velocity, lean age, book churn,
  path efficiency and depth imbalance. `--sort <feature>`, `--imbGate <x>` prints
  the live blast radius of a gate on the depth reading.
- `tools/parityScan.ts`, `tools/buyScan.ts`, `tools/volScan.ts`,
  `tools/underwaterScan.ts` — the other offline analyses of that channel.
- `tools/level.ts --level N --run <id>` — the only place a level may be scored.
  It requires the run's market set to be EXACTLY the level's universe, so every
  level needs its own run.
- `tools/play-level.ts --level N` — run and score one level in one command.
  About three minutes for a level in the seventies; five run fine in parallel.
- `tools/lib/seedRandom.mjs` — the ONLY non-determinism in a run is
  `Math.random()` in `BacktestExecution` (the ±20 ms latency jitter), so a
  single-market probe is one sample:
  `PG_SEED=11 NODE_OPTIONS="--import file://$PWD/protocols/pair-game-opus/tools/lib/seedRandom.mjs" probe2.sh tag "<slugs>"`.
  Record level evidence from ordinary unseeded runs.
- The first N slugs:
  `npx tsx protocols/pair-game-opus/tools/universe.ts --first N --slugs-only`.
- Failure count from a probe's rows:
  `awk '$1 ~ /^btc-updown/ {split($9,a,"/"); if (a[1]+0<1000 || a[2]+0<1000 || $3+0<=0 || $4/1000>0.98) print $1, a[1]"/"a[2]}' /tmp/pg/<tag>.rows`

### Traps that have each cost a session

- **`/tmp` is case-insensitive here.** Probe tags `Z1` and `z1` are the same
  files, so a run can silently read a previous session's rows. Delete the target
  `.rows` before waiting on it.
- **zsh does not word-split unquoted variables.** Never collect `--param` flags
  in a shell variable, and never use `set -- $pair` to split a "a b" string.
  Pass the flags literally to `probe2.sh` — a sweep that silently drops them
  reproduces the baseline and looks like a result.
- **Per-tick state set inside the `needUp > 0 && needDown > 0` branch is stale
  once a leg completes.** `fairCapSide`/`fairHandover` and now
  `depthCapSide`/`depthHandover` are cleared above the branch; check any new
  per-tick latch the same way.
- **The live reading is not the offline reading.** The depth imbalance measured
  as a boxcar mean over 1 Hz observation samples peaked at 0.83 in the level 68
  window; the same quantity as an EWMA over the dense tick stream peaks at 0.76.
  Offline scans are for finding a separation and ranking windows, never for
  picking a threshold — read the threshold off the player's own debug timeline.

## Needs human

Nothing.
