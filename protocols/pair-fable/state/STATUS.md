# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-08-01T05:20Z (mission-02 session 39, mid-session checkpoint after 13-row readout + E-049 submit)

## HEADLINE STATE (read this first)

**s39 read all 13 in-flight rows vs reference 1029 (drain 05:02Z;
integrity clean everywhere: 96-slug identical failure set, all pairs
10,651). Verdicts (frozen bars, B_full 0.74):**

- **E-047 v17t (clock-ramp late tighten): LATE-TIGHTEN-LIVE**, dose
  monotone to grid edge: +0.653 / +1.223 / **+2.179** (k012=1043, ev
  −5.89). First axis EVER to improve p/100 at FULL (−5.91 → −5.39).
  pair-v17t.md §7.
- **E-048 v17o (state-gate tighten): STATE-GATE-LIVE**, dose monotone:
  +0.762 / +1.368 / **+2.317** (k012=1040, ev **−5.75 = new best FULL
  on record**). Sticky FLAT (+0.202 paired). Engagement 62% post-5
  flagged-S suppression (bar 20%), false-flag ≈ 0, NO C/D taker leak
  (doom→lock migration, spend $599k < $687k baseline).
  **v17t ≡ v17o at k012 (paired −0.138 ± 0.188)** — state ≈ clock at
  this center (near-universal flag). pair-v17o.md §12.
- **E-045b p90: P*-CONT** (+1.620 ± 0.202; ev −6.45) — P* monotonicity
  continues at schema floor 0.90; schema touch deferred to E-049's
  composition read. pair-v17.md §15.
- **E-046 maker-tilt dose/persistence at bps10/0.92: NO TILT-EV-REAL-92**
  (best t160 +0.695 < 0.74), DOSE-FLAT, PERSIST-FLAT; engagement real
  but HALF-STARVED (split 61.6→59.0, residue win% 73.8%, residue 667 ≪
  1,226 expectation). **Directional acquisition program CLOSED at ev
  under frozen bars** (taker E-038/E-041, width E-043, maker
  E-044/E-046) pending a NEW conditioning lever. Starvation follow-up
  recorded, not taken (pairs cost binds, not signal quality).
  pair-v17m.md §8. t40dup noise: Δ −0.007, sd 21.54 — instrument
  re-validated.

**Standing references: 1029 (v17 τ0 P*0.92) remains the comparison
reference; 1040 (v17o k012, −5.75) is the best FULL ev on record;
1043 (v17t k012, −5.89), 1039 (v17 p90, −6.45).** Neutral program is
priority-1-led again: tighten axes LIVE with genuinely open dose/
composition questions.

**IN FLIGHT (E-049, frozen pair-v17t.md §8 BEFORE submission at
f406e9c; submitted s39 05:13–05:16Z; 4 × 10,747 @ 140/20, B=500;
queue verified 05:17Z: 4 aggregates waiting-children, ~43k market
jobs ⇒ drain ≈06:25Z; s39 may still read them, else next session
reads FIRST — do NOT resubmit):**

| cell | strategy | key params (rest = 1029 center) | batchUid |
|---|---|---|---|
| k016 | pair-fable-v17t | P*.92 lateTighten .16 | pf-e049-k016-20260801T051339-op8bk9 |
| k020 | pair-fable-v17t | P*.92 lateTighten .20 (schema max) | pf-e049-k020-20260801T051425-9ymu0l |
| p90k012 | pair-fable-v17t | P*.90 lateTighten .12 | pf-e049-p90k012-20260801T051512-shuzbm |
| ok020 | pair-fable-v17o | P*.92 oTighten .20 | pf-e049-ok020-20260801T051559-hscwsy |

E-049 bars (frozen, pair-v17t.md §8): DOSE-CONT/SAT/OVER (k020 vs
1043; k016 locates any peak), COMPOSE-ADD/REDUNDANT (p90k012 vs 1039
and vs 1043), REDUNDANT-AT-MAX/STATE-ADDS (ok020 vs k020 paired).
Mechanism metrics: anatomy per cell, C+D $ vs $687.3k leak rule,
noActivity (participation collapse watch — k012 already 3,030).
Post-readout mandatory: loss identity on the best cell — pre-grace S
toxicity (−26.6k at 1040) is the emerging next frontier (needs its own
non-equivalence argument vs E-027 before any build).

