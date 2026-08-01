# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-08-01T08:15Z (mission-02 session 41 checkpoint — E-051 IN FLIGHT)

## IN FLIGHT (s41, submitted 07:58–08:00Z, commitSha 7e5f9276)

E-051 earlyTighten grid, 4 FULL cells (design frozen pair-v17t.md §14
BEFORE submission; smoke 1053 PASS):

- e03 = pf-e051-e03-20260801T075801-31yzgb
- e06 = pf-e051-e06-20260801T075837-ep5wq3
- e09 = pf-e051-e09-20260801T075917-8asz8i
- p86k020 = pf-e051-p86k020-20260801T075955-k0szf5

Verified 4 aggregate waiting-children at 08:00Z; workers on sha
7e5f927; drain expected ~09:05Z. **Resume:** rows land at full drain —
recover run ids via `backtest_runs.batch_uid` (results.ts --batch-uid
<uid>), then apply the §14 frozen bars (B_full 0.74, paired vs 1052 on
the 10,651 common set; degeneracy check: m0–4 S fills at highest read
dose ≥ 25% of 1052's m0–4 level = 348,400 shares → use the §15 minute
histogram; 1052 m0–4 S fills = 1853+603+564+502+462 = 3,984 of 6,658).
Loss identity on 1052 DONE (§15).

## HEADLINE STATE (read this first)

**s40: five-session audit s35–s39 PASS (see Audit note), then E-050
frozen → submitted → read at drain 07:47Z in the same session.
Integrity clean everywhere (96-slug identical failure set, all pairs
10,651, commitSha f0f87f19). Verdicts (frozen bars, B_full 0.74;
pair-v17t.md §13):**

- **E-027 identity guard (pair-v17t.md §10):** lateTighten > 0.20 is
  LEGITIMATE — it remains a price rule (never keys participation on
  minute), with a frozen DEGENERATE tripwire. Schema lifted:
  pairTarget floor 0.90→0.85, lateTighten max 0.20→0.32
  (bounds-only edit, behavior-identical at old params).
- **E-050 P*-CONT-88:** p88k012(1049) − 1046 = +0.998 ± 0.170 — the
  P* floor axis continues below 0.90. Curve decaying: second step
  p86−p88 = +0.660 sub-bar.
- **E-050 COMPOSE-MAX-ADD:** p90k020(1051) beats both parents (+0.975
  / +0.821) BUT loses to p88k012 (−0.177) — the P* lever currently
  outranks the k extension.
