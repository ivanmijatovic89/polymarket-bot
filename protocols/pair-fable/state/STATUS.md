# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-08-01T10:35Z (mission-02 session 44 close — E-052 still draining, §21 disagreement lever found)

## IN FLIGHT (read first — s45 owes this readout)

**E-052 (lateBandTighten) FULL grid, submitted s43 09:26–09:29Z at
commitSha 94a077cd. NOT drained at s44 close (10:30Z): lb04 PRIMARY at
10,651/10,747 markets (its last 96 jobs sit behind the other batches
in the shared FIFO; row lands when they run + aggregate), dup at
~3.5k, lb08/lb12 not started. Observed pace s44: ~149 market-jobs/min
(3.6× slower than the s42 1h-drain model — 27 active workers, cause
unknown, fleet healthy 31/31). Projected full-grid drain ≈ 13:30Z
2026-08-01.**

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

**Session 44 (~09:37–10:35Z):** fleet check (not drained) → §20/§16
known-answer reproduction → gross S-EV matrix by phase×band → new
tool doomhazard.ts (per-S-fill spot join, 112 day files, ~3 min
serial DuckDB scan — foreground, not fleet-shardable) → quartile +
split-half + binary-threshold analyses (per-fill dump at
/tmp/dh1052.json, offline cuts) → §21 written → E-052 readout
deferred to s45 (drain ≈13:30Z).

## Audit note

M1–M5 implemented and verified at 4809a8e (s26 correction stands).

### Five-session audit s35–s39 (done in s40) — PASS. **Next audit: s45
### (s40–s44) — DUE BEFORE new research in s45.**

- Next-five plan progress: (1) s40 GREEN ✓; (2) s41 GREEN ✓; (3) s42
  GREEN ✓; (4) s43 GREEN ✓; (5) s44 YELLOW (readout blocked by slow
  drain; controller-math analysis instead). ≥3 GREEN satisfied ✓.

## Next step (priority order)

1. **s45 first: five-session audit s40–s44** (mission §7.2) — before
   new research.
2. **s45 (GREEN neutral-controller): E-052 readout** under the frozen
   §19 bars (see IN FLIGHT). Integrity first (common set 10,651,
   identical 96-slug failure set, latency 140/20, engine SHA — s43/s44
   commits are protocol-only). Then verdict + channel decomposition +
   LEDGER E-052 row.
3. **Then E-053 freeze (disagreeTighten, §21.3)** — spot-disagreement
   maker concession on the S quote; compose with the E-052 verdict;
   §18 kept-flow bar PRIMARY + both-granularity degeneracy tripwires
   (flag covers 53% of S fills — extinction is the dominant risk;
   conservative first cell at threshold −5 = 31% of fills). This is
   the "genuinely new conditioning lever" the E-046 directional
   closure was pending, but quote-side dosing comes first
   (priority 1); the directional reopen on this feature is a later,
   separate freeze.
4. Open-but-unscheduled: P* floor < 0.85, k > 0.28 (decaying sub-bar
   avoidance channels — composition reason required to reopen).
5. **P-013 (needs human):** sell-side mirror scope ruling (PROPOSALS).
6. Cross-symbol replication: gated on P-012.

## Alignment gate — session 44 (final)

- **Classification:** supporting-diagnostic (controller-math anatomy
  on the controller's own reference run; no controller code touched —
  E-052 was already in flight, and its readout could not run because
  the fleet drain ran 3.6× slower than the standing model).
- **Contribution (controller decision changed):** (a) the "refuse the
  doomed start leg" mechanism family is measured dead a fortiori
  (doom flat across every quote-time observable within price bands) —
  removes the §20-implied attack from the backlog before a design was
  wasted on it; (b) E-053's lever (spot-vs-book disagreement) is
  discovered, split-half replicated, and shown orthogonal to E-052's
  band (survives in untouched flow) — the next freeze after the
  E-052 verdict is now fully specified in §21.3. Evidence:
  pair-v17t.md §21, tools/doomhazard.ts, this session's tool outputs.
- **Time to evidence:** min ~1 fleet check; min ~8 first data query
  (pathway reproduction with known-answer checks). PASS.
- **Throughput:** 0 fleet submissions (correctly: E-053 must wait for
  the E-052 verdict; queue is fully loaded with E-052). 4 local
  serial scans ~3 min each (doomhazard.ts full + 2 halves + dump;
  serial constraint recorded: DuckDB day-file scan, memory-bound,
  fleet runs only backtest jobs) + ~6 SQL/offline analyses.
- **Scale:** closed by E-036 on record; unchanged this session.
- **Next:** s45 — five-session audit, then E-052 readout (GREEN
  neutral-controller), then E-053 freeze per §21.3.
- **Verdict:** **YELLOW** (one supporting diagnostic that directly
  informs controller math; next session must be GREEN and is — the
  E-052 readout).
- Verdict history: s31–s43 GREEN, s44 YELLOW. Next audit: s45
  (s40–s44).

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
  queue drain (s32 model) — **but the s42 "≈1h from submit" pace is
  NOT reliable: s44 observed ~149 jobs/min (~3.6× slower) with a
  healthy fleet; project drain from observed pace, not the model.**
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
