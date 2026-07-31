# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 26)

## Current work

**Session 26: E-040 CLOSED (INSTRUMENT-BOUND); noise model at
pinned-800/B500 REPLACED; E-039 re-verdicted CEIL-UNRESOLVED
(pre-registered §9 consequence); E-041 FULL-instrument ceiling
re-test frozen + submitted (4 × 10,747 jobs).**

E-040 close (runs 993–1000, full table pair-v16.md §10): the
duplicate triplet {994, 999, 1000} (formula-identical e0) clusters
within 0.34 ev, but paired per-market sd(Δpnl) ≈ 34 in EVERY pair
(duplicates included) ⇒ single-run pairwise ev SE ≈ 1.2 (2σ ≈ 2.4)
at pinned-800/B500. Run 986 (formula-identical, code/universe/feeds
all verified identical) sits +1.4..+1.8 above all three duplicates —
the tail is real and 3 duplicates under-sample it. e1's +1.3 has the
same signature ⇒ CEIL-FINE unresolved; PERSIST unresolved at ev;
structural facts stand (persist 1400 barely binds — leaders already
~always ≥10 s persistent at gap 0.10; tilt D-spend unit-cost cliff
between 0.85 and 0.80). **E-039 re-verdict: CEIL-LIVE →
CEIL-UNRESOLVED** — winner +1.91 is z ≈ 1.6; winner state
(−10.83 ev, p/100 −3.16) did NOT replicate (triplet mean −12.37,
p/100 −3.6..−3.7). Dose-structure facts stand; ev claims withdrawn.
E-038 TILT-LIVE not re-opened (structure, not a single pair).

**Binding instrument rule (pair-v16.md §10):** ev-level verdicts at
B=500 now require FULL-universe run pairs (SE ≈ 0.33) or
duplicate-triplet means. Pinned-800 single runs remain the
structure/mechanism screen only.

**IN FLIGHT (next session reads FIRST; do NOT resubmit):** E-041,
4 FULL runs @ 140/20, SHA d204df35 (params-only, no code change),
universe 10,747 identical on all cells (--to-ms 1785196800000 pin,
from-ms floor). Queue verified 20:28Z: 4 aggregates
(waiting-children), ~43k market jobs, 0 failed, f0a 2264/10747.
ETA ~2–2.5 fleet-hours from 20:27Z. Center = E-040 e0 (τ+160 gap.10
q100 I160 B500 P*.96 doom.99 cool5 ttl90 persist0):

| # | tiltUnitMax | batchUid |
|---|---|---|
| f0a | 0.90 | pf-e041-f0a-20260731T202514-4lc2kv |
| f0b | 0.90 | pf-e041-f0b-20260731T202554-njqzov |
| f1 | 1.00 | pf-e041-f1-20260731T202637-hwbk83 |
| f2 | 0.95 | pf-e041-f2-20260731T202727-4oge4h |

Readout: `results.ts --last 4`; noise SE_pair from the f0a/f0b
paired per-market sd (sql.ts paired query, see §10 for the form);
frozen bars pair-v16.md §11: B_full = max(0.30, 2×SE_pair,
|Δev(f0a,f0b)|); verdicts CEIL-REAL / CEIL-HARMFUL / CEIL-NULL /
FINE-MOVE / INSTRUMENT-FAIL (B_full > 0.8). Decision mapping:
CEIL-REAL ⇒ iterate acquisition price at FULL instrument;
NULL/HARMFUL ⇒ ceiling closed, center reverts to 1.00, next lever =
signal (b) spot-vs-priceToBeat tilt (v17, new file — safe to build
while E-041 runs since it does not touch pair.v16.ts).

## Audit correction (s25 audit item)

