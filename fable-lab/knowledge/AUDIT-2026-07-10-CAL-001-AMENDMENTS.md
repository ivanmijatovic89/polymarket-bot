# Audit: CAL-001 mid-run amendments #11/#12 + LESSONS E9 addendum

Fresh-context adversarial verifier, session 18 (U43t), run while the
CAL-001-discovery-v3 replay was in flight (~2,646/8,516 markets). Report
preserved verbatim below. Actions taken on the findings are recorded in
STATE.md U43t and the touched files.

---

# ADVERSARIAL VERIFICATION — CAL-001 mid-run amendments #11/#12 + LESSONS E9 addendum

**VERDICT: sound-with-findings.** Both amendments are genuinely outcome-free in what they *reported*, change no frozen constant/gate/threshold, and #12's core measurement replicates exactly on my independent recompute of the grown log. The economics and statistics of #12 are correct. The defects found are one over-generalization in the LESSONS E9 addendum (MAJOR) and process/wording issues (MINOR).

## Independent recompute (task 4)

Own script (pairing by (slug, off), first-occurrence dedupe per (slug, asset, off), matching calib.ts semantics), run against `fable-lab/logs/CAL-001-discovery-v3.log` at its current size:

- 32,706 diag lines, 0 duplicate (slug,asset,off) keys, 2,646 markets.
- **16,353 paired (market, offset) samples; 16,352 satisfy `bid_DOWN = 1−ask_UP` AND `ask_DOWN = 1−bid_UP` exactly (4-dp); exactly 1 deviant** — the SAME one #12 reports: `btc-updown-15m-1764846000`, off=850, ts=850.0 for both assets, cross-sums 0.9500/0.9600. #12's 13,421/13,422 claim is confirmed and has extrapolated cleanly (~3,000 new pairs, zero new deviants).
- ts-mismatch pairs: 0 (every pair captured at the same 0.1s-logged tick).
- Per-offset coverage identical UP vs DOWN at every offset (2646/2644/2636/2630/2565/2049/1183) — itself a corollary of mirroring (an uncrossed UP book implies an uncrossed DOWN book on the same tick). 850s coverage 1183/2646 = 44.7%, consistent with #11's 43.0% at its earlier snapshot.

## Findings

**1. MAJOR — LESSONS E9 addendum over-generalizes beyond the measurement, and quietly closes E9's own reserved re-registration angle.**
Evidence: `fable-lab/knowledge/LESSONS.md:77-84` claims the books mirror "by venue construction, not merely 'beyond fees at sampled entries'" and "any pair-arbitrage or dutch-book re-skin is dead by structure; the only deviations possible are transient recording artifacts". Three overreaches: (a) the measurement is of the *delta-typed converted Telonex dataset*, BTC 15m, top-of-book, at 7 offsets — it cannot distinguish venue-level mirroring from pipeline-level mirroring upstream. I verified the local converter does NOT synthesize one side from the other (`src/telonex/converters/deltaTyped.ts:199-204` carries `up` and `down` ticks independently from raw files), but the Telonex raw feed upstream is unverified from here. (b) Depth was never measured (the fixture logs top-of-book only, `diag-calib.ts:76-78`), yet the original E9 (`LESSONS.md:73-74`) explicitly reserved "depth beyond top-of-book" as the legitimate re-registration angle — the addendum deletes that escape hatch by structural inference, not measurement. (c) "the only deviations possible are transient recording artifacts" states an impossibility from a 1-in-13k frequency observation.
Recommended action: rescope the addendum to "in the delta-typed recorded dataset, at top-of-book, the two books mirror exactly (1 deviant in 16k+ pairs); consistent with the venue maintaining one order set" and restore the depth caveat, or explicitly cite venue mechanics as a *prior*, not a measured fact. This is a knowledge-base edit, safe to make now (LESSONS is not part of the frozen analysis).

