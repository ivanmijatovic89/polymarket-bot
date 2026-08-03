# Status — Pair Game Opus

- Highest passed level: **46** (first 46 eligible markets)
- Current level: **47** (first 47 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: `2026-08-03T11:37:27.659Z-35d1de5f`

## Evidence — levels 1–46

Levels 1–45 at commit `4f21eb1e`, runs 3744–3788 (one run per level, level N =
run 3743+N). Level 46 re-run at commit `ad24bd93`: run **3883**, 46/46, worst
pair cost 0.9695 against a ceiling of 0.98.

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
- A 60-market sequential probe takes about 4–5 minutes locally; **three** run in
  parallel comfortably on 10 cores.
- Debug timelines go to **stderr**: `run-backtest.ts ... --param debug=1 --param
  debugEveryMs=15000 --sequential --json >/dev/null 2>file`. Tick lines carry
  `tgt=<bidUp>/<bidDown>` and `lead=`; comparing `tgt` with the ask on the same
  line is the fastest way to find which cap is actually binding.
- The first sixty slugs:
  `npx tsx protocols/pair-game-opus/tools/universe.ts --first 60 --slugs-only`

## Level 47 — the blocker

Over the first sixty markets the shipped player fails exactly two: 47 and 52
(`btc-updown-15m-1775129400`, `-1775133900`). Both are slow windows (peak BTC
deviation 12 dollars), so the spike gate never engages and never should.

Anatomy, now read tick-by-tick twice:

- Both windows open near even, the player picks the cheaper leg, then the
  momentum reading hands priority to the other leg within a minute on a BTC
  deviation of three to fifteen dollars. It buys 650-odd shares of that leg. The
  window reverses for good around t+105 s and the abandoned leg is the winner.
- Both finish 1000 shares of the loser against 281 / 344 of the winner.
- At the reversal the pair is STILL completable — market 47 at t+105 s needs
  about 420 dollars and has 440 — and the player does not complete it because
  its bid on the winning leg is capped at 0.52 against an ask of 0.56. The cap
  is `(budgetLeft − needOther × reserve) / needFirst`, and `reserve` is set by
  `reserveLow` at 0.6 × the abandoned leg's trailing low. **The binding
  constraint in these windows is the bid, not the money.**

## Measured dead — do not re-try

- **`underdogMax`** (0.15 / 0.20 / 0.25 / 0.40) and **`underdogLift`** — last
  session's headline plan, and it is built on a misreading. Once the priority
  leg is complete the player leaves the two-legged branch entirely, so
  `underdogMax` no longer applies at all; in both blocking windows it is inert to
  the decimal. The leg that is stranded is stranded by the bid cap above.
- **`swapEdge`** (new this session) — the priority role may only change hands
  when the book edge for the other leg beats a threshold proportional to the
  shares already sunk into the current one. Repairs BOTH blocking windows
  outright, 1000/1000 at pair costs 0.920 and 0.941, the healthiest either has
  ever printed. Costs three other markets, 57 of 60 against 58. Below 0.4 the
  repair disappears; 0.5 and 0.7 are much worse (53, 51). Ships off.
- **`reserveMom`** (new this session) — drop the reserve floor while the leg left
  behind is still falling. Reproduces `reserveLow=0` to the cent: at the moments
  the reserve binds, the abandoned leg is always below its own average. Ships off.
- **`maxImbalance`** (300 / 450 / 600) — saves exactly the budget it was
  predicted to save and moves the winning leg not one share, because of the bid
  cap above. Combined with `swapEdge` it prevents either leg finishing.
- **`reserveLowUntilMs`** (new this session; 60 / 90 / 120 / 150 s) — release
  only the LATE reserve and leave the opening minutes alone. Lifts the winning
  leg from 281 / 344 to 375–406 / 531 in both windows. Necessary, not sufficient:
  the player still finishes the losing leg and runs out.
- **`priorityLatch`** — 56 of 60 alone; with conviction re-latching turned down
  it repairs both blockers and loses eight to twelve markets.
- `momDeadband` (0.01 / 0.02 / 0.05), `priority=dear`, `reserveLow` escalation
  and de-escalation, sustained edge (`edgeHoldMs`), `spendPace`, price caps
  pinned to a leg's own low, budget averages, the `earlyShare` family — all
  measured dead in this or earlier sessions.

## The central finding, four sessions in

Every change tried so far reshuffles WHICH markets the player wins rather than
raising the count. `swapEdge` is the clearest case: it repairs the two known
failures and breaks three others, and the three casualties fail in exactly the
shape the two originals do — 1000 shares of the loser, 200 to 400 of the winner.

The reason the casualties appear is worth keeping: the priority role flickering
every tick was doing an undesigned second job, because a leg is only bought on
ticks where it holds priority. Suppress the flicker and the player buys its
chosen leg out in seventy-five seconds instead of minutes. Any future rule that
makes the priority sticky must replace that brake explicitly.

## Next action — start from the best measurement, not from a new idea

The closest either blocking window has ever come is `maxImbalance` 300 with
`reserveLow` 0 — the two constraints the tick record identifies, released
together. The winning leg goes from 281 / 344 shares to **656 / 778**, and at
`maxImbalance` 150 to 800 / 750. That is the frontier; everything else this
session sits behind it.

Neither finishes, and the reason is precise and worth attacking directly: making
the legs take turns buys BOTH of them near half a dollar, so market 47 at
950 / 800 shares carries a pair cost of 1.10. Share count and pair cost trade
against each other under these two knobs.

So the question for next session is narrow and answerable: **can the player keep
the share counts this setting produces while buying one of the two legs cheaply?**
Both windows do offer it — market 47's losing leg is available under 0.05 for the
last four minutes and its winner touched 0.400 at t+48 s. What the turn-taking
version does is spend the late minutes topping up whichever leg is behind at
whatever it costs, instead of parking on the cheap leg and waiting. A cap that
says "in the closing minutes, buy the leg that is under 0.10 and nothing else"
would keep the balance the imbalance cap creates and refuse the expensive fills
that ruin the pair cost. That is a rule about the endgame, it is aimed at a
measured 1.10, and it has not been tried.

Run it against markets 47 and 52 first (they take about a minute), and only then
against the first sixty.

## Needs human

Nothing.
