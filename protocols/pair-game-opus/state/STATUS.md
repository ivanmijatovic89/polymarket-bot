# Status — Pair Game Opus

- Highest passed level: **46** (first 46 eligible markets)
- Current level: **47** (first 47 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: `2026-08-03T11:37:27.659Z-35d1de5f`

## Evidence — levels 1–46

Levels 1–45 at commit `4f21eb1e`, runs 3744–3788 (one run per level, level N =
run 3743+N). Level 46 re-run at this session's final commit `36b8a4bf`: run
**3947**, 46/46.

## Runs are NOT reproducible — read results accordingly

Latency jitter is random per order, so the same configuration on the same market
can finish differently. **Before promoting anything, repeat the probe two or
three times.** This session lost an hour to a six-market result that looked like
a clean sweep and did not repeat.

## Tools

- `tools/probe2.sh <tag> "<slugs>" [--param k=v ...]` — one parameter set over an
  explicit slug list; writes `/tmp/pg/<tag>.{json,err,rows}` and prints the run
  id. **Use this rather than `probe.sh`**, which swallows stderr.
- **zsh does not word-split unquoted variables.** Never collect `--param` flags
  in a shell variable and expand it — the whole string arrives as one argument
  and the launcher rejects it. Write the flags out. (Cost ten minutes again.)
- `tools/play-level.ts --level N` — run and score one level in one command.
- Score any 60-market probe with `tools/level.ts --level 60 --run <id>`.
- A 60-market sequential probe takes 4–5 minutes locally; **three** run in
  parallel comfortably on 10 cores.
- Debug timelines go to **stderr**: `probe2.sh <tag> "<slugs>" --param debug=1
  --param debugEveryMs=5000`, then read `/tmp/pg/<tag>.err`. Tick lines carry
  `held=`, `spent=`, `tgt=`, `lead=` and `edg=`; the last is the book edge that
  drives the edge pace, and comparing it with `held` finds that cap instantly.
- The first sixty slugs:
  `npx tsx protocols/pair-game-opus/tools/universe.ts --first 60 --slugs-only`

## Level 47 — what actually blocks it, measured tick by tick

The shipped player fails markets 47 and 52 (`btc-updown-15m-1775129400`,
`-1775133900`). Both are near-even chops that reverse around t+100 s. Anatomy of
market 47, from its own debug timeline:

- By t+50 s the player holds **656 UP at an average of 0.59** and 281 DOWN,
  having spent 531 of a 970 ceiling. UP is the eventual loser.
- DOWN — the winner — is offered between 0.44 and 0.56 from t+50 s to t+110 s.
  Finishing DOWN there and topping UP up cheaply later comes to about 0.95 a
  pair. The player buys none of it.
- **Two** rules cut DOWN off at nearly the same place, which is why every
  single-knob probe in earlier sessions moved it a little and no further:
  1. the reserve held back for the abandoned leg is `0.6 ×` its trailing low,
     putting the bid cap at 0.484 against an ask of 0.56;
  2. the edge pace allows a leg `qty × edge / edgeFull` shares, and with a book
     edge of 0.11 against `edgeFull` 0.32 that is 344 shares.
  Release the reserve alone → ~400 shares. Release the pace alone → 514. Release
  both → 1000/1000 at a pair cost of 0.962, repeatably.

## The commitment exemption — shipped OFF, and why

Four new parameters, all defaulting to 0/off, documented in the strategy file:

- **`commitShare`** — once one leg passes this share of target, the accumulation
  paces (`edgeFull`, `holdRamp`, `earlyShare`, `openShare`, `fillPace`) stop
  applying to the other leg, latched for the window. Rationale: the paces ration
  a leg by how much the book has revealed because buying a leg is a DECISION;
  once most of one leg is bought the decision is made, and the other leg is not a
  second decision but the thing that makes the first one's shares matchable.
- **`commitReserve`** — release `reserveLow`'s floor while bidding for that
  latched leg, i.e. stop reserving against a leg already mostly bought.
- **`commitLoss`** — require the committed leg to be trading below what was paid
  for it before the exemption applies.
- **`commitRise`** — measured inert, see its comment.

`commitShare=0.6 commitReserve=1` repairs both blockers repeatably (0.962 and
0.968) and costs four markets in the first sixty. `commitLoss` at 0.03–0.045
recovers three of them. Full sixty at `commitLoss=0.045`: **58/60** — the same
count as the shipped player, on a different set. Level 47 now fails on market 29
instead of market 47.

## The one market in the way: 29 (`btc-updown-15m-1775113200`)

It is a mirror image of the blockers and that is the whole difficulty.

|                    | market 47 (repaired) | market 29 (broken) |
|--------------------|----------------------|--------------------|
| committed leg      | UP, 656 @ 0.595      | DOWN, 594 @ 0.594  |
| its ask at the time| 0.55                 | 0.60               |
| chased leg         | DOWN @ 0.46          | UP @ 0.41          |
| budget left        | 439                  | 499                |
| committed leg ends | worthless            | **winner**         |

Every instantaneous reading tried gives the same sign in both: which leg is
dearer, which is cheaper, the model price (`pModel` 0.58 vs 0.44 — both
"contradict" the chase), the price to beat (silent, BTC never leaves its own
60-dollar deadband in either window), share counts, needs, spend. The only
reading that differs is the committed leg against its own basis — down 4–5 cents
in the blockers, flat to up in the casualties — and that margin is three cents
wide on a noisy number. It passed one run of all six markets at 0.045 and failed
two repeats.

## Measured dead — do not re-try

- `underdogMax` / `underdogLift`, `swapEdge`, `reserveMom`, `maxImbalance`,
  `reserveLowUntilMs`, `priorityLatch`, `momDeadband`, `priority=dear`,
  `reserveLow` escalation and de-escalation, `edgeHoldMs`, `spendPace`, price
  caps pinned to a leg's own low, budget averages, `avgGuard`/`avgGuardFrom`,
  the `earlyShare` family — all in this or earlier sessions.
- **`reserveLow=0` globally** — finishes both blockers and costs three other
  markets; it changes every window from twenty seconds in. `commitReserve` is the
  same release restricted to the case that needs it, and it keeps those three.
- **`commitRise`** (trailing-low gate on the exemption) — inert at every pad up
  to 0.10 because the window's low is set by an opening print, and harmful at
  0.15.
- **The chased leg's ask average** as the "is it running away" test — too noisy;
  a leg falling from 0.49 to 0.39 ticks back above a thirty-second average
  whenever it matters.

## Next action — throttle the exemption by RATE, not by another price test

Price tests are exhausted; the remaining measured difference between the repair
and the casualty is how FAST the chased leg is bought.

- Market 47 (good): the chase takes 719 shares over 30 seconds — about 24 shares
  a second, spread over four separate stretches where that leg holds priority.
- Market 29 (bad): the chase takes 750 shares in **five** seconds — 150 a second,
  one burst, and it ends with the committed leg 219 shares short and 74 dollars
  left.

So: while the exemption is active, cap the chased leg at N shares per second (or
per rolling window), with the rest of the paces still off. The honest version of
the rule is "do not spend the ceiling faster than the market can prove it needs
spending" — a leg genuinely running away stays away and gives you half a minute;
a leg that is briefly cheap gives you one instant, and buying it out in that
instant is the mistake. Try 20/40/60 shares per second against markets 47, 52
and 29 first (about ninety seconds), then the first sixty. **Repeat every
promising six-market result at least twice before believing it.**

## Needs human

Nothing.