**2. MINOR (outcome-freedom, #12) — the reported statistic is leak-free, but the measurement procedure had unregistered price exposure.**
Analysis: the mirror identity `bid_DOWN + ask_UP = 1` is invariant under UP↔DOWN relabeling — the pass/fail counts and the deviant's cross-sums (0.95/0.96) carry zero directional information, so nothing reported in #12 or E9's addendum can bias the frozen gates or the sign of any cell. The frozen constants (k=126, z≥3.565, minority≥30, subwindow rule, both abort gates) are mechanical in `tools/calib.ts:40-41,199-226,248-259`, leaving discretion only in verdict/LESSONS wording — and #12(b) *tightens* that discretion rather than loosening it. However: unlike #11 (timing fields only), the #12 measurement necessarily read late-window bid/ask fields, which per-market are strongly outcome-correlated at 850s; nothing pre-registered the measuring script or constrained its output to symmetric aggregates, and inspecting the deviant's raw prices (rather than only its cross-sums) would have effectively revealed that one market's likely outcome. As reported, exposure is immaterial (≤1 market of 8,516, and only symmetric quantities were written down).
Recommended action: freeze a one-line rule in CALIBRATION.md (or LESSONS) for future mid-run checks: any measurement touching price fields must pre-commit its script and print only relabeling-invariant aggregates; per-sample price values may not be inspected before the one-shot read.

**3. MINOR (consistency) — #12 falsifies #10's premise but leaves the same falsified premise standing elsewhere in frozen text, unflagged.**
Evidence: #12 explicitly falsifies #10's "the DOWN ask has its own spread and is not 1 − UP bid" (`CALIBRATION.md:207-212`), but the identical claim also appears in the frozen decision rule ("the DOWN side has its own book and spread", `CALIBRATION.md:85-87`) and in the fixture header (`fable-lab/strategies/_fixtures/diag-calib.ts:7`). Neither is mentioned. No behavioral consequence (the NEG-FLAG rule's conclusion — not directly shortable — survives; the DOWN grid now IS the sell-UP measurement), and editing frozen text or committed fixture code mid-run would be worse than leaving it.
Recommended action: note both stale locations in the post-read erratum/results section; do not edit mid-run.

**4. MINOR (wording, #12b) — "an UP hit and its DOWN reflection" implies a cell-to-cell mirror that doesn't exist.**
Evidence: the UP grid buckets by `ask_UP`; the DOWN grid buckets by `ask_DOWN = 1 − bid_UP` — the mapping is shifted by the spread, so an UP cell's markets scatter across one-or-two DOWN cells rather than landing in a single "reflection". The constraint as written (don't double-count) is conservative and correct in spirit; the wording just shouldn't be read as an exact cell bijection.
Recommended action: when writing the verdict, treat *any* overlapping-sample cross-side pair as non-independent, not only exact reflections. No doc change needed.

## Direct answers to the task questions

- **#12 logic (task 2): correct.** Buying DOWN at `ask_DOWN = 1−b` pays `1−b` and returns 1 iff DOWN wins → PnL = `b − 1_{UP}` = exactly a short of UP at bid `b`, implementable without shorting; the fee `156bps·min(1−b, b)` is symmetric so the equivalence survives net. Non-redundancy holds: the DOWN cell tests `bid_UP` vs win rate; no UP cell tests anything but `ask_UP` vs win rate, and the spread strictly separates them. **Bonferroni at k=126 is statistically correct**: Bonferroni controls FWER under arbitrary dependence, including this near-deterministic mirror structure; the 126 hypotheses are distinct (ask-side vs bid-side), and to the extent dependence makes the effective test count smaller, keeping k=126 only costs power (conservative), never size. The claim in #12(c) is accurate.
- **Consistency (task 3): no frozen constant, gate, or threshold changed.** #11 and #12 add only interpretation constraints. `calib.ts` matches the frozen doc on every checkable item: Z_BAR=3.565 (:40), K=126 (:39), minority 30 (:41), fee formula per amendment #4 (:174), drift filter per #1 (:46,93), subwindows per #6 (:49-53), both gates per #2/#10 (:199-226), per-offset coverage per #8 (:112-123). The only #10 tension (cross-checkable vs not-independent) is compatible: consistency check ≠ double-counted evidence.
- **#11 (task 1): clean.** Timing/coverage fields carry no directional information; the conditional-on-activity interpretation matches what calib.ts actually estimates and coincides with in-engine tradability; my current-log coverage numbers reproduce its pattern.
- **Nothing outcome-related was read in this audit**: no DB result queries, calib.ts not run, no win rates computed; only log bid/ask/timing fields and source files.
