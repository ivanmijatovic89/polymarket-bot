# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-08-01T00:20Z (mission-02 session 34 in progress)

## Current work

**Session 34 (started 00:13Z, immediately after s33): queue verified
at 00:13Z — p98 at 7,502/10,747, m10/m40 at 0, ~24.7k jobs left ⇒
drain still ≈01:05–01:15Z; readout not possible yet. Wait used for a
mission-mandated baseline report (pair-v17.md §11): mission §2 pair
VWAP fractions computed on g0=1008 for the first time.** Headline:
neutral controller pairs at mean 1.10 per market (only 21.2% of
markets < 0.98, 7.6% < 0.95); matched volume, pair cost, and pnl are
monotone together — the 500+ matched bucket pairs at 0.958 and is
**ev-positive (+17.41/mkt, 447 mkts)** while the 100–250 bucket
carries −127k of the −144k total loss. Loss is now localized by
regime (trending/low-oscillation markets), consistent with the 58/42
S-toxicity identity and inbox d904e17d (high-activity operator).
Caveats recorded in §11 (outcome-conditioning; guard-7 depth optimism
strongest in the profitable bucket).

**s34 second increment: §11.1 early-detectability + pair.v17o BUILT.**
(a) The losing regime is flagged by minute 5 from the controller's own
completion pace: early_matched<150 markets carry ALL of the −110k
S-flow toxicity (−42.2k of it accruing post-flag); early_matched≥150
markets' S flow is fair (−1.6k/2,680 mkts). (b) pair.v17o
(completion-deficit per-share quote concession, design pair-v17o.md
committed BEFORE code at e3f307f): protocol:check PASS, smoke 1018
PASS, activation 1019(k=0)/1020(k=0.06) PASS on identical 20 mkts —
pre-grace S fills unchanged, post-grace 43→30 at −3¢ avg price.
Watch-metric frozen: taker completions rose 46→77 (flow shift into
C/D — E-042 anatomy risk); FULL cells must report C/D counts+$.
Submit literals prepared for both E-045 branches (pair-v17o.md §5).
Sequencing: v17t grid first, v17o follows.

**Session 33 (00:08–00:20Z, harness restarted the loop 0 min after
s32 close): rows STILL ~55–65 min out at session start (queue at
00:08Z: 4 batches at 10,651/10,747 waiting only on the 96 outage
retries, p98 at 4,122, m10/m40 at 0 ⇒ drain ≈01:05–01:15Z, matching
the s32 model). Wait used to build + VERIFY the complete readout
runbook: `memory/experiments/e043-e045-readout.md`** — steps 0–6 with
exact copy-paste literals for row mapping, integrity (96-failure +
identical-set + 10,651-common checks), all 10 frozen comparison
pairs, E-044 mechanism metrics, decision mappings, and the v17t
follow-through. Both SQL literals PROVEN against known answers this
session: S-split engagement on 1008 reproduced 57.85/42.15 (lose
1,969,100 sh @ 0.418 / win 1,434,600 @ 0.503) and the paired-delta
template on 1009-vs-1008 reproduced +0.535 (se 0.212, n 10,651) vs
the recorded E-042 readout (+0.54 / 0.21). Next session: run the
runbook top to bottom — zero query-writing latency remains.

**Session 32 (23:48–00:08Z, started ~2 min after s31 forced close):
E-043/E-044/E-045 rows STILL not landed — and the timing model is now
CORRECTED: run rows do NOT land ~65 min after each submit; they land
ALL TOGETHER shortly after the ENTIRE fleet queue drains.** Evidence:
(a) E-042's three rows created within 9 s of each other (22:40:02–:11)
at full drain, ~40 min after g3's own markets finished; (b) h80's
10,651 markets finished ≈23:10Z yet its aggregate still absent 55 min
later; (c) `src/backtest/queue.ts:87-95` — 3 attempts, exponential 5 s
backoff: each retry of the 96 deterministic priceToBeat failures is
re-queued behind the pending FIFO, so final failures (and thus the
waiting-children aggregates) resolve only near full drain. **Expected
landing for ALL 7 rows: ≈01:15–01:25Z** (at 00:05Z: h80/h160/p92/p94
done with 10,651 each, p98 at 1,209/10,747, m10/m40 at 0; ~30.7k
market jobs left at ~420–500/min).

