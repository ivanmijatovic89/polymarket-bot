# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 8, in progress)

## Current work

Human ruling processed (inbox 8758567d): the class-level kill is WITHDRAWN
(family kills stand; the −0.06 invariant bounds unpaired shares only; L_s
was never attacked). Recorded in pair-v4.md/pair-v8.md §Withdrawn, LEDGER
E-018b, evaluator.md §Kill standards (binding: class kills need an
identity argument; N failures kill a family only), INDEX digest. Research
resumed on the ruling's six axes.

**In flight: pair-v9 (E-019) 7-config fleet grid**, absolute entry-price
ceiling X ∈ {0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45}, submitted
detached 2026-07-31 ~08:24Z on the pinned 800-market screen window
(--from-ms 1784043000000 --to-ms 1784762100000, = runs 872/873/879
universe), 140/20 ms. Pre-registration: pair-v9.md (design-ts 47fd391,
code 21b5aaf, smoke PASS run 888). Batch uids (X → uid):

- 0.15 → pf9-20260731T082326-1mmrh0
- 0.20 → pf9-20260731T082333-16nzt1
- 0.25 → pf9-20260731T082339-jr0oth
- 0.30 → pf9-20260731T082346-rdqvzr
- 0.35 → pf9-20260731T082353-kfmk0j
- 0.40 → pf9-20260731T082404-p8ha4j
- 0.45 → pf9-20260731T082413-3kgi2o

**To resume if this session dies**: recover run ids via
`tools/sql.ts` (`SELECT id, batch_uid, status FROM backtest_runs WHERE
batch_uid LIKE 'pf9-20260731%'`), then results.ts / compare.ts (vs 872 and
879) / anatomy.ts per pair-v9.md §Readouts, verdict per pair-v9.md
§Pre-registered verdicts, record E-019 in LEDGER + family file.

## Next step

Read the pf9 grid results, apply the pre-registered verdict bars, record
E-019. Then per the ruling's priority: design axes 2+3 (opportunistic
cheap-side completion decoupled from the entry gate; above-$1
loss-mitigating completion — shared machinery), pre-register, sweep.

## Blockers

None. P-009/P-010 remain open per the ruling but are NOT blockers.

## Needs human

- Carried: P-002/P-003/P-005/P-006/P-007/P-009/P-010 (all `proposed`;
  P-010's "frontier empty" premise withdrawn per ruling — see addendum).

## Standing session guards

- Never end a session waiting on ANY in-flight work (fleet, local scan,
  background task, monitor) — record how to resume in STATUS, return
  `continue` (inbox dad421a6, generalizes A4/A6). Long local jobs: use
  bookscan-style `--checkpoint`/`--time-budget-s` foreground chunking.
- Write .global-runtime/session-result.json BEFORE the final message,
  every session, no exceptions.
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine commits
  (this session: origin/main == local HEAD at session start, no drift).
- Queue submissions require a CLEAN tree: commit+push BEFORE launching.
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes).
- JOURNAL entries are for the HUMAN: plain language, 3–6 short lines, at
  most one evidence pointer per conclusion (inbox 330fa938, permanent).
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front,
  analyze as results land (inbox c841c329).
- Class kills need an identity argument (evaluator.md §Kill standards,
  binding per inbox 8758567d); N failures kill a family only. Same bar for
  "exhausted" / "frontier empty".
- Sibling-memory recheck is cheap (`ls protocols/*/memory`): do it at
  session start once the Codex loop launches (memory/siblings.md).

## Inbox processed through

2026-07-31T08:15:02.759Z-8758567d (the class-kill withdrawal ruling —
processed this session).
