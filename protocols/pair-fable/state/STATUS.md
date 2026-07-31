# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 24 close)

## Current work

**Session 24: E-038 read and CLOSED (TILT-LIVE); E-039 (v16.1
acquisition-price ceiling + leader persistence) designed→frozen
(0eb909f)→implemented→smoked→submitted (9f3e9cd).**

E-038 verdict (runs 978–983, full table pair-v16.md §6): TILT-LIVE —
per-$100 monotone in +τ (+0.83/+1.71/+2.19 at τ 40/80/160 vs bridge
c0=978), anti-leader control c4 collapses (sign confirmed), gap 0.20
worse. Bridge PASS (Δp/100 0.21; ev Δ −0.53 = jitter caveat, noted).
HONEST DECOMPOSITION: absolute ev FLAT across +τ — tilt is acquired
~entirely via D-mode FOK at ask ≈ 0.90+ (fair-priced for its 88–95%
win-side accuracy); per-$100 gain partly invested-denominator
dilution. Median market at τ160 is POSITIVE (+2.79 p/100); tail =
leader-flip chasing.

**IN FLIGHT (next session reads AFTER the s25 audit; do NOT
resubmit):** d0=987 and d1=986 are COMPLETED and read (bridge PASS;
d1 CEIL-LIVE ev +1.91 vs d0, anatomy: residue value unchanged,
D-spend −$13.5k). Still running at close: d2/d3/d4/d5. E-039, 6 runs, batchUids `pf-e039-d0..d5-20260731T185*`,
pinned 800 @ 140/20, SHA 9f3e9cd. Queue verified 6 aggregate +
4,800 market jobs, 0 failed at submit. Cells (center = c3: τ+160
gap.10 q100 I160 B500 P*.96 doom.99 cool5 ttl90):

| # | tiltUnitMax | leadPersistTicks | vs |
|---|---|---|---|
| d0 | 1.00 | 0 | run 981 (v16.1 code bridge) |
| d1 | 0.90 | 0 | d0 |
| d2 | 0.80 | 0 | d0 |
| d3 | 0.70 | 0 | d0 |
| d4 | 1.00 | 20 | d0 |
| d5 | 0.80 | 20 | d2/d4 |

Readout: run ids via `tsx protocols/pair-fable/tools/results.ts
--batch-uid <uid>` (or --last 6); compare.ts (d0 baseline first, then
981); anatomy.ts per run (D-fill $ + residue win-side). Frozen bars
pair-v16.md §7: **ev GOVERNS E-039 (bar 0.30)** — metric amendment
recorded pre-submission (per-$100 has denominator artifacts both
ways); BRIDGE-STOP |d0−981| p/100 > 0.54; CEIL-LIVE / CEIL-DEAD /
CEIL-HARMFUL per §7.

## Next step (priority order)

1. **Read E-039** (above), close in pair-v16.md §8 + LEDGER +
   JOURNAL. CEIL-LIVE ⇒ iterate winner (finer ceiling, persistence
   dose, maker-tilt gating). CEIL-DEAD/HARMFUL ⇒ signal (b)
   spot-vs-priceToBeat tilt (ExternalFeeds plumbing exists) or
   maker-only tilt.
2. **P-013 (needs human):** sell-side mirror scope ruling (PROPOSALS).
3. **Cross-symbol replication:** gated on P-012.
4. Unexplored v15 lever: price gate P* itself (corner evidence
   952/958 points LOWER); competes with, does not block, directional.

## Alignment gate — session 24

- **Classification:** directional-controller (E-038 readout + E-039
  iteration of the same directional controller).
- **Direct mission contribution:** E-038 CLOSED — TILT-LIVE (runs
  978–983; per-$100 monotone +0.83/+1.71/+2.19 in +τ, anti-leader
  control collapses; ev-flat decomposition names the acquisition
  price as the binding cost). E-039 designed/frozen (0eb909f),
  implemented v16.1 (9f3e9cd), smoked, 6-cell grid submitted; d0
  bridge PASS (Δp/100 0.05, Δev −0.20), d1 (ceiling 0.90) CEIL-LIVE
  with ev +1.91 vs d0 — the largest single-lever ev gain on record
  (residue value unchanged, expensive >0.90 chases removed).
- **Time to evidence:** ~1 min (first E-038 results read immediately
  at session start). Target MET.
- **Throughput:** 1 experiment closed (6×800 runs read + anatomy +
  compare), 1 experiment launched (6×800 = 4,800 market jobs, whole
  grid up front, queue verified, 0 failures), 2 local smokes. No
  serial local scans.
- **Scale progress:** closed by E-036 on record; this grid runs the
  mechanism question at $500.
- **Next-session priority:** session 25 runs the every-fifth-session
  audit (s20–s24) FIRST, then reads E-039 d2–d5 (batchUids above,
  readout commands + frozen §7 bars in Current work) — GREEN either
  way.
- **Verdict:** **GREEN.**
- Verdict history: s22 GREEN, s23 GREEN, s24 GREEN. Next audit:
  session 25 (due).

## Blockers

None. E-039 grid in flight (see Current work; do NOT resubmit).

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
  commits (s13–s24: only protocol commits moved HEAD).
- Queue submissions require a CLEAN tree pushed to origin/main (push
  via `git push origin HEAD:main`); commit state snapshots before
  submitting.
- **zsh does NOT word-split unquoted variables** — submit grids as
  one LITERAL command per config (inbox c841c329); always keep stderr.
- Verify with fleet.ts after every detached batch; count aggregate
  jobs (waiting-children) or DB rows, not market-job totals.
- Do not push strategy-semantics changes while that strategy's jobs
  are queued/running — workers track origin/main; serialize push →
  submit. (E-039 jobs run on 9f3e9cd: do not touch pair.v16.ts while
  the grid is queued.)
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes). FULL reference v1-b: run 914.
  v15 bridge chain 970 ≡ 960 ≡ 956. v16 bridge: c0 = run 978 (≡ 970,
  p/100 bar; ev jitter caveat §6). **v15 noise floor 0.15 ⇒ ev bar
  0.30, per-$100 bar 0.54** (937v938). E-039 governs on ev (§7).
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
  2026-07-31 s22: only pair-fable has memory (s23/s24: unchanged).
- Smoke cannot catch latency-race bugs AND cannot demonstrate RARE
  fill modes (escalate to a 200-mkt Stage B instead).
- Schema refines AND engine constraints (OrderManager validation) can
  invalidate a frozen grid corner — check every cell when freezing
  (GTD expiry < now+60s rejected; ttlSec ≥ 61).
- A completed run with 0 trades and noActivity=N can mean every order
  was REJECTED — check OrderManager validation before blaming data.
- The backtest sim is NOT bit-deterministic (latency jitter) — noise
  floors come from duplicate pairs.

## Inbox processed through

2026-07-31T16:46:43.750Z-82e89da5 (no newer entries at s24 start).
