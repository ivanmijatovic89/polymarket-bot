# Status — Pair Game Opus

- Highest passed level: **37** (first 37 eligible markets, run **3264**)
- Current level: **38** (first 38 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: (no entries)

## Evidence — every level re-run on the shipped defaults, this session

| Level | Run | Level | Run | Level | Run | Level | Run |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3228 | 11 | 3238 | 21 | 3248 | 31 | 3258 |
| 2 | 3229 | 12 | 3239 | 22 | 3249 | 32 | 3259 |
| 3 | 3230 | 13 | 3240 | 23 | 3250 | 33 | 3260 |
| 4 | 3231 | 14 | 3241 | 24 | 3251 | 34 | 3261 |
| 5 | 3232 | 15 | 3242 | 25 | 3252 | 35 | 3262 |
| 6 | 3233 | 16 | 3243 | 26 | 3253 | 36 | 3263 |
| 7 | 3234 | 17 | 3244 | 27 | 3254 | 37 | 3264 |
| 8 | 3235 | 18 | 3245 | 28 | 3255 | | |
| 9 | 3236 | 19 | 3246 | 29 | 3256 | | |
| 10 | 3237 | 20 | 3247 | 30 | 3257 | | |

Every level was re-run from scratch on the current defaults at the current
commit; the earlier evidence (runs 2966–3022) is superseded because the defaults
changed. Every market ends exactly 1000/1000 and the worst pair cost on level 37
is 0.969 against a ceiling of 0.98.

## Runs are NOT reproducible — read results accordingly

Latency jitter is random per order, so the same configuration on the same market
can finish differently. This is not a curiosity, it is a trap: an earlier version
of this session's change made market 4 bistable (1000/1000 in about three runs of
four, 632/1000 in the rest) and the ladder duly reported eight of the lower
levels failing while level 37 "passed". **Before promoting anything, repeat the
probe two or three times.** `probe.sh` makes that cheap.

## Tools added this session

- `tools/probe.sh "<slugs>" [--param k=v ...]` — one parameter set over an
  explicit slug list, printing only the per-market rows. Forty markets in ~90 s;
  four or five can run in parallel on this machine.
- `tools/ladder.sh <from> <to> [parallel]` — `play-level` over a range of levels,
  bounded parallelism, one PASS/FAIL line with run id and worst pair cost per
  level. The whole ladder 1–37 takes about eight minutes.

## How the player works now

Unchanged from the previous session except for the block below: the
remaining-budget line is the ceiling guarantee, `ptbFair` (disagreement between
BTC's implied probability and the book's) picks the priority leg after a 45 s
stand-down, `underdogMax` 0.10 holds the second leg to a loser's price,
`openMs`/`openShare` and `edgeFull` pace accumulation, conviction overrides the
trend read on a hard opening lean.

**New: the early size cap.** Before `earlyMs` (45 s — the same stand-down the
override waits out), no leg may hold more than `earlyShare` (0.5) of its target,
but only when both of these hold:

- the player already holds at least `earlyBoth` (0.35) of the target in the
  OTHER leg — i.e. the window has already made it buy both sides, which only
  happens when the priority role has changed hands;
- and the outside price does not back the leg being bought (`earlyFair` 1). The
  permission latches, so a wobble across the threshold cannot re-impose the cap.

Measured and shipped disabled, with numbers in the file: `reserveLow` (+
`reserveLowAfterMs`), `earlyFairEdge`, plus everything listed in previous
sessions.

## What level 37 cost, and what it taught

Its blocking market opens leaning UP, the book completes the whole UP leg inside
the 45 s stand-down at an average near 0.65, and the market then reverses for
good. Three families of cure were measured:

- **`avgGuard`** (cap each bid so the two realized averages stay inside the
  ceiling) fixes all four failing markets and breaks five earlier ones, exactly
  as its own note predicted — it refuses the expensive winner and leaves the
  player holding a full leg of the cheap loser.
- **Price caps on the chase** (`reserveLow`, reserving against the other leg's
  own cheapest observed ask) look much better — 0.7 fixes two of three failures
  — but they do not do what they appear to do. Capping the price only converts a
  taker fill into a resting maker bid a few cents lower, and a reversing leg
  falls straight through that bid. The same thousand shares of the same losing
  outcome get bought anyway.
- **A cap on SIZE** is the one that works, and only with both gates. Ungated it
  costs three markets that had to finish a leg early; gated on the player's own
  inventory it costs one; gated additionally on the outside price disagreeing it
  costs none.

The gate thresholds are not smooth. At `earlyBoth` 0.25 and 0.3 the mechanism
reaches into a market it was never meant to touch and makes it bistable; 0.35 is
where it stops. `earlyShare` 0.4 and 0.5 both work, 0.45 is worse than either.
Treat any change here as a change of behaviour, not a tuning nudge.

## Level 38 — the blocker, diagnosed

Level 38 fails on `btc-updown-15m-1775121300` (750/1000, and UP is the winner).
The player builds 750 UP at about 0.615 in the first twenty seconds, then the
`edgeFull` pace freezes that leg — the edge narrows, the allowance drops below
what is already held — and the priority role moves to DOWN, which is then
completed from 0.45 down to 0.34. UP's remaining 250 shares are left with an
allowance of 0.33 and UP never trades below 0.47 again.

Two things to try, in order:

1. **Finish what you started.** A leg past roughly three quarters of its target
   should be completed rather than frozen: unmatched shares are a total loss, so
   the marginal 250 are worth more than the pace they violate. This is a
   one-sided release of `edgeRoom` and it does not refuse anything.
2. The early cap should have held DOWN at 500 here and did not, because the
   outside price backed DOWN by exactly 0.07 — and was wrong. Requiring a larger
   backing (`earlyFairEdge` 0.10) does fix this market and costs market 18, so
   the threshold alone is not the answer; something has to separate "the model
   has no view" from "the model disagrees".

Market 40 (`btc-updown-15m-1775123100`, 469/1000) also fails on its own and has
the same shape as 37 did. `reserveLow` 0.7 fixes it and costs market 26.

## Next action

Attack level 38 with the "finish what you started" release above. Re-run the
whole ladder (`ladder.sh 1 38 6`) before claiming it, and repeat any candidate
probe two or three times before believing it.

## Needs human

Nothing.