s32 additions (no new runs; no readout possible):

- Timing-model correction above (capability note — stops future
  sessions from polling per-batch).
- **v17t submit commands PREPARED for both E-045 branches**
  (pair-v17t.md §4 "Prepared submit commands"): Branch A (P*-FLAT) =
  three literals as drafted; Branch B (P*-LIVE) = same + `--param
  pairTarget=<winner>`, with the winning E-045 cell's run row as the
  k=0 reference by code identity (no k=0 re-run in either branch).
- Verified HEAD d539617 == origin/main, tree clean — v17t submit is
  push-ready.

**Session 31: E-043/E-044/E-045 STILL not readable (no run rows yet —
aggregates wait on the 96 outage-failure retries; E-042 precedent says
rows land ~65 min after submit ⇒ ≈00:00–00:15Z for E-043, after drain
~00:47Z for the rest). Wait time used to build pair.v17t (time-varying
maker quote ceiling) — the backlog neutral axis.** Session started
23:31Z, harness forced close 23:46Z.

s31 additions:

- **pair.v17t built + smoked** (design pair-v17t.md, DRAFT — grid
  freeze pending E-045): maker quote cap pHat gets an age-growing
  PER-SHARE concession `− lateTighten·(elapsed/15m)`, pricing the
  measured late-window S-toxicity ramp (§10). pLock/doom stay on base
  P*. lateTighten=0 ≡ v17 by code identity.
- **Dose-form defect found via activation check**: routing the
  tightening through pairTarget amplifies it by Qs2/q (d pHat/d pTgt
  = Qs2/q) — runs 1015 (k=0) vs 1016 (k=0.12-via-target, same 20
  mkts): maker fills 64→34, suppression already hard at minute 1–5.
  Fixed to per-share form (applied after the projection). Smokes:
  1014 (5 mkts, PASS), 1015/1016 (20 mkts, activation evidence).
- **Per-share form ACTIVATION PASS** (run 1017, k=0.06, same 20 mkts
  vs 1015 k=0): minutes 0–2 activity ≈ identical (16/8/10 vs 17/10/6
  S fills), late-window (m≥5) S shares 2,100 vs 2,700 — mild late
  suppression, no early collapse (contrast 1016). protocol:check +
  smoke + activation all PASS ⇒ v17t is submit-ready once its grid
  is frozen (do that AFTER the E-045 verdict — §3 of pair-v17t.md:
  P*-LIVE would re-center base P* first). 20-mkt ev numbers are noise
  — do not cite them.
- v17t references: k=0-run ≡ v17 τ0 ⇒ reuse g0(1008) as the FULL
  baseline; no k=0 re-run needed.

s30 additions (commit e91c1e5):

