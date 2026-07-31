# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 9)

## Current work

E-019 (pair-v9 ceiling grid, runs 889–895) read and recorded: KILL at
every X, but scope split by the pre-registered capture-multiple statistic
— kill extends to persistent-rest only for X ≥ 0.20; X=0.15 (ev −0.03,
inside noise, capture× 1.06) leaves low-X and duty-cycle open. Details
pair-v9.md §Result, LEDGER E-019.

**In flight: two fleet grids** (submitted detached 2026-07-31 ~08:43Z,
pinned 800-market window --from-ms 1784043000000 --to-ms 1784762100000,
140/20 ms, code 2538404, design-ts 3767786):

E-020 — pair-v10 (v1 + taker-completion module; pair-v10.md), label pf10:

- control C=0 D=0 → pf10-20260731T084328-omki44 (regression gate vs 872!)
- C=0.90 → pf10-20260731T084355-y7mmio
- C=0.95 → pf10-20260731T084403-63t8rn
- C=0.99 → pf10-20260731T084412-s21kwo
- D=0.05 → pf10-20260731T084422-pt32wp
- D=0.10 → pf10-20260731T084429-mlc18h
- C=0.95 D=0.10 → pf10-20260731T084437-iutx50

E-021 — pair-v9 low-X + duty-cycle (pair-v9.md §E-021), label pf9x:

- X=0.08 → pf9x-20260731T084444-m62nua
- X=0.10 → pf9x-20260731T084451-pshy5i
- X=0.12 → pf9x-20260731T084458-k2ypxv
- X=0.12 cooldown=0 → pf9x-20260731T084508-81b065
- X=0.15 cooldown=0 → pf9x-20260731T084524-92n2kk

**To resume**: recover run ids via `tools/sql.ts` (`batch_uid LIKE
'pf10-20260731%'` / `'pf9x-20260731%'`), then results.ts / anatomy.ts /
compare.ts per the pre-registered readouts. Verdict bars frozen in
pair-v10.md §Pre-registered verdicts and pair-v9.md §E-021. Record
E-020/E-021 in LEDGER + family files + JOURNAL.

Already read in session 9 (do not redo): **E-020 regression gate PASS**
(run 897 control vs 872: Δev +0.024 ≤ 0.05, played 704 vs 705 — grid
interpretable). Partial: run 898 (C=0.90) ev −1.49 ≈ control, but the
module fired only ~3× in 800 mkts ('unknown' fills in anatomy = FOK
completions) ⇒ per confounder (a) that config is TRIGGER-UNTESTED, not
killed — read C=0.95/0.99 and the D configs for the real test, and count
their 'unknown'-mode fills (anatomy.ts labels FOK 'C'-meta fills as
unknown; treat unknown-count as completion-count proxy).

## Next step

Read both grids, apply frozen verdicts. Then per verdicts: promote /
iterate / close axes. Remaining ruling axes not yet designed: size
laddering (axis 4), time-varying policy (axis 5), liquidity-structure
market selection (axis 6). Session 10 is a 5th-session self-check
(mission §Self-check).

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
  (this session: no engine changes; only protocol commits moved HEAD).
- Queue submissions require a CLEAN tree: commit+push BEFORE launching.
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes).
- JOURNAL entries are for the HUMAN: plain language, 3–6 short lines, at
  most one evidence pointer per conclusion (inbox 330fa938, permanent).
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front,
  analyze as results land (inbox c841c329).
- Class kills need an identity argument (evaluator.md §Kill standards,
  binding per inbox 8758567d); N failures kill a family only. Same bar
  for "exhausted" / "frontier empty".
- Sibling-memory recheck is cheap (`ls protocols/*/memory`): do it at
  session start once the Codex loop launches (memory/siblings.md).
- zsh does not word-split unquoted vars: use `setopt shwordsplit` (or
  spell args out) when scripting multi-flag submissions — session 9 lost
  a submission round to this.

## Inbox processed through

2026-07-31T08:15:02.759Z-8758567d (no new entries in session 9).
