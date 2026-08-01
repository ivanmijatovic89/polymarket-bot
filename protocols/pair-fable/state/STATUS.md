# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-08-01T09:50Z (mission-02 session 43 close — E-052 submitted, 4 batches in flight)

## IN FLIGHT (read first — s44 owes this readout)

**E-052 (lateBandTighten) FULL grid, submitted s43 09:26–09:29Z at
commitSha 94a077cd, all 4 verified waiting-children 09:30Z; drain ≈1h
from submit (s42 model). Rows land at FULL queue drain.**

- lb04 PRIMARY = `pf-e052-lb04-20260801T092631-4q77rc`
- lb04 DUP (noise-only, designated pre-results — kept-flow noise
  replicate ONLY, not a second chance at bars) =
  `pf-e052-lb04-20260801T092713-lc3gla`
- lb08 = `pf-e052-lb08-20260801T092843-dy3e3n`
- lb12 = `pf-e052-lb12-20260801T092929-r0rm39`

Resume: `npx tsx protocols/pair-fable/tools/fleet.ts` (count aggregate
waiting-children → 0), then map batchUids → run ids via results.ts /
sql.ts, read under the FROZEN §19 bars (pair-v17t.md §19): paired Δev
vs 1052 on the 10,651 common set (bar 0.74) AND kept-flow paired Δpnl
(§17 method) K_bar +$4.0k PRIMARY; degeneracy at BOTH granularities
(late ≥0.40 S fills ≥ 273 = 25% of 1,091 at highest dose; noActivity
growth ≤ +360 vs 5,308). Verdicts REPRICE-CONT / AVOID-CLOSE / AMBIG
(dup-confirm rule) / NULL / KEPT-SIGNAL / OVER / DEGENERATE — §19.

## HEADLINE STATE

**s43: E-052 frozen (9be384f BEFORE implementation), built (94a077c),
smoked (1058 PASS + activation A/B 1059/1060 — dosed late S fills
shift down, C/D un-dosed), submitted. Mechanism: flat extra concession
on any maker quote resting ≥0.40 from m5+ (LATE_BAND 0.40 and the m5
boundary are measurement-pinned design constants from §16). First
experiment carrying the §18 kept-flow channel bar as PRIMARY.**

**s43 while-draining analysis (§20, re-ranks the backlog):**
completion-pathway decomposition on 1052 — C-lock-only markets are
PROFITABLE (+18.87/mkt × 1,101), mixed +5.07, S-only +14.13; the
ENTIRE net loss is the 3,532 doom-only markets (−16.63/mkt). The D
leg itself is FAIR (0.826/sh avg for 82.08% share-weighted win rate,
−$2.2k on $342.9k = −0.5¢/sh; 80% of D dollars pinned at 0.80–0.85 by
DOOM_BID 0.20). **The §15 backlog item "doom-backstop completion
price" is dead before design — no headroom; completion-side mechanics
exhausted. The only EV-positive attack surface left is the doomed
start leg itself (one ~100-sh fill at ~0.35 per doom market).**

- **Records:** best FULL ev 1056 (−2.37, avoidance dose — not the
  mechanism center); MECHANISM-TEST CENTER 1052 (P*0.86 k012, −3.17);
  standing comparison reference 1029 (−8.07).
- Channel-bar law (§18): ev gains with kept-flow ≤ 0 close their axis;
  avoidance is bounded above by ev = 0.

## Current work

**Session 43 (~09:05–09:50Z):** E-052 design freeze → param
`lateBandTighten` in pair.v17t.ts → protocol:check + smoke 1058 +
activation A/B (1059 dosed / 1060 base, 30 latest, local sequential)
→ push 94a077c → 4 FULL submissions (incl. accidental lb04 dup,
designated noise-only pre-results in §19 addendum) → §20
completion-pathway decomposition while draining.

## Audit note

M1–M5 implemented and verified at 4809a8e (s26 correction stands).

### Five-session audit s35–s39 (done in s40) — PASS. Next audit: s45 (s40–s44).

- Next-five plan progress: (1) s40 GREEN ✓; (2) s41 GREEN ✓; (3) s42
  GREEN ✓; (4) s43 late-band build+smoke+submit GREEN ✓ (this
  session); (5) s44 readout. ≥3 GREEN satisfied ✓.

## Next step (priority order)