- **S-fill toxicity is PRICE-UNIFORM** (run 1008, §10 addendum):
  −3.0 ± 0.5 ¢/share across bands 0.2–0.8 (95% of S volume). No
  unconditioned quote-side/price-level asymmetry lever exists;
  side asymmetry must be signal-conditioned (= E-044's mechanism).
  If E-044's m-cells don't move the S split, the asymmetry axis has
  no band-level fallback.
- **S-split engagement query VERIFIED** on run 1008 (reproduces
  57.85/42.15, S-lose avg 0.418): JSON_TABLE over intent_meta,
  `CONVERT(jt.side USING utf8mb4) COLLATE utf8mb4_unicode_ci =
  brm.final_outcome`, filter jt.m='S', group win/lose. Apply as-is
  to E-044 m-cell run ids (v17m tags maker quotes m='S'/'R'; tilt is
  placement-side only, so the same query reads engagement directly).
- zsh eats `$[0]` inside double quotes (arithmetic expansion) —
  escape as `\$[*]` in sql.ts JSON paths.

**Session 29 (context): g0 loss identity** — completion leverless
(D EV-neutral vs hold ⇒ explains E-041 CEIL-NULL); whole neutral
loss = S-flow adverse selection 58/42, −3.2¢/share; S toxicity
grows 1.6–3× late-window (pair-v17.md §10):

- **Completion policy has NO lever** — leg-vs-outcome identity: C and
  D fills are ~fair at their prices (D buys the leader at 0.823, it
  wins 81.1% ⇒ EV ≈ fees; doom-completing ≈ EV-equal to holding).
  Mechanically explains E-041 CEIL-NULL.
- **The whole neutral loss is S-flow adverse selection**: maker
  starts fill 58/42 toward the eventual loser, −3.2¢/share ≈ −110k
  of the −144k. The tilt program (E-043/E-044 in flight) attacks
  exactly this term; **baseline S split 58/42 is the engagement
  metric to read on E-044's m-cells.**
- **S-fill toxicity grows with window age** (−2.2..−3.3¢/sh min 0–4 →
  −6..−10¢/sh min 12–13): measured prior for a time-varying-quote
  neutral axis. Start-minute gating separately re-measured dead for
  v17 (minuteev on 1008; matches E-027).

Sibling lab pair-opus: clean start, no results yet (memory/ has only
PRIOR-WORK.md — an accurate digest of our findings — and
capabilities).

**Session 28 (context): E-042 CLOSED (SIGB-BETTER + TILT-EV-NULL +
dose monotone); pair.v17m (maker-only tilt) built + smoked; E-043 +
E-044 + E-045 (7 × FULL) SUBMITTED.**

E-042 readout (pair-v17.md §7; g0=1008, g1=1011, g2=1010, g3=1009 vs
f1=1005; 10,651 common intersection; B_full = 0.74):
- **SIGB-BETTER**: g3 (bps 40) − f1 = +1.87 — spot-vs-strike leader
  beats the book leader. Mostly harm avoidance: neutral g0 − f1 =
  +1.33, i.e. the signal-(a) book tilt was actively costing ev.
- **TILT-EV-NULL**: g3 − g0 = +0.54 < 0.74 (2.5σ by its own pair SE
  0.21 — suggestive, below the frozen bar). Dose monotone in width
  (g3 − g1 = +1.32): false-flip cost real.
- **ANATOMY (the session's key finding)**: tilted residue WINS 88–90%
  of markets at bps 10–20 (neutral base 30%) — the signal is genuinely
  predictive — but doom/taker acquisition spends more than the residue
  earns (g1: +163k residue vs −161k extra pairs cost + 11k fees).
  The lever is acquisition COST, not signal quality ⇒ E-044.
- Standing references: g0 = 1008 is the FIRST FULL neutral at the
  E-040 e0 center (ev −13.51, p/100 −5.93); g3 = 1009 best
  directional on record (−12.97). Universe = 10,651 (96-slug
  deterministic priceToBeat-outage set, all-cells-identical verified).

pair.v17m (commit 18ce0a4; design pair-v17m.md FROZEN at f107234
before code): v17 with maker-only tilt acquisition — FOK tiltDef =
min(T, 0) (taker never chases the leader; held tilt respected; doom
salvage on flip preserved); tiltUnitMax dropped. protocol:check PASS;
smoke 1012 PASS; activation 1013: τ160 taker ≤ τ0 taker on EVERY
market (16 vs 24) — no-chase verified. τ0 ≡ v17 τ0 by code identity.

**IN FLIGHT (next session reads FIRST; do NOT resubmit):** 7 FULL
runs @ 140/20, universe 10,747 (submitted 10,747; expect 96 outage
failures each), --to-ms 1785196800000. E-043/E-045 at SHA f107234
(params-only on pair.v17), E-044 at 18ce0a43. Queue verified 23:04Z:
7 aggregates waiting-children, h80 at 6794/10747.

| exp | # | strategy | key params | batchUid |
|---|---|---|---|---|
| E-043 | h80 | v17 | τ160 bps80 | pf-e043-h80-20260731T225501-e9pec4 |
| E-043 | h160 | v17 | τ160 bps160 | pf-e043-h160-20260731T225536-gxoe2a |
| E-045 | p92 | v17 | τ0 P*0.92 | pf-e045-p92-20260731T225614-q260og |
| E-045 | p94 | v17 | τ0 P*0.94 | pf-e045-p94-20260731T225654-ydl2ao |
| E-045 | p98 | v17 | τ0 P*0.98 | pf-e045-p98-20260731T225738-4q7e3p |
| E-044 | m10 | v17m | τ160 bps10 | pf-e044-m10-20260731T230254-9z7pbg |
| E-044 | m40 | v17m | τ160 bps40 | pf-e044-m40-20260731T230348-t7ujlc |

Center everywhere else: q100 I160 doom.99 cool5 ttl90 persist0
lagAggr0 B500 (P* 0.96 except E-045 cells; tiltUnitMax=1 on v17,
absent on v17m).

## Readout procedure (bars in pair-v17.md §8/§9 + pair-v17m.md §4)

1. `results.ts --last 8` (grep -v "FAILURE btc-updown" for summaries).
   Failures must be the identical 96-slug outage set per cell (SQL:
   `backtest_run_failures` reason 100% MISSING-priceToBeat, common
   count 96); pairwise common = 10,651 vs E-042 runs.
2. All comparisons paired per-market SQL on the common intersection
   (JOIN backtest_run_markets a/b ON slug), bar B_full = 0.74.
3. E-043: h80 vs g3(1009) → DOSE-CONT/PEAKED/FLAT; h80/h160 vs
   g0(1008) → TILT-EV-REAL retest; h160 vs g0 |Δ| ≥ 0.74 = anomaly.
4. E-044: m10 vs g1(1011), m40 vs g3(1009) → MAKERTILT-BETTER/…;
   any m vs g0 > 0.74 ⇒ TILT-EV-REAL (first ev-positive tilt).
   Mechanism metric: residue win% per anatomy.ts (DEAD needs ≤ 60%).
5. E-045: each p-cell vs g0(1008) → P*-LIVE (either direction) or
   P*-FLAT-FULL; read monotonicity across 0.92→0.98.
6. Decision mappings are frozen in the files — follow them.

## Audit note

M1–M5 implemented and verified at 4809a8e (s26 correction stands).

### Five-session audit s26–s30 (done in s30, 2026-07-31T23:30Z) — PASS

- **Gates:** s26 GREEN (directional: E-040 close, E-039 re-verdict,
  E-041 submit), s27 GREEN (directional: E-041 close CEIL-NULL, v17
  built, E-042 submit), s28 GREEN (directional+neutral: E-042 close,
  v17m built, E-043/E-044/E-045 submit), s29 GREEN (neutral: g0 loss
  identity, analysis-only, declared). 4 GREEN / 0 YELLOW / 0 RED;
  s30 = readout + this audit. All gates present with evidence.
- **Time to evidence:** 1 / 2 / 3 / 5 min — all PASS (s30: fleet
  verify at min 2).
- **Throughput:** 3 experiments closed (E-040, E-041, E-042), 3
  frozen+submitted (E-043/E-044/E-045), 2 strategies built+smoked
  (v17, v17m). Fleet runs read: 8×800 + 8×10,747; submitted:
  15×10,747 (~161k market jobs), all whole-grid-up-front,
  queue-verified. One declared analysis-only session (s29, runs in
  flight, 4 read-only scans). No unexplained serial scans.
- **Binding requirements:** $2,000 + 500–1,000 matched-share check
  CLOSED by E-036 (s21, on record; unchanged — no new scale claims
  made since). Directional controller = the active leading program
  (E-042→E-044 chain). M1–M5 verified 4809a8e. No silently closed
  requirements found; the one positive claim in the window (E-039
  +1.91) was actively withdrawn on noise evidence before steering
  anything — the instrument upgrade (B_full 0.74 at FULL) is the
  window's main methodological gain.
- **Premature conclusions check:** completion-axis "no lever" (s29)
  is an analysis finding recorded as mechanism explanation of the
  E-041 verdict, not a new class kill; start-minute gating recorded
  as constraint matching E-027. OK.
- **Next-five plan (s31–s35):** (1) E-043/E-044/E-045 verdicts →
  frozen decision mappings (GREEN, directional+neutral); (2) the
  mapped follow-up — maker-tilt iteration OR width extension OR P*
  follow-up (GREEN); (3) time-varying-quote neutral axis (late-window
  S-toxicity prior measured in s29) design+run (GREEN); (4) at most
  one supporting diagnostic if a verdict demands mechanism digging
  (YELLOW cap 1); (5) s35 = next audit. ≥3 direct controller
  increments guaranteed.

Reading the already-frozen E-043/E-044/E-045 results is evaluation of
completed work (§6.3), not new research — audit done; readout may
proceed, and new design (backlog: time-varying τ) is unblocked after
the readout's decision mappings are applied.

## Next step (priority order)

1. **Read E-043/E-044/E-045 via the verified runbook**
   `memory/experiments/e043-e045-readout.md` (steps 0–6, all literals
   proven s33). Rows land together at full queue drain ≈01:05–01:15Z
   2026-08-01. fleet.ts first — do NOT resubmit; if `active batches`
   > 0, do prep/analysis instead of polling per-batch.
2. Follow the frozen decision mappings (maker-tilt iteration, width
   extension, or P* follow-up).
3. **Freeze + submit the v17t grid** (pair-v17t.md §4: k ∈ {0.03,
   0.06, 0.12} vs g0=1008, FULL, B_full 0.74) — AFTER applying
   E-045's verdict. Exact submit literals for BOTH verdict branches
   are prepared in pair-v17t.md §4 (s32); strategy smoked +
   activation-verified (runs 1014/1015/1016/1017); code committed and
   pushed (d539617 == origin/main verified s32). Freeze the file,
   then fire the three commands.
4. **P-013 (needs human):** sell-side mirror scope ruling (PROPOSALS).
5. Cross-symbol replication: gated on P-012.

## Alignment gate — session 34 (in progress; finalized at close)

- **Classification:** neutral-controller (mission-metric baseline
  evaluation of the standing neutral FULL run + NEW neutral mechanism
  pair.v17o designed, implemented, smoked, activation-verified;
  E-043/E-044/E-045 readout still queue-blocked).
- **Contribution:** controller decision changed: a genuinely new
  neutral axis (state-conditioned quoting) moved from nothing to
  submit-ready in-session, on a measured prior computed this session
  (pair-v17.md §11/§11.1: ALL S-flow toxicity concentrated in
  low-early-matched markets, −42.2k accruing post-flag; high-early S
  flow fair). Mission §2 pair-VWAP reporting computed for the first
  time (21.2%/7.6%/0.34% below 0.98/0.95/0.90). Evidence: commits
  50eb247/e3f307f/7abbb7a; runs 1018/1019/1020.
- **Time to evidence:** fleet verify min 0, first substantive scan
  min ~2, mission-metric SQL min ~4. PASS.
- **Throughput:** 3 local sequential runs (5+20+20 mkts) + 9 read-only
  DB queries; 7 × 10,747 in flight (verified once, no resubmission).
  No serial-scan issue.
- **Scale:** closed by E-036 on record; §11 explicitly re-flags
  guard-7 depth optimism on the 500+ bucket.
- **Next:** runbook steps 0–6 when drain completes (≈01:05–01:15Z),
  frozen mappings, v17t freeze+fire, then v17o grid — GREEN.
- **Verdict:** **GREEN** (direct neutral-controller implementation +
  evaluation).
- Verdict history: s30 GREEN, s31 GREEN, s32 GREEN, s33 GREEN,
  s34 GREEN. Next audit: s35 (five-session audit BEFORE new research).

## Alignment gate — session 33 (superseded)

- **Classification:** neutral-controller + directional-controller
  (evaluation-resume of E-043/E-044/E-045; readout still blocked —
  the harness restarted the loop 0 min after s32, ~60 min before
  queue drain).
- **Contribution:** no controller decision changed — no verdict
  readable (declared honestly). Banked: the complete readout runbook
  (e043-e045-readout.md) with BOTH core SQL literals verified against
  known answers (S-split 57.85/42.15 @ 0.418 reproduced on 1008;
  paired-delta +0.535/se 0.212/n 10,651 reproduced on 1009-vs-1008
  matching the recorded E-042 +0.54/0.21). Next session reads
  verdicts with zero query-writing latency.
- **Time to evidence:** fleet verify min 1, first substantive data
  scan (S-split verification on 1008) min ~6. PASS.
- **Throughput:** 0 new runs (7 × 10,747 in flight, verified once,
  no resubmission — all controller work verdict-gated, v17t submit
  design-gated on E-045); 4 read-only DB queries. No serial-scan
  issue.
- **Scale:** closed by E-036 on record; all in-flight runs B=500.
- **Next:** execute the runbook steps 0–6 (rows land ≈01:05–01:15Z),
  apply frozen mappings, freeze + fire the v17t grid — GREEN
  (neutral + directional controller evaluation).
- **Verdict:** **GREEN** (blocked-stub session: aligned
  evaluation-resume prep, zero drift, no premature claims).
- Verdict history: s29 GREEN, s30 GREEN, s31 GREEN, s32 GREEN,
  s33 GREEN. Next audit: s35.

## Alignment gate — session 32 (superseded)

- **Classification:** neutral-controller + directional-controller
  (evaluation-resume of E-043/E-044/E-045; readout blocked by queue
  drain — the harness restarted the loop 2 min after s31, well before
  the runs could finish).
- **Contribution:** no controller decision changed — no new evidence
  was readable (declared honestly). Banked for the next session:
  corrected run-row timing model (rows land together at full queue
  drain; evidence = E-042 9-second row cluster + h80 aggregate absent
  55 min after its markets finished + queue.ts 5s-backoff retry
  mechanics), and prepared v17t submit literals for both E-045
  verdict branches (pair-v17t.md §4).
- **Time to evidence:** fleet verify min 1, DB row poll min 3 —
  resume of in-flight evidence; no NEW backtest was launchable (all
  controller work is verdict-gated on the 7 in-flight runs, and the
  only pending submit — v17t — is explicitly gated on E-045 by its
  own design file). PASS on the resume reading; recorded plainly.
- **Throughput:** 0 new runs (7 × 10,747 in flight, verified 3×, no
  resubmission); 3 read-only DB polls + 1 queue-config check. No
  serial-scan issue.
- **Scale:** closed by E-036 on record; all in-flight runs B=500.
- **Next:** read all 7 rows (land ≈01:15–01:25Z), apply frozen
  decision mappings, freeze + fire the prepared v17t grid — GREEN
  (neutral + directional controller evaluation).
- **Verdict:** **GREEN** (blocked-stub session: aligned
  evaluation-resume, zero drift, no premature claims).
- Verdict history: s28 GREEN, s29 GREEN, s30 GREEN, s31 GREEN,
  s32 GREEN. Next audit: s35.

## Alignment gate — session 31 (superseded)

- **Classification:** neutral-controller (built + verified pair.v17t,
  the priority-1 backlog axis; E-043/E-044/E-045 readout attempted
  but rows had not landed by forced close — declared: no new fleet
  submissions, 7 FULL runs still draining).
- **Contribution:** the time-varying-quote neutral axis moved from
  backlog prior to submit-ready strategy: pair.v17t implemented
  (commit 9ef75e4 + per-share fix), design pair-v17t.md, smoke 1014,
  activation evidence 1015/1016/1017. Found + fixed a real dosing
  defect (target-routed tightening amplified by Qs2/q — the
  activation check caught it, which is what it is for).
- **Time to evidence:** ~1 min (fleet verify), first substantive scan
  min 2, smoke launched min ~8. PASS.
- **Throughput:** 4 local sequential runs (5+20+20+20 mkts) + 3
  read-only SQL scans; 7 × 10,747 FULL in flight (progress verified
  3×, no resubmission). No serial-scan issue.
- **Scale:** closed by E-036 on record; all cells B=500.
- **Next:** s32 reads E-043/E-044/E-045 (rows land ≈00:15–00:50Z),
  applies frozen mappings, then freezes + submits the v17t grid —
  GREEN (neutral + directional controller evaluation).
- **Verdict:** **GREEN.**
- Verdict history: s27 GREEN, s28 GREEN, s29 GREEN, s30 GREEN,
  s31 GREEN. Next audit: s35.

## Blockers

None. 7 FULL runs in flight — ALL rows land together at full queue
drain ≈ 01:15–01:25Z 2026-08-01 (corrected s32 model; do NOT
resubmit — verify with fleet.ts, then results.ts --last 8).

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
  commits (s13–s28: only protocol/harness commits moved HEAD;
  s28 rebase pulled protocols/pair-opus only — no engine change).
- **Sibling labs:** `protocols/pair-opus` created 2026-08-01 — an
  independent clean-start lab on the SAME strategy problem (reads
  allowed both ways per inbox c68ea4ce; writes own-protocol only).
  Worth reading their memory/ once they produce results.
- Queue submissions require a CLEAN tree pushed to origin/main (push
  via `git push origin HEAD:main`); commit state snapshots before
  submitting. If push is rejected (sibling labs push too), rebase
  then push — check what the rebase pulled.
- **zsh does NOT word-split unquoted variables** — submit grids as
  one LITERAL command per config (inbox c841c329); also `echo ===`
  breaks zsh (=cmd expansion) — avoid `=`-leading words. Always keep
  stderr. run-backtest.ts: `--latest` is a BOOL; market count goes in
  `--limit N`. Capture the batchUid line from EVERY submit.
- Verify with fleet.ts after every detached batch; count aggregate
  jobs (waiting-children), not market-job totals.
- Do not push strategy-semantics changes while that strategy's jobs
  are queued/running — workers track origin/main; serialize push →
  submit. (E-043/E-045 pin pair.v17.ts at f107234; E-044 pins
  pair.v17m.ts at 18ce0a43: do NOT touch either file while queued.)
- Screens baseline 874 (v0) and parents 872/873/879 valid ≤
  2026-08-06 (evaluator.md §Universes). FULL references: v1-b = 914;
  v16 τ+160 no-ceiling = 1005 (f1); **v17 neutral g0 = 1008 (the
  standing FULL neutral baseline); v17 best directional g3 = 1009.**
  v15 bridge chain 970 ≡ 960 ≡ 956. v16 bridges: c0 = 978, d0 = 987.
- **NOISE MODEL: FULL-pair instrument at B=500 — paired per-market
  sd 38.29 (same-config), SE_pair 0.369, ev bar B_full = 0.74.
  Cross-config paired sd is LARGER (22–66 measured in E-042,
  behavior-divergence dependent). Pinned-800/B500 single-run ev
  SE ≈ 1.2 — structure screens only. p/100 bar 0.54 for screens.**
- JOURNAL entries are messages to the human (contract v2): plain
  sentences, tried/happened/means/next, drop run ids/codes unless
  genuinely the point.
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329), verify queue depth after.
- Class kills need an identity argument (evaluator.md §Kill
  standards); N failures kill a family only. Verdict bars must name
  comparison PAIRS. Positive signals measured ON discovery data need
  disjoint confirmation before any build decision (E-039 → E-041
  canonical: +1.91 at pinned-800 → 0.04 at FULL).
- Fill model: calibrated by E-025 (ToB capacity bound). Guard-7
  whole-size fill optimism: larger-q results depth-optimistic
  (E-036). E-044's maker-tilt fills are worst-queue conservative
  (adverse-selection direction — the honest side for this test).
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
  engaged (s28: g3-vs-g0 differ on 8,789 mkts, mostly jitter).
- leadPersistTicks is in TICKS (~138/s on active markets).
- Feed-declaring strategies: workers fulfill binance+priceToBeat
  (diag 1006). 96 of the 10,747 universe markets have NO strike
  anywhere (0.89% universe-wide; deterministic set) — hard per-market
  failures, compare on common played intersection (pair-v17.md §6.2).

## Inbox processed through

2026-07-31T16:46:43.750Z-82e89da5 (no newer entries at s28 start).
