# CONFIRM-010 — pre-registered confirmation test for IDEAS #10 (the E22 up-dn reversal mirror)

**Status: FROZEN, PARKED — may not run until the mechanical unlock below.**
Registered session 54 (2026-07-11), DECISIONS D41. This spec is frozen at a
uniquely clean moment: the fresh-window data it will be judged on does not
exist locally and CANNOT currently be obtained — the vendor download quota
is exhausted (U66, DATASET-GROWTH.md §quota). Every design choice below
therefore provably predates any access to the test data. No amendment after
ingestion begins may change a bar, the cell, the window rule, or the
decision rule; the only permitted post-freeze changes are pre-run-audit
corrections of mechanical errors, recorded as amendments (CAL-003
precedent: audits may tighten/abort, never loosen).

## What is being tested

IDEAS #10 (protocol/IDEAS.md §10): after a big up-segment reverses into a
big down-segment late in the window (triple 450-600-750s, shape up-dn),
buying DOWN at its ask at the 750s sample nets > 0 after fees. Source: the
CAL-003 discovery table's largest positive, net +2.38c at z = +2.40 —
hypothesis-generating only (below the discovery bar; max of 40 cells, so
winner's-curse-biased upward). This test is the "reserve-window evidence
under full pre-registration" escape in EDGE-SPACE §4, executed on
independent data.

## Mechanical unlock (all required before any run; items 1 and the drift
## half of 2 are from the U45-audited IDEAS #10 entry — items 2's
## every-new-month obligation, 3, and 4 are ADDED at this freeze, D41;
## all additions tighten)

1. **Data**: eligible universe (tools/universe.ts) contains ≥ 9,540
   markets with `market_start_ms ≥ 1781430300000` (2026-06-14T09:45:00Z,
   the first slot after the frozen universe's last market). Combined with
   the 5,460-market probe reserve → ≥ 15,000.
2. **Regime**: the VENUE-DRIFT refresh has been run on every new month in
   the fresh window and NO band fired under D27 confirmation semantics.
   A confirmed fire VOIDS this spec (re-derive from the new regime; record
   in an amendment — that is an abort, not a loosening).
3. **Code identity**: `tools/calib3.ts`,
   `strategies/_fixtures/diag-calib.ts`, AND `tools/calib-integrity.sh`
   are byte-unchanged since this spec's registration commit
   (`git log -- <file>` empty after it). Any change → fresh-context
   re-audit of the changed tool against this spec before running.
4. **Pre-run audit**: a fresh-context verifier checks 1-3 and this spec's
   internal consistency. It may correct mechanical errors (recorded
   amendments) or abort; it may not loosen anything.

## Frozen sample (deterministic once ingested)

- **Reserve half**: all eligible markets with
  `market_start_ms ∈ [1772323200000, 1777237199999]`
  (2026-03-01T00:00:00Z → boundary−1; the CAL-001 probe reserve, 5,460
  markets, untouched by any read). Run A's replayed-market count MUST
  equal 5,460 — any other count means the reserve window's eligible set
  changed since CAL-001 registration (e.g. a backfill conversion) and is
  a pre-run-audit investigation, not a shrug.
- **Fresh half**: the FIRST 9,540 eligible markets with
  `market_start_ms ≥ 1781430300000`, ascending by `market_start_ms`
  (ties impossible; slugs are 15m-grid unique). Markets beyond the first
  9,540 belong to no window (spare). If ingestion produces fewer than
  9,540, the unlock is not met — do not run a smaller test.
- Combined N = 15,000 markets. The **holdout
  [1777237200000, 1781429400000] stays locked** — both halves exclude it
  by construction (reserve ends at boundary−1; fresh half starts after
  the holdout's last market).
- Expected cell yield (cited from the U45-audited IDEAS #10 arithmetic,
  scan-se convention — the convention this test's statistic uses):
  n ≈ 1,730 entries, se ≈ 0.94c, ~55% power at true net +2c at
  α = 0.023. A null here is a pre-agreed kill of the lead, disclosed as
  carrying ~45% false-kill risk at true +2c.

## Frozen instrument and procedure

1. Two detached LOCAL `--sequential` runs of the outcome-free
   `fable-diag-calib` fixture (CAL-001 discovery precedent; the calib
   pipeline reads `[diag-calib]` lines from the local run log — fleet
   workers write logs remotely, so fleet is NOT usable here):
   - run A: `--from-ms 1772323200000 --to-ms 1777237199999` (reserve),
   - run B: `--from-ms 1781430300000 --to-ms <start_ms of fresh market
     #9,540>` (computed from the DB at run time; record it in the run
     note),
   batchUids `CONFIRM-010-reserve` / `CONFIRM-010-fresh`, D8 latency
   pins, committed code. Wall estimate ≈ 15,000 × 1.23 s ≈ 5.1 h total.
2. D23 integrity battery on each log (same checks and abort semantics as
   CAL-001; malformed/dup/one-sided/ts violations → investigate before
   any read). Known discovery-specific residue in `calib-integrity.sh`
   (print-only, does NOT abort): its EPOCH section advises
   `max < 1772323200` and its trailer expects `8516/8516` — both are
   CAL-001-discovery framing and WILL differ here by construction. The
   expected epoch ranges for THIS spec are: run A epochs ∈
   [1772323200, 1777237199], run B epochs ∈ [1781430300, run-B cap];
   line counts scale with each run's market count. Do not edit the
   script to "fix" this (it is on the byte-identity list); read its
   output against these frozen expectations.
3. Concatenate the two logs (`cat A B > combined.log`; windows are
   disjoint so per-slug first-occurrence dedupe cannot cross-contaminate)
   and perform the ONE-SHOT read:
   `npx tsx fable-lab/tools/calib3.ts combined.log --expect-totals
   <lines>,<perSide>` with totals taken from the two runs' own battery
   outputs (CAL-002 amendment #1 semantics). Reserve-mode gates are
   binding: join-direction n ≥ 30 ∧ winRate > 0.9; E14-analog |z| < 3.26;
   empty control on a real log → ABORT.
4. Post-run: `tools/holdout-lock-audit.ts` sweep; new rows classified
   (the two runs must add none — both windows avoid the holdout).

## Frozen decision rule (single pre-named cell)

The DECISION cell is exactly **DOWN (450-600-750, up-dn)** as printed by
calib3.ts. The tool prints all 40 cells and flags CANDIDATE(reserve) at
z ≥ 3.26 — **that flag is NOT this test's bar**. The bar here, per the
IDEAS #10 pre-registered convention:

- **CONFIRM** iff `net > 0` AND `z ≥ 2.00` (one-sided α ≈ 0.023, scan-se
  z = d/se as the tool prints it) AND minority-outcome count ≥ 30 (D13).
- **KILL the lead** otherwise (including gate aborts resolved as data
  problems ruled out — a clean read below the bar is a kill, not a park;
  this is the pre-agreed spend of IDEAS #10's unlock).
- No other cell in the printout has any status. The full table is
  recorded verbatim in Results (transparency), but citing any non-decision
  cell for anything is mining; a future hypothesis from it would need its
  own fresh-data confirmation.

## What CONFIRM licenses (and does not)

- CONFIRM ⇒ IDEAS #10 becomes a citable ≥1.5c-gross, net-positive taker
  argument under EDGE-SPACE §4 — the first surviving edge candidate. Next
  step is a normal LIFECYCLE registration (strategy `fable-exp-010`
  implementing the trigger with live-parity tick semantics: sample UP mid
  at first valid tick ≥ 450/600/750 s with the drift filter, buy DOWN at
  ask on shape up-dn), judged by its own spec. Selection lineage
  disclosed there: cell chosen as max of 40 (CAL-003) refining CAL-002
  structure; the confirmation data is independent, which is the point.
- CONFIRM is NOT a live-EV claim: taker fills at the recorded ask are the
  engine's realistic-leaning case (CAPABILITIES §4), but spread/latency
  at live time must be re-argued in the EXP spec.
- KILL ⇒ IDEAS #10 → dead; the E22 open point in EDGE-SPACE §4 closes;
  the reserve's confirmation role is spent either way (record that).

## Runs (append-only)

_(none — parked)_

## Results / Verdict (append-only; one-shot)

_(none — parked)_

## Post-freeze addendum — TIGHTEN-ONLY (U72, 2026-07-11; audit-sourced)

_Appended under the D41 pre-run-audit rule (tighten/abort only). Source:
the first fresh-context audit of the frozen integrity script,
`knowledge/AUDIT-2026-07-11-CALIB-SHELL-SCRIPTS.md`. The three frozen
files are untouched; these obligations bind the UNLOCK EXECUTOR when
reading the battery output (spec §Frozen instrument item 2), because the
audit demonstrated the script's exit code covers only the latency and
errors checks — a corrupted log exits 0. Nothing here relaxes any frozen
expectation._

At each battery run (both logs), the executor MUST mechanically verify,
in addition to the frozen expectations already pinned above:

1. **Every counter line compared, not the exit code** (audit MAJOR-1):
   malformed / gaps / dupfiles / epoch mismatches / badoff / tsbounds /
   crossed / duptuples / over14 / oneSided / tsmono all read from the
   printout and required to be 0; mirror deviants read and disclosed.
   Exit 0 certifies nothing beyond latency+errors.
2. **Independent line-count cross-check** (MAJOR-2): `grep -c
   'diag-calib' <log>` (UNANCHORED) must equal the battery's
   `SAMPLES lines=` value; a difference means prefix-mangled sample
   lines invisible to the anchored battery regex — investigate before
   any read.
3. **Balance identity** (MINOR-3): `lines == UP + DOWN` by hand; a
   shortfall means non-UP/DOWN asset values silently absorbed into the
   mirror map.
4. **Zero-lines abort** (MINOR-4): `SAMPLES lines=0` on either log is an
   automatic abort regardless of exit code.
5. **grep-family sanity probe** (MINOR-7): before trusting the errors
   line, verify `echo failed | grep -ci 'error\|failed'` prints 1 on the
   host (the frozen script uses non-POSIX BRE alternation).
