# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-08-01T02:00Z (mission-02 session 37 close)

## HEADLINE STATE (read this first)

**Standing FULL neutral baseline: p92 = RUN 1029 (v17 τ0, pairTarget
0.92, ev −8.07, p/100 −5.91).** g0=1008 remains the P*0.96 reference
for older comparisons only. s35: five-session audit s30–s34 PASS;
E-046 frozen (8c287bc) + submitted. s36 (drain-blocked, analysis-only,
declared): mission §2 metrics + loss identity REPLICATED on 1029 —
pair-v17.md §13 (fractions <0.98 30.2% / <0.95 23.1% / <0.90 5.4%;
post-flag S toxicity share up to ~45% of the loss; healthy-pace
population collapsed to 4.7%) + v17o reading prior in pair-v17o.md §11.
s37 (drain-blocked, analysis-only): readout INPUTS pinned on 1029 —
**E-046 engagement baseline = S split 61.6/38.4 (NOT 1008's 58/42),
residue expectation ≈ 1,226** (pair-v17m.md §7); v17t minute-curve
prior (pair-v17t.md §6; post-min-5 = 48.6% of S volume, −4.36¢/sh).

**IN FLIGHT (next session reads FIRST; do NOT resubmit): 13 FULL runs
@ 140/20, universe 10,747 (expect the identical 96 outage failures
each), all --to-ms 1785196800000, all vs reference 1029 (bar B_full
0.74). Queue verified 01:23Z: 13 aggregates waiting-children, ~126k
market jobs left at ~620/min ⇒ ALL 13 rows land together at full
drain ≈04:45–05:00Z.** s34 grid at sha 9736032e; E-046 at 8c287bc4
(pair.v17m.ts verified untouched since 18ce0a43 — identity holds).

| grid | cell | strategy | key params (rest = 1029 center) | batchUid |
|---|---|---|---|---|
| v17t | k003 | pair-fable-v17t | P*.92 lateTighten .03 | pf-v17t-k003-20260801T010109-gzot2w |
| v17t | k006 | pair-fable-v17t | P*.92 lateTighten .06 | pf-v17t-k006-20260801T010150-p50d20 |
| v17t | k012 | pair-fable-v17t | P*.92 lateTighten .12 | pf-v17t-k012-20260801T010232-1lz5zm |
| v17o | k003 | pair-fable-v17o | P*.92 oTighten .03 | pf-v17o-k003-20260801T010338-c1nc9x |
| v17o | k006 | pair-fable-v17o | P*.92 oTighten .06 | pf-v17o-k006-20260801T010433-jrc6ii |
| v17o | k012 | pair-fable-v17o | P*.92 oTighten .12 | pf-v17o-k012-20260801T010535-yf2jjq |
| v17o | k006s | pair-fable-v17o | P*.92 oTighten .06 oSticky 1 | pf-v17o-k006s-20260801T010638-x8uc3q |
| E-045b | p90 | pair-fable-v17 | P*.90 (edge probe vs 1029) | pf-e045b-p90-20260801T010749-irr1bu |
| E-046 | t40 | pair-fable-v17m | P*.92 τ40 bps10 persist0 | pf-e046-t40-20260801T011803-2irtuw |
| E-046 | t40dup | pair-fable-v17m | (accidental dup of t40 — noise check ONLY, no verdict role) | pf-e046-t40-20260801T011853-xaiyd1 |
| E-046 | t80 | pair-fable-v17m | P*.92 τ80 bps10 persist0 | pf-e046-t80-20260801T012053-gnmn1l |
| E-046 | t160 | pair-fable-v17m | P*.92 τ160 bps10 persist0 | pf-e046-t160-20260801T012138-ozzx0m |
| E-046 | t160p | pair-fable-v17m | P*.92 τ160 bps10 persist1000 | pf-e046-t160p-20260801T012224-hyw1rz |

Center passed EXPLICITLY on every cell (orderSize=100
imbalanceBand=160 doomUnitMax=0.99 pairTarget as listed) — schema
DEFAULTS are NOT the center (defect caught s34). Bars + decision
mappings frozen in pair-v17t.md §4/§5, pair-v17o.md §4/§10,
pair-v17.md §12 (E-045b), **pair-v17m.md §6 (E-046, incl. the t40dup
designation fixed before results)**. Readout literals: paired-delta
template + integrity checks in e043-e045-readout.md steps 2–3 (same
queries, new ids); v17o mechanism literal in pair-v17o.md §7; E-044's
verified S-split engagement query applies to E-046 cells as-is.

Readout order suggestion: E-045b p90 FIRST (it may move the center
question), then v17t/v17o (neutral axes), then E-046 (tilt at 0.92).
If p90 returns P*-CONT, E-046 verdicts still stand vs 1029; the
winning tilt cell would be re-verified at any new center before
promotion (frozen in pair-v17m.md §6).

## Current work

**Session 37 (01:38–02:00Z, harness restarted the loop again ~0 min
after s36 close — same drain-blocked position; queue verified 01:39Z:
13 aggregates waiting-children, ~117.6k market jobs, drain ≈04:45Z as
modeled). Declared analysis-only; no fleet submissions. Work: pinned
the frozen readout's remaining unmeasured INPUTS on reference 1029,
with a 1008 known-answer check passing first on each query. (1) E-046
engagement baseline: 1029's S split is 61.6/38.4 toward the loser
(lose 1.127M sh @ .383, win 0.704M @ .485; −3.79¢/sh, net −69.4k) —
MORE skewed and MORE toxic per share than 1008's 58/42/−3.23¢; the
+5.44 P* gain came from volume shrink, not fairer flow. The §6
"moved ≥2 pts" clause reads against 61.6/38.4. (2) Residue
expectation: played 8,764@0.92 vs 10,152@0.96 ⇒ frozen formula gives
≈1,226 (the 55–60% guess in §6 was wrong; formula binds). (3) v17t
prior: 1029 minute curve — post-min-5 flow is 48.6% of S volume at
−4.36¢/sh (gross −39.8k, cross-checks §13's −38.7k−1.1k ✓); min 12–13
already near-empty ⇒ lateTighten acts mostly on minutes 7–11. All in
pair-v17m.md §7 + pair-v17t.md §6; bars unchanged everywhere.**

**Session 36 (01:28–01:55Z, harness restarted the loop ~0 min after
s35 close — same drain-blocked position as s32/s33): queue verified
twice (13 aggregates waiting-children; workers all UP at 9736032;
v17t-k003 children fully settled at 10,651+96 yet NO run row —
re-confirms the s32 rows-at-full-drain timing model). Declared
analysis-only; no new fleet submissions (adding load would delay the
drain). Work: replicated the §11/§11.1 mission-metric + loss-identity
analysis on the NEW standing baseline 1029 (it existed only on the old
0.96 center). Result in pair-v17.md §13: fractions improve sharply at
0.92 (<0.98 30.2%, <0.95 23.1%, <0.90 5.4%), monotone matched-bucket
structure replicates (loss all in 100–250; 250+ ev-positive both
centers), early-flag separation replicates BUT the healthy ≥150
population collapses to 4.7% (was 26.4%), and post-flag S toxicity is
−38.7k ≈ 45% of the −85.9k baseline loss (was ~40% share). v17o
reading prior recorded pre-readout in pair-v17o.md §11 (bars
unchanged): expect near-global engagement, tiny false-flag downside,
ENGAGEMENT-STARVED a-priori-likely at k012. Internal consistency
check: bucket totals ≈ ev × universe ✓.**

**Session 35 (01:12–01:30Z): five-session audit s30–s34 done FIRST
(PASS — see Audit note) since the 8 s34 rows were still ~2h from
drain. Then E-046 (the E-044-mapped maker-tilt iteration): design
frozen in pair-v17m.md §6 and committed (8c287bc) BEFORE submission,
4 cells submitted (dose t40/t80/t160 + persistence t160p at bps10 on
the P*0.92 center), all vs 1029 by τ0 code identity — no k=0 re-run.
pair.v17m.ts verified untouched since 18ce0a43 (params-only; straight
to FULL per E-043/E-045 precedent). One slip, recorded before any
results: t40 was submitted twice (first batchUid line was filtered
from visible output); no safe single-batch cancel with 10 other
batches sharing the queue ⇒ both kept, first = primary, second =
t40dup (duplicate-pair noise check only). Queue verified: 13
aggregates in flight, drain ≈04:45–05:00Z.**

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

s34 third increment (all pre-freeze, evidence-driven): (c) grid
corners verified live (runs 1021/1022 — dose-monotone post-grace
suppression 43→30→11, zero pre-grace contamination in any cell,
grace-3 shifts suppression into min 3–5); (d) deficit-coverage
analysis (window-fn over 1008): releasing deficit covers only ~60%
of post-5 toxicity because pace-recovered markets stay toxic ⇒
`oSticky` ratchet param implemented + activation-verified (run 1023:
post5 S fills 15 vs 30 releasing vs 43 baseline) — v17o grid is now
4 cells (k .03/.06/.12 releasing + k .06 sticky); (e) flag-timing
sensitivity (m3/m5/m7) supports continuous form, grace {3,5}; (f)
§11.1 concentration replicated on 1009 (−104.1k vs −3.1k). All in
pair-v17o.md §§5–9 with banked submit + readout literals.

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

(The s28 7-run in-flight table was removed at s37 — those runs landed
as 1008–1029 and were read/closed in s30–s34; see the memory files.)

## Audit note

M1–M5 implemented and verified at 4809a8e (s26 correction stands).

### Five-session audit s30–s34 (done in s35, 2026-08-01T01:25Z) — PASS

- **Gates:** s30 GREEN (E-042-follow-up neutral analysis: S-toxicity
  price-uniform + verified S-split instrument; s26–s30 audit), s31
  GREEN (neutral: pair.v17t built, dosing defect found+fixed via
  activation check, runs 1014–1017), s32 GREEN (blocked-stub:
  run-row timing model corrected with evidence, v17t submit literals
  banked), s33 GREEN (blocked-stub: full readout runbook built, both
  SQL literals verified against known answers), s34 GREEN
  (E-043/E-044/E-045 closed via runbook, v17o built+verified
  1018–1023, two grids frozen, 8 FULL submitted). **5 GREEN / 0
  YELLOW / 0 RED**; every gate present with evidence pointers.
- **Time to evidence:** 2 / 1 / 1 / 1 / 0 min — all PASS (the two
  blocked-stub sessions resumed in-flight evidence at min 1, per
  gate records).
- **Throughput:** 3 experiments closed (E-043 DOSE-FLAT, E-044
  MAKERTILT-BETTER@bps10, E-045 P*-LIVE +5.44), 1 probe + 2 grids
  frozen and submitted (E-045b, v17t×3, v17o×4 = 8×10,747 whole-grid
  up front, queue-verified), 2 strategies built (v17t, v17o), 10
  local sequential runs, 7 FULL rows read, ~25 read-only DB scans.
  No unexplained serial scans; two sessions were genuinely
  drain-blocked (harness restarted the loop 0–2 min after close) and
  banked verified readout infrastructure instead — honest and
  productive use.
- **Binding requirements:** $2,000 + 500–1,000 matched-share check
  remains CLOSED by E-036 (no new scale claims since). Directional
  controller actively led (E-042→E-044→E-046 mapped). M1–M5: files
  untouched since 4809a8e (verified this session, git log empty).
  Mission §2 pair-VWAP fraction reporting produced for the first
  time (pair-v17.md §11) — a standing mission deliverable now on
  record. Neutral baseline moved on evidence (P* 0.92, run 1029).
- **Premature-closure check:** E-043 width close followed its frozen
  mapping (both named bars failed at FULL). E-045's winner sits at
  the grid edge and was NOT declared final — the E-045b p90 edge
  probe was pre-registered and submitted instead. No silently
  closed requirements found.
- **Next-five plan (s35–s39):** (1) s35: E-046 freeze + submit
  (maker-tilt dose/persistence at bps10 on the 0.92 center — GREEN
  directional); (2) read the 8 in-flight rows + E-046 rows, apply
  frozen mappings (GREEN evaluation, neutral+directional); (3)
  mapped follow-up from v17t/v17o verdicts (winner refinement or
  axis close — GREEN neutral); (4) mapped follow-up from
  E-046/E-045b (re-center or iterate — GREEN); (5) at most one
  YELLOW diagnostic only if a verdict demands mechanism digging.
  s40 = next audit. ≥3 direct GREEN controller increments
  guaranteed.

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

1. **Read the 13 in-flight rows** (drain ≈04:45–05:00Z; table in
   HEADLINE STATE): map batchUids → run ids via backtest_runs.batch_uid,
   integrity per e043-e045-readout.md step 2 (identical-96-set rule,
   pairwise common 10,651 vs 1029), paired deltas via the step-3
   template vs **1029**. Frozen bars: pair-v17t.md §4/§5 (+§6 minute
   prior), pair-v17o.md §4/§10 (+§7 mechanism literal, §11 prior),
   pair-v17.md §12 (E-045b), pair-v17m.md §6 (E-046; t40dup = noise
   check only) **+§7 calibrated inputs: engagement baseline 61.6/38.4,
   residue expectation ≈1,226**. Suggested order: p90 → v17t/v17o →
   E-046. Apply the frozen mappings.
2. **Mapped follow-ups** from those verdicts (winner refinement, axis
   close, or re-center; each file names its own decision mapping).
3. **P-013 (needs human):** sell-side mirror scope ruling (PROPOSALS).
4. Cross-symbol replication: gated on P-012.

## Alignment gate — session 35 (final)

- **Classification:** directional-controller (E-046 frozen +
  submitted) + mandated five-session audit (mission §7.2, done first).
- **Contribution (controller decision changed):** the E-044-mapped
  maker-tilt iteration moved from mapping to a frozen, submitted
  experiment: 4 FULL cells (dose 40/80/160 + persistence 1000 ticks
  at bps10 on the P*0.92 center) with named bars
  (TILT-EV-REAL-92 / DOSE / PERSIST / ALL-NULL+ENGAGED /
  ENGAGEMENT-STARVED) and decision mappings frozen at 8c287bc BEFORE
  submission. Audit s30–s34 PASS (5 GREEN, no premature closures,
  M1–M5 files verified untouched). Evidence: pair-v17m.md §6, commits
  8c287bc + this close; queue verified 13 aggregates.
- **Time to evidence:** fleet verify min 1; audit (required before
  new research) written by min ~13 from existing gate records +
  2 verification queries; E-046 submission started min ~6 after
  audit completion. PASS.
- **Throughput:** 1 experiment frozen + submitted (5 × 10,747
  including the accidental t40dup — whole grid up front,
  queue-verified); 4 read-only checks (queue ×2, cmd literals,
  git-identity ×2). No serial scans. 13 FULL runs in flight total;
  no readout possible before drain (~04:45Z) — recorded, not waited
  on.
- **Scale:** closed by E-036 on record; all cells B=500.
- **Next:** read all 13 rows vs 1029, apply frozen mappings (GREEN,
  neutral + directional evaluation), then the mapped follow-ups.
- **Verdict:** **GREEN.**
- Verdict history: s31 GREEN, s32 GREEN, s33 GREEN, s34 GREEN,
  s35 GREEN (audit s30–s34 PASS this session). Next audit: s40.

## Alignment gate — session 36 (final)

- **Classification:** neutral-controller (drain-blocked analysis-only
  session, declared up front; no fleet submissions by design — adding
  queue load would have delayed the 13-row drain).
- **Contribution (controller decision informed):** the mission §2
  metric report and the loss identity now exist on the STANDING
  baseline 1029, not just the old center: fractions <0.98/<0.95/<0.90
  = 30.2/23.1/5.4% at P*0.92; loss still 100% in the 100–250 matched
  bucket; post-min-5 S toxicity −38.7k ≈ 45% of the baseline loss;
  healthy-pace population 4.7%. Direct consequence recorded BEFORE
  readout: v17o cells must be read as near-global tightening with
  structurally tiny false-flag cost (pair-v17o.md §11) — this changes
  how the frozen ENGAGEMENT metrics will be interpreted. Evidence:
  pair-v17.md §13, pair-v17o.md §11, this session's sql.ts outputs.
- **Time to evidence:** fleet verify min ~3, first substantive 1029
  query min ~10. PASS.
- **Throughput:** analysis-only (declared): 6 read-only DB scans (2
  fleet + 4 JSON_TABLE aggregations over 10k-market run 1029), 2
  memory sections written. No serial scans; no fleet runs expected —
  13 in flight, none readable before ≈04:45Z (verified twice).
- **Scale:** closed by E-036 on record; no new scale claims.
- **Next:** read all 13 rows vs 1029 (drain ≈04:45–05:00Z), apply
  frozen mappings — GREEN (neutral + directional evaluation), order
  p90 → v17t/v17o → E-046.
- **Verdict:** **GREEN.**
- Verdict history: s31 GREEN, s32 GREEN, s33 GREEN, s34 GREEN,
  s35 GREEN, s36 GREEN. Next audit: s40.

## Alignment gate — session 37 (final)

- **Classification:** neutral-controller + directional-controller
  evaluation prep (drain-blocked analysis-only, declared up front; no
  fleet submissions — 13 rows land ≈04:45Z, verified 01:39Z).
- **Contribution (controller decision changed):** two frozen-bar
  INPUTS that were quoted from the wrong baseline are now measured on
  the actual reference 1029: the E-046 engagement clause reads against
  S split 61.6/38.4 (not 1008's 58/42 — a 3.7-pt shift that directly
  moves the ENGAGED/STARVED boundary) and the residue expectation is
  pinned at ≈1,226 (the frozen formula's value; §6's 55–60% guess was
  wrong). Plus the v17t k-cell reading prior (minute curve on 1029).
  Known-answer checks on 1008 passed before each measurement; two
  independent methods cross-check (−39.8k ≈ §13's −38.7k−1.1k).
  Evidence: pair-v17m.md §7, pair-v17t.md §6, this session's sql.ts
  outputs.
- **Time to evidence:** fleet verify min 1, first substantive query
  (known-answer 1008) min ~6. PASS.
- **Throughput:** analysis-only (declared): 7 read-only DB queries (1
  fleet + 6 sql.ts incl. two 10k-market JSON_TABLE aggregations), 2
  memory sections written. No serial scans; no fleet runs expected
  before ≈04:45Z.
- **Scale:** closed by E-036 on record; no new scale claims.
- **Next:** read all 13 rows vs 1029 (drain ≈04:45–05:00Z), apply
  frozen mappings with the §7/§6 calibrated inputs — GREEN, order
  p90 → v17t/v17o → E-046.
- **Verdict:** **GREEN.**
- Verdict history: s31 GREEN, s32 GREEN, s33 GREEN, s34 GREEN,
  s35 GREEN, s36 GREEN, s37 GREEN. Next audit: s40.

## Blockers

None. 13 FULL runs in flight (table in HEADLINE STATE) — rows land
together at full queue drain ≈04:45–05:00Z 2026-08-01 (do NOT
resubmit — fleet.ts first, then map batchUids via the
backtest_runs.batch_uid query).

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
  v16 τ+160 no-ceiling = 1005 (f1); **v17 P*0.92 neutral p92 = 1029
  (the standing FULL neutral baseline since s34); v17 P*0.96 neutral
  g0 = 1008 (older comparisons); v17 best directional g3 = 1009.**
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
