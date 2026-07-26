# Arena — vision (v2)

> Status: agreed direction. Next docs: STRATEGY.md (the concept, human-defined)
> and RULES.md (the invariants, formalized).

## Goal

Make **one strategy** profitable on **BTC 15m**, run it live, earn real money —
then keep improving it forever. Autonomous 24/7 operation; the human defines
the strategy concept and the invariants, gates every money step, and nothing
else.

## The strategy (fixed by the human)

Buy both sides — UP and DOWN shares — when the combined price is below $1,
then **merge** the pair back into $1. The edge is structural (execution /
microstructure), not predictive. Full definition lives in `STRATEGY.md`.

## Who works on it

| Role | Who | What they do |
|------|-----|--------------|
| Workers (agentic) | Phase 1: Fable 5 (Claude Code, $200 Max), 24/7. Phase 2: + GPT (Codex, $20). Later: more if they earn their place. | Build their own **variant** of the strategy, experiment, backtest, write findings. |
| Advisors (non-agentic) | Perplexity, Grok, … | Consulted by workers for ideas. A suggestion enters the commons as a normal `unverified` entry — never as truth. |
| Human | Ivan | Strategy concept, invariants, capital gates, champion approval. |

## How workers relate

**All knowledge is shared; only implementations compete.** Each worker owns a
private workspace and its own strategy variant. A neutral eval tool runs
variants on a fixed eval set and generates the leaderboard **from DB run ids**
— self-reported numbers don't exist. The top variant is the champion; only the
champion can be proposed for live, and only the human approves it.

## Commons (the shared lab)

```
commons/
  ENGINE.md          # what the engine can/can't do (curated, links to docs/)
  OPS.md             # fleet facts, launch commands, backtest speed
  knowledge/<id>.md  # one FILE per finding — concurrent-write safe
  bugs/<id>.md       # one file per bug
  tools/             # shared tools; anyone may add, nobody may break
```

Every knowledge/bug entry: **claim + exact repro (backtest command + run id) +
author model + status** (`unverified → confirmed-by-<other-model> → refuted`).
Two rules keep it trustworthy:

1. Decisions may build only on `confirmed` entries; `unverified` = a lead to
   re-verify first.
2. **Verification tax**: before adding a new entry, a shift must confirm or
   dispute one existing `unverified` entry. The backlog of unchecked claims
   shrinks as a side effect of normal work.

## Honesty invariants (draft — formalized in RULES.md)

For this strategy the classic parameter-overfit risk is low (structural edge).
The danger moves to **execution realism** — where a beautiful backtest lies:

- Mandatory latency simulation + conservative maker-fill model + fees, always.
- Fill-status semantics respected: merge only after `MINED`.
- An embargoed holdout window stays anyway (cheap insurance).
- Minimum sample sizes for any claim of improvement.
- DRY_RUN stays on until the human flips it. No exceptions.

## Operation

One 24/7 shift per worker: own worktree, commit → pull-rebase → push straight
to main, model stamped on every commit, heartbeat/status file so a dead shift
is visible at a glance. Stuck shifts downgrade to verifiers (replicate
findings, robustness-test the champion, clear the unverified backlog) — never
idle, never forced nonsense.

**Phases**: P0 — human strategy definition + RULES.md + commons seeded from
existing docs. P1 — Fable solo, 24/7, battle-tests the whole machinery.
P2 — + Codex worker; cross-verification becomes real. P3 — more workers only
if P2 shows they add value.

## End goal

Honest backtest profit → DRY_RUN live → small real size → scale. Champion
changes only via leaderboard + human approval.
