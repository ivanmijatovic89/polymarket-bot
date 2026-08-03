# Status — Pair Game Opus

- Highest passed level: **46** (first 46 eligible markets)
- Current level: **47** (first 47 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: `2026-08-03T11:37:27.659Z-35d1de5f`

## Evidence — levels 1–46

Levels 1–45 at commit `4f21eb1e`, runs 3744–3788 (one run per level, level N =
run 3743+N). Level 46 re-run at the current commit: run **3823** (see below);
the earlier level-46 evidence is run 3789.

Every market ends exactly 1000/1000; worst pair cost on the ladder is 0.970
against a ceiling of 0.98.

## What carried level 46: the spike gate

`spikeEdge` 35 / `spikeHoldMs` 10 s, both shipped on. While BTC sits more than
35 dollars from its own five-second average — and for ten seconds afterwards —
the player buys nothing and rests nothing on either side. It reads the SPEED of
the underlying, which the order book cannot express, and that is why every price
cap before it failed.

## Runs are NOT reproducible — read results accordingly

Latency jitter is random per order, so the same configuration on the same market
can finish differently. **Before promoting anything, repeat the probe two or
three times.**

## Tools

- `tools/probe2.sh <tag> "<slugs>" [--param k=v ...]` — one parameter set over an
  explicit slug list; writes `/tmp/pg/<tag>.{json,err,rows}` and prints the run
  id. **Use this rather than `probe.sh`**, which swallows stderr.
- **zsh does not word-split unquoted variables.** Never collect `--param` flags
  in a shell variable and expand it, and never `set -- $line` inside a loop —
  the whole string arrives as one argument and the launcher rejects it. Write
  the flags out.
- `tools/ladder.sh <from> <to> [parallel] [outdir]` — `play-level` over a range.
  1–46 takes about twenty-five minutes at parallelism 6.
- Score any 60-market probe with `tools/level.ts --level 60 --run <id>`. Scoring
  a 60-market probe at `--level 46` works and prints `passed=46/46`, but the
  header still says FAIL because the run carries markets outside that level's
  universe — read the INTEGRITY line before believing a FAIL.
- A 60-market sequential probe takes about 4–5 minutes locally; two run in
  parallel comfortably on 10 cores.
- Debug timelines go to **stderr**: `run-backtest.ts ... --param debug=1 --param
  debugEveryMs=15000 --sequential --json >/dev/null 2>file`. Tick lines carry
  `spk=` (BTC's deviation from its own short average) and `edg=` (the book's
  spread, instantaneous/sustained). The `summary` line per market prints each
  leg's lowest ask and when it printed — the cheapest pair the window ever
  offered.
- The first sixty slugs:
  `npx tsx protocols/pair-game-opus/tools/universe.ts --first 60 --slugs-only`

## Level 47 — the blocker

Remaining failures over the first sixty markets are exactly two: 47 and 52
(`btc-updown-15m-1775129400`, `-1775133900`). Both are slow windows (peak BTC
deviation 12 dollars), so the spike gate never engages and never should.

Anatomy, read tick-by-tick this session:

- Neither window is unwinnable. Market 47's cheapest UP is 0.002 (at t+835 s)
  and its cheapest DOWN 0.400 (at t+48 s) — a floor of 0.402 against a 0.98
  ceiling. The pair is simply never affordable at ONE instant: the two asks sum
  to about 1.01 for the whole window, so the only way through is to buy each leg
  in its own trough, minutes apart.
- The player instead spends more than half its money in the first minute on the
  leg quoted 0.53–0.61, on a book that is still a coin flip, and that leg is the
  one that expires worthless. In market 47 it holds 656 UP by t+60 s; the window
  then reverses for good at t+105 s and DOWN runs from 0.44 to 0.99. It finishes
  1000 UP / 281 DOWN.
- What licenses those 656 shares is the edge pace (`edgeFull`): the allowance is
  `|askUp − askDown| / 0.32` of the target, read at ONE tick and ratcheting.
  A single instant of 0.21 spread inside a minute of coin-flip book buys 656
  shares permanently.

## Measured dead — do not re-try

- `reserveLow` escalation (0.7 / 0.8 / 0.9) — re-measured this session ON TOP of
  the spike gate, since the earlier rejection predated it. Worse than ever:
  3 / 7 / 7 failures over the first sixty markets against 2 with it off (runs
  3792, 3794, 3795 versus baseline 3793). Closed.
- Sustained edge (`edgeHoldMs`, new this session) — the edge pace reading the
  LOWEST spread over a trailing window instead of this tick's. It repairs both
  blocking windows cleanly (1000/1000, pair cost ~0.96, six probes). It costs
  14 / 15 / 14 / 9 markets under four different gates. Full numbers in the
  parameter's own comment.
- `spendPace` (new this session) — ration the shared BUDGET by the clock rather
  than shares. Repairs market 47 outright and lifts market 52 from 344 to 825,
  at the cheapest pair costs this player has ever printed (0.83–0.95) — and
  fails 22 of sixty. Anything gentle enough to be safe is inert.
- Price caps pinned to a leg's own low, budget averages, and the `earlyShare`
  family with better gates — all measured dead in earlier sessions.

## A fact that killed one plan

The previous session's next action was to build a rule around the HANDOVER —
the moment the priority role changes hands. It cannot be done as stated: the
priority role does not change once mid-window, it flickers on essentially every
tick. A counter over it saturates within seconds of the first fill, and gating
the sustained edge on "at least one handover" reproduced the ungated result
market for market (run 3803 versus 3799). "The priority leg changed" is not a
rare event and cannot carry a rule. Fifteen-second debug logs make it look rare;
it is not.

## Next action

Three restraint families are now closed, and they failed the same way: any rule
strong enough to stop the bad commitment also delays the good one, because at
the moment of commitment the two are indistinguishable in the book, in the
clock, and in the budget.

What has NOT been tried is changing what the player does AFTER the read goes
wrong, rather than trying to prevent the read. The specific arithmetic:

1. `underdogMax` is 0.10. The non-priority leg may never pay more than a
   loser's price. In both blocking windows the leg that wins is the demoted one,
   quoted 0.44–0.56 for two full minutes after the reversal, and the player rests
   at 0.48 and never crosses. Everything else is affordable at that moment —
   the budget line alone would allow 0.487 — so the binding constraint is
   `underdogMax`, not money. Measure `underdogLift` (0 today), which hands the
   underdog its allowance back as the priority leg fills, and `underdogMax`
   itself at 0.15–0.25. This is the one constraint in the chain that has never
   been moved.
2. If that fails, look at the endgame rather than the open: both windows still
   hold 700-odd unbought shares of the winning leg with five minutes and real
   money left. A rule that abandons the pair ceiling's projected arithmetic once
   one leg is complete and simply buys the other as cheaply as it can is untried.

## Needs human

Nothing.
