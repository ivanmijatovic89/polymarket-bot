# Status — Pair Game Opus

- Highest passed level: **59** (first 59 eligible markets)
- Current level: **60** (first 60 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: `2026-08-03T11:37:27.659Z-35d1de5f`

## Evidence

Levels 1–45 at commit `4f21eb1e`, runs 3744–3788 (one run per level, level N =
run 3743+N). Levels 46–51 at commit `3d8055f9`. Levels 52–59 at commit
`e16f30fe`. Three clean runs each, all with the shipped defaults and no
parameters:

| Level | Runs (all passed) |
|---:|---|
| 47 | 4014, 4015, 4016 |
| 48 | 4017, 4018, 4019 |
| 49 | 4020, 4021, 4022 |
| 50 | 4023, 4024, 4025 |
| 51 | 4026, 4027, 4028 |
| 52 | 4096, 4097, 4098 (plus seeded 4094, 4095, 4099) |
| 53 | 4128, 4129, 4130 |
| 54 | 4131, 4132, 4133 |
| 55 | 4134, 4135, 4136 |
| 56 | 4137, 4138, 4139 |
| 57 | 4140, 4141, 4142 |
| 58 | 4143, 4144, 4146 |
| 59 | 4145, 4147, 4148 |

Every level contains the ones below it, so level 59 re-verifies 1–58.

## The jitter is a seedable draw — use `seedRandom.mjs`

The ONLY non-determinism in a run is `Math.random()` in `BacktestExecution`
(the ±20 ms latency jitter). It is unseeded, so **a single-market probe is one
sample, not a verdict** — this is what made session 19 record the level 52
market as "only fails in a batch" after six probes agreed.

`tools/lib/seedRandom.mjs` replaces `Math.random` with a seeded generator; the
distribution is unchanged, so a seeded run is an ordinary draw you can repeat:

```
PG_SEED=11 NODE_OPTIONS="--import file://$PWD/protocols/pair-game-opus/tools/lib/seedRandom.mjs" \
  protocols/pair-game-opus/tools/probe2.sh tag "<slugs>"
```

Sweeping seeds over ONE market turns a 25-minute level run into a 30-second
experiment. On the level 52 market, 5 of 36 seeds reproduced the failure.
Record level evidence from ordinary unseeded runs.

## What passed level 52 — `finishCeil`

The chased leg reached 898 of 1,000 with 92 dollars left for its last 102 shares
and 344 of the other leg, which prices the chase at 0.565. The offer was 0.56
plus a 1.7-cent taker fee — refused by 1.2 cents. The offer never returned, the
leg stalled at 898 and the window scored −44.

`finishCeil=0.975` is a second, higher pair budget that only a leg past
`finishCeilShare=0.85` may reach, and **only by crossing** — it can never raise a
resting bid or grow a position, only finish one. The gap between `pairCeil`
(0.97) and the 0.98 the game scores against is insurance against ending a leg
short; spending a dollar of it to stop a leg ending short is what it is for.
All five failing seeds then finish 1000/1000 at 0.9665 a pair.

## What passed level 47 — three gates on the commitment exemption

`commitShare=0.6` + `commitReserve=1` repair two blockers and cost four other
markets. No instantaneous price test separates the groups. Three gates do:

- **`commitLeadMs=12000`** — the deficient leg must have held the momentum lead
  for twelve seconds IN TOTAL since the latch. Repairs have 12–15 s of it;
  casualties have one or two. 8 s leaves both casualties firing, 16 s loses a
  repair.
- **`commitLag=0.15`** — the chased leg must still be 150 shares behind when the
  exemption arms.
- **`commitLoss=0.045`** — the committed leg must be marked down against both its
  last quote and its own thirty-second average.

Arming is one-way: checked every tick until it fires, latched afterwards.

## Measured dead — do not re-try

- **`commitRate`** — a rate cap slows the chase without stopping it. Monotone
  harm over the first sixty markets: 58 without it, 57 at 100/s, 54 at 60/s and
  40/s, 51 at 20/s.
- **`commitRise`** — inert at every pad up to 0.10, harmful at 0.15.
- `underdogMax` / `underdogLift`, `swapEdge`, `reserveMom`, `maxImbalance`,
  `reserveLowUntilMs`, `priorityLatch`, `momDeadband`, `priority=dear`,
  `reserveLow` escalation and de-escalation, `edgeHoldMs`, `spendPace`, price
  caps pinned to a leg's own low, budget averages, `avgGuard`/`avgGuardFrom`,
  the `earlyShare` family, `reserveLow=0` globally.
- The chased leg's ask average as an "is it running away" test — too noisy.

## Tools

- `tools/probe2.sh <tag> "<slugs>" [--param k=v ...]` — one parameter set over an
  explicit slug list; writes `/tmp/pg/<tag>.{json,err,rows}`. **Use this rather
  than `probe.sh`**, which swallows stderr.
- `tools/lib/seedRandom.mjs` — see above.
- `tools/level.ts --level N --run <id>` — the only place a level may be scored.
- `tools/play-level.ts --level N` — run and score one level in one command.
- **zsh does not word-split unquoted variables.** Never collect `--param` flags
  in a shell variable and expand it. Write the flags out.
- A 52-market sequential run takes 5–10 minutes locally; six run in parallel on
  10 cores. `--param debug=1 --param debugEveryMs=1000` slows it about tenfold.
- Debug timelines go to **stderr**. Tick lines carry `held=`, `spent=`, `tgt=`,
  `lead=`, `edg=` and `chs=<chase leg>/<lead seconds>`.
- The first N slugs:
  `npx tsx protocols/pair-game-opus/tools/universe.ts --first N --slugs-only`

## Next action

Level 60: `npx tsx protocols/pair-game-opus/tools/play-level.ts --level 60`,
three times. Levels 53–59 each needed no change at all — run the level first and
only diagnose if it fails.

If the newly added market fails, seed-sweep it alone before theorising: that is
now a 30-second experiment, and only a sweep tells you whether a single passing
probe means anything. Two levels can be launched in one batch (six runs on 10
cores, ~25 minutes) since passing level N+1 also re-verifies N.

## Needs human

Nothing.
