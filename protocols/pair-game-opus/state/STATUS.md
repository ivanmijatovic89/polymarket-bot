# Status — Pair Game Opus

- Highest passed level: **67** (first 67 eligible markets)
- Current level: **68** (first 68 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: `2026-08-03T11:37:27.659Z-35d1de5f`

## Evidence

Levels 1–45 at commit `4f21eb1e`, runs 3744–3788 (one run per level, level N =
run 3743+N). Levels 46–51 at `3d8055f9`. Levels 52–59 at `e16f30fe`. Levels
60–66 at `18640212`. Level 67 at `80d695a0`, runs 4231/4232/4233; again at
`c2791855` as run 4353; at `00a423e7` as run 4380; and again at this session's
HEAD as run **4409** (`play-level --level 67`, 67/67).

The first 68 at shipped defaults: run 4361 and, at this session's HEAD, the
`L68_base` probe — exactly one failure, `btc-updown-15m-1775148300`, 1000/343.75.
Every parameter added this session is inert at its default.

## Level 68 — the open problem

The added market is `btc-updown-15m-1775148300`. It opens a coin flip (UP 0.44,
DOWN 0.58), leans UP hard from t+70, and the player takes its ENTIRE UP leg
inside that lean — 656 shares between 0.56 and 0.64, from a balanced 344/344 at
t+70 to 1000/344 at t+89, spending $416 of its $970 in nineteen seconds. The
window then sits at 0.50/0.50 for ten more minutes and settles DOWN. The player
holds 344 DOWN and has 0.28 a share to buy 656 more of a leg the market never
offers below 0.35 again.

**What releases the buyout** is `edgeFull`. The ask gap touches 0.32 for a few
seconds at the top of the spike, `edgeFrac` hits 1, the whole target is granted
on the book's word, and a cascade takes the leg from 719 to 1000 in one tick.

## The budget arithmetic — read this before designing anything

Per-share cost including the 7 bp taker fee is `p + 0.07·p·(1−p)`. So a pair
bought symmetrically at a coin flip costs **1.035**; a pair completed after the
market has decided, winner at 0.95 and loser at 0.03, costs **0.985**. A plan
that holds N pairs from the coin-flip period and completes the rest after the
decision therefore costs `1.035·N + 0.985·(1000−N)`, which is **$985 at N=0 and
rises with N** — above the $980 the rule allows. Two consequences:

1. **There is no safe play.** No amount of symmetric early inventory, and no
   amount of waiting, produces a pair inside the ceiling on its own. The player
   must make a directional bet before the market has decided and be right.
2. **The whole margin lives in the price at which the winner is caught.** At
   0.85 instead of 0.95 the late pair costs 0.965 rather than 0.985, and the
   plan fits. Everything this player earns, it earns there.

That also explains the shipped player's cost distribution over the 67 markets it
passes: min 0.832, p25 0.955, median 0.962, p75 0.966, max 0.969. It is
budget-bound in nearly every window, so **any rule that withholds money from a
leg does not make it careful — it makes some market end short.**

`pairCeil` can be raised to 0.975 (with `finishCeil` 0.978) or 0.978 (0.98) with
no failures and a worst realized cost of 0.9758 / 0.9784. So half a cent to a
cent of budget is available on demand, and on its own it buys nothing.

## Measured dead on level 68 — do not re-try

Every one of these repairs the specimen in a single-market probe. All were then
run over the full 68 and are ruinous. **A single-market probe is not evidence
for a global pace or cap change.**

| Change | Failures over the first 68 (baseline: 1) |
|---|---|
| `edgeFull` 0.45 / 0.50 | 12 / 15 |
| `edgeHoldMs` (sustained ask gap) 20 s / 30 s / gated | 14 / 15 / 9 |
| `holdRamp` 0.3 | 16 |
| `spendPace` 0.35 / 0.40 / 0.45 | 18 / 16 / 13 |
| `maxImbalance` 300 | 43 |
| `oracleHold` 0.6 / 0.7 / 0.8 (latched) | 24 / 31 / 29 |
| priority swap on "can't afford both at today's asks" | 24 / 13 / 21 / 23 |
| the same, gated on the chased leg holding 0.5–0.8 of target | 24 / 27 / 24 / 20 |
| `solvDrop` 0.10 / 0.14 / 0.18 / 0.18+gap | 21 / 19 / 19 / 21 |
| `solvFree` | inert — 22 / 19 / 20 |
| `burstShare` 0.15 / 0.18 / 0.20 (money velocity cap) | 13 / 9 / 12 |
| `finishSolv` any | inert — does not bind |
| solvency as a room cap (`solvCap`) | does not repair the specimen; removed |
| `chasePad` 0.04–0.15, `budgetPace` 1.2–2.5 | do not repair the specimen |
| `convDwellMs` 1000–5000 | inert — identical 1000/344 |
| `openCheapMs` 3000–30000 | 15 s ⇒ 9; never repairs |
| `reserveLow` 0.7 / 0.8 / 0.9 / 1.0 | 3 / **9 (repairs)** / 9 / 11 |
| `reserveLow=0.8` + `oracleReserve` 1.0 / 1.2 / 1.3 | 9 / 10 / 10 — stops repairing |
| `reserveFull` 0.7 / 1.0 | specimen 1000/594 — still fails |
| `pairCeil` 0.975 / 0.978 (+ matching `finishCeil`) | 1 — safe and inert |
| **`fairHold`** 0.72/0.06, 0.72/0.08, 0.65/0.06, 0.60/0.06 | **9 / 7 / 8 / 8 (repairs robustly)** |

Six families have now been tried on this window and every one costs between
seven and forty-three of the sixty-seven markets that already pass: share caps,
price caps, total-spend paces, reassigning the chase, a money velocity cap, and
now a cap keyed on the model-book disagreement.

## The model-book disagreement is a GOOD direction signal — this session's find

`fairHold` (new, in the code at an inert default of 1) caps the leg that is ahead
at a share of its target whenever the player's own model runs ahead of the book
on that leg by `fairHoldGap`, hands the chase to the other leg while the cap
holds, and releases once that other leg is complete. It was built on the one
reading that separates the level 68 window from the window that most needs the
aggressive chase (`…1775110500`): there the book is at or above the model (gap
0.000 / −0.021 / −0.029 at t+30 / t+45 / t+61), while in the level 68 window the
model sits 5 to 11 cents ABOVE the book for the whole approach and rises
monotonically as the player buys.

It repairs the specimen properly — 1000/1000 at 0.965–0.968 at 0.50, 0.60, 0.65
AND 0.72, the first setting of anything to survive a whole band rather than one
lucky point. It costs seven to nine other markets, and **the casualties invert
the premise**: every one of them is the capped leg stranded exactly on the cap,
and in every one of them that leg is the WINNER. Eight windows settle on the leg
the model was running ahead of the book on. So the disagreement is a good
directional read, right in eight of the nine windows where it is strong, and the
level 68 window is its only miss. Do not build another rule that distrusts it.

Casualties at (0.72, 0.06), all of which pass at defaults: `…1775092500`,
`…1775093400`, `…1775095200`, `…1775104200`, `…1775107800`, `…1775120400`,
`…1775131200`, `…1775132100`, `…1775140200`. Disjoint from `reserveLow`'s nine.

## The other measured foothold — `reserveLow=0.8`

Passes the specimen outright, 1000/1000 at 0.9668. Knife-edge in the parameter
(0.7 fails, 0.8 passes, 0.9 gives 1000/200, 1.0 gives 1000/594) and costs nine
markets, all of which pass at 0.956–0.968 at defaults. Its nine:
`…1775089800` 344/1000, `…1775094300` 582/1000, `…1775109600` 1000/469,
`…1775110500` 0/1000, `…1775124900` 613/1000, `…1775129400` 1000/281,
`…1775133900` 1000/544, `…1775138400` 531/1000, `…1775147400` 219/1000.

Under `reserveLow=0.8`, `…1775110500` shows the whole mechanism: the reserve
prices the leading leg's cap at 0.64–0.71 while its ask runs 0.68 → 0.99, so the
leg is refused four cents behind the market for the entire window and ends at
zero. The money the reserve saved was being saved for a leg that ended at 0.13.

## The live thread — a parity hold released by the oracle

This is the only shape whose arithmetic works in BOTH colliding windows, and it
has not been built. Hold both legs at about a third of target and buy nothing
more until the oracle names a side by a HIGH multiple of its band; then buy the
named leg out at once and finish the other in the closing minutes.

- Level 68 window: the oracle's reading for UP peaks at 1.47 bands (t+96) — it
  never reaches 1.6 — and reaches 1.70 for DOWN at t+722 with DOWN asking 0.82.
  Cost: 344 pairs at 1.035 plus 656 at (0.828 + 0.106) ⇒ **$969**, inside.
- `…1775110500`: the oracle reaches 1.83 bands for UP at t+61 with UP asking
  0.85, the loser then falling to 0.03. Cost: 344 at 1.035 plus 656 at
  (0.859 + 0.032) ⇒ **$941**, comfortably inside.

So a gate near 1.6 bands separates them, which nothing else has. What is unknown
and must be measured before anything is tuned: how many of the 67 ever produce a
1.6-band reading at all, how late, and at what ask. A window that never confirms
would sit at 344/344 and fail, so the shape needs a fallback for that case —
probably the current behaviour, released on a clock late in the window.

Note this is NOT the `holdRamp`/`spendPace` family (16 and 18 failures). Those
ration by the clock, which delays the chase in exactly the trending windows that
need it early. This rations until an oracle threshold and then releases
everything at once.

## What passed level 67 — `oracleReserve`

Level 67's market is a whipsaw: DOWN leads for twenty seconds and takes 469
shares at 0.57, then UP leads and takes 469 at 0.55, and UP then runs to 0.99
and never comes back. The bid could not reach because the `reserveLow` floor was
holding 0.198 a share for a DOWN leg that ended up trading at two cents.
`oracleReserve=1.5` stands that floor down once BTC has run clear of the price to
beat by 1.5 bands in the priority leg's own direction. The band 1.3–1.8 keeps
both that window and an earlier one that lands with a one-cent margin.

## What passed level 47 — three gates on the commitment exemption

`commitShare=0.6` + `commitReserve=1` repair two blockers and cost four other
markets. Three gates separate them: `commitLeadMs=12000`, `commitLag=0.15` and
`commitLoss=0.045`. Arming is one-way.

## What passed level 52 — `finishCeil`

`finishCeil=0.975` is a second, higher pair budget that only a leg past
`finishCeilShare=0.85` may reach, and only by crossing — it can never raise a
resting bid or grow a position, only finish one.

## Measured dead — do not re-try

- **`commitRate`** — monotone harm over the first sixty markets.
- **`commitRise`** — inert up to 0.10, harmful at 0.15.
- `underdogMax` / `underdogLift`, `swapEdge`, `reserveMom`, `maxImbalance`,
  `reserveLowUntilMs`, `priorityLatch`, `momDeadband`, `priority=dear`,
  `reserveLow` escalation and de-escalation, `edgeHoldMs`, `spendPace`, price
  caps pinned to a leg's own low, budget averages, `avgGuard`/`avgGuardFrom`,
  the `earlyShare` family, `reserveLow=0` globally, `solvSwap`.
- The chased leg's ask average as an "is it running away" test — too noisy.

## The jitter is a seedable draw — use `seedRandom.mjs`

The ONLY non-determinism in a run is `Math.random()` in `BacktestExecution` (the
±20 ms latency jitter). It is unseeded, so a single-market probe is one sample.

```
PG_SEED=11 NODE_OPTIONS="--import file://$PWD/protocols/pair-game-opus/tools/lib/seedRandom.mjs" \
  protocols/pair-game-opus/tools/probe2.sh tag "<slugs>"
```

Record level evidence from ordinary unseeded runs. **Pass the `--param` flags to
`probe2.sh` — a sweep that silently drops them reproduces the baseline and looks
like a result.**

## Tools

- `tools/probe2.sh <tag> "<slugs>" [--param k=v ...]` — one parameter set over an
  explicit slug list; writes `/tmp/pg/<tag>.{json,err,rows}`. Use this rather
  than `probe.sh`, which swallows stderr.
- Failure count from a probe's rows:
  `awk '$1 ~ /^btc-updown/ {split($9,a,"/"); if (a[1]+0<1000 || a[2]+0<1000 || $3+0<=0 || $4/1000>0.98) print $1, a[1]"/"a[2]}' /tmp/pg/<tag>.rows`
- `tools/lib/seedRandom.mjs` — see above.
- `tools/level.ts --level N --run <id>` — the only place a level may be scored.
- `tools/play-level.ts --level N` — run and score one level in one command.
- **zsh does not word-split unquoted variables.** Never collect `--param` flags
  in a shell variable, and never use `set -- $pair` to split a "a b" string —
  both silently produce one argument and reproduce the baseline.
- A 68-market sequential run takes about six minutes locally; four run in
  parallel on 10 cores. `--param debug=1 --param debugEveryMs=1000` slows it
  about tenfold.
- Debug timelines go to **stderr**. Tick lines carry `held=`, `spent=`, `tgt=`,
  `lead=`, `edg=`, `out=`, `diff=`/`need=` (the oracle band), `pModel=`/`pBook=`,
  `want=`/`gap=` (the model-book disagreement) and `chs=`.
- The first N slugs:
  `npx tsx protocols/pair-game-opus/tools/universe.ts --first N --slugs-only`
  (cache them to a file; the sweeps above use `/tmp/pg/slugs68.txt`).
- **Per-tick state set inside the `needUp > 0 && needDown > 0` branch is stale
  once a leg completes.** A cap left standing from the previous tick refused the
  only leg still being bought and looked exactly like the rule not working. The
  fix is in the code (`fairCapSide` / `fairHandover` are cleared above the
  branch); check any new per-tick latch the same way.

## Next action

Build the parity hold released by the oracle, described above. Order of work:

1. **Measure first, before building the rule.** Over the first 68 markets,
   record for each window the earliest time the oracle reading (`outsideFrac`)
   crosses 1.4 / 1.6 / 1.8 bands, which side it names, whether that side wins,
   and the named side's ask at that instant. That table decides whether the shape
   is viable at all and where the threshold goes; it is one debug run plus an
   awk pass over `pModel`/`diff`/`need`/`out` in the tick log.
2. Only then add the two knobs: a share at which both legs pause, and the band
   that releases them. Give the release a late-clock fallback so a window that
   never confirms does not sit at a third of target.

Do not reopen: the opening-lean thread (`convDwellMs`, `openCheapMs`), any share
or price cap on the chased leg, any solvency test of the form "can both legs be
afforded at today's asks" (the two asks always sum to more than the ceiling, so
it is true in every window at every instant), and any rule that treats the
model-book disagreement as a warning.

## Needs human

Nothing.
