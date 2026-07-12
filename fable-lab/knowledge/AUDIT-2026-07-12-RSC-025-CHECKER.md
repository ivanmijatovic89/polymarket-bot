# AUDIT 2026-07-12 — RESCUE-025 program checker (fresh-context, pre-ledger)

_Mandated by RESCUE-025.md "Integrity requirements": one fresh-context
checker over the program verdict (sweep table + winner derivation +
confirmation read) before the terminal verdict is ledgered. Checker ran
read-only with its own SQL, session 69. Report preserved VERBATIM below;
disposition of findings follows at the end._

---

# VERDICT: SOUND-WITH-FINDINGS

The program reproduces end to end: the frozen winner rule mechanically selects V32 from the sweep table, every published confirmation number reproduces from independent SQL against the database, the pre-committed draw regenerates to the exact frozen sha256, all 8 shards replayed exactly their drawn slug sets, window integrity holds, and DEAD FOR GOOD follows mechanically from the frozen bar. The findings are two minor arithmetic/units slips in the verdict prose and one latent tool defect that did not affect this verdict.

## What reproduced exactly (my independent recomputation)

- **Confirmation pool (runs 584–591, my own SQL over `backtest_run_markets`):** N=4000, played=288, won/lost=202/86, winRate=202/288=0.701389→0.7014, mean pnl=−0.1307675→−0.1308, sd(n−1)=8.421236→8.4212, q̂=−0.0155284→−0.0155, t=q̂·√4000=−0.98209→−0.9821, CI95=[−0.3917, +0.1302], maker=0, taker=288, fees=73.8100. Every digit matches the published block (RESCUE-025.md lines 335–337). No zero-pnl played markets, so played=won+lost is consistent.
- **Winner derivation:** eligible set (fail=0 ∧ played≥100 ∧ q̂>0) per the table excludes exactly V29(90), V19(85), V40(79), V21(53), V11(72), V31(70), V36/V37/V39/V25/V26/V35 (q̂≤0); highest-t eligible is V32 (t=+3.25 ≥ +1.5), runner-up V30 (t=+2.84). The table's per-row "eligible" flags are all consistent with the rule. Correct.
- **Sweep table vs DB:** I recomputed all 40 rows (runs 543–582) from `backtest_run_markets` — N, played, won/lost, q̂, t, EV all match to published rounding (differences ≤0.001 in EV, pure rounding). All 40 completed, failures_count=0, exactly one run per RSC-025-V01..V40, and **zero** sweep markets with market_start_ms ≥ 1772323200000.
- **Draw pre-commitment:** re-ran the committed seeded Fisher-Yates (seed `RESCUE-025-draw-1`, djb2+LCG, replicated read-only from `fable-lab/tools/rescue-draw.ts`) over today's eligible reserve list: eligible reserve=5,460 (matches line 123), sha256 = `b77ba0cbf26a4c854d919992aff2eb2c262dd79d04c10ceacbb5d87b3f51e6b3` — byte-identical to the frozen value (line 128). All 8 round-robin shards (500 each) match each run's replayed slug set: missing=0 extra=0 on every shard, with the shard→run mapping in the file (S0→591, S1..S7→584..590).
- **Integrity:** exactly one `backtest_runs` row per RSC-025-CONFIRM-S0..S7, all completed, markets_persisted=500=input_markets_total each; failures_count=0 on all 8 and zero rows in `backtest_run_failures`; all 4000 market_start_ms in [1772323200000, 1777236300000] ⊂ reserve window, zero at/above the holdout floor 1777237200000; all 4000 slug epochs ×1000 inside the window; 4000 distinct slugs. All 9 runs (578 + confirmations) ran `fable-rsc-025` with identical params matching V32's frozen grid cell exactly (segThresh1=0.03, segThresh2=0.03, ratioMin=1; rest defaults).
- **Bar/verdict:** q̂=−0.0155 ≤ 0 fails clause 1; t=−0.98 < 1.5 fails clause 2; played=288 ≥ 100; winRate 0.7014 ≤ 0.9 so E14 n/a. DEAD FOR GOOD follows mechanically. Sanity on verdict prose: se(q̂)=1/√4000=0.0158 ✓; (0.03−(−0.0155))/0.0158=2.88≈"2.9 se below +0.03" ✓; p≈0.07 under null (P(Z≥1.5)=0.067) ✓; incidence 6.35% vs 7.2% ✓; winRate 0.764→0.701 ✓. No contradiction between the confirmation-result section and the frozen text above it.

