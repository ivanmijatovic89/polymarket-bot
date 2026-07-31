# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 3, mid-session)

## Current work

Session 3 (evidence = this session's tool runs):

1. **pair-v3 (contested-start) KILLED at Phase 0** — before any strategy
   code. New tool `tools/contested.ts` (aggTrades spot + priceToBeat per
   start fill, pre-registered verdicts in pair-v3.md): doom rate flat
   ~17–35% across the whole dist/drift feature range on 872 AND 873,
   last-start-only view included; market-level correlation INVERTED
   (contested quartile 61% doom vs 38% decided). Doom is unpredictable
   from start-time market state. LEDGER E-012.
2. **Cadence model (pair-v1.md §Cadence model)**: exact family algebra
   pnl/played = inc·[g_sh(S−q) − avgE·q]. incrementSize cancels (idea
   killed by arithmetic, 0 runs). Break-even S* = q(1+avgE/g_sh): 8.2 /
   4.1 / 2.88 at gates 0.98/0.95/0.93 vs actual S 2.42/1.88/1.64 — tight
   gate needs only ~1.8× cadence. Gate×cadence untested → pre-registered
   v1-e/f/g (ttlSec=61, cooldownTicks=5, gates 0.98/0.95/0.93), decisive
   between q-terminal (advance) and per-start-hazard (mechanism dead at
   any tuning) worlds.
3. In flight now: design-ts commit + smoke + fleet launch of v1-e/f/g
   screens (`--latest --limit 800` @ 140/20). Run ids recorded below once
   submitted.

## Next step

1. If screens finished in-session: evaluate v1-e/f/g vs same-gate parents
   (872/873/879) via compare.ts intersection + anatomy.ts (S, q, g_sh per
   run); apply the pre-registered ADVANCE/KILL rules in pair-v1.md
   §Cadence extension. Else: next session starts there.
2. If ADVANCE (q-terminal world): design v4 = requote-on-book-move /
   both-sides start quoting to push S past S* at gate ~0.93; new code ⇒
   full pre-register + freeze + smoke.
3. If KILL (per-start-hazard world): one-order-at-a-time pair mechanism is
   unprofitable at any cadence/gate — invoke guard 4 (different idea axis
   or family kill); candidate axes list to be drawn from anatomy evidence,
   NOT more v1 params.
4. M1–M5 review-gate items remain binding before any first promotion /
   LIVE-CANDIDATE (none is near yet — best ev still < 0).

## Blockers

None. Fleet healthy at session start; 875–879 evaluated.

## Needs human

Nothing new. Carried (non-blocking): P-002/P-003/P-005/P-006/P-007
`proposed` — engine-side, human's call.

## Standing session guards

- Never end a session waiting on an in-flight fleet run — record ids here,
  return `continue` (A4/A6).
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine commits.
- Queue submissions require a CLEAN tree: commit+push state/memory BEFORE
  launching.
- m7 remainder pending: pnl decomposition column on next results.ts touch.
- Self-check session: session 5 (every fifth).

## Inbox processed through

2026-07-30T23:20:47.483Z-0e6fde8b (no new entries this session).
