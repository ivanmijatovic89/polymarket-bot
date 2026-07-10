# AUDIT — VENUE-DRIFT instrument (fresh-context, 2026-07-10, U46)

_Auditor: fresh-context subagent with no session history; target: the
venue-drift monitoring instrument (`knowledge/VENUE-DRIFT.md`,
`tools/venue-drift.ts`, `strategies/_fixtures/diag-venue.ts`) — the sole
mechanism through which EDGE-SPACE §4's "venue regime change" clause can
fire. Motivation: the instrument gates all regime-reopening decisions,
successors will run the refresh against its bands as soon as the operator
syncs new data, and it had never been fresh-context audited. Report
preserved verbatim below; session follow-ups (two empirical settlements
from the surviving baseline log, which the auditor did not have) and the
actions taken are appended after the report._

---

**VERDICT: sound-with-findings** — band arithmetic, pooling arithmetic, tool/doc semantics, and outcome safety all verify; but two of the three triggers have quantifiably thin false-fire margins against the baseline's own month-to-month dispersion, and the pooled reference values cannot be reproduced with the checked-in tool (blocking re-baselining after a fire).

## Findings (by severity)

**1. MAJOR (false-fire risk) — the crossedFrac trigger is only ~14% above a value the baseline itself produced.**
Evidence: `fable-lab/knowledge/VENUE-DRIFT.md:54,67`. The trigger is ≥ 2× the pooled mean 0.0012 → fires at ≥ 0.0024. But baseline month 2025-12's mean is **0.0021** — 1.75× the pooled reference, just 12.5% below the trigger, and inside the baseline. Baseline monthly means span 0.0004–0.0021, a **5.25× range**, while the trigger is only 2× the (sample-weighted, recomputed-and-confirmed: (28·0.0021+24·0.0012+30·0.0008+30·0.0009+30·0.0011)/142 = 0.001208) mean. A recurrence of Dec-2025-like conditions — demonstrably "normal variation" — fires or nearly fires the bar and would falsely reopen E9–E17 questions on noise. Compounding: crossedFrac uses a **mean** (venue-drift.ts:81-82) over ~30 markets, so 1–2 E6-artifact-heavy markets in a random draw can dominate a month's value. The trigger is not robust at n=30.

**2. MAJOR (false-fire risk) — the depth band is only ~1.5–1.9σ wide relative to observed monthly-median dispersion.**
Evidence: `VENUE-DRIFT.md:54-58,66`. Log-ratios of the five baseline monthly depth medians vs the pooled 479.4: [−0.391, +0.461, +0.548, −0.226, +0.041]; mean 0.087, sd **0.412**. The band edge ln(2)=0.693 sits at z ≈ **1.47** (upper) / **1.89** (lower) of that dispersion → ~7% + ~3% ≈ **~10% false-fire probability per evaluated month for depth alone**, under conditions statistically like the baseline. Concretely: baseline months 2026-01 (760.2 = 1.59×) and 2026-02 (829.2 = 1.73×) already approach the 2× edge from inside the baseline — a recurrence of a Feb-2026-like month plus modest sampling noise fires. With three OR'd triggers (VENUE-DRIFT.md:29-31), per-refresh false-fire probability is materially above the level appropriate for a bar that reopens settled questions. Symmetric false-quiet: any real regime change smaller than ~2× is undetectable by construction. n=30/month is adequate only if the intended detectable effect is ≥ ~2×; the doc never states this power trade-off.