## Findings

1. **MINOR — fees-per-played-market figure is wrong: "~29c" should be ~26c.** RESCUE-025.md line 364: "With ~29c average taker fees per played market (73.81/288)". 73.81/288 = 0.2563 = ~25.6c, not ~29c. The parenthetical division is correct; the stated cents value is not. Directionally the argument (fees exceed the fresh-sample gross mix) is unaffected, but the number as printed does not equal its own formula.

2. **MINOR — the "compatible at 1 se" claim mislabels its own bound (and has a units slip).** Line 354: "Only a very small true effect (roughly q̂ < +0.015 … under ~0.13c/market …) remains compatible at 1 se." At 1 se the compatible region is q̂_true < −0.0155 + 0.0158 ≈ +0.0003; the stated +0.015 corresponds to ≈1.93 se (≈95% one-sided), not 1 se. Also "~0.13c/market" is a units error: 0.015 × sd 8.4212 = $0.126 ≈ 13c (dollars, as evPerMarket is elsewhere), not 0.13 cents. Both slips are conservative with respect to the DEAD verdict (they overstate, not understate, what remains compatible), so the verdict is unaffected.

3. **MINOR (latent tool defect, no effect here) — `rsc-pool.ts` per-market failure check is vacuous.** `fable-lab/tools/rsc-pool.ts` line 36 counts `r.status === 'failed'` over `backtest_run_markets` rows, but that table has no `status` column (schema has only `skip_reason`; failures live in `backtest_runs.failures_count` and the separate `backtest_run_failures` table, and failed slugs never get a `backtest_run_markets` row at all). So the tool's `failures=0` output is always 0 by construction. The published claim happens to be true — I verified failures_count=0 on all 8 runs, zero `backtest_run_failures` rows, and markets_persisted=500=input on every shard — and the pre-verdict checks cited in the file (line 320) checked this at the run level independently. But the tool should be fixed before reuse (e.g. for any future holdout-style pooled read), since a shard with failures <500 persisted plus this vacuous counter could silently under-count N instead of aborting; here the `markets=500` per-shard output made that visible.

4. **Note (not a defect):** 3,712 of the 4,000 confirmation rows carry skip_reason='no_in_window_activity' and exactly equal the non-played set; they enter N with pnl=0 per the stated "q̂/t over all N" results.ts convention, consistent with how the sweep rows were computed — apples-to-apples.

Everything the verdict rests on — winner selection, pre-commitment, sample integrity, pooled arithmetic, bar evaluation — reproduces exactly. The two prose slips are in the post-verdict interpretation text and do not change any frozen-bar clause or the terminal verdict.

---

## Disposition (session 69, same unit)

- Finding 1 (MINOR): fixed in place in RESCUE-025.md with attribution
  ("~29c" → "~26c").
- Finding 2 (MINOR): the interpretation sentence rewritten in place with
  attribution — correct 1-se bound (q̂_true ≲ +0.0003), the +0.015 figure
  relabeled as the ~95% one-sided bound, and the units error fixed
  (≈13c/market, not 0.13c). Conservative direction confirmed: verdict
  unaffected.
- Finding 3 (MINOR, latent tool defect): rsc-pool.ts fixed — failure
  count now reads `backtest_runs.failures_count` (run level) and the
  tool asserts rows.length equals the run's persisted-market count,
  aborting on mismatch instead of silently under-counting N. Verified by
  re-running on the 8 confirmation shards: output identical to the
  published block (failures=0 now a real check).
- Note 4: no action.
