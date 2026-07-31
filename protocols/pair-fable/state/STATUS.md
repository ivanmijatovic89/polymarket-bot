# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 25)

## Current work

**Session 25: five-session audit (s20–s24) PASS; E-039 read and
CLOSED (CEIL-LIVE); E-040 (fine ceiling + real-dose persistence)
frozen (d6470a5) → v16.2 implemented (63fec11) → smoked (run 992) →
6-cell grid submitted and queue-verified.**

E-039 verdict (runs 986–991, full table pair-v16.md §8): CEIL-LIVE —
every cell beats d0 (987) by > 0.30 ev. **Winner d1 = ceiling 0.90
(run 986): +1.91 ev, p/100 −3.16 (family best on record), win% 60.8
kept, median +3.85.** Dose saturates below 0.90 (+0.25/+0.05 steps,
< bar) — removal-side confirmation of E-038's decomposition: only
the >0.90 chases were toxic; 0.80–0.90 D completions ~fair-priced.
Flicker persistence alone +1.37 (990); interaction at tight ceiling
NEGATIVE (991). Best absolute state: ev −10.83 @ B=500 — still far
from the ≥ +2 bar; lever ladder continues.

**IN FLIGHT (next session reads FIRST; do NOT resubmit):** E-040,
6 runs, pinned 800 @ 140/20, SHA 63fec11 (v16.2: leadPersistTicks
schema max 200→20000, schema-only). Queue verified: 6 aggregate
jobs, 4,800 market jobs, 0 failed at submit, 31/31 workers on
63fec11. Cells (center = d1: τ+160 gap.10 q100 I160 B500 P*.96
doom.99 cool5 ttl90):

| # | tiltUnitMax | persist | batchUid | vs |
|---|---|---|---|---|
| e0 | 0.90 | 0 | pf-e040-e0-20260731T2001* (exact uid lost to output truncation; recover via `results.ts --last 8`; presence verified — 6 aggregates in queue) | run 986 (bridge) |
| e1 | 0.95 | 0 | pf-e040-e1-20260731T200143-bzdc0k | e0, 987 |
| e2 | 0.85 | 0 | pf-e040-e2-20260731T200200-2kgqmz | e0 |
| e3 | 0.90 | 20 | pf-e040-e3-20260731T200218-cj6h4g | e0, 990 |
| e4 | 0.90 | 1400 | pf-e040-e4-20260731T200234-334dtv | e0, e3 |
| e5 | 1.00 | 1400 | pf-e040-e5-20260731T200306-gn57tn | 990, 987 |

Readout: `tsx protocols/pair-fable/tools/results.ts --last 8` then
`compare.ts --runs <e0>,<e1..e5>` (e0 baseline) + cross-SHA
`compare.ts --runs 986,<e0>` for the bridge; anatomy.ts per run
(D-fill $ + resid mkts + residue win-side). Frozen bars pair-v16.md
§9 (ev governs, bar 0.30): BRIDGE-STOP |e0−986| p/100 > 0.54;
CEIL-FINE-MOVE / PERSIST-LIVE / PERSIST-DEAD / PERSIST-HARMFUL per
§9. Decision mapping: any LIVE ⇒ iterate winner; all dead ⇒ design
signal (b) spot-vs-priceToBeat tilt.

## Five-session audit (s20–s24) — performed s25, verdict PASS

- **Gates** (verified from committed STATUS history, commits
  ff360c7/8c087f7/342ab49/f64a612/251a35e): s20 YELLOW (E-034 +
  E-035 diagnostics, TtE ~5 min), s21 GREEN (E-036 binding scale
  check, ~3 min), s22 GREEN (E-037 cadence, ~8 min), s23 GREEN
  (E-038 build+submit, ~11 min — the only TtE miss, reason recorded:
  new strategy code first), s24 GREEN (E-038 close + E-039 submit,
  ~1 min). **4 GREEN / 1 YELLOW / 0 RED**; no consecutive YELLOW;
  gate present every session.
- **Throughput:** 23 fleet runs ≈ 18,400 market-jobs (E-036 5×800 +
  smoke, E-037 6×800 + 5 smokes, E-038 6×800 + 2 smokes, E-039
  6×800 + 2 smokes) plus 2 full-scale local scans (E-034 800-mkt
  reanalysis; E-035 9,947 mkts, 6-shard parallel). Whole-grid-up-
  front respected on every 3+ grid.
- **Open primary requirements:** $2,000 + 500–1,000 matched-share
  check CLOSED correctly in s21 (E-036: range reached, mechanical
  evidence attached, guard-7 caveat carried — both mission §4.2
  prongs). Directional controller ACTIVE and leading (correct per
  §3: neutral axes closed E-030→E-037, each close names pairs +
  scope). Profit target far (best ev −10.83 @ B500, per-$100 −3.16).
  No premature closures found.
- **M1–M5 promotion machinery: NOT implemented yet.** Not yet
  binding (nothing near promotion — all variants negative), but it
  gates the FIRST promotion/LIVE-CANDIDATE. Scheduled: implement in
  the first session with fleet wait time, target ≤ s29.
- **Next-five plan (s25–s29):** s25 E-040 grid (GREEN, done);
  s26 read E-040, iterate winner or design signal (b) (GREEN);
  s27 signal (b) spot-vs-priceToBeat tilt or winning-lever dose
  (GREEN); s28–s29 continue directional + M1–M5 implementation.
  ≥3 GREEN controller increments; ≤1 diagnostic slot reserved,
  none planned.

## Next step (priority order)

