# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 23 close)

## Current work

**Session 23 opened priority 2: E-038, the DIRECTIONAL controller
(pair-fable-v16) — designed→frozen→implemented→smoked→submitted; the
6-cell grid is IN FLIGHT at session close.** Design freeze b96fa50
BEFORE code ceae123 (M2). v16 = v15.4 with a signed inventory target:
leader = side whose bestBid leads by ≥ leadGap; error-vs-target
replaces raw surplus in band guard, lag pricing, leadStop, and FOK
completion amount; VWAP ceiling + capital reservation stay RAW
(conservative — pair-v16.md §1 deviations 1–2). τ=0 reduces EXACTLY
to v15.4. Smokes PASS (5 mkts, τ0 vs τ80: 46 vs 58 trades — tilt
live, τ0 neutral-like). E-035/E-018/E-031 non-equivalence + the §5
calibration-rule amendment are written in pair-v16.md §2–§3.

**IN FLIGHT (next session's FIRST action — read these):** 6 runs,
batchUids `pf-e038-c0..c5-20260731T184*`, pinned 800 @ 140/20, SHA
ceae123 (workers verified on it, 31/31 alive). At close: 987/4,800
market jobs done, 0 failed. Cells (center q100 I160 B500 P*.96 γ0
doom.99 cool5 ttl90):

| # | tiltShares | leadGap | vs |
|---|---|---|---|
| c0 | 0 | 0.10 | run 970 (bridge) |
| c1 | +40 | 0.10 | c0 |
| c2 | +80 | 0.10 | c0 |
| c3 | +160 | 0.10 | c2 |
| c4 | −80 | 0.10 | c0 |
| c5 | +80 | 0.20 | c2 |

Readout commands: run ids via `tsx protocols/pair-fable/tools/results.ts
--label pf-e038 --limit 10`; then compare.ts (baseline first: c0 then
970), anatomy.ts per run (S/R/C/D + residue), evaluate.ts. Frozen
verdict bars in pair-v16.md §5: BRIDGE-STOP (|c0−970| per-$100 >
0.54); TILT-LIVE (some τ≠0 beats c0 by > 0.54); TILT-DEAD (all within
±0.54); TILT-HARMFUL (monotone degradation in |τ|). Also read final
NET residual direction (win-side fraction of the tilt) from
anatomy.ts residue rows.

## Next step (priority order)

1. **Read E-038 results** (above) and close the experiment in
   pair-v16.md §6 + LEDGER + JOURNAL. If TILT-LIVE: iterate (finer τ,
   hysteresis, signal (b) spot-vs-priceToBeat via ExternalFeeds). If
   TILT-DEAD/HARMFUL for signal (a): next directional signal is (b);
   E-035 does NOT cover maker-side tilt (pair-v16.md §2), but its
   dose curve tightens priors.
2. **P-013 (needs human):** sell-side mirror scope ruling (PROPOSALS).
3. **Cross-symbol replication:** gated on P-012.
4. v15 neutral axes: ALL closed (§15.4). Only unexplored v15 lever:
   the price gate P* itself (corner evidence 952/958 points LOWER);
   competes with, does not block, the directional line.

## Alignment gate — session 23

- **Classification:** directional-controller (E-038 is mission
  priority 2 — the directional version of the same controller).
- **Direct mission contribution:** the directional controller now
  EXISTS and is under measurement: design frozen (b96fa50), v16
  implemented (ceae123), smoked, and the full 6-cell τ dose–response
  grid (both signs + signal threshold) submitted and verified in
  queue. Controller decision pending the grid readout.
- **Time to evidence:** ~11 min (session start ≈18:28Z; design commit
  18:36:48Z, first smoke launched 18:39:01Z). Target NARROWLY MISSED:
  a new strategy required design-freeze-before-code (M2) plus a new
  file before any run could exist — reason recorded per mission rule.
- **Throughput:** 1 experiment (6 pre-registered cells, whole grid up
  front) + 2 sequential 5-mkt smokes; 4,810 market-replays launched
  (4,800 fleet + 10 local); queue verified (6 aggregate jobs, 4,800
  market jobs, 0 failed at close); fleet 31 workers on ceae123. No
  serial local scans.
- **Scale progress:** closed by E-036 (s21); this grid runs at $500
  (mechanism question, scale axis already answered on record).
- **Next-session priority:** read E-038 runs, verdict per frozen
  bars, then iterate the directional axis (GREEN either way).
- **Verdict:** **GREEN.**
- Verdict history: s21 GREEN, s22 GREEN, s23 GREEN. Next audit:
  session 25 (every-fifth-session template, mission §Alignment).

## Blockers

None. E-038 grid in flight (see Current work — next session reads it;
do NOT resubmit: batchUids above, 0 failures at close).

## Needs human

- **P-013**: sell-side mirror program scope ruling (see PROPOSALS).
- **P-012**: convert eth/sol/xrp 15m telonex datasets — gates
  cross-symbol replication. Not blocking.
- Carried: P-002/P-003/P-005/P-006/P-007/P-009/P-010 (all `proposed`).
  P-009/P-010 (fill-model realism / live probe) remain the binding
  caveat on every scale number (guard-7).

## Standing session guards

- Never end a session waiting on ANY in-flight work — record how to
  resume in STATUS, return `continue` (inbox dad421a6). Applied THIS
  session: E-038 grid recorded above, session returned `continue`.
- Write .global-runtime/session-result.json BEFORE the final message,
  every session, no exceptions.
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine
  commits (s13–s23: only protocol commits moved HEAD).
- Queue submissions require a CLEAN tree pushed to origin/main (push
  via `git push origin HEAD:main`); commit state snapshots before
  submitting.
- **zsh does NOT word-split unquoted variables** — submit grids as
  one LITERAL command per config (inbox c841c329); always keep stderr.
- Verify with fleet.ts after every detached batch; count aggregate
  jobs (waiting-children) or DB rows, not market-job totals.
- Do not push strategy-semantics changes while that strategy's jobs
  are queued/running — workers track origin/main; serialize push →
  submit. (E-038 jobs run on ceae123: do not touch pair.v16.ts while
  the grid is queued.)
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes). FULL reference v1-b: run 914.
  v15 baselines: new-SHA bridge chain 970 ≡ 960 ≡ 956; future v15
  runs compare against 970. v16 bridge: c0 vs 970 (pending). **v15
  noise floor 0.15 ⇒ ev bar 0.30, per-$100 bar 0.54** (937v938).
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
  2026-07-31 s22: only pair-fable has memory (s23: unchanged repo).
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

2026-07-31T16:46:43.750Z-82e89da5 (no newer entries at s23 start).
