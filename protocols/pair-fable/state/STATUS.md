# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 21 close)

## Current work

**Session 21 executed E-036 — the binding scale check (mission
f8b19a4) — designed→frozen→bound-raise→smoke→5-run fleet grid→closed,
all in one session.** Design 703b8dc BEFORE code 32beb25 (M2); smoke
959; runs 960–964 on the pinned 800 @ 140/20, SHA uniform 32beb254
(verified per-market). Verdict: **SCALE-DEGRADING; the binding scale
question is CLOSED on both mission prongs** (pair-v15.md §14.2):

- **(a) reached:** M mean 715 / median 600 / p90 1,289 at
  q=300/B=$2,000 — inside the 500–1,000 matched-share range. S-fill
  count is size-invariant (2,478–2,627 per 800 mkts at ALL q), so
  M ∝ q exactly as E-033 predicted.
- **(b) attached:** q=300 rests AT the measured ToB depth (E-028b
  300–450 sh) under whole-size-fill semantics — every scaled number is
  a depth-optimistic UPPER bound; real capture would be worse.
- **Economics:** per-$100 loss −5.2..−5.9 at every level; two named
  pairs breach the 0.54 bar the WRONG way: q100→q200 @ B2000 −0.73
  (degrading), and B2000→B1000 @ q200 +0.66 (LESS cap is better).
  Mechanism: wider absolute band ⇒ deficits complete deeper into
  trends (mean P 1.093→1.102; D/S fill ratio 0.56→1.07). Absolute
  loss scales with invested (ev −11.5 → −36.3/mkt).
- Bridge run 960 vs 956 PASS (Δ per-$100 0.43 ≤ 0.54): the schema
  bound raise (orderSize→400, imbalanceBand→800, 32beb25) is
  behavior-neutral; E-033's qualification is resolved — scale is
  neutral ≤ q100, degrading beyond, never improving.

**Axis scoreboard after s21:** HOW converged (E-031b/E-032); size/cap
SCALE-DEGRADING and CLOSED per the mission disjunction (E-036); WHICH
dead (E-034); ask-side WHEN + tilt dead (E-035). The neutral
controller as specified pays a scale-invariant doom premium of
−5..−6/$100. Remaining live directions: activity/cadence regime
(inbox d904e17d — last untested controller axis), sell-side mirror
(P-013, needs human), cross-symbol (P-012), fill-model realism
(P-009/P-010 — now load-bearing: guard-7 optimism dominates all scale
results).

## Next step (priority order)

1. **E-037 (GREEN, next session's first action): high-activity /
   cadence axis on v15** (inbox d904e17d), as neutral-controller work.
   Constraints to name in the frozen design: E-013 measured
   ttl/cooldown cadence-DEAD on the one-rest v1 (fill-limited;
   worst-queue crossings are market-given) — v15 is not exactly
   equivalent (both-sides continuous quoting) but S-count invariance
   (E-033/E-036) says the same crossing bound holds at ToB join
   prices; E-025's trade-confirmed ceiling ≈ 97 fills/mkt vs v15's ~7
   trades/mkt is the measured headroom; E-032 showed 1-tick quote
   improvement intercepts only 2.4% of completion dollars. So the
   design must attack PLACEMENT×CADENCE jointly (e.g. guard-2 swap
   lagAggr→a requote-cadence/price-refresh knob at small q, or a
   design-constant promotion with written justification), not ttl
   alone. Hypothesis sketch: more, smaller, faster-refreshed quotes
   raise matched inventory per dollar without raising doom exposure
   (v15 mean trades/mkt ≈ 7 at q=25..100; probe toward 20–100).
   Freeze minimally (hypothesis/config/metric/verdict), smoke
   `--sequential --limit 3`, then submit the whole grid; command
   shape: `npx tsx protocols/pair-fable/tools/run-backtest.ts
   --strategy pair-fable-v15 --param ... --limit 800 --latest --to-ms
   1784762100000 --label pf-e037 --detach --json` (one per config,
   LITERAL args — see the zsh guard below).
2. **P-013 (needs human):** sell-side mirror scope ruling (PROPOSALS).
   No sell-side work beyond the filed proposal without the ruling.
3. **Cross-symbol replication:** gated on P-012.
4. v15 HOW/WHICH/tilt/scale: no further spend without a new measured
   signal (guard-4; scale exception now DISCHARGED by E-036).

## Alignment gate — session 21

- **Classification:** neutral-controller (E-036 is a direct scale test
  of the neutral continuous controller).
- **Direct mission contribution:** closed the binding scale
  requirement (mission f8b19a4): $2,000 tested, 500–1,000
  matched-share range reached (a) with the depth-optimism mechanical
  bound (b) on record; controller decision changed — scale axis is no
  longer open, size stays ≤ q100 for any future v15 work. Evidence:
  design 703b8dc, code 32beb25, runs 960–964, pair-v15.md §14.2,
  LEDGER E-036.
- **Time to evidence:** ~3 min (session start ≈17:49; design commit
  703b8dc 17:52; smoke run 959 launched 17:52:24, completed 17:52:44).
  10-minute target MET.
- **Throughput:** 1 experiment (5 pre-registered configs + 1 smoke);
  4,003 market-replays; whole grid submitted up front (5 detached
  submissions, verified in queue), fleet 31 workers, all 5 runs landed
  and were analyzed in-session (~2 min/run). No serial local scans.
- **Scale progress:** the binding check is DONE — $2,000 tested
  (invMax 1,967), M 715/600 mean/med at q=300 vs the 500–1,000 target
  (reached, depth-optimistic), verdict SCALE-DEGRADING.
- **Next-session priority:** E-037 cadence/placement axis (GREEN,
  neutral-controller); sketch + commands above.
- **Verdict:** **GREEN.**
- Verdict history: s19 GREEN, s20 YELLOW, s21 GREEN. Next audit:
  session 25 (every-fifth-session template, mission §Alignment).

## Blockers

None. Fleet idle after E-036 (all 5 batches completed). No in-flight
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
  commits (s13–s21: only protocol commits moved HEAD).
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
  (32beb25) bridge 960 ≡ 956 verified** — future v15 runs compare
  against 960 (center q100/I160/B500 equivalent). **v15 noise floor
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
  2026-07-31 s21: not re-checked (s20: only pair-fable has memory).
- Smoke cannot catch latency-race bugs (CAP-BREACH check) AND cannot
  demonstrate RARE fill modes (escalate to a 200-mkt Stage B instead).
- Schema refines can invalidate a frozen grid corner — check every
  cell against the schema refines when freezing.
- The backtest sim is NOT bit-deterministic (latency jitter):
  identical configs differ run-to-run — noise floors come from
  duplicate pairs.

## Inbox processed through

2026-07-31T16:46:43.750Z-82e89da5 (alignment-control update; adopted
s20/s21 — marker advanced this session, no unprocessed entries
remain).
