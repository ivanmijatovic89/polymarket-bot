# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 22 close)

## Current work

**Session 22 executed E-037 — the quoting-presence/cadence axis (the
pre-registered s21 next step; inbox d904e17d activity question) —
designed→frozen→implemented→amended→smoked→6-run fleet grid→closed in
one session.** Design ac22097 BEFORE code 24780bf (M2); §15.3
amendment BEFORE submission (OrderManager rejects GTD expiry <
now+60s — smokes 965–967 had ZERO trades from wholesale rejection;
ttlSec floor raised 5→61, cell #5 15→61); smokes 968/969 PASS; runs
970–975 pinned 800 @ 140/20, SHA uniform 24780bf (verified
per-market-row). Verdict: **CADENCE-DEAD** (pair-v15.md §15.4):

- Bridge 970 ≡ 960 PASS (Δper-$100 −0.24 ≤ 0.54) — the
  cooldownTicks/ttlSec param promotion is behavior-neutral.
- Every named-pair S-count uplift < +25% (max +14.1% = #4's band
  headroom, a band effect per the registered E-036-interaction guard);
  no per-$100 move beyond the 0.54 bar; cooldown dose–response
  10→5→0 = S 2367→2445→2461 (~4% over the whole dead-time range).
- Mechanism: v15 capture is PRICE-GATED by the VWAP ceiling (it
  refuses the bid when projected pair > P*), not duty-cycle-gated —
  the ~30× gap to the E-024/E-025 always-on ToB ceiling is by design.
  The activity axis (d904e17d) is ANSWERED for v15 at these
  placements.

**Axis scoreboard after s22 — the neutral controller is UNDERSTOOD:**
HOW converged (§10.5/§11.5); size/cap SCALE-DEGRADING, closed
(§14.2); WHICH dead (§13.2); ask-side WHEN/tilt dead (E-035);
cadence/activity dead (§15.4). Loss = doom-completion premium
−5..−6/$100, invariant on every measured axis. Per the binding
priority order the program NOW MOVES TO PRIORITY 2: the directional
version of the same controller.

A human commit 52b1ac0 added `missions/02-research-v2-draft.md` —
explicitly marked DRAFT/INACTIVE ("do not treat as a ruling"); the
active mission remains `missions/02-research.md`. E-037 work is
consistent with both texts.

## Next step (priority order)

1. **E-038 (GREEN, next session's first action): directional
   controller v16** — same v15 machinery with a measured, risk-bounded
   non-zero inventory target (mission priority 2). Design sketch to
   freeze: shift the band asymmetrically toward a leader signal —
   tilt target τ(t) with |τ| ≤ tiltMax, deficit-side completion
   pressure relaxed toward the leader (the doom premium IS the cost
   of completing the trend-loser; a bounded lead-side tilt attacks
   exactly that term). Signal candidates, cheapest first: (a)
   book-implied leader (bid difference — no new plumbing, one session
   to evidence); (b) spot-vs-priceToBeat distance (contested.ts
   machinery exists; needs ExternalFeeds plumbing into v16). Start
   with (a); grid must include τ=0 bridge vs 970 and a τ dose–response
   with the frozen 0.54/0.30 bars; name the E-035 non-equivalence in
   the freeze (E-035 killed one-shot ask-side REGION ENTRIES, not a
   bounded tilt inside the continuous controller). Command shape per
   cell: `npx tsx protocols/pair-fable/tools/run-backtest.ts
   --strategy pair-fable-v16 --param ... --limit 800 --latest --to-ms
   1784762100000 --label pf-e038 --detach --json` (LITERAL args, one
   command per config; verify queue with fleet.ts after).
2. **P-013 (needs human):** sell-side mirror scope ruling (PROPOSALS).
3. **Cross-symbol replication:** gated on P-012.
4. v15 neutral axes: ALL closed — no further spend without a new
   measured signal (guard-4). The only unexplored v15 lever is the
   price gate P* itself; corner evidence (952/958) points LOWER, and
   it competes with (not blocks) E-038.

## Alignment gate — session 22

- **Classification:** neutral-controller (E-037 is a direct
  presence/cadence test of the neutral continuous controller).
- **Direct mission contribution:** closed the last open neutral-
  controller axis (activity/cadence, inbox d904e17d): promoted
  ttl/cooldown to params, measured S-count elasticity ≈ 0 (< +25%
  everywhere), proved capture is price-gated; controller decision
  changed — cadence work is dead for v15, program advances to the
  directional controller (priority 2). Evidence: design ac22097, code
  24780bf, runs 970–975, pair-v15.md §15.4, LEDGER E-037.
- **Time to evidence:** ~8 min (session start ≈18:04Z; design commit
  1fbfcec/ac22097 18:11; smoke run 965 launched 18:12:27). 10-minute
  target MET.
- **Throughput:** 1 experiment (6 pre-registered cells + 5 sequential
  smoke/diagnostic runs 965–969); 4,815 market-replays; whole grid
  submitted up front (6 detached submissions, queue verified: 6
  aggregate jobs, 4,800 market jobs), fleet 31 workers, all 6 runs
  landed and analyzed in-session (~1.7 min/run). No serial local
  scans.
- **Scale progress:** closed by E-036 (s21); this session $500 level
  only (grid design — scale axis already answered). No remaining gap:
  $2,000 tested, 500–1,000 range reached depth-optimistically, on
  record.
- **Next-session priority:** E-038 directional controller v16 (GREEN,
  directional-controller); sketch + commands above.
- **Verdict:** **GREEN.**
- Verdict history: s20 YELLOW, s21 GREEN, s22 GREEN. Next audit:
  session 25 (every-fifth-session template, mission §Alignment).

## Blockers

None. Fleet idle after E-037 (all 6 batches completed). No in-flight
work.

## Needs human

- **P-013**: sell-side mirror program scope ruling (see PROPOSALS).
- **P-012**: convert eth/sol/xrp 15m telonex datasets — gates
  cross-symbol replication. Not blocking.
- Carried: P-002/P-003/P-005/P-006/P-007/P-009/P-010 (all `proposed`).
  P-009/P-010 (fill-model realism / live probe) gained further weight
  from E-036: guard-7 depth optimism is now the binding caveat on
  every scale number.

## Standing session guards

- Never end a session waiting on ANY in-flight work (fleet, local
  scan, background task, monitor) — record how to resume in STATUS,
  return `continue` (inbox dad421a6). Long local jobs: `--checkpoint`
  + `--time-budget-s` foreground chunking; shard big scans with
  calib-style `--offset` (6-way ≈ 3 mkts/s).
- Write .global-runtime/session-result.json BEFORE the final message,
  every session, no exceptions.
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine
  commits (s13–s22: only protocol commits moved HEAD; s22 pulled
  52b1ac0 = missions draft only).
- Queue submissions require a CLEAN tree pushed to origin/main (push
  via `git push origin HEAD:main`); commit state snapshots before
  submitting.
- **zsh does NOT word-split unquoted variables** — a `for cfg in "a b
  c"` + `set -- $cfg` loop passes the whole string as $1 and the
  launcher's params arrive NaN/empty (5 failed submissions s21, exit 2,
  nothing enqueued). Submit grids as one LITERAL command per config
  (inbox c841c329 already requires this); always keep stderr.
- Detached submissions seconds after a push can also fail cleanly
  (exit 2, nothing enqueued) — verify with fleet.ts after every
  detached batch; queue totals can UNDERCOUNT because completed jobs
  are trimmed — count aggregate jobs (waiting-children) or DB rows,
  not market-job totals.
- Do not push strategy-semantics changes while that strategy's jobs
  are queued/running — workers track origin/main; serialize push →
  submit.
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes). FULL reference v1-b: run 914.
  v15 baselines: old-SHA (4a5982e) 948/952/956/957; **new-SHA
  (24780bf) bridge chain 970 ≡ 960 ≡ 956 verified** — future v15 runs
  compare against 970 (center q100/I160/B500, explicit cool5/ttl90). **v15 noise floor
  0.15 ⇒ ev bar 0.30, per-$100 bar 0.54** (937v938).