## Current work

**Session 39 (01:54Z–, long session by design):** drain-blocked at
start (13 rows, drain 05:02Z) with only 11 sessions left in budget ⇒
stayed alive through the drain (background watcher + blocking waits),
executed the full 13-row readout (integrity → paired deltas →
mechanism metrics → frozen mappings), froze + submitted E-049, and is
now waiting on the E-049 drain (~06:25Z) to read it too. All frozen-
readout inputs from s36–s38 were used as calibrated (engagement
baseline 61.6/38.4, residue expectation 1,226, C/D $687.3k — every one
bound in a verdict). Readout checklist scratch file deleted after use.

## Audit note

M1–M5 implemented and verified at 4809a8e (s26 correction stands).

**Next audit: s40 (covers s35–s39), due BEFORE new research in s40.**
Gate summary for it: s35 GREEN (E-046 freeze+submit + audit), s36
GREEN (mission-metric replication on 1029, drain-blocked declared),
s37 GREEN (frozen-readout input calibration, drain-blocked declared),
s38 GREEN (loss identity + C/D baseline, drain-blocked declared), s39
GREEN (13-row readout closing E-045b/E-046/E-047/E-048 + E-049
freeze+submit). Five-session plan item check (s35 plan): (1) E-046
frozen+submitted ✓ (s35), (2) 13 rows read with frozen mappings ✓
(s39), (3) v17t/v17o follow-up ✓ (E-049), (4) E-045b/E-046 follow-up ✓
(folded into E-049 + directional close), (5) ≤1 YELLOW ✓ (zero).

### Five-session audit s30–s34 (done in s35) — PASS

(Full text in git history at dace65a; summary: 5 GREEN / 0 YELLOW / 0
RED, all time-to-evidence PASS, 3 experiments closed + 2 grids frozen
+ 2 strategies built, scale check closed by E-036 on record, no
premature closures; plan items all satisfied through s39.)

## Next step (priority order)

1. **Read E-049** (4 rows, drain ≈06:25Z; batchUids above): integrity
   (96-set, pairs 10,651), paired deltas per the §8 bar table, anatomy
   mechanism metrics, apply frozen mappings. If s39 is still alive it
   does this; otherwise next session, FIRST.
2. **Apply E-049 decisions:** operating-point selection on the tighten
   axis; COMPOSE-ADD ⇒ pairTarget schema-floor touch grid;
   REDUNDANT-AT-MAX ⇒ drop v17o iteration, v17t sole carrier.
3. **Loss identity on the new best cell** (mandatory per §8): pre-grace
   S toxicity is the next mechanism frontier — design needs a
   non-equivalence argument vs E-027 (binary start gating) before any
   build.
4. **P-013 (needs human):** sell-side mirror scope ruling (PROPOSALS).
5. Cross-symbol replication: gated on P-012.

## Alignment gate — session 39 (final)

- **Classification:** neutral-controller (13-row readout: 8 of 13 rows
  neutral axes; E-049 freeze+submit) + directional-controller close
  (E-046 verdict applied per frozen mapping).
- **Contribution (controller decision changed):** four experiments
  closed with frozen bars — the neutral controller gained its first
  two LIVE mechanism axes since the P* level (both dose-monotone at
  the grid edge, k012 = new best FULL ev −5.75, first p/100 gain at
  FULL), the P* floor probe read P*-CONT, and the directional
  acquisition program closed at ev (E-046 ALL-NULL with engagement
  evidence). Mapped follow-up E-049 frozen BEFORE submission
  (f406e9c) and submitted whole-grid. Evidence: pair-v17t.md §7/§8,
  pair-v17o.md §12, pair-v17.md §15, pair-v17m.md §8, LEDGER
  E-045b–E-049, runs 1031–1043.
- **Time to evidence:** min 1 (fleet verify), min ~3 sibling check,
  min ~8 checklist bank; drain-blocked by 13 in-flight rows until
  05:02Z (verified continuously by watcher — genuinely blocked, used
  for readout prep), then full readout executed immediately. PASS.
