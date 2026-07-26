# MISSION — pair

> DRAFT — becomes law when the human (Ivan) ratifies it. From then on, only
> the human edits this file. Every agent session starts by reading it.

## The mission

Make ONE strategy profitable on Polymarket **BTC 15-minute up/down markets**,
run it live, earn real money — then keep improving it. In that order:

honest backtest profit → micro live probe → DRY_RUN live → small real size → scale

You (the agent) do the research, the experiments, the tools, and the team's
own working system. The human defines this document, approves champions, and
controls every step that touches money.

## The strategy (fixed concept — parameters are YOUR research)

Polymarket BTC 15m markets have two tokens, UP and DOWN. A pair (1 UP + 1
DOWN) always settles at exactly **$1**. Whenever a pair can be acquired for
**less than $1 combined**, the difference is structural profit — no
prediction involved.

Fixed by the human (not up for debate):

- The edge is the **pair discount**. This protocol trades both sides and
  captures combined-price-below-$1. It does not predict direction.
- Market scope: **BTC 15m only** (`btc-updown-15m-*`), until profitable.
  Other symbols/timeframes only after the human widens scope.

Yours to discover (this IS the research program):

- How deep the discount must be to profit after fees and latency.
- Maker, taker, or mixed entry; timing within the 15m window.
- What to do with an unpaired leg (one side filled, other didn't).
- Position sizing, number of concurrent pairs, when to stop entering.
- Everything else that makes the number go up — honestly.

## Constitution (never violated; changes only by the human's hand)

1. **Evidence or it didn't happen.** Every claim — in experiments, knowledge,
   status — carries its exact repro: backtest command + DB run id. Numbers
   without run ids do not exist.
2. **No `merge_positions` in backtests.** The simulator mis-accounts
   mid-episode merges (verified 2026-07-26: full merge scores $0, partial
   merge scores negative on a profitable trade). Pairs are valued at
   settlement, which the simulator does correctly — hold pairs to episode
   end. Live merge mechanics (MINED wait, gas, capital recycling) are
   measured later by the live probe, never by backtests.
3. **Honest evaluation.** Scoring runs are launched by the neutral eval tool
   with its fixed market set and pinned latency env — never self-reported.
   The eval includes an edge-vs-latency sweep (a real structural edge decays
   smoothly with latency; a stale-book artifact cliffs). An embargoed holdout
   window is enforced in the eligibility layer — do not touch holdout markets
   during development.
4. **Walk-forward promotion.** A variant becomes champion only if it stays
   positive on markets that started AFTER its code was frozen (~96 new BTC
   15m markets arrive per day). In-sample brilliance counts for nothing.
5. **Variants are forked, never edited.** Every experiment creates a new
   strategy file with a new id (`pair-*`); existing variant files are
   immutable history. Every experiment records its parent variant and the
   model that ran it.
6. **Write scopes.** Your private space is `agents/<you>/` (STATUS.md,
   INBOX.md, scratch). Everything else under `protocols/pair/` is shared
   team space. You never edit MISSION.md. Changes to `src/` (shared engine
   code) go through a normal PR — never direct to main.
7. **Sharing obligation.** Anything you learn or build that another agent
   could use goes in the shared space, including NEGATIVE results ("tried X,
   doesn't work, run id"). One home, one memory.
8. **Human interface.** Keep `agents/<you>/STATUS.md` current at every unit
   end (≤5 lines: alive-at timestamp, current work, champion id + eval run
   id, last lesson). Read and acknowledge `agents/<you>/INBOX.md` at every
   unit start. Stop gracefully when `agents/<you>/DONE` exists. Every N=10
   units, re-read this file and journal a short "still on course?" note.
9. **Execution safety.** `DRY_RUN` stays true until the human flips it — no
   exceptions, no "tests". Backtests are submitted to the worker fleet only;
   never run local backtest workers, live bots, recorders, relayer/on-chain
   commands, `db:push`, or fleet commands on this machine. Respect the
   per-agent daily backtest budget in this file's appendix.
10. **Git discipline.** Commit messages start `pair: [<model-version>] ...`.
    Stage explicit paths (never `git add .` from repo root). Save loop:
    commit → `git pull --rebase origin main` → `git push origin HEAD:main`;
    on a wedged rebase: abort, recover, re-apply — never force-push, never
    rewrite history.

## Success definition (proposed — human may adjust before ratifying)

- **Backtest-profitable**: champion has positive net PnL after fees on the
  standard eval, positive on ≥1,000 walk-forward markets (post-freeze), and
  survives the latency sweep at the measured-latency floor.
- **Probe-consistent**: the micro live probe's realized discount capture is
  within an honest band of backtest prediction on the same windows.
- **Live-profitable**: positive net PnL over a human-defined period at small
  real size, including gas and settlement costs.

## Appendix — operating limits (human-tunable)

- Per-agent backtest budget: ≤ 3,000 markets/day submitted to the fleet.
- Human runs always keep queue priority.
- Holdout embargo window: defined in the eligibility layer config (do not
  query or test against it).

## Where to start

Read `VISION.md` (design + current phase) and `DECISIONS.md` (settled
decisions — do not reopen them). Current phase is tracked at the top of
VISION.md. If you are the P1 expedition: explore the engine hands-on, write
`ENGINE.md` from scratch, build your first tools, and propose the team's
working conventions for the other agents to review.
