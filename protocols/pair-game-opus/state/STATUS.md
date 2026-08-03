# Status — Pair Game Opus

- Highest passed level: **51** (first 51 eligible markets)
- Current level: **52** (first 52 eligible markets)
- Active strategy: **`pair-game-opus-pair.v1`** (`strategies/pair.v1.ts`), all
  defaults — no `--param` needed
- Inbox processed through: `2026-08-03T11:37:27.659Z-35d1de5f`

## Evidence

Levels 1–45 at commit `4f21eb1e`, runs 3744–3788 (one run per level, level N =
run 3743+N). Levels 46–51 at commit `3d8055f9`, three clean runs each, all with
the shipped defaults and no parameters:

| Level | Runs (all 3 passed) |
|---:|---|
| 47 | 4014, 4015, 4016 (and 4011–4013 with the values passed explicitly) |
| 48 | 4017, 4018, 4019 |
| 49 | 4020, 4021, 4022 |
| 50 | 4023, 4024, 4025 |
| 51 | 4026, 4027, 4028 |

Level 46 is re-verified by construction — every level contains the ones below it.

## Level 52 — two runs pass, one fails, and that is why it is not claimed

Runs 4030 and 4031 are 52/52. Run 4029 fails the added market
`btc-updown-15m-1775133900` at 1000/898 and a pair cost of 0.9996 — right on the
ceiling. The market is not being weakened; it is being held to the same bar, and
one run in three does not clear it.

**The added market is deterministic on its own and only fails in a batch.** Six
single-market probes of it returned the identical result (0.967 a pair, 1000/1000);
the failure appears only inside the 52-market sequential run. The latency jitter
stream is evidently shared across the batch, so a market's draw depends on how
many orders the markets before it placed. Diagnose this one **inside a level
run**, not in isolation — an isolated probe will simply pass and tell you nothing.

## What passed level 47 — three gates on the commitment exemption

The exemption (`commitShare=0.6`, `commitReserve=1`) repairs the two blockers and
costs four other markets. No instantaneous price test separates the two groups,
because the exemption is a bet that the committed leg collapses and nothing
visible at the time says whether it will. Three gates do separate them, and all
three now ship on by default:

- **`commitLeadMs=12000`** — the deficient leg must have held the momentum lead
  for twelve seconds IN TOTAL since the latch before the exemption arms. The
  repairs have twelve to fifteen seconds of it by the time the chase is half
  done; the casualties have one or two. Measured: 8 s leaves both casualties
  firing, 16 s delays one repair into a worse price and loses it.
- **`commitLag=0.15`** — the chased leg must still be 150 shares behind at the
  instant the exemption arms. One casualty armed at 719 vs 781 and spent the
  ceiling closing a 62-share gap.
- **`commitLoss=0.045`** — the committed leg must be marked down against both its
  last quote and its own thirty-second average. On its own it is too noisy to
  trust; alongside the other two it is what keeps market 38 from arming.

Arming is one-way: checked every tick until it fires, latched afterwards.
Re-checking it after the chase starts switches the exemption off at parity and
strands the leg, which is the failure the latch exists to prevent.

## Measured dead — do not re-try

- **`commitRate`** (shares per second on the chase, this session) — a rate cap
  slows the chase without stopping it; the money still goes out. Monotone harm
  over the first sixty markets: 58 without it, 57 at 100/s, 54 at 60/s and 40/s,
  51 at 20/s. The one-second "bursts" that motivated it were an artefact: the
  leg stopped being contested because the chase had finished, not because the
  chase was instantaneous.
- **`commitRise`** — inert at every pad up to 0.10, harmful at 0.15.
- `underdogMax` / `underdogLift`, `swapEdge`, `reserveMom`, `maxImbalance`,
  `reserveLowUntilMs`, `priorityLatch`, `momDeadband`, `priority=dear`,
  `reserveLow` escalation and de-escalation, `edgeHoldMs`, `spendPace`, price
  caps pinned to a leg's own low, budget averages, `avgGuard`/`avgGuardFrom`,
  the `earlyShare` family, `reserveLow=0` globally.
- The chased leg's ask average as an "is it running away" test — too noisy.

## Tools

- `tools/probe2.sh <tag> "<slugs>" [--param k=v ...]` — one parameter set over an
  explicit slug list; writes `/tmp/pg/<tag>.{json,err,rows}` and prints the run
  id. **Use this rather than `probe.sh`**, which swallows stderr.
- **zsh does not word-split unquoted variables.** Never collect `--param` flags
  in a shell variable and expand it — the whole string arrives as one argument
  and the launcher rejects it. Write the flags out. (Cost ten minutes again.)
- `tools/level.ts --level N --run <id>` — the only place a level may be scored.
- `tools/play-level.ts --level N` — run and score one level in one command.
- A 47-market sequential probe takes 3–5 minutes locally; **three** run in
  parallel comfortably on 10 cores, which is exactly one level's evidence.
- Debug timelines go to **stderr**: `--param debug=1 --param debugEveryMs=2000`,
  then read `/tmp/pg/<tag>.err`. Tick lines carry `held=`, `spent=`, `tgt=`,
  `lead=`, `edg=` and now `chs=<chase leg>/<lead seconds>`, which is what makes
  the arming gates readable at a glance.
- The first N slugs:
  `npx tsx protocols/pair-game-opus/tools/universe.ts --first N --slugs-only`

## Next action

Level 52. The added market ends at 0.9996 a pair in the run that fails it and
0.967 in the runs that pass, so the whole gap is a few cents of acquisition cost
on the chased leg. Reproduce it inside a 52-market run (roughly one in three),
pull that market's timeline out of the batch's stderr, and find where those cents
go. Do not tune against a single-market probe of it — that always passes.

## Needs human

Nothing.