1. **s44 (GREEN neutral-controller): E-052 readout** under the frozen
   §19 bars (see IN FLIGHT). Integrity first (common set 10,651,
   identical 96-slug failure set, latency 140/20, engine SHA — s43
   commits are protocol-only: 9be384f/94a077c/4a9e90e touch only
   protocols/pair-fable/**). Then verdict + channel decomposition +
   LEDGER E-052 row.
2. **If E-052 closes avoidance-only/NULL:** §19 decision map says the
   maker-price concession family is exhausted as a repricing channel
   at this center. §20 killed the doom-completion-price item. The
   remaining §15 item (C/D mix) needs a §20-informed re-derivation —
   the honest state: C-pathway is the profit engine, doom markets are
   the loss, completion prices are all ~fair, and per mission binding
   priority the neutral→directional ladder applies (priority 2 leads
   once neutral axes are genuinely closed; directional was CLOSED at
   ev in E-046 "pending a new conditioning lever" — a fresh freeze
   would need a genuinely new lever, e.g. conditioning the tilt or
   the S-quote on doom-hazard state, designed from the §20 fact that
   the loss is ONE overpriced start leg per one-way market).
3. Open-but-unscheduled: P* floor < 0.85, k > 0.28 (decaying sub-bar
   avoidance channels — composition reason required to reopen).
4. **P-013 (needs human):** sell-side mirror scope ruling (PROPOSALS).
5. Cross-symbol replication: gated on P-012.

## Alignment gate — session 43 (final)

- **Classification:** neutral-controller (E-052 design freeze +
  implementation + smoke + FULL submission; §20 analysis on the
  reference cell is controller math for the next mechanism).
- **Contribution (controller decision changed):** the late-band
  concession axis moved from calibration sketch to a frozen, running
  experiment (design 9be384f, code 94a077c, smoke 1058, activation
  1059/1060, 4 FULL batches queued); the doom-completion-price
  backlog item was measured dead before design (§20: D-leg fair at
  −0.5¢/sh — saves a full FULL grid); completion-side mechanics
  closed, attack surface narrowed to the doomed start leg. Evidence:
  pair-v17t.md §19+addendum+§20, commits 9be384f/94a077c/4a9e90e.
- **Time to evidence:** min ~7 first substantive action (freeze-number
  DB queries on 1052 with known-answer checks); min ~15 smoke running.
  PASS.
- **Throughput:** 1 experiment frozen+built+submitted (3 cells + 1
  designated dup = 42,988 market jobs); 2 local activation runs; 1
  smoke; ~8 read-only DB queries; §20 analysis product. No serial
  scans. Queue verified before (empty) and after (4 waiting-children).
- **Scale:** closed by E-036 on record; all cells B=500.
- **Next:** s44 — E-052 readout under frozen §19 bars (GREEN
  neutral-controller), per Next step 1.
- **Verdict:** **GREEN.**
- Verdict history: s31–s43 all GREEN. Next audit: s45 (s40–s44).

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
  commits (through s43: only protocol/harness commits moved HEAD;
  f0f87f19→7e5f9276 verified protocol-only in s42; s43 commits
  9be384f/94a077c/4a9e90e protocol-only).
- **Sibling labs:** `protocols/pair-opus` — reads allowed both ways
  (inbox c68ea4ce); s43 check: still no results (memory/ =
  PRIOR-WORK.md + capabilities only).
- Queue submissions require a CLEAN tree pushed to origin/main (push
  via `git push origin HEAD:main`); commit state snapshots before
  submitting. If push is rejected (sibling labs push too), rebase
  then push — check what the rebase pulled.
- **Submit-output guard (new, s43):** capture the batchUid line from
  EVERY submit — pipe through `grep "batchUid="`, NOT `tail`. A
  resubmit after a cut-off output DOUBLE-ENQUEUES (no cancel path in
  tooling); if it happens, designate the dup's role in writing BEFORE
  results land (E-046/E-052 precedent).
- **zsh does NOT word-split unquoted variables** — submit grids as
  one LITERAL command per config (inbox c841c329). `echo ===` breaks
  zsh. Always keep stderr. run-backtest.ts: `--latest` is a BOOL;
  market count goes in `--limit N`. Capture the batchUid per submit.
- Verify with fleet.ts after every detached batch; count aggregate
  jobs (waiting-children), not market-job totals. Rows land at FULL
  queue drain (s32 model; re-confirmed s42).
- Do not push strategy-semantics changes while that strategy's jobs
  are queued/running — workers track origin/main; serialize push →
  submit. (E-052 jobs QUEUED at s43 close — pair.v17t.ts is FROZEN
  until drain.)
- Screens baseline 874 (v0) and parents 872/873/879 valid ≤
  2026-08-06 (evaluator.md §Universes). FULL references: **standing
  comparison reference 1029 (v17 τ0 P*0.92, ev −8.07); MECHANISM-TEST
  CENTER 1052 (v17t P*0.86 k012, −3.17); best FULL ev on record 1056
  (1052+e09 avoidance dose, −2.37); chain 1057 (−2.48), 1055 (−2.53),
  1054 (−2.89), 1049 (−3.83), 1051 (−4.00), 1050 (−4.23), 1046
  (−4.83), 1047 (−4.98), 1043 (−5.89); older: g0=1008, g3=1009,
  m10=1026.** v15 bridge chain 970 ≡ 960 ≡ 956; v16 bridges c0=978,
  d0=987.
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
  (noActivity), not only within-market fill counts. (E-052 §19 is the
  first freeze carrying both — the template for future freezes.)
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
  fill modes (escalate to a 200-mkt Stage B instead). s43 addition:
  smoke alone cannot demonstrate mechanism ACTIVATION either — pair a
  small local A/B (dose vs 0) when the mechanism's fills are ≤~10% of
  flow (E-052 used 30-mkt sequential pair 1059/1060).
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

2026-07-31T16:46:43.750Z-82e89da5 (no newer entries at s43 start).