- **Throughput:** 13 FULL rows read + verdicts applied; 4 FULL cells
  frozen + submitted (43k market jobs, queue-verified); ~25 read-only
  DB queries + 7 anatomy runs; 1 background watcher (declared; the
  wait WAS the drain — no fleet capacity existed for more).
- **Scale:** closed by E-036 on record; all cells B=500.
- **Next:** read E-049 (this session if drain permits, else next),
  apply mappings — GREEN neutral evaluation either way.
- **Verdict:** **GREEN.**
- Verdict history: s31–s39 all GREEN. Next audit: s40 (s35–s39).

## Blockers

None. E-049 in flight (table above), drain ≈06:25Z.

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
  commits (through s39: only protocol/harness commits moved HEAD).
- **Sibling labs:** `protocols/pair-opus` — reads allowed both ways
  (inbox c68ea4ce); s39 check: still no results (memory/ =
  PRIOR-WORK.md + capabilities only).
- Queue submissions require a CLEAN tree pushed to origin/main (push
  via `git push origin HEAD:main`); commit state snapshots before
  submitting. If push is rejected (sibling labs push too), rebase
  then push — check what the rebase pulled.
- **zsh does NOT word-split unquoted variables** — submit grids as
  one LITERAL command per config (inbox c841c329; bit again in s39 on
  a `set -- $var` loop — write literals). `echo ===` breaks zsh.
  Always keep stderr. run-backtest.ts: `--latest` is a BOOL; market
  count goes in `--limit N`. Capture the batchUid line from EVERY
  submit.
- Verify with fleet.ts after every detached batch; count aggregate
  jobs (waiting-children), not market-job totals. Rows land at FULL
  queue drain (s32 model, re-confirmed s39: 13 rows created 04:57–
  04:58Z as the last children settled).
- Do not push strategy-semantics changes while that strategy's jobs
  are queued/running — workers track origin/main; serialize push →
  submit. (E-049 pins pair.v17t.ts / pair.v17o.ts semantics while
  queued — do NOT touch either file until drain.)
- Screens baseline 874 (v0) and parents 872/873/879 valid ≤
  2026-08-06 (evaluator.md §Universes). FULL references: **standing
  comparison reference 1029 (v17 τ0 P*0.92, ev −8.07); best FULL on
  record 1040 (v17o k012, −5.75); 1043 (v17t k012, −5.89); 1039 (p90,
  −6.45); older: g0=1008 (P*0.96), g3=1009 (best tilt at 0.96),
  m10=1026.** v15 bridge chain 970 ≡ 960 ≡ 956; v16 bridges c0=978,
  d0=987.
- **NOISE MODEL: FULL-pair instrument at B=500 — same-config paired
  sd 21.5–38.3 (E-041: 0.21 dup Δ; s39: 0.007 dup Δ), SE_pair
  0.19–0.24 on 10,651, ev bar B_full = 0.74. Cross-config paired sd
  larger (22–66). Pinned-800/B500 single-run ev SE ≈ 1.2 — structure
  screens only. p/100 bar 0.54 for screens.**
- JOURNAL entries are messages to the human (contract v2): plain
  sentences, tried/happened/means/next, drop run ids/codes unless
  genuinely the point.
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329), verify queue depth after.
- Class kills need an identity argument (evaluator.md §Kill
  standards); N failures kill a family only. Verdict bars must name
  comparison PAIRS. Positive signals measured ON discovery data need
  disjoint confirmation before any build decision.
- Fill model: calibrated by E-025 (ToB capacity bound). Guard-7
  whole-size fill optimism: larger-q results depth-optimistic
  (E-036). Maker-tilt fills are worst-queue conservative.
- Sibling-memory recheck at session start (`ls protocols/*/memory`).
- Smoke cannot catch latency-race bugs AND cannot demonstrate RARE
  fill modes (escalate to a 200-mkt Stage B instead).
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

## Inbox processed through

2026-07-31T16:46:43.750Z-82e89da5 (no newer entries at s39 start).
