# Status — Pair Game Opus

- Highest passed level: **46** (first 46 eligible markets)
- Current level: **47** (first 47 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: `2026-08-03T11:37:27.659Z-35d1de5f`

## Evidence — levels 1–46 at commit `4f21eb1e`

| Level | Run | Level | Run | Level | Run | Level | Run | Level | Run |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3744 | 11 | 3754 | 21 | 3764 | 31 | 3774 | 41 | 3784 |
| 2 | 3745 | 12 | 3755 | 22 | 3765 | 32 | 3775 | 42 | 3785 |
| 3 | 3746 | 13 | 3756 | 23 | 3766 | 33 | 3776 | 43 | 3786 |
| 4 | 3747 | 14 | 3757 | 24 | 3767 | 34 | 3777 | 44 | 3787 |
| 5 | 3748 | 15 | 3758 | 25 | 3768 | 35 | 3778 | 45 | 3788 |
| 6 | 3749 | 16 | 3759 | 26 | 3769 | 36 | 3779 | 46 | 3789 |
| 7 | 3750 | 17 | 3760 | 27 | 3770 | 37 | 3780 | | |
| 8 | 3751 | 18 | 3761 | 28 | 3771 | 38 | 3781 | | |
| 9 | 3752 | 19 | 3762 | 29 | 3772 | 39 | 3782 | | |
| 10 | 3753 | 20 | 3763 | 30 | 3773 | 40 | 3783 | | |

Every market ends exactly 1000/1000; worst pair cost on the ladder is 0.970
against a ceiling of 0.98. Level 46 (run 3789) reports 46/46 with no integrity
findings.

## What carried level 46: the spike gate

`spikeEdge` 35 / `spikeHoldMs` 10 s, both shipped on. While BTC sits more than
35 dollars from its own five-second average — and for ten seconds afterwards —
the player buys nothing and rests nothing on either side.

It is the first restraint in this file that repairs markets without costing any:
over the first sixty markets, failures go from four to two. It reads the SPEED of
the underlying, which the order book cannot express, and that is why every price
cap before it failed. The two markets it fixes lurch 86 dollars in five seconds
and give it back; the two markets that every earlier restraint destroyed never
travel more than 27.

Both bands are measured and both edges are real: threshold 30/35/40 clean and
repeatable, 45 loses one spike market outright, 50 loses both; hold 8/10/12 s
clean, 5 s lifts too early, 15 s starts refusing a window that must buy its
favourite in the first minute.

## Runs are NOT reproducible — read results accordingly

Latency jitter is random per order, so the same configuration on the same market
can finish differently. **Before promoting anything, repeat the probe two or
three times.** The shipped setting was confirmed four times over sixty markets
plus a fifth at the neighbouring threshold.

## Tools

- `tools/probe2.sh <tag> "<slugs>" [--param k=v ...]` — one parameter set over an
  explicit slug list; writes `/tmp/pg/<tag>.{json,err,rows}` and prints the run
  id. **Use this rather than `probe.sh`**, which swallows stderr and so makes a
  run that died environmentally look exactly like one that produced no report.
- **zsh does not word-split unquoted variables.** Never collect `--param` flags
  in a shell variable and expand it — the whole string arrives as one argument
  and the launcher rejects it. Write the flags out.
- `tools/ladder.sh <from> <to> [parallel] [outdir]` — `play-level` over a range,
  one PASS/FAIL line with run id and worst pair cost per level. 1–46 takes about
  twenty-five minutes at parallelism 6.
- Score any 60-market probe with
  `tools/level.ts --level 60 --run <id>` — the real RULES grader, rather than
  reading share counts by eye.
- Debug timelines go to **stderr**: `run-backtest.ts ... --param debug=1 --param
  debugEveryMs=1000 --sequential --json >/dev/null 2>file`. The tick line now
  carries `spk=` (BTC's deviation from its own short average), which is how the
  spike gate was sized.
- The first sixty slugs:
  `npx tsx protocols/pair-game-opus/tools/universe.ts --first 60 --slugs-only`

## Level 47 — the blocker, diagnosed

Remaining failures over the first sixty markets are exactly two: 47 and 52
(`btc-updown-15m-1775129400`, `-1775133900`). Both are unreachable by everything
tried so far and both have the same anatomy, freshly re-read at the shipped
defaults:

- They are SLOW windows. Peak BTC deviation is 12 dollars in market 47 and 12 in
  52, so the spike gate never engages and never will.
- The priority role changes hands ONCE, mid-window, and both legs end up bought
  around 0.5 by taking turns. Market 47 buys 281 DOWN at ~0.53 in its first
  fifty seconds, then flips and takes UP from 200 to 656 at 0.57–0.61. Market 52
  does the same with 344 DOWN at ~0.53 and then UP to 656 at 0.52–0.61.
- At the handover the pair is already lost on arithmetic: with 656 UP at 0.62 the
  remaining 719 DOWN would have to average 0.28, and DOWN is quoted at 0.40–0.44
  at that moment and never trades below 0.30 again.
- Both then reverse, and both end 1000 of the leg that lost against 281–344 of
  the leg that won.

## Next action

1. **Re-measure `reserveLow` escalation on top of the spike gate.** The escalation
   (0.7 / 0.8 / 0.9) was rejected last session at 6 / 10 / 9 failures against 4 —
   but that measurement predates the spike gate, and two of the four markets it
   was fighting are now gone. `reserveLow` at 1.0 is exactly the arithmetic the
   handover violates: it refuses to chase the new favourite past what the other
   leg's own observed low still needs. Cheap to run: four probes, sixty markets.
2. **If that fails, attack the HANDOVER itself rather than the price.** The
   distinguishing fact in both markets is not a price level but an event: the
   player spends a third of the window chasing one leg, then promotes the other
   and chases it too, at a HIGHER price than the first. Nothing in the player
   notices that this has happened. A rule that reads the handover — refuse to
   promote a leg whose current ask is above what the demoted leg has already been
   bought at, or require the promotion to pay for itself against the realized
   average — is untried and is keyed to the player's own history rather than to
   the quote.
3. Do NOT re-try price caps pinned to a leg's own low, budget averages, or the
   `earlyShare` family with better gates. All are measured dead in `pair.v1.ts`,
   and the two remaining markets are the ones they were built for.

## Needs human

Nothing.