- **E-050 LIFT-CONT (marginal):** k028(1050) − k020(1047) = +0.744 =
  exactly the bar; degeneracy check PASS (min-4–11 S fills 72.7% of
  k020's, bar 25% — still repricing, not gating). k axis open but
  low-priority.
- **NEW BEST FULL: 1052 (v17t P*0.86 k012) ev −3.17, p/100 −5.05.**
  Chain: 1049 (−3.83), 1051 (−4.00), 1050 (−4.23), 1046 (−4.83).
  Two-session arc −8.07 → −3.17 (61% of per-market loss removed). No
  C/D leak (max $522k < $687.3k rule). Cost: noActivity 5,308 = 50%
  of universe unplayed at 1052 — participation keeps shrinking; the
  absolute-profit target needs the remaining flow made profitable.
- **Residual-loss anatomy on 1046 (pair-v17t.md §12):** loss frontier
  moved to the ENTRY window — minutes 0–4 carry 57% of gross S loss
  (minute 0 alone −$10.1k on 29% of S volume); favorite-side fills
  (p ≥ 0.50) worst per share in both phases; conditional toxicity
  U-shaped in time ⇒ **earlyTighten** (decaying concession, mirror of
  lateTighten) recorded as the candidate next mechanism — design not
  frozen yet.

**Standing references: comparison reference stays 1029 (v17 τ0 P*0.92,
ev −8.07) until a re-center decision; best FULL on record 1052
(−3.17).** Neutral program is priority-1-led: P* floor + k dose both
still open but per-step gains at/below bar; the genuinely untested df
is the early-window concession. **NOTHING in flight** (drain verified
07:47Z by watcher).

## Current work

**Session 40 (06:25–08:10Z):** closed loop — audit s35–s39 PASS →
E-027 identity guard (§10) → schema-bounds edit + protocol:check +
smoke → E-050 frozen (§11, f0f87f1) → 4 FULL cells submitted → 1046
residual anatomy (§12) while draining → drain 07:47Z → full readout +
verdicts applied (§13). E-050 rows: 1049/1050/1051/1052. Nothing in
flight at close.

## Audit note

M1–M5 implemented and verified at 4809a8e (s26 correction stands).

### Five-session audit s35–s39 (done in s40, BEFORE new research) — PASS

- **Gates:** 5 GREEN / 0 YELLOW / 0 RED; all five gates present in
  STATUS history with evidence pointers (commits 1c5f02e, 1d7518a,
  6670bd7, dace65a, fec522b). Classifications: s35
  neutral+directional (E-046 freeze/submit + s30–s34 audit), s36–s38
  neutral-controller analysis (drain-blocked, declared analysis-only
  per mission §6.2 — no fleet capacity existed; each produced
  calibrated inputs later BOUND in s39 verdicts, so they were
  controller work, not recap), s39 neutral readout + directional
  close.
- **Time to evidence:** 5/5 PASS per recorded gates (min 1–8 first
  actions).
- **Throughput:** 17 FULL rows read and verdict-bound in the span
  (runs 1031–1047; 13 carried from s34/s35 submissions, 4 E-049 rows
  submitted AND read in s39); 5 experiments closed with frozen bars
  (E-045b, E-046, E-047, E-048, E-049); universe 10,747 / pairs
  10,651 everywhere; all B=500.
- **Open primary requirements:** scale check remains CLOSED on record
  (E-036 — $2,000 tested, 500–1,000 matched reached, depth-optimism
  caveat P-009/P-010 carried); directional controller ACTIVELY tested
  (E-046) and closed at ev under frozen bars with an explicit reopen
  condition (new conditioning lever) — lever-scoped, not a silent
  class kill, consistent with evaluator.md §Kill standards; neutral
  priority-1 lead is legitimate (tighten dose/floor axes measured
  LIVE and still open at grid/schema edges).
- **Premature closures:** none found. The one class-adjacent phrase
  ("directional acquisition program CLOSED at ev") names its frozen
  bars, its evidence set (E-038/E-041/E-043/E-044/E-046), and its
  reopen condition.
- **Controller progress in span:** FULL neutral ev −8.07 → −4.83
  (1029 → 1046), p/100 −5.91 → −5.33 — the first per-dollar gains on
  record.
- **Next-five plan (s40–s44):** (1) s40 identity-guard analysis +
  pairTarget/lateTighten schema touch + E-050 grid freeze/submit
  (GREEN neutral); (2) s41 E-050 readout + verdicts (GREEN); (3) s42
  loss identity on the new best cell + pre-grace S-toxicity mechanism
  design with non-equivalence argument (GREEN analysis); (4) s43
  next-mechanism build + smoke + submit (GREEN); (5) s44 readout;
  directional revisit only if a new conditioning lever emerged.
  ≥3 GREEN ✓; ≤1 supporting diagnostic ✓.

### Five-session audit s30–s34 (done in s35) — PASS

(Full text in git history at dace65a; summary: 5 GREEN / 0 YELLOW / 0
RED, all time-to-evidence PASS, 3 experiments closed + 2 grids frozen
+ 2 strategies built, scale check closed by E-036 on record, no
premature closures; plan items all satisfied through s39.)

## Next step (priority order)

1. **earlyTighten design + freeze + build (GREEN neutral, s41):** the
   §12 anatomy motivates a decaying entry-window concession
   k_e·(1 − elapsed/15m) on the maker quote cap (mirror of
   lateTighten; V-shaped total concession). Needs: proper
   non-equivalence argument at design freeze (vs E-027 — same §10
   price-rule argument; vs P* — time-shaped, not uniform; vs
   lateTighten — opposite slope), then new param in pair.v17t.ts (or a
   sibling file), protocol:check + smoke + activation, grid frozen
   BEFORE submission on the 1052/1049 centers. Consider riding a
   small composition probe (p86k020 / p88k020) in the same batch —
   bars frozen at design time.
2. **Loss identity on 1052** (owed at first use as reference, §8
   rule) — fold into the earlyTighten design evidence.
3. Open-but-unscheduled: P* floor < 0.85 (per-step decaying), k >
   0.28 (marginal at bar) — revisit only with a composition reason.
4. **P-013 (needs human):** sell-side mirror scope ruling (PROPOSALS).
5. Cross-symbol replication: gated on P-012.

## Alignment gate — session 40 (final)

- **Classification:** neutral-controller (audit + E-050 freeze/submit/
  readout + residual anatomy — all on the neutral tighten/P* axes).
- **Contribution (controller decision changed):** five-session audit
  s35–s39 PASS (mission §7.2, done before new research); E-027
  identity guard written and applied (schema lift ruled legitimate
  with a frozen degeneracy tripwire — pair-v17t.md §10); E-050
  frozen, submitted, and read in-session: P*-CONT-88, COMPOSE-MAX-ADD
  (composed corner loses to deeper floor), LIFT-CONT-marginal with
  degeneracy PASS. Controller operating point moved 1046 → **1052
  (P*0.86 k012, ev −3.17, new best FULL)**. Next mechanism identified
  from measurement, not speculation: residual loss is 57%
  entry-window (§12) ⇒ earlyTighten. Evidence: pair-v17t.md
  §10–§13, LEDGER E-050, runs 1049–1052, commits f0f87f1/d6bd74a.
- **Time to evidence:** min ~4 state recovered, min ~12 audit written
  (mandated pre-research), first substantive action (protocol:check +
  schema edit chain) by min ~15, smoke PASS by min ~20, grid
  submitted by min ~13-of-research-time. PASS (audit is §7.2-mandated
  and preempts the 10-min clock; the first post-audit evidence action
  landed inside 10 minutes of research start).
- **Throughput:** 4 FULL runs submitted AND read (10,747 mkts each,
  B=500); 1 experiment closed (E-050, 3 axes); 1 analysis product
  (1046 residual anatomy); ~10 read-only DB queries; 1 background
  drain watcher + foreground holds (declared; the wait WAS the drain).
- **Scale:** closed by E-036 on record; all cells B=500.
- **Next:** earlyTighten design freeze + build + grid (GREEN
  neutral-controller).
- **Verdict:** **GREEN.**
- Verdict history: s31–s40 all GREEN. Next audit: s45 (s40–s44).

## Blockers

None. NOTHING in flight — the queue is empty (verified 06:26Z drain).

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
  submit. (All pins RELEASED at the 06:26Z drain — queue empty;
  pair.v17t.ts may be edited for the floor/lift schema touches.)
- Screens baseline 874 (v0) and parents 872/873/879 valid ≤
  2026-08-06 (evaluator.md §Universes). FULL references: **standing
  comparison reference 1029 (v17 τ0 P*0.92, ev −8.07); best FULL on
  record 1052 (v17t P*0.86 k012, −3.17); chain 1049 (−3.83), 1051
  (−4.00), 1050 (−4.23), 1046 (−4.83), 1047 (−4.98), 1043 (−5.89),
  1039 (p90, −6.45); older: g0=1008 (P*0.96), g3=1009 (best tilt at
  0.96), m10=1026.** v15 bridge chain 970 ≡ 960 ≡ 956; v16 bridges
  c0=978, d0=987.
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
