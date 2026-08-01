# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-08-01T11:00Z (mission-02 session 46 close — E-052 read NULL,
E-053 frozen+implemented+submitted, gate GREEN)

## IN FLIGHT (read first — s47 owes this readout, drain ~11:50Z)

**E-053 (disagreeTighten) FULL grid, submitted s46 10:51–10:55Z at
commitSha d77347c5. 32,241 market-jobs, projected drain ~11:50Z
2026-08-01 at the re-validated ~600/min pace. Rows land at FULL queue
drain.**

- dt04 = `pf-e053-dt04-20260801T105135-h66yqs`
- dt08 = `pf-e053-dt08-20260801T105229-qfamj6`
- dt12 = `pf-e053-dt12-20260801T105331-3ozjf7`

**s47 readout recipe (mirror of the s46 E-052 readout, which is the
worked example in pair-v17t.md §19 READOUT):**

1. `npx tsx protocols/pair-fable/tools/fleet.ts` → aggregate
   waiting-children 0, 3 batches gone.
2. Map batchUids → run ids: sql.ts `SELECT id,batch_uid,status FROM
   backtest_runs WHERE batch_uid LIKE 'pf-e053-dt%'` (beware
   pf-e053-act-* rows 1066/1067 = local activation A/B, diagnostics
   only; smoke 1065).