**3. MAJOR (re-derivation gap) — the pooled reference values are not reproducible with the checked-in tool, so re-baselining after a fired regime change is not executable as written.**
Evidence: `fable-lab/tools/venue-drift.ts:65-88` computes **only per-UTC-month** aggregates; it has no pooled mode. The pooled depth 479.4 (`VENUE-DRIFT.md:66`) is **not** the median of the five monthly medians (recomputed: median(324.4, 382.4, 499.6, 760.2, 829.2) = **499.6**), so it must be the median over all 142 per-market depthMeds — but the doc never states which convention it is, and no command that produces 479.4 (or the informational rate 130.32) is recorded anywhere in the file. Refresh against the *fixed recorded* numbers is executable; but after a fire, a successor establishing a new-era pooled baseline (the natural next step, unaddressed by the refresh procedure at lines 76-91) cannot re-derive values with the same semantics. The ×/÷2 band **rule** itself is stated explicitly enough (lines 29-31 and D17, DECISIONS.md:395-400) — the gap is only the pooling convention/tooling.

**4. MINOR — 2026-01 has 24 markets, below the doc's own stated floor, undisclosed.**
`VENUE-DRIFT.md:22` says the flush artifact loses at most the final market per chunk ("Expect 28-30 markets per month cell") — verified in code: `diag-venue.ts:83-84` flushes intermediate markets on market change, so only the chunk's last market can be lost, and additionally any market producing zero ticks never logs. 24 (line 55) means 6 markets missing from one 30-market chunk; the cause (likely empty/tick-less parquets) is neither the documented artifact nor disclosed, and it thins that month's contribution to the pooled reference.

**5. MINOR — "Crossed ticks are excluded from sampling" is imprecise: only UP-crossed ticks are excluded.**
`VENUE-DRIFT.md:17` vs `diag-venue.ts:118`: the sampling gate is `!isCrossed(up)`; a tick where only the DOWN book is self-crossed is still sampled (defensible since the sampled metrics are UP-side, but the doc wording overclaims). crossedFrac itself correctly counts either-book crossing (line 110), matching line 16.