**M1–M5 ARE implemented and verified** — commit 4809a8e
(2026-07-31 01:41, in main's history), per-finding verification in
its commit message (M1 exemplar now FAILS mechanical; M2 design-ts
sanity check live; M3 2×SE champion bar + dethroning; M4
cross-run SHA warnings in evaluate/compare + team-workflow rule 4;
M5 schema max). The s25 audit line "NOT implemented yet" was wrong —
it did not check the tool code. Remains subject to "must stay
implemented and passing" before first promotion.

## Next step (priority order)

1. **Read E-041** (table above; bars §11). Any verdict is GREEN
   directional-controller work.
2. If CEIL-NULL/HARMFUL: design + implement **signal (b)
   spot-vs-priceToBeat tilt** as pair.v17.ts (leader = sign of
   spot − priceToBeat from ExternalFeeds; plumbing exists in
   backtests: binanceWsSpotPrice + polymarketPriceToBeat). Target
   effect sizes ≥ 2 ev; verdicts at FULL-pair instrument.
3. **P-013 (needs human):** sell-side mirror scope ruling (PROPOSALS).
4. **Cross-symbol replication:** gated on P-012.
5. Unexplored v15 lever: price gate P* (corner evidence 952/958
   points LOWER) — now needs the FULL instrument too.

## Alignment gate — session 26

- **Classification:** directional-controller (E-040 close, E-039
  re-verdict, E-041 freeze+submit — all on the directional
  controller's acquisition-ceiling lever).
- **Contribution:** controller evidence standard changed (noise
  model replaced, §10); E-039's ev claim withdrawn before it could
  steer iteration; E-041 submitted to decide the ceiling honestly
  (4×10,747 verified). Audit item corrected (M1–M5 done at 4809a8e).
- **Time to evidence:** ~1 min (results.ts read of E-040 stragglers
  as first action). PASS.
- **Throughput:** 1 experiment closed (8×800 runs read; 11 paired
  per-market SQL comparisons; code/universe/feed identity checks);
  1 experiment launched whole-grid-up-front (4 FULL = 42,988 jobs,
  queue-verified, 0 failures). No serial scans.
- **Scale:** closed by E-036 on record; E-041 runs at B=500.
- **Next:** read E-041 — GREEN either way.
- **Verdict:** **GREEN.**
- Verdict history: s24 GREEN, s25 GREEN, s26 GREEN. Next audit: s30.

## Blockers

None. E-041 in flight (~2–2.5 h; see Current work; do NOT resubmit).

## Needs human

- **P-013**: sell-side mirror program scope ruling (see PROPOSALS).
- **P-012**: convert eth/sol/xrp 15m telonex datasets — gates
  cross-symbol replication. Not blocking.
- Carried: P-002/P-003/P-005/P-006/P-007/P-009/P-010 (all
  `proposed`). P-009/P-010 remain the binding caveat on every scale
  number (guard-7).

## Standing session guards

- Never end a session waiting on ANY in-flight work — record how to
  resume in STATUS, return `continue` (inbox dad421a6).
- Write .global-runtime/session-result.json BEFORE the final message,
  every session, no exceptions.
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine
  commits (s13–s26: only protocol/harness-contract commits moved
  HEAD; session-contract v2 landed 1b95537 — journal + summary are
  messages to the human, plain register).
- Queue submissions require a CLEAN tree pushed to origin/main (push
  via `git push origin HEAD:main`); commit state snapshots before
  submitting.
- **zsh does NOT word-split unquoted variables** — submit grids as
  one LITERAL command per config (inbox c841c329); always keep
  stderr. run-backtest.ts: `--latest` is a BOOL; market count goes
  in `--limit N`. Capture the batchUid line from EVERY submit.
- Verify with fleet.ts after every detached batch; count aggregate
  jobs (waiting-children), not market-job totals.
- Do not push strategy-semantics changes while that strategy's jobs
  are queued/running — workers track origin/main; serialize push →
  submit. (E-041 jobs run on d204df35: do NOT touch pair.v16.ts
  while the grid is queued. A NEW strategy file pair.v17.ts is safe.)
- Screens baseline 874 (v0) and parents 872/873/879 valid ≤
  2026-08-06 (evaluator.md §Universes). FULL reference v1-b: run
  914. v15 bridge chain 970 ≡ 960 ≡ 956. v16 bridges: c0 = 978,
  d0 = 987.
- **NOISE MODEL (replaced s26, pair-v16.md §10): pinned-800/B500
  single-run pairwise ev SE ≈ 1.2 (2σ ≈ 2.4); per-market paired
  sd ≈ 34. The old 0.30 ev bar is void at B=500. ev verdicts need
  FULL pairs (SE ≈ 0.33, E-041 measures it) or duplicate-triplet
  means. p/100 bar 0.54 unchanged for structure screens at B=100;
  duplicate sets can under-sample tails — prefer paired per-market
  z + sign tests over max-pairwise formulas.**
- JOURNAL entries are messages to the human (contract v2): plain
  sentences, tried/happened/means/next, drop run ids/codes unless
  genuinely the point.
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329), verify queue depth after.
- Class kills need an identity argument (evaluator.md §Kill
  standards); N failures kill a family only. Verdict bars must name
  comparison PAIRS. Positive signals measured ON discovery data need
  disjoint confirmation before any build decision (E-028 → E-035;
  E-039 → E-040/E-041 is now the canonical in-family example).
- Fill model: calibrated by E-025 (ToB capacity bound). Guard-7
  whole-size fill optimism: larger-q results depth-optimistic
  (E-036).
- Sibling-memory recheck at session start (`ls protocols/*/memory`)
  — 2026-07-31 s26: only pair-fable has memory (unchanged).
- Smoke cannot catch latency-race bugs AND cannot demonstrate RARE
  fill modes (escalate to a 200-mkt Stage B instead).
- Schema refines AND engine constraints (OrderManager validation)
  can invalidate a frozen grid corner — check every cell when
  freezing (GTD expiry < now+60s rejected; ttlSec ≥ 61).
- A completed run with 0 trades and noActivity=N can mean every
  order was REJECTED — check OrderManager validation before blaming
  data.
- The backtest sim is NOT bit-deterministic (latency jitter) — and
  jitter noise at B=500 is heavy-tailed at run level (s26).
- leadPersistTicks is in TICKS (~138/s on active markets);
  1400 ≈ 10 s. At leadGap 0.10 leaders are already ≥10 s persistent
  (E-040 structural).

## Inbox processed through

2026-07-31T16:46:43.750Z-82e89da5 (no newer entries at s26 start).
