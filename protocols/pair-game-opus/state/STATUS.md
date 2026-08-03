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
`c2791855` as run 4353; at `00a423e7` as run 4380; at `fd08c719` as run 4409;
and again at this session's HEAD as run **4429** (`play-level --level 67`, 67/67).

The first 68 at shipped defaults, at this session's HEAD: exactly one failure,
`btc-updown-15m-1775148300`, 1000/343.75. Every parameter added this session
(`fairHoldZ`, `volTauMs`, `volSampleMs`, `debug=2`) is inert at its default.

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
| `fairHold` 0.72 + `fairHoldZ` 1.0 / 0.8, gap 0.06 | 9 / 7 — the release changes almost nothing |
| `fairHold` 0.72/0.08 + `fairHoldZ` 1.0; 0.60/0.06 + 1.0 | 7 / 8 — same |
| the parity hold released by the oracle (bands 1.2–3.0, hold 0–0.5) | 7 at BEST, on perfect execution — see above |

Seven families have now been tried on this window and every one costs between
seven and forty-three of the sixty-seven markets that already pass: share caps,
price caps, total-spend paces, reassigning the chase, a money velocity cap, a cap
keyed on the model-book disagreement (with and without a release), and a parity
hold released by the oracle.

## The model-book disagreement is a GOOD direction signal — and it cannot be capped

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

### Why a release cannot save it — measured, and it kills the family

The obvious repair, and the one this session built (`fairHoldZ`), is to make the
cap a DELAY: hold the leg, then let it go when a reliable witness agrees with the
model. The witness exists and it arrives in time. Measured in the player's own
reading, the volatility-normalised oracle names the winner at one sigma at
t+135s, 181, 292, 465, 536, 540, 576, 588 and 709 in the nine casualties — every
one of them, and in the level 68 window it never reaches 0.8 for the leg the cap
stops, so the repair is not at risk.

It changes almost nothing: 9 → 9 failures at (0.72, 0.06, z=1.0), 7 → 7 at
(0.72, 0.08), 9 → 7 at z=0.8. Every remaining failure is still the capped leg
sitting on EXACTLY 720 shares.

The reason is that the cap does not save the money, it REDIRECTS it. Stopping one
leg hands the chase to the other, which is then bought out completely, so by the
time the witness speaks the budget is gone: `…1775092500` is at 1000/720 having
spent $789 of $970, and the 280 shares it still owes cost $263 at the release
price; `…1775132100` is at $864 spent with $199 still to pay. The release fires
and buys nothing.

So a released cap needs the money held back as well as the shares — and holding
the money back is the parity hold, which is separately dead. `fairHold` is
finished: do not spend another session on it.

## Going underwater is normal too

`tools/underwaterScan.ts` measures, per market, the worst moment before t+600s at
which the player owes more on the leg it is behind on, at that leg's current ask,
than it has budget left. The level 68 window peaks at 2.20× (656 shares at 0.62
with $185 left, t+237s) and is TWELFTH of 68 — eleven windows that pass go
further underwater than it does, up to 5.69×. Committing past your own money is
the normal operation of this player, not the anomaly, which is the same answer
`solvDrop`, `reserveLow` and `finishSolv` gave one experiment at a time.

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

## The parity hold released by the oracle — MEASURED DEAD

The shape the last session left as the next action (hold both legs, buy nothing
until the oracle names a side by a high band, then buy the named leg out and
finish the other late) was measured over all 68 markets before being built, and
it does not survive its own arithmetic. It was right about the two colliding
windows and wrong about the rest.

`tools/parityScan.ts`, over the whole-window observation channel, scores exactly
that plan: 344 pairs at 1.035 plus the rest at the named leg's ask when the band
is first crossed plus the OTHER leg's cheapest ask any time afterwards — perfect
execution, no depth limit, no latency, and the loser bought at its best price of
the window. Even so:

| Band | Never confirms | Names the LOSER | Over the $980 ceiling |
|---|---|---|---|
| 1.2 | 0/68 | 20 | 10 |
| 1.4 | 0/68 | 15 | 12 |
| 1.6 | 0/68 | 14 | 12 |
| 2.0 | 0/68 | 11 | 13 |
| 3.0 | 0/68 | 2 | 35 |

Raising the band buys accuracy and pays for it in lateness: at 3.0 the reading is
almost never wrong, and by the time it speaks the winner asks 0.93–0.96. Holding
less early helps a little and changes nothing: at hold 0 the floor is 7 markets
over budget at band 1.4. Seven unaffordable windows against the shipped player's
one. The fallback for a window that never confirms is moot — every window
confirms.

The two colliding windows really are separated by a 1.6-band gate. Fourteen
other windows are separated the wrong way by the same gate.

## The volatility-normalised oracle — an accurate, late witness

Every reading of the outside price in this player measures BTC's distance from
the price to beat against a FIXED number of dollars: `needDiff = ptbEdge ·
sqrt(timeLeft)` with `ptbEdge ≈ 60`, and `pModel` likewise divides by a constant
`ptbSigma`. The same sixty dollars therefore counts the same in a calm quarter
hour and a violent one.

Divide instead by BTC's OWN measured volatility — the mean square of its
one-second moves over a trailing few minutes — and the reading becomes a true
z-score, `|diff| / sqrt(volVar · secondsLeft)`. Measured over all 68 markets
(`tools/volScan.ts`), at the first instant each reading crosses a band:

| Reading | Band | Names the LOSER | Median crossing |
|---|---|---|---|
| fixed | 1.2 | 20/68 | t+153s |
| **adaptive** | 1.2 | **3/68** | t+574s |
| fixed | 1.6 | 14/68 | t+262s |
| **adaptive** | 1.6 | **1/68** | t+680s |
| fixed | 2.0 | 11/68 | t+423s |
| **adaptive** | 2.0 | **0/68** | t+783s |

So it is a much better witness and a much later one, and the two facts are the
same fact. It is useless as a gate on the chase — a player that waited for one
sigma would buy every winner at 0.71–0.94, which is the parity plan that just
died. It is exactly right as a RELEASE.

It also does not separate the two colliding windows at the decisive moment: the
level 68 window reads 0.52–0.56 sigma while the player is buying UP at t+81–91,
and `…1775110500` reads 0.57 sigma at t+61 while the player is buying UP at 0.85.
Nothing measured so far separates those two instants except the model-book
disagreement.

The reading is in the code as `outsideZ` (estimator time constant `volTauMs`,
default 180 s) and appears in both debug channels as `z=`. Nothing reads it
except `fairHoldZ`.

## Not an outlier: buying dear while unconfirmed

Before building anything on "do not pay this much for a leg the outside price has
not confirmed", `tools/buyScan.ts` counted, per market, the shares bought at an
ask of 0.55 or more while the oracle had not confirmed that leg to 1.6 bands. The
level 68 window is FOURTH on that list with 1063 such shares, and 26 of the 68
markets are at 1000 or more. Buying dear and unconfirmed is not an anomaly — it
is the normal operation of the player. A price cap conditioned on the oracle
would fire in nearly every window.

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
- **`--param debug=2` is the observation channel**: one line per market per
  `debugEveryMs` for the WHOLE window, emitted above every early return, so it
  keeps reporting after both legs are complete. `debug=1` stops the moment the
  player is done, which silently truncates any measurement of what happened
  later — half the markets never even print their summary line. Every `debug=2`
  line carries its own slug, so parallel chunks can be parsed without tracking
  market boundaries. One pass over the first 68 takes about four minutes in four
  parallel chunks and is worth far more than a probe: three of this session's
  four results came from it without running the player at all.
- `tools/parityScan.ts`, `tools/buyScan.ts`, `tools/volScan.ts` — offline
  analyses of that channel (the parity plan, what the player pays and when, and
  the volatility-normalised reading). `volScan.ts --dump <slug>` prints both
  oracle readings second by second; `--release <z>` prints when each window's
  WINNER is first named at that many sigma, and at what ask.
- **`/tmp` is case-insensitive here.** Probe tags `Z1` and `z1` are the same
  files, so a run can silently read a previous session's rows. Delete the target
  `.rows` before waiting on it.
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
  `lead=`, `edg=`, `out=`, `diff=`/`need=` (the oracle band), `z=` (the same
  distance in measured sigma, `!` once `fairHoldZ` has released a cap),
  `pModel=`/`pBook=`, `want=`/`gap=` (the model-book disagreement) and `chs=`.
- The first N slugs:
  `npx tsx protocols/pair-game-opus/tools/universe.ts --first N --slugs-only`
  (cache them to a file; the sweeps above use `/tmp/pg/slugs68.txt`).
- **Per-tick state set inside the `needUp > 0 && needDown > 0` branch is stale
  once a leg completes.** A cap left standing from the previous tick refused the
  only leg still being bought and looked exactly like the rule not working. The
  fix is in the code (`fairCapSide` / `fairHandover` are cleared above the
  branch); check any new per-tick latch the same way.

## What is left, and where to look

Seven families have now been tried on this window and every one costs between
seven and forty-three of the sixty-seven markets that already pass. What the four
measurements of this session add up to is that **the level 68 window is not an
outlier in anything the player can see about ITSELF**: not in what it pays
(fourth of 68 in shares bought dear and unconfirmed, with 26 windows at the
maximum), not in how far it commits past its own money (twelfth of 68, and eleven
passing windows go further), and not in what the outside price says at the moment
it commits (0.52–0.56 sigma, indistinguishable from `…1775110500`'s 0.57 at the
moment that window's chase is essential). Every rule that scores the player's own
state fires everywhere or nowhere. That is why six families have died the same
death.

The one reading that does separate the two windows is the model-book
disagreement, and this session established that it cannot be used as a cap
because a cap redirects money rather than saving it.

So the next session should look at the ONE thing not yet measured: what the book
does AROUND the commitment rather than what the player does. Concretely, over the
observation channel: in each window, how quickly does the leaning leg's ask come
BACK after the lean — the shape of the excursion in the book itself, not in BTC.
The level 68 window's UP ask goes 0.46 → 0.64 → 0.45 in a hundred seconds and
then sits at a coin flip for ten minutes; `…1775110500`'s goes 0.49 → 0.85 and
never returns. If the book's own reversion behaviour separates them, it is a
signal available at the instant, and no measurement of it exists yet. `volScan.ts`
and `underwaterScan.ts` show the pattern to follow: measure over the recording
first, and only build if the separation is there.

Do not reopen: the parity hold on any band or hold level; `fairHold` with or
without a release; the opening-lean thread (`convDwellMs`, `openCheapMs`); any
share or price cap on the chased leg; any solvency or underwater test; and any
rule that treats the model-book disagreement as a warning.

## Needs human

Nothing.