**6. MINOR — fire semantics are clear on trigger, incomplete on consequence.**
Trigger is unambiguous: **a single refreshed month**, **any one of the three metrics** (`VENUE-DRIFT.md:26-31`, "A refreshed month is... if... or... or"). Consequence mapping is partial: step 4 (lines 87-90) gives mechanism linkages for spread (maker economics) and crossed (recording quality / E6) but **none for depth**, and whether a fired month reopens all E9–E17 conclusions or only the mechanism-linked question is left to session judgment. Also, crossedFrac fires only upward — a 3–5× *improvement* (2026-06's 0.0004, which the doc itself calls a quality change at line 73) can never fire; if intentional, it is unstated.

**7. MINOR — `--random` is unseeded SQL `RAND()`; a fired refresh row is not reproducible.**
`src/db/telonexMarkets.ts:236` (`orderBy = sql\`RAND()\``). The refresh procedure (`VENUE-DRIFT.md:81-83`) never states this. A successor cannot re-run a fired month and expect the same 30 markets, so a marginal fire (findings 1-2 show marginal fires are likely) cannot be distinguished from draw luck by exact replication — only by an independent redraw, which the procedure doesn't call for. Step 2 also omits that the run's stdout must be captured to a log file for step 3's aggregator (the baseline log `logs/venue-drift-baseline.log` is gitignored per the task brief; implied but unstated).

## Checks that PASS (recomputed)

- **(a) Band arithmetic**: 0.5×0.0100=0.0050, 2×0.0100=0.0200 ✓; 0.5×479.4=239.7, 2×479.4=958.8 ✓; 2×0.0012=0.0024 ✓ (`VENUE-DRIFT.md:65-67`).
- **(b) Pooling consistency**: 28+24+30+30+30 = **142** ✓ (line 62); +30+26 = **198** total ✓ (line 37); pooled crossedFrac mean recomputes to 0.001208 → 0.0012 ✓; pooled depth 479.4 ∈ [324.4, 829.2] monthly range ✓; pooled spread 0.0100 = every monthly value ✓; 2026-05/06 correctly held out of the pooled reference ✓.
- **(c) Tool vs doc**: venue-drift.ts computes per-UTC-month (slug-epoch-based, lines 66-68) median-of-per-market-medians for spread/depth/rate and mean for crossedFrac, exactly as documented (line 18-19), with cross-file slug dedupe matching "unique markets parsed". Fixture matches: 10s default sampling (`diag-venue.ts:23`), UP spread (line 120), UP bid0+ask0 depth (lines 121-123), either-book crossedFrac (line 110), 780s flush on episode clock from slug epoch (lines 112-114), flush-on-market-change explaining the documented end-of-chunk artifact (lines 83-84, 56-70). Only mismatch is finding 5. (Nano-nit, not counted: the first post-780s tick increments `ticks`/`lastTs` before the flush check, so rate spans marginally past 780s.)
- **(d) Outcome safety**: CONFIRMED. `diag-venue.ts` returns `[]` from both hooks (never places orders), ignores the portfolio parameter (`_portfolio`), reads only `tick.snapshot` book fields, and emits only book statistics; no resolution/PnL/win-rate symbol appears anywhere in fixture or aggregator.
- **(g) Refresh executability**: substantially executable — universe check, exact command shape with env pins, aggregation command, append-only table discipline, and fixed comparison values are all present (`VENUE-DRIFT.md:41-48, 76-91`). Gaps are findings 3 and 7.

## Bottom line

The instrument's arithmetic and code/doc alignment are solid, and the outcome-free discipline holds. The real exposure is calibration: the crossedFrac trigger (2× a mean, with a baseline month already at 1.75×) and the depth band (~1.7σ of observed monthly-median dispersion) both sit close enough to the baseline's own variation that false fires under normal conditions are a realistic — roughly 5-10%-per-evaluated-month — event, and the doc contains no statement of this residual risk or a tie-break protocol (e.g., mandatory independent redraw before citing a marginal fire). Since the bar was pre-specified in D17 before data, the bands cannot now be retuned without a new decision; the cheapest sound mitigation would be a D-entry adding a confirmation redraw requirement for fires within some margin of the edge, plus recording the pooled-aggregation convention and 2026-01's missing-market cause.

---

## Session follow-up (U46): two empirical settlements + actions taken

The auditor could not read the gitignored baseline log. It survives on
disk (`logs/venue-drift-baseline.log`, 198 diag lines), so the session
settled two findings factually:

1. **Pooling convention (finding 3) SETTLED:** the pooled reference is
   the statistic over ALL per-market values in the 2025-12 → 2026-04
   window (median for spread/depth/rate, mean for crossedFrac), NOT the
   median of monthly medians. Recomputed from the log: depth 479.4,
   spread 0.0100, rate 130.32, crossedFrac 0.001186 → 0.0012 — all four
   published values reproduce exactly. `tools/venue-drift.ts` gained a
   `--pooled YYYY-MM:YYYY-MM` mode implementing exactly this convention,
   verified to reproduce all four values on the baseline log
   (`pooled 142 0.0100 479.4 130.32 0.0012`); re-baselining after a
   fire is now mechanical.
2. **Missing-market cause (finding 4) SETTLED:** the log shows every
   chunk replayed 30/30 markets; 12 markets across three months emitted
   no diag line (2025-12: 2, 2026-01: 6, 2026-06: 4), each finishing in
   ~0s with `trades=0` — zero/near-zero-event parquets, invisible to the
   fixture. The documented "end-of-chunk flush artifact" NEVER fired
   (the 780s in-market flush emits before chunk end for any market with
   post-780s ticks); the doc's artifact paragraph was wrong about the
   mechanism and is corrected in VENUE-DRIFT.md.

Actions taken in this unit (all in the same commit): DECISIONS D27
(fire-confirmation redraw rule + residual-risk statement — bands
unchanged, per pre-specification discipline), VENUE-DRIFT.md amendments
(pooling convention + pooled-mode command recorded; missing-market cause
corrected; UP-crossed sampling wording fixed; depth consequence mapping
+ upward-only crossedFrac noted; unseeded RAND() + log-capture step
added; false-fire risk stated with the D27 rule), venue-drift.ts
`--pooled` mode (tsc clean, verified against published values).
