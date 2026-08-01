# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-08-01T10:05Z (mission-02 session 45 close — audit PASS, readout machinery verified, grid still draining)

## IN FLIGHT (read first — s46 owes this readout, ~minutes after start)

**E-052 (lateBandTighten) FULL grid, submitted s43 09:26–09:29Z at
commitSha 94a077cd. At s45 close (10:04Z): 23.2k market-jobs waiting,
observed pace ~450–650 jobs/min ⇒ projected full drain ≈ 10:45–10:55Z
2026-08-01. (s44's "13:30Z, fleet 3.6× slow" projection was a clock
misread — see audit correction. Fleet healthy, pace normal.)
lb04 PRIMARY complete except its last 96 jobs (the known no-strike
failure set) which sit at the FIFO tail; rows land at full drain.**

**s45 STAGED THE ENTIRE READOUT — s46 executes it immediately:**

1. `npx tsx protocols/pair-fable/tools/fleet.ts` → expect 0 waiting,
   0 waiting-children, 4 batches gone.
2. Map batchUids → run ids: sql.ts `SELECT id,batch_uid,status FROM
   backtest_runs WHERE batch_uid LIKE 'pf-e052-%'` (ignore act-*
   1059/1060).
3. Integrity: results.ts per run — markets 10,651+96 failures
   (identical set), latency 140/20 from cmd, B=500. Engine-SHA: VERIFIED
   s45 — 94a077c..9965b92 touches only protocols/pair-fable/** (M4 ok).
4. Paired Δev vs 1052: compare.ts `--runs 1052,<lb04>,<lb08>,<lb12>`
   (+ dup for noise only). Bar B_full 0.74.
5. Kept-flow channel (PRIMARY, §18): the §17 cross-tab SQL — VERIFIED
   s45, reproduces §18 e06 channels exactly (kept 3,032/−$273; dropped
   2,311/+$15.7k; new 1,318/−$8.1k on 1057 vs 1052). K_bar +$4.0k;
   dup-vs-primary lb04 kept-flow Δ validates the $2.2k noise scale.
6. Degeneracy + watch metrics: `npx tsx protocols/pair-fable/tools/
   e052metrics.ts --run <ids>` (NEW tool, known-answer PASS on 1052:
   inBandLateS 1091, noActivity 5308, flipPool 719, S 6658, C+D
   $417.6k, fees $7.2k, inBandAvgPx 0.5218). Bars: highest dose
   inBandLateS ≥ 273 AND noActivity growth ≤ +360.
7. Verdict per §19 map (REPRICE-CONT / AVOID-CLOSE / AMBIG /
   NULL / KEPT-SIGNAL / OVER / DEGENERATE) + LEDGER E-052 row +
   §19 READOUT section in pair-v17t.md.
8. Then E-053 freeze per §21.3 (fresh base numbers, compose with the
   E-052 verdict, §18 channel bar PRIMARY, both-granularity
   degeneracy, partial-capture sizing).**

- lb04 PRIMARY = `pf-e052-lb04-20260801T092631-4q77rc`
- lb04 DUP (noise-only, designated pre-results — kept-flow noise
  replicate ONLY, not a second chance at bars) =
  `pf-e052-lb04-20260801T092713-lc3gla`
- lb08 = `pf-e052-lb08-20260801T092843-dy3e3n`
- lb12 = `pf-e052-lb12-20260801T092929-r0rm39`

Resume: `npx tsx protocols/pair-fable/tools/fleet.ts` (aggregate
waiting-children → 0), map batchUids → run ids via sql.ts
(`SELECT id,batch_uid FROM backtest_runs WHERE batch_uid LIKE
'pf-e052-lb%'` — beware the act-* rows 1059/1060 are the s43 local
activation runs, NOT cells), read under the FROZEN §19 bars
(pair-v17t.md §19): paired Δev vs 1052 on the 10,651 common set (bar
0.74) AND kept-flow paired Δpnl (§17 method) K_bar +$4.0k PRIMARY;
degeneracy at BOTH granularities (late ≥0.40 S fills ≥ 273 = 25% of
1,091 at highest dose; noActivity growth ≤ +360 vs 5,308). Verdicts
REPRICE-CONT / AVOID-CLOSE / AMBIG (dup-confirm rule) / NULL /
KEPT-SIGNAL / OVER / DEGENERATE — §19.

## HEADLINE STATE

**s44 (while E-052 drained): §21 anatomy on 1052 (pair-v17t.md §21,
new tool tools/doomhazard.ts). Two results: (1) the doom pathway is
NOT identifiable at quote time by ANY observable tried — price,
minute, spot-vs-strike distance, drift; doom fraction is flat across
feature quartiles within every price band; "refuse the doomed start
leg" is dead a fortiori (fill-time features overstate quote-time
power). (2) NEW LEVER, replicated: spot-vs-book DISAGREEMENT — S
fills taken while the filled side is NOT behind on spot (advBps ≤ 0)
run −5.5¢/sh vs −1.9¢/sh for spot-confirmed fills; 8/8 band×half
split-half cells agree; 53% of S fills carry −$19.4k of the −$25.2k
gross S loss; survives inside E-052-untouched flow (late<0.40 and
early<0.40, both halves). Computable live from feeds v17t already
declares (binanceWsSpotPrice + priceToBeat). E-053 sketch in §21.3 —
freeze only AFTER the E-052 verdict (composition + §18 bars).**

**Records:** best FULL ev 1056 (−2.37, avoidance dose — not the
mechanism center); MECHANISM-TEST CENTER 1052 (P*0.86 k012, −3.17);
standing comparison reference 1029 (−8.07).
Channel-bar law (§18): ev gains with kept-flow ≤ 0 close their axis;
avoidance is bounded above by ev = 0.

## Current work

**Session 45 (09:52–10:05Z, cut short by harness session-close
enforcement):** five-session audit s40–s44 PASS (recorded above) →
clock-misread correction (real drain ≈10:50Z, not 13:30Z) → engine-SHA
identity verified for the E-052 comparison → readout machinery built
and known-answer-verified (e052metrics.ts + §17 kept-flow SQL, both
exact against recorded 1052/1057 numbers) → grid NOT yet drained at
forced close; full readout recipe staged in IN FLIGHT for s46.

## Audit note

M1–M5 implemented and verified at 4809a8e (s26 correction stands).

### Five-session audit s40–s44 (done in s45, before new research) — PASS
### with one bookkeeping correction. Next audit: s50 (s45–s49).

- **Counts:** 4 GREEN (s40 E-050 freeze+submit+readout → center 1052;
  s41 E-051 freeze+implement+submit; s42 E-051 readout EARLY-NULL +
  §18 channel-bar law; s43 E-052 freeze+implement+submit), 1 YELLOW
  (s44 §21 anatomy — single diagnostic, next-GREEN rule honored by
  this session's E-052 readout). 0 RED, no consecutive YELLOWs.
- **Time to evidence:** all five gates recorded PASS (≤10 min first
  action; verified against commit timestamps).
- **Throughput:** 3 frozen experiment grids (E-050/E-051/E-052), 12
  FULL-universe batches ≈ 129k market-jobs, whole-grid-up-front per
  c841c329; drain wait consistently spent on controller-math analyses
  (§12, §15–§17, §20, §21). One serial local scan (doomhazard.ts,
  ~3 min, DuckDB memory-bound — constraint recorded pre-launch).
- **Open primary requirements:** $2,000/matched-share checks remain
  closed by E-036 (P-009/P-010 caveat stands). Neutral controller: ev
  −8.07 → −3.17 mechanism center (best FULL −2.37) across the window,
  AND the §18 law now correctly discounts avoidance-driven gains.
  Directional controller (priority 2): correctly pending — §21's
  spot-disagreement lever is the "genuinely new conditioning feature"
  the E-046 closure required; quote-side dosing (E-053) first, then a
  separate directional freeze. No premature closures found: §20's
  backlog kill is direct measurement (D-leg fair), §21's doom kill is
  a-fortiori-valid (fill-time ⊇ quote-time power), E-018 stays
  withdrawn per ruling.
- **Correction (bookkeeping):** s44's "~149 jobs/min, 3.6× slower,
  drain 13:30Z" model was a CLOCK MISREAD — s44 used local time
  (UTC+2) as UTC, so ~15 real minutes looked like ~75. Real observed
  pace s45: ~640 jobs/min (16.7k jobs in 26 min), consistent with the
  s42 1h-drain model. Standing-guard note corrected below. Lesson:
  stamp session times from `date -u`, never from the shell prompt or
  assumed offsets.
- **Next-five plan (s45–s49):** (1) s45 E-052 readout under frozen §19
  bars — GREEN; (2) E-053 disagreeTighten freeze+implement+submit per
  §21.3 composed with the E-052 verdict — GREEN; (3) E-053 readout —
  GREEN; (4) composition/dose increment at the winning operating point
  OR the directional reopen on the disagreement feature (priority 2)
  — GREEN; (5) at most one supporting diagnostic if a readout demands
  decomposition. ≥3 direct GREEN controller increments by construction.

### Five-session audit s35–s39 (done in s40) — PASS.

## Next step (priority order)

1. **s46 (GREEN neutral-controller): E-052 readout** — the complete
   staged recipe is in IN FLIGHT above; drain should be long done.
   Verdict + channel decomposition + LEDGER E-052 row + §19 READOUT.
2. **Then E-053 freeze (disagreeTighten, §21.3)** — spot-disagreement
   maker concession on the S quote; compose with the E-052 verdict;
   §18 kept-flow bar PRIMARY + both-granularity degeneracy tripwires
   (flag covers 53% of S fills — extinction is the dominant risk;
   conservative first cell at threshold −5 = 31% of fills). This is
   the "genuinely new conditioning lever" the E-046 directional
   closure was pending, but quote-side dosing comes first
   (priority 1); the directional reopen on this feature is a later,
   separate freeze.
3. Open-but-unscheduled: P* floor < 0.85, k > 0.28 (decaying sub-bar
   avoidance channels — composition reason required to reopen).
4. **P-013 (needs human):** sell-side mirror scope ruling (PROPOSALS).
5. Cross-symbol replication: gated on P-012.

## Alignment gate — session 45 (final)

- **Classification:** neutral-controller (the mandatory five-session
  audit, then the first steps of the E-052 readout itself: integrity
  verification + measurement-machinery known-answer checks on the
  controller's reference run. No diagnostic side-quest was started.)
- **Contribution (controller decision changed):** (a) audit s40–s44
  PASS recorded, incl. a real correction — the standing fleet-pace
  guard was based on a clock misread and is fixed (commit 9965b92);
  (b) E-052 readout integrity steps done: engine-SHA identity
  verified 94a077c..HEAD, e052metrics.ts + kept-flow SQL reproduce
  ALL freeze-time and §18 recorded numbers exactly — the §19 verdict
  is now a ~10-minute mechanical step for s46. No verdict yet: the
  grid (48k jobs) was still ~23k jobs from drain when the harness
  forced session close at ~13 min elapsed.
- **Time to evidence:** min ~1 (fleet check), min ~5 first data
  reproduction. PASS.
- **Throughput:** 0 new submissions (queue fully loaded with E-052;
  correct). 5 SQL/tool verifications, 1 new readout tool, audit.
  Session forcibly closed by the harness at ~13 min — the plan was to
  wait ~45 min in-session for drain; contract says record + continue
  instead.
- **Scale:** closed by E-036 on record; unchanged this session.
- **Next:** s46 — E-052 readout (GREEN neutral-controller, staged
  recipe in IN FLIGHT), then E-053 freeze per §21.3.
- **Verdict:** **GREEN** (borderline vs YELLOW, judged GREEN because
  every action this session WAS the controller test's own required
  process: the §7.2 audit and §19 readout steps 1–3 of the frozen
  bars; nothing diagnostic or unrelated ran. If the human reads this
  as YELLOW, note s44+s45 would then be consecutive YELLOWs — flagged
  rather than hidden; the substantive cause both times is the same
  single E-052 drain window, and s46 completes the GREEN readout.)
- Verdict history: s31–s43 GREEN, s44 YELLOW, s45 GREEN (borderline,
  see above). Next audit: s50 (s45–s49).

## Blockers

None. E-052 in flight is NOT a blocker (contract: record ids, return
continue). Do NOT edit pair.v17t.ts semantics while these jobs are
queued (workers track origin/main — serialize push→submit; jobs run at
94a077c).

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
  commits (through s44: only protocol/harness commits moved HEAD; s44
  commit touches only protocols/pair-fable/**).
- **Sibling labs:** `protocols/pair-opus` — reads allowed both ways
  (inbox c68ea4ce); s44 check: still no results (memory/ =
  PRIOR-WORK.md + capabilities only).
- Queue submissions require a CLEAN tree pushed to origin/main (push
  via `git push origin HEAD:main`); commit state snapshots before
  submitting. If push is rejected (sibling labs push too), rebase
  then push — check what the rebase pulled.
- **Submit-output guard (s43):** capture the batchUid line from EVERY
  submit — pipe through `grep "batchUid="`, NOT `tail`. A resubmit
  after a cut-off output DOUBLE-ENQUEUES (no cancel path in tooling);
  if it happens, designate the dup's role in writing BEFORE results
  land (E-046/E-052 precedent).
- **zsh does NOT word-split unquoted variables** — submit grids as
  one LITERAL command per config (inbox c841c329). `echo ===` breaks
  zsh. Always keep stderr. run-backtest.ts: `--latest` is a BOOL;
  market count goes in `--limit N`. Capture the batchUid per submit.
- Verify with fleet.ts after every detached batch; count aggregate
  jobs (waiting-children), not market-job totals. Rows land at FULL
  queue drain (s32 model, ≈1h/4-batch grid at ~450–650 jobs/min —
  re-validated s45). s44's "149 jobs/min, 3.6× slower" claim was a
  CLOCK MISREAD (local UTC+2 stamped as Z), not a real slowdown.
  **Stamp all session times from `date -u`, never the shell prompt.**
- Screens baseline 874 (v0) and parents 872/873/879 valid ≤
  2026-08-06 (evaluator.md §Universes). FULL references: **standing
  comparison reference 1029 (v17 τ0 P*0.92, ev −8.07); MECHANISM-TEST
  CENTER 1052 (v17t P*0.86 k012, −3.17); best FULL ev on record 1056
  (1052+e09 avoidance dose, −2.37); chain 1057 (−2.48), 1055 (−2.53),
  1054 (−2.89), 1049 (−3.83), 1051 (−4.00), 1050 (−4.23), 1046
  (−4.83), 1047 (−4.98), 1043 (−5.89); older: g0=1008, g3=1009,
  m10=1026.** v15 bridge chain 970 ≡ 960 ≡ 956; v16 bridges c0=978,
  d0=987. **Beware pf-e052-act-* rows 1059/1060 = local activation
  A/B, diagnostics only.**
- **NOISE MODEL: FULL-pair instrument at B=500 — same-config paired
  sd 21.5–38.3 (E-041: 0.21 dup Δ; s39: 0.007 dup Δ), SE_pair
  0.19–0.24 on 10,651, ev bar B_full = 0.74. Cross-config paired sd
  larger (22–66). Pinned-800/B500 single-run ev SE ≈ 1.2 — structure
  screens only. p/100 bar 0.54 for screens. Kept-flow channel noise ≈
  $2.2k total-pnl dup Δ ⇒ K_bar +$4.0k (§19).**
- **CHANNEL BAR (§18):** every future mechanism freeze on this family
  must include kept-flow paired Δpnl (played-in-both markets) as a
  PRIMARY success bar; ev gains with kept-flow ≤ 0 close their axis.
  Degeneracy tripwires must police market-level participation
  (noActivity), not only within-market fill counts. (E-052 §19 + the
  E-053 sketch §21.3 both carry this.)
- JOURNAL entries are messages to the human (contract v2): plain
  sentences, tried/happened/means/next, drop run ids/codes unless
  genuinely the point.
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329), verify queue depth after.
- Class kills need an identity argument (evaluator.md §Kill
  standards); N failures kill a family only. Verdict bars must name
  comparison PAIRS. Positive signals measured ON discovery data need
  disjoint confirmation before any build decision (§21 used
  split-half; the E-053 FULL run itself is the final confirm).
- Fill model: calibrated by E-025 (ToB capacity bound). Guard-7
  whole-size fill optimism: larger-q results depth-optimistic
  (E-036). Maker-tilt fills are worst-queue conservative.
- Sibling-memory recheck at session start (`ls protocols/*/memory`).
- Smoke cannot catch latency-race bugs AND cannot demonstrate RARE
  fill modes (escalate to a 200-mkt Stage B instead); smoke alone
  cannot demonstrate mechanism ACTIVATION — pair a small local A/B
  (dose vs 0) when the mechanism's fills are ≤~10% of flow (E-052
  used 30-mkt sequential pair 1059/1060).
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
- **Fill-time vs quote-time bias (contested.ts note, reused §21):**
  features measured at FILL time overstate what a QUOTE-time gate can
  see — a NULL kills a fortiori; a positive needs partial-capture
  sizing in the freeze bars.

## Inbox processed through

2026-07-31T16:46:43.750Z-82e89da5 (no newer entries at s44 start).
