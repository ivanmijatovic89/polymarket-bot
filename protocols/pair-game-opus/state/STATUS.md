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
`c2791855` as run 4353; and again at this session's HEAD as run **4380**
(`play-level --level 67`, 67/67).

Run **4361** is the first 68 at shipped defaults: exactly one failure,
`btc-updown-15m-1775148300`, 1000/343.75. Every parameter added this session is
inert at its default.

## Level 68 — the open problem

The added market is `btc-updown-15m-1775148300`. It opens a coin flip (UP 0.44,
DOWN 0.58), leans UP hard for twenty seconds around t+80, and the player takes
its ENTIRE UP leg inside that lean — 656 shares between 0.56 and 0.64, eight
tenths of the ceiling spent by t+90. The window then sits at 0.50/0.50 for ten
more minutes and settles DOWN. The player holds 344 DOWN and has 0.28 a share
to buy 656 more of a leg the market never offers below 0.35 again.

**A winning line exists** and several rules reach it: stop the leading leg near
700, buy the OTHER leg out mid-window while it is still near 0.45, finish the
first leg in the closing minute at four cents. That ends 1000/1000 at 0.960–0.968
and PnL near +35. The problem is reaching it without a rule that wrecks the other
67 markets.

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
| priority swap on "can't afford both at today's asks" | 24 / 13 / 21 / 23 |
| the same, gated on the chased leg holding 0.5–0.8 of target | 24 / 27 / 24 / 20 |
| `solvDrop` 0.10 / 0.14 / 0.18 / 0.18+gap (swap on required discount) | 21 / 19 / 19 / 21 |
| `solvFree` (demoted leg keeps its ceiling allowance) | inert — 22 / 19 / 20 |
| `burstShare` 0.15 / 0.18 / 0.20 (money velocity cap) | 13 / 9 / 12 |
| `finishSolv` any | inert — does not bind |
| solvency as a room cap (`solvCap`) | does not repair the specimen; removed |
| `chasePad` 0.04–0.15, `budgetPace` 1.2–2.5 | do not repair the specimen |
| `convDwellMs` 1000–5000 (opening lean must persist) | inert — identical 1000/344 |
| `openCheapMs` 3000–30000 (lead with the cheap leg at the open) | 15 s ⇒ 9; never repairs |
| `reserveLow` 0.7 / 0.8 / 0.9 / 1.0 | 3 / **9 (repairs)** / 9 / 11 |
| `reserveLow=0.8` + `oracleReserve` 1.0 / 1.2 / 1.3 | 9 / 10 / 10 — and stops repairing |
| `reserveFull` 0.7 / 1.0 (honest reserve while affordable) | specimen 1000/594 — still fails |
| `pairCeil` 0.975 / 0.978 (+ matching `finishCeil`) | 1 — safe and inert; with `reserveLow=0.8`, 7 / 6 and stops repairing |

Five families have now been tried on this window and every one costs between
nine and forty-three of the sixty-seven markets that already pass:

1. share caps (`maxImbalance`, `holdRamp`, `oracleHold`) — a leg stops exactly
   on the cap and never resumes;
2. price caps (`chasePad`, `edgeFull`, `budgetPace`);
3. total-spend paces (`spendPace`);
4. reassigning the chase (four shapes, this session) — same signature as (1),
   with the demoted leg parked at the gate;
5. a money velocity cap (`burstShare`) — the mildest at nine failures, and
   still nine times the baseline.

## The ladder has no slack — the fact that explains every failed family

Realized pair cost over the 67 markets that pass at defaults: min 0.832,
**p25 0.955, median 0.962, p75 0.966, max 0.969**. Sixty-six of sixty-seven
finish within about a cent of the 0.97 budget. The player is budget-bound
everywhere, so any rule that withholds money from a leg does not make it
careful — it makes some market end short. That is why five families of restraint
all cost between nine and forty-three markets, and it is the first thing to
check any new idea against.

`pairCeil` can be raised to 0.975 (with `finishCeil` 0.978) or 0.978 (0.98) with
no failures and a worst realized cost of 0.9758 / 0.9784 — safely inside the
0.98 rule. So half a cent to a cent of budget is available on demand. It buys
nothing on its own, and given to `reserveLow=0.8` it is spent re-enabling the
very purchase the reserve was raised to refuse.

## The most useful result so far on level 68

`reserveLow=0.8` **passes the specimen outright** — 1000/1000 at 0.9668 with
PnL +33. It is the only setting of anything that has done so without a swap
rule. It costs nine other markets, all of which pass at 0.956–0.968 at defaults
(they are tight, not comfortable), and all of which fail with the same signature:
a leg refused and left at a fifth to a half of its target.

The nine casualties, baseline → `reserveLow=0.8`:

| slug | base cost | at 0.8 |
|---|---|---|
| `…1775089800` | 0.9636 | 344/1000 |
| `…1775094300` | 0.9633 | 582/1000 |
| `…1775109600` | 0.9673 | 1000/469 |
| `…1775110500` | 0.9565 | 0/1000 |
| `…1775124900` | 0.9598 | 613/1000 |
| `…1775129400` | 0.9659 | 1000/281 |
| `…1775133900` | 0.9671 | 1000/544 |
| `…1775138400` | 0.9677 | 531/1000 |
| `…1775147400` | 0.9606 | 219/1000 |

Note the behaviour is knife-edge in the parameter: 0.7 does not repair the
specimen, 0.8 does, 0.9 gives 1000/200 and 1.0 gives 1000/594. Treat the single
pass at 0.8 as a foothold to explain, not as a result to tune around.

## What was learned this session

The parameters `solvDrop`, `solvGap`, `solvSwapShare`, `solvFree`, `burstShare`
and `burstMs` are all in the code at inert defaults, with the measurements in
their doc comments. The two ideas behind them:

- **The required discount.** Finish the chased leg at today's ask, fund the
  other at the cheapest it has ever shown, and ask what the chased leg would
  have had to cost for the pair to fit inside the ceiling. The gap is the
  discount the plan is counting on — 22 cents in the level 68 window. It looked
  scale-free and is not: it divides by the chased leg's REMAINING shares, so it
  explodes on a leg one clip from done and fires hardest exactly where it should
  not.
- **`underdogMax` is the deadlock.** Any rule that demotes a leg parks it at
  0.10, which a contested leg is never quoted at. `solvFree` tested lifting that
  for a freshly demoted leg and changed nothing, so the deadlock is a symptom,
  not the cause: by the time these rules fire the money is already spent.

## What passed level 67 — `oracleReserve`

Level 67's market is a whipsaw: DOWN leads for twenty seconds and takes 469
shares at 0.57, then UP leads and takes 469 at 0.55, and UP then runs to 0.99
and never comes back. The bid could not reach because the `reserveLow` floor was
holding 0.198 a share for a DOWN leg that ended up trading at two cents.

`oracleReserve=1.5` stands that floor down once BTC has run clear of the price
to beat by 1.5 bands in the priority leg's own direction. The band 1.3–1.8 keeps
both that window and an earlier one that lands with a one-cent margin.

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
  in a shell variable and expand it. Write the flags out.
- A 68-market sequential run takes about six minutes locally; four run in
  parallel on 10 cores. `--param debug=1 --param debugEveryMs=1000` slows it
  about tenfold.
- Debug timelines go to **stderr**. Tick lines carry `held=`, `spent=`, `tgt=`,
  `lead=`, `edg=`, `out=`, `diff=`/`need=` (the oracle band) and `chs=`.
- The first N slugs:
  `npx tsx protocols/pair-game-opus/tools/universe.ts --first N --slugs-only`
  (cache them to a file; the sweeps above use `/tmp/pg/slugs68.txt`).

## Next action

**The opening thread is closed.** Both halves of it were built and measured this
session. Gating the opening lean (`convDwellMs`) changes the t+0 choice and then
momentum picks the dearer leg back one tick later and buys the identical clip at
the identical price — the ask EMA is seeded at t+0, so a one-cent uptick on tick
two reads as a leg running away. Replacing the direction rule outright
(`openCheapMs`) does move the clip to the cheap leg and saves twelve dollars,
ends on the identical 1000/344, and costs eight other markets. Do not reopen it.

The live thread is `reserveLow=0.8`: it is the only thing that has passed the
specimen without a swap rule, and its nine casualties are a small, named set.
The next session should take those nine one at a time and find what separates
them from the specimen at the moment the raised floor bites. The specimen's
moment is precise and measurable: at t+80 s the player holds 719/344 with $369
left; the other leg has never traded below 0.38 and 656 of them cost $249, which
FITS in the money in hand — and the discounted floor prices them at $150 instead,
freeing exactly the $99 that buys the last 281 shares of the leading leg at 0.62.
`reserveFull` tests that "does the honest number still fit" gate directly and is
already in the code; on its own it moves the specimen to 1000/594 and stops
there, because the leg that is not the priority is still pinned at `underdogMax`
and cannot spend what the gate saved. So the gate probably needs to be paired
with a real price for the leg being reserved FOR — which is the deadlock this
player keeps hitting, and the one thing worth attacking directly.

Two cheap diagnostics that have not been run: (1) a debug timeline of any two of
the nine casualties under `reserveLow=0.8`, to see whether the refused leg is
refused at a price it later trades at or simply never bid at all; (2) whether the
raised floor bites early or late in the casualties versus at t+80 in the
specimen. Either could produce the gate.

## Needs human

Nothing.