3. Integrity per run: 10,651 + identical 96-failure set, latency
   140/20, B=500, params per cell. Engine-SHA: check the compare.ts
   M4 warning — commits 94a077cd..d77347c5 are protocols/pair-fable/**
   only (verified s46; re-verify if HEAD moved past d77347c5).
4. Paired Δev vs 1052: compare.ts `--runs 1052,<dt04>,<dt08>,<dt12>`.
   Bar B_full 0.74.
5. Kept-flow channel (PRIMARY, §18): the §17 cross-tab SQL (validated
   s46 against the §18 known answer; literal SQL in the s46 shell
   history and reproducible from §17 method: join
   backtest_run_markets a,b on slug, run_id pair (cell,1052), classify
   played = trade_count>0, sum Δpnl by kept/dropped/new). K_bar +$4.0k.
6. Degeneracy (BOTH granularities, §22 bars): per cell
   `npx tsx protocols/pair-fable/tools/disagreecapture.ts --run <id>`
   (~3 min serial each, DuckDB memory-bound — constraint on record):
   fill-time T=−5 flagged count ≥ 516 (25% of base 2,064) AND
   noActivity growth vs 5,308 ≤ +699 (50% of pool 1,398). e052metrics
   also works for noActivity/S totals (its inBandLateS field is
   E-052-specific, ignore).
7. Verdict per §22 map (REPRICE-CONT / AVOID-CLOSE / AMBIG / NULL /
   KEPT-SIGNAL / OVER / DEGENERATE) + LEDGER E-053 row + §22 READOUT
   section. NULL/AVOID-CLOSE/OVER ⇒ **priority 2 (directional
   controller) becomes the leading program** per the frozen §22
   decision map — the quote-price concession family would then be
   closed for internal AND external conditioning at this center.

Do NOT edit pair.v17t.ts semantics while these jobs are queued
(workers at d77347c5; serialize push→submit).

## HEADLINE STATE

**s46: E-052 (lateBandTighten) read NULL + DEGENERATE@lb12 under the
frozen §19 bars — axis closed at this shape.** Δev max +0.396 (lb08)
vs bar 0.74; kept-flow max +$2,337 (lb12) vs K_bar +$4.0k; lb12
extinguishes the target flow (inBandLateS 1,091→205 < 273 floor).
Context finding (not a bar): FIRST lever on the family with a
positive dose-monotone kept-flow channel (+292/+1,752/+2,337) —
consistent with §21.2's claim that the band was a weak proxy for the
spot-disagreement feature. Dup replicate: Δev 0.019, kept-flow Δ $23
— tightest same-config pair on record.

**§21.4 (s46, freeze input): the disagreement flag is a persistent
state** — 0.976/0.968 persistence at 1s lead (T=0/−5), lagged-flag
separation intact (−5.3 vs −2.0¢/sh), 98% of toxic dollars identified
1s ahead ⇒ quote-time capture near-full, E-053 bars carry no big
capture discount. New tool tools/disagreecapture.ts (also computes
the extinction pool: 1,398 played markets have EVERY S fill flagged
at −5).

**E-053 frozen (§22) + implemented + submitted this session** — see
IN FLIGHT. Verdict branches: REPRICE-CONT ⇒ first genuine repricing
lever, optimize/compose; NULL-family ⇒ priority 2 becomes leading.

**Records:** best FULL ev 1056 (−2.37, avoidance dose — not the
mechanism center); MECHANISM-TEST CENTER 1052 (P*0.86 k012, −3.17);
standing comparison reference 1029 (−8.07). Chain adds s46: 1064
(−2.77), 1062 (−2.87), 1061 (−3.05), 1063 (−3.07).
Channel-bar law (§18): ev gains with kept-flow ≤ 0 close their axis;
avoidance is bounded above by ev = 0.

## Current work

**Session 46 (10:03–11:00Z):** E-052 grid was NOT yet drained at
start (drained 10:38Z) → drain window used for §21.4 quote-time
capture measurement (new disagreecapture.ts, known-answer-verified
against §21.2/§21.3 numbers) + §21.5 pre-freeze skeleton → full
E-052 readout at drain (NULL + DEGENERATE@lb12, §19 READOUT + LEDGER
row) → E-053 freeze (§22, BEFORE implementation) → implementation →
protocol:check + smoke 1065 + activation A/B 1066/1067 all PASS →
3-cell grid submitted + queue-verified. Commits: 3745cf0(≈§21.4),
§21.5, readout, freeze, d77347c5 (implementation) — all pushed.

## Audit note

M1–M5 implemented and verified at 4809a8e (s26 correction stands).
Five-session audit s40–s44 PASS (recorded s45). Next audit: s50
(s45–s49).

Next-five plan tracking (set s45): (1) s45 partial → completed s46:
E-052 readout GREEN ✓; (2) E-053 freeze+implement+submit ✓ (also
s46); (3) E-053 readout — s47 GREEN; (4) composition/dose at winning
point OR directional reopen (priority 2) per the §22 decision map —
GREEN; (5) at most one supporting diagnostic. ≥3 GREEN by
construction.

## Next step (priority order)

1. **s47 (GREEN neutral-controller): E-053 readout** — recipe staged
   in IN FLIGHT; drain ~11:50Z.
2. **Per §22 decision map:** REPRICE-CONT ⇒ dose/composition
   increment at the operating point (center may move). NULL /
   AVOID-CLOSE / OVER ⇒ priority 2: directional controller —
   reopen E-046's closure on the disagreement feature (tilt
   conditioning; separate freeze, mechanism class = inventory target,
   not quote price).
3. Open-but-unscheduled: P* floor < 0.85, k > 0.28 (decaying sub-bar
   avoidance channels — composition reason required to reopen).
4. **P-013 (needs human):** sell-side mirror scope ruling (PROPOSALS).
5. Cross-symbol replication: gated on P-012.

## Alignment gate — session 46

- **Classification:** neutral-controller (E-052 readout + E-053
  freeze/implementation/submission — two direct controller
  increments; §21.4 was the E-053 freeze's required sizing input,
  measured while blocked on the drain).
- **Contribution (controller decision changed):** (a) E-052 verdict
  NULL + DEGENERATE@lb12 recorded under frozen bars — the late-band
  concession axis is closed, lateBandTighten NOT adopted (runs
  1061/1064/1062 + dup 1063 vs 1052); (b) E-053 frozen at fresh base
  numbers, implemented, integrity-verified, and its FULL grid
  submitted (d77347c5); (c) §21.4 established near-full quote-time
  capture, removing the main sizing unknown from the E-053 bars.
- **Time to evidence:** min ~1 (fleet/queue check), min ~7 first data
  scan launched (disagreecapture on 1052). PASS.
- **Throughput:** 1 frozen 3-cell FULL grid submitted (32,241
  market-jobs, whole grid up front); 5 fleet runs evaluated (E-052
  readout); 2 serial local scans (~3 min each, DuckDB memory-bound —
  recorded pre-launch; fleet was saturated with E-052 then E-053
  during both); smoke + activation A/B (3 local sequential runs).
- **Scale:** closed by E-036 on record (P-009/P-010 caveat);
  unchanged this session.
- **Next:** s47 — E-053 readout (GREEN neutral-controller, staged
  recipe in IN FLIGHT).
- **Verdict:** **GREEN**.
- Verdict history: s31–s43 GREEN, s44 YELLOW, s45 GREEN (borderline,
  flagged), s46 GREEN. Next audit: s50 (s45–s49).

## Blockers

None. E-053 in flight is NOT a blocker (contract: record ids, return
continue).

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
  commits (through s46: only protocol commits moved HEAD; verified
  f0f87f19..94a077cd..d77347c5 all protocols/pair-fable/** only).
- **Sibling labs:** `protocols/pair-opus` — reads allowed both ways
  (inbox c68ea4ce); s46: not rechecked (s44: no results yet) — recheck
  at s47 start (`ls protocols/*/memory`).
- Queue submissions require a CLEAN tree pushed to origin/main (push
  via `git push origin HEAD:main`); commit state snapshots before
  submitting. If push is rejected (sibling labs push too), rebase
  then push — check what the rebase pulled.
- **Submit-output guard (s43):** capture the batchUid line from EVERY
  submit — pipe through `grep "batchUid="`, NOT `tail`. A resubmit
  after a cut-off output DOUBLE-ENQUEUES (no cancel path in tooling);
  if it happens, designate the dup's role in writing BEFORE results
  land (E-046/E-052 precedent — E-052's dup earned its keep as the
  noise replicate: Δev 0.019 / kept-flow Δ $23).
- **zsh does NOT word-split unquoted variables** — submit grids as
  one LITERAL command per config (inbox c841c329). `echo ===` breaks
  zsh. Always keep stderr. run-backtest.ts: `--latest` is a BOOL;
  market count goes in `--limit N`. Capture the batchUid per submit.
- Verify with fleet.ts after every detached batch; count aggregate
  jobs (waiting-children), not market-job totals. Rows land at FULL
  queue drain (s32 model; ~600–830/min re-validated s46: 48k-job
  4-batch grid drained 09:30→10:38Z). **Stamp all session times from
  `date -u`, never the shell prompt** (s44 clock-misread lesson).
- Foreground `sleep` chains are blocked by the harness — poll with a
  bounded loop inside ONE Bash call, or arm a Monitor. A ~10-min
  foreground poll loop with `timeout` set works (s46).
- Screens baseline 874 (v0) and parents 872/873/879 valid ≤
  2026-08-06 (evaluator.md §Universes). FULL references: **standing
  comparison reference 1029 (v17 τ0 P*0.92, ev −8.07); MECHANISM-TEST
  CENTER 1052 (v17t P*0.86 k012, −3.17); best FULL ev on record 1056
  (1052+e09 avoidance dose, −2.37); chain 1057 (−2.48), 1055 (−2.53),
  1054 (−2.89), 1049 (−3.83), 1051 (−4.00), 1050 (−4.23), 1046
  (−4.83), 1047 (−4.98), 1043 (−5.89); s46 adds 1064 (−2.77), 1062
  (−2.87), 1061 (−3.05), 1063 (−3.07); older: g0=1008, g3=1009,
  m10=1026.** v15 bridge chain 970 ≡ 960 ≡ 956; v16 bridges c0=978,
  d0=987. **Beware pf-e052-act-* 1059/1060 and pf-e053-act-*
  1066/1067 (+ smoke 1065) = local activation/smoke runs, diagnostics
  only.**
- **NOISE MODEL: FULL-pair instrument at B=500 — same-config paired
  sd 21.5–38.3 (E-041: 0.21 dup Δ; s39: 0.007; s46: 0.019 dup Δ),
  SE_pair 0.19–0.24 on 10,651, ev bar B_full = 0.74. Cross-config
  paired sd larger (22–66). Pinned-800/B500 single-run ev SE ≈ 1.2 —
  structure screens only. p/100 bar 0.54 for screens. Kept-flow
  channel noise: dup replicates $23 (s46) and ≈$2.2k scale (s43 est.)
  ⇒ K_bar +$4.0k stays conservative (§22).**
- **CHANNEL BAR (§18):** every future mechanism freeze on this family
  must include kept-flow paired Δpnl (played-in-both markets) as a
  PRIMARY success bar; ev gains with kept-flow ≤ 0 close their axis.
  Degeneracy tripwires must police market-level participation
  (noActivity), not only within-market fill counts. (§19 fired
  exactly this way at lb12 — within-market extinction with noActivity
  inside its cap.)
- JOURNAL entries are messages to the human (contract v2): plain
  sentences, tried/happened/means/next, drop run ids/codes unless
  genuinely the point.
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329), verify queue depth after.
- Class kills need an identity argument (evaluator.md §Kill
  standards); N failures kill a family only. Verdict bars must name
  comparison PAIRS. Positive signals measured ON discovery data need
  disjoint confirmation before any build decision (§21 used
  split-half; the E-053 FULL run is the final confirm).
- Fill model: calibrated by E-025 (ToB capacity bound). Guard-7
  whole-size fill optimism: larger-q results depth-optimistic
  (E-036). Maker-tilt fills are worst-queue conservative.
- Smoke cannot catch latency-race bugs AND cannot demonstrate RARE
  fill modes; smoke alone cannot demonstrate mechanism ACTIVATION —
  pair a small local A/B (dose vs 0). E-053 used 30-mkt sequential
  pair 1066/1067 (flag covers 31% of S flow — visible).
- Schema refines AND engine constraints (OrderManager validation)
  can invalidate a frozen grid corner — check every cell when
  freezing (GTD expiry < now+60s rejected; ttlSec ≥ 61).
- A completed run with 0 trades and noActivity=N can mean every
  order was REJECTED — check OrderManager validation before blaming
  data. High noActivity can also be the market slice.
- The backtest sim is NOT bit-deterministic (latency jitter); a
  per-market pnl diff between two runs is NOT proof a mechanism
  engaged.
- leadPersistTicks is in TICKS (~138/s on active markets).
- Feed-declaring strategies: workers fulfill binance+priceToBeat
  (diag 1006). 96 of the 10,747 universe markets have NO strike
  anywhere — deterministic set; compare on common played intersection
  (pair-v17.md §6.2).
- **Fill-time vs quote-time bias (contested.ts note):** features
  measured at FILL time overstate what a QUOTE-time gate can see — a
  NULL kills a fortiori; a positive needs capture measurement.
  §21.4 measured E-053's capture directly: near-full (0.968 at 1s).

## Inbox processed through

2026-07-31T16:46:43.750Z-82e89da5 (no newer entries at s46 start).