- JOURNAL entries are for the HUMAN: plain language, 3–6 short lines,
  ≤ 1 evidence pointer per conclusion (inbox 330fa938, permanent).
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329), verify queue depth after every detached batch.
- Class kills need an identity argument (evaluator.md §Kill
  standards); N failures kill a family only. Verdict bars must name
  comparison PAIRS. Positive signals measured ON discovery data need
  disjoint confirmation before any build decision (E-028 → E-035).
- Fill model: calibrated by E-025 (acceptable capacity bound at ToB).
  Guard-7 whole-size fill optimism: larger-q results depth-optimistic
  — at q ≥ 200 the rest is AT/ABOVE measured ToB depth (E-036).
- Sibling-memory recheck at session start (`ls protocols/*/memory`) —
  2026-07-31 s22: checked, only pair-fable has memory.
- Smoke cannot catch latency-race bugs (CAP-BREACH check) AND cannot
  demonstrate RARE fill modes (escalate to a 200-mkt Stage B instead).
- Schema refines AND engine constraints can invalidate a frozen grid
  corner — check every cell against schema refines and OrderManager
  validation when freezing (E-037: GTD expiry < now+60s is rejected;
  ttlSec < 61 cannot trade at all).
- A completed run with 0 trades and noActivity=N can mean every order
  was REJECTED (not empty data) — check OrderManager validation
  before blaming the dataset (runs 965–967).
- The backtest sim is NOT bit-deterministic (latency jitter):
  identical configs differ run-to-run — noise floors come from
  duplicate pairs.

## Inbox processed through

2026-07-31T16:46:43.750Z-82e89da5 (alignment-control update; adopted
s20/s21 — marker advanced this session, no unprocessed entries
remain).