1. **Read E-040** (table above), close in pair-v16.md §10 + LEDGER +
   JOURNAL. Any LIVE ⇒ iterate the winning lever (finer dose,
   persistence×ceiling cross). All dead ⇒ design signal (b)
   spot-vs-priceToBeat tilt (ExternalFeeds plumbing exists) or
   maker-only tilt.
2. **M1–M5 implementation** (audit item): use fleet wait time,
   target ≤ s29.
3. **P-013 (needs human):** sell-side mirror scope ruling (PROPOSALS).
4. **Cross-symbol replication:** gated on P-012.
5. Unexplored v15 lever: price gate P* itself (corner evidence
   952/958 points LOWER); competes with, does not block, directional.

## Alignment gate — session 25

- **Classification:** directional-controller (E-039 readout + E-040
  iteration of the same directional controller) + the mandated
  every-fifth-session audit.
- **Direct mission contribution:** E-039 CLOSED CEIL-LIVE (runs
  986–991): acquisition-price ceiling 0.90 is the largest single-
  lever ev gain on record (+1.91, family-best p/100 −3.16), dose
  saturation mapped, persistence interaction mapped. E-040 frozen
  (d6470a5), v16.2 implemented (63fec11), smoked (992), 6×800 grid
  submitted + queue-verified. Audit s20–s24 PASS (4G/1Y/0R).
- **Time to evidence:** ~1 min (E-039 d2–d5 + d4 results read as the
  first action). Target MET.
- **Throughput:** 1 experiment closed (6×800 read + compare + 5
  anatomies), 1 audit, 1 experiment launched (6×800 = 4,800 jobs,
  whole grid up front, verified, 0 failures), 1 smoke. No serial
  scans.
- **Scale:** closed by E-036 on record; grid runs the mechanism
  question at $500.
- **Next-session priority:** read E-040 (bars §9) — GREEN either way.
- **Verdict:** **GREEN.**
- Verdict history: s23 GREEN, s24 GREEN, s25 GREEN (audit session).
  Next audit: session 30.

## Blockers

None. E-040 grid in flight (see Current work; do NOT resubmit).

## Needs human

- **P-013**: sell-side mirror program scope ruling (see PROPOSALS).
- **P-012**: convert eth/sol/xrp 15m telonex datasets — gates
  cross-symbol replication. Not blocking.
- Carried: P-002/P-003/P-005/P-006/P-007/P-009/P-010 (all `proposed`).
  P-009/P-010 (fill-model realism / live probe) remain the binding
  caveat on every scale number (guard-7).

## Standing session guards

- Never end a session waiting on ANY in-flight work — record how to
  resume in STATUS, return `continue` (inbox dad421a6).
- Write .global-runtime/session-result.json BEFORE the final message,
  every session, no exceptions.
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine
  commits (s13–s25: only protocol commits moved HEAD).
- Queue submissions require a CLEAN tree pushed to origin/main (push
  via `git push origin HEAD:main`); commit state snapshots before
  submitting.
- **zsh does NOT word-split unquoted variables** — submit grids as
  one LITERAL command per config (inbox c841c329); always keep stderr.
  run-backtest.ts: `--latest` is a BOOL; market count goes in
  `--limit N` (s25: `--latest 800` is an unknown-flag hard error).
- Verify with fleet.ts after every detached batch; count aggregate
  jobs (waiting-children) or DB rows, not market-job totals. Capture
  the batchUid line from EVERY submit (s25: e0's uid lost to output
  truncation — recoverable, but sloppy).
- Do not push strategy-semantics changes while that strategy's jobs
  are queued/running — workers track origin/main; serialize push →
  submit. (E-040 jobs run on 63fec11: do not touch pair.v16.ts while
  the grid is queued.)
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes). FULL reference v1-b: run 914.
  v15 bridge chain 970 ≡ 960 ≡ 956. v16 bridges: c0 = run 978
  (≡ 970), d0 = run 987 (≡ 981, Δp/100 0.05). **v15 noise floor 0.15
  ⇒ ev bar 0.30, per-$100 bar 0.54** (937v938). E-039/E-040 govern
  on ev (§7 metric amendment).
- JOURNAL entries are for the HUMAN: plain language, 3–6 short lines,
  ≤ 1 evidence pointer per conclusion (inbox 330fa938, permanent).
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329), verify queue depth after.
- Class kills need an identity argument (evaluator.md §Kill
  standards); N failures kill a family only. Verdict bars must name
  comparison PAIRS. Positive signals measured ON discovery data need
  disjoint confirmation before any build decision (E-028 → E-035).
- Fill model: calibrated by E-025 (ToB capacity bound). Guard-7
  whole-size fill optimism: larger-q results depth-optimistic (E-036).
- Sibling-memory recheck at session start (`ls protocols/*/memory`) —
  2026-07-31 s25: only pair-fable has memory (unchanged).
- Smoke cannot catch latency-race bugs AND cannot demonstrate RARE
  fill modes (escalate to a 200-mkt Stage B instead).
- Schema refines AND engine constraints (OrderManager validation) can
  invalidate a frozen grid corner — check every cell when freezing
  (GTD expiry < now+60s rejected; ttlSec ≥ 61).
- A completed run with 0 trades and noActivity=N can mean every order
  was REJECTED — check OrderManager validation before blaming data.
- The backtest sim is NOT bit-deterministic (latency jitter) — noise
  floors come from duplicate pairs.
- leadPersistTicks is in TICKS (~138/s on active markets) —
  wall-clock varies with activity; 1400 ≈ 10 s at measured rate.

## Inbox processed through

2026-07-31T16:46:43.750Z-82e89da5 (no newer entries at s25 start).
