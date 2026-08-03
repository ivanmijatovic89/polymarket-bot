# Status — Pair Game Opus

- Highest passed level: **45** (first 45 eligible markets)
- Current level: **46** (first 46 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: `2026-08-03T11:37:27.659Z-35d1de5f`

## Evidence — levels 1–45 at commit `260f81ad`

| Level | Run | Level | Run | Level | Run | Level | Run | Level | Run |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3664 | 10 | 3673 | 19 | 3682 | 28 | 3691 | 37 | 3700 |
| 2 | 3665 | 11 | 3674 | 20 | 3683 | 29 | 3692 | 38 | 3701 |
| 3 | 3666 | 12 | 3675 | 21 | 3684 | 30 | 3693 | 39 | 3702 |
| 4 | 3667 | 13 | 3676 | 22 | 3685 | 31 | 3694 | 40 | 3703 |
| 5 | 3668 | 14 | 3677 | 23 | 3686 | 32 | 3695 | 41 | 3704 |
| 6 | 3669 | 15 | 3678 | 24 | 3687 | 33 | 3696 | 42 | 3705 |
| 7 | 3670 | 16 | 3679 | 25 | 3688 | 34 | 3697 | 43 | 3706 |
| 8 | 3671 | 17 | 3680 | 26 | 3689 | 35 | 3698 | 44 | 3707 |
| 9 | 3672 | 18 | 3681 | 27 | 3690 | 36 | 3699 | 45 | 3708 |

Every market ends exactly 1000/1000; worst pair cost on the ladder is 0.970
against a ceiling of 0.98. Defaults were also re-verified over the first sixty
markets at the previous commit (run 3631): markets 1–45 all clean, and the two
parameters added since both default to inert.

## Runs are NOT reproducible — read results accordingly

Latency jitter is random per order, so the same configuration on the same market
can finish differently. **Before promoting anything, repeat the probe two or
three times.** `probe.sh` makes that cheap. A level that passes three runs in
four is not passed.

## Tools

- `tools/probe.sh "<slugs>" [--param k=v ...]` — one parameter set over an
  explicit slug list, printing only the per-market rows. Sixty markets in ~4 min;
  four can run in parallel on this machine.
- `tools/ladder.sh <from> <to> [parallel] [outdir]` — `play-level` over a range,
  one PASS/FAIL line with run id and worst pair cost per level. The whole ladder
  1–45 takes about twenty-five minutes at parallelism 6.
- Debug timelines go to **stderr**, so `probe.sh` swallows them. Use
  `run-backtest.ts ... --param debug=1 --param debugEveryMs=5000 --sequential
  --json >/dev/null 2>file` instead. Every level since 44 has been diagnosed this
  way; it is much faster than the SQL tools.
- The first sixty slugs:
  `npx tsx protocols/pair-game-opus/tools/universe.ts --first 60 --slugs-only`

## Level 46 — the blocker, now diagnosed as TWO failures

Remaining failures over the first sixty markets are 46, 47, 52 and 55
(`btc-updown-15m-1775128500`, `-1775129400`, `-1775133900`, `-1775136600`).

All four share one anatomy: the player spends between a half and three fifths of
the ceiling acquiring six hundred-odd shares of ONE leg at an average near 0.59,
the window then reverses, and the leg still owed six or seven hundred shares is
quoted at 0.62 to 0.85 against a remaining budget that affords about 0.60.

But the fills that do the damage come in two different shapes, and that is the
session's main finding:

- **46 and 55 buy inside a JUMP.** Market 55's book goes 0.50 → 0.64 in five
  seconds and the player takes 400 shares at 0.59–0.64; market 46's DOWN ask goes
  0.45 → 0.70 in ten seconds and the player finishes DOWN with 625 shares at
  0.63–0.67. Both jumps revert within a minute. These are reachable: a cap that
  can tell a spike from a trend repairs both.
- **47 and 52 buy a genuine TREND that later reverses.** Their legs climb about
  eight cents over sixty seconds, which every reading available at the time
  agrees with, and the reversal arrives minutes later. Nothing tried so far
  separates these from the trends the player must chase.

## Measured and rejected this session

- **`reserveLow` escalation** (reserve the other leg at more of its observed
  low): 6 failures at 0.7, 10 at 0.8, 9 at 0.9, against 4 at the shipped 0.6.
  Fixes 46 and 52 only at 0.9, where it costs six other markets.
- **`budgetPace`** (cap the priority leg at a multiple of what the remaining
  budget affords per outstanding share): 19 / 19 / 18 / 17 failures at 1.15 /
  1.25 / 1.35 / 1.45. Repairs none of the four. The separating ratio does not
  exist — passing markets routinely buy their favourite at two or three times the
  remaining average, late, when it has to be finished.
- **`jumpPad`** (cap the priority leg at its own ask EMA plus a pad — a reference
  that FOLLOWS a move instead of being pinned behind it): 11 / 9 / 6 / 6 failures
  at pad 0.03 / 0.05 / 0.08 / 0.12, and at pad 0.08, 6 / 5 / 5 / 10 at time
  constants 8 s / 15 s / 20 s / 45 s. **The first restraint ever to repair 46 and
  55.** Not shipped: it never reaches 47 or 52, and the delay it imposes costs
  markets 2 and 26 — 2 ends up finishing its leg at 0.72 instead of 0.61.
- **`earlyBoth` 0.25/0.30 and `earlyMs` 90 s**: completely inert, four failures
  and the same four, because `earlyFair` releases the size cap in all four
  markets (the outside model agrees with the book there, so the cap never binds).
- **`earlyFair=0`** (unconditional size cap): 7 / 7 / 8 / 8 failures across the
  variants. Fixes 46 and costs 18, 33, 42, 57. Confirms the shipped doc.

## Next action

Stop attacking the four as one family; they are two, and 46/55 are the ones with
a reachable signature.

1. **Make `jumpPad` pay for itself.** It repairs 46 and 55 and its whole cost is
   the delay it imposes on legs that are climbing legitimately. Two ways to
   remove that cost are untried: (a) apply it to CROSSING only, leaving the
   resting bid where it is, so a leg the cap refuses still fills passively on
   every downtick instead of being pushed out of the book entirely; (b) release
   it once the leg is past `finishShare`, which is where market 2's expensive
   completion happened. Either would be measured the same way — sixty markets,
   pad 0.08, time constant 15–20 s, repeated twice because these runs are not
   reproducible.
2. **47 and 52 need a different question.** Every mechanism tried reads the price
   path, and their price path is indistinguishable from a chase that must be
   made. What has NOT been read is the player's own exposure: in both, the moment
   before the reversal the player holds ~656 of one leg and ~300 of the other,
   with 55–58% of the ceiling spent — a state that is fine if the trend holds and
   fatal otherwise. A rule keyed to that state (how much of the ceiling has been
   committed relative to how many PAIRS have actually been formed) is the one
   reading not yet measured.

## Needs human

Nothing.
</content>
</invoke>
