# Status — Pair Game Opus

- Highest passed level: **67** (first 67 eligible markets)
- Current level: **68** (first 68 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: `2026-08-03T11:37:27.659Z-35d1de5f`

## Evidence

Levels 1–45 at commit `4f21eb1e`, runs 3744–3788 (one run per level, level N =
run 3743+N). Levels 46–51 at `3d8055f9`. Levels 52–59 at `e16f30fe`. Levels
60–66 at `18640212`. Level 67 at `80d695a0`. Three clean runs each, shipped
defaults, no parameters:

| Level | Runs (all passed) |
|---:|---|
| 60 | 4149, 4150, 4151 |
| 61 | 4152, 4153, 4154 |
| 62 | 4155, 4156, 4157 |
| 63 | 4158, 4159, 4160 |
| 64 | 4161, 4162, 4163 |
| 65 | 4164, 4165, 4166 |
| 66 | 4167, 4168, 4169 |
| 67 | 4231, 4232, 4233 |

Every level contains the ones below it, so level 67 re-verifies 1–66. Run 4298
re-confirms 67/68 at the current HEAD (`d403e79b`), i.e. the two parameters
added while working level 68 are inert at their defaults.

## Level 68 — the open problem

The added market is `btc-updown-15m-1775148300`. It opens a coin flip (UP 0.44,
DOWN 0.58), leans UP hard for twenty seconds around t+80, and the player takes
its ENTIRE UP leg inside that lean — 656 shares between 0.56 and 0.64, eight
tenths of the ceiling spent by t+90. The window then sits at 0.50/0.50 for ten
more minutes and settles DOWN. The player holds 344 DOWN and has 0.28 a share
to buy 656 more of a leg the market never offers below 0.37 again.

**A winning line exists** and was seen repeatedly: stop the leading leg near
700, buy the OTHER leg out mid-window while it is still near 0.50, finish the
first leg in the closing minute at four cents. That ends 1000/1000 at 0.966.
The problem is reaching it without a rule that wrecks the other 67 markets.

**What releases the buyout** is `edgeFull`. The ask gap touches 0.32 for a few
seconds at the top of the spike, `edgeFrac` hits 1, the whole target is granted
on the book's word, and a cascade takes the leg from 719 to 1000 in one tick.
It is NOT `finishShare` — turning that off changes the window by nothing.

## Measured dead on level 68 — do not re-try

Every one of these repairs the specimen in a single-market probe. All were then
run over the full 68 and are ruinous. **A single-market probe is not evidence
for a global pace or cap change.**

| Change | Failures over the first 68 (baseline: 1) |
|---|---|
| `edgeFull` 0.45 / 0.50 | 12 / 15 |
| `holdRamp` 0.3 | 16 |
| `spendPace` 0.35 / 0.40 / 0.45 | 18 / 16 / 13 |
| `maxImbalance` 300 | 43 |
| `oracleHold` 0.6 / 0.7 / 0.8 (latched) | 24 / 31 / 29 |
| `finishSolv` any | inert — does not bind |
| `chasePad` 0.04–0.15, `budgetPace` 1.2–2.5 | do not repair the specimen |

`oracleHold` is the third share cap tried on this window shape after
`maxImbalance` and `holdRamp`, and gave the third identical answer: the
failures are share counts, never pair costs — a leg stopped exactly on the cap
and never resumed. Do not try a fourth.

## What passed level 67 — `oracleReserve`

Level 67's market is a whipsaw: DOWN leads for twenty seconds and takes 469
shares at 0.57, then UP leads and takes 469 at 0.55, and UP then runs to 0.99
and never comes back. The bid could not reach because the `reserveLow` floor was
holding 0.198 a share for a DOWN leg that ended up trading at two cents.

`oracleReserve=1.5` stands that floor down once BTC has run clear of the price
to beat by 1.5 bands in the priority leg's own direction. Releasing the floor
outright (`reserveLow` 0.5/0.4/0.3) also finishes the window and costs an
earlier market that lands with a one-cent margin. The band 1.3–1.8 keeps both;
both windows finish on all of eighteen seeded latency draws across it.

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

## What passed level 47 — three gates on the commitment exemption

`commitShare=0.6` + `commitReserve=1` repair two blockers and cost four other
markets. Three gates separate them: `commitLeadMs=12000` (the deficient leg held
the momentum lead for twelve seconds in total since the latch),
`commitLag=0.15` (the chased leg is still 150 shares behind) and
`commitLoss=0.045` (the committed leg is marked down against both its last quote
and its own thirty-second average). Arming is one-way.

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

## Tools

- `tools/probe2.sh <tag> "<slugs>" [--param k=v ...]` — one parameter set over an
  explicit slug list; writes `/tmp/pg/<tag>.{json,err,rows}`. Use this rather
  than `probe.sh`, which swallows stderr.
- `tools/lib/seedRandom.mjs` — see above.
- `tools/level.ts --level N --run <id>` — the only place a level may be scored.
- `tools/play-level.ts --level N` — run and score one level in one command.
- **zsh does not word-split unquoted variables.** Never collect `--param` flags
  in a shell variable and expand it. Write the flags out.
- A 68-market sequential run takes about six minutes locally; four run in
  parallel on 10 cores. `--param debug=1 --param debugEveryMs=1000` slows it
  about tenfold.
- Debug timelines go to **stderr**. Tick lines carry `held=`, `spent=`, `tgt=`,
  `lead=`, `edg=`, `out=`, `diff=`/`need=` (the oracle band) and `chs=`.
- The first N slugs:
  `npx tsx protocols/pair-game-opus/tools/universe.ts --first N --slugs-only`

## Next action

Level 68. The two obvious families — price caps and share caps — are both
exhausted on this window. What has NOT been tried is a rule about the SPEED of
commitment measured in money against the pair ceiling at the moment of the fill:
not "you may not own this much" and not "you may not pay this much", but "this
clip would leave the other leg unbuyable at its own current ask, so refuse this
clip" applied to ordinary buying rather than only to the finishing exemption.
`finishSolv` implements exactly that test but wires it to the wrong release;
moving the same test onto `capChase` or onto `roomRaw` is the untried variant.

Note it must not bind in the ordinary case where both asks sum to 1.01 — that is
every window from the first minute — so it needs a condition that fires only
when the leg is being taken well past parity with the other one.

## Needs human

Nothing.
