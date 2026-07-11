# AUDIT — U75 R5-closure unit (fresh-context verifier)

_Commissioned session 57 after U75 (commit 3879b95), per the D31 practice.
Report reproduced VERBATIM below. Disposition (U75b, same session): all four
findings applied — (1) MAJOR: `simulatorBias` (the only field the validator
gates registration on, and the only label needing regex-escaped parens + §)
is now asserted on both the full and bare fixtures; (2) the `\n##` wrap-stop
arm pinned via a new fixture 4; (3) the transcription check re-run in-session
on ALL 11 runs (341/355/356 added: 10-4-6, 10-8-23, 10-8-33 — identical to
raw SQL) and the FILLS-RECOMPUTATION note amended to state the original 8/11
scope; (4) `holdoutEndMs`-null (submit.ts holdout-stage gate) and digitless
`numOrNull` arms asserted. Selftest is now 33 assertions, all green._

---

VERDICT: **sound-with-findings**

# Findings

**1. MAJOR (over-claimed coverage): "all/every parseSpecFile extractions" is false — `simulatorBias` is never asserted.**
Evidence: `fable-lab/tools/lib/spec.ts:74` extracts `simulatorBias`; the FULL fixture even contains the field (`fable-lab/tools/spec-selftest.ts:64`) but no `check()` reads `full.simulatorBias` or `bare.simulatorBias` — I enumerated all 26 call sites. This field is load-bearing: `fable-lab/tools/validate-experiment.ts:57` gates registration on it (`if (!spec.simulatorBias) bad(...)`). It is also the only field whose label requires regex-escaping of literal parens + `§` (`'Simulator-bias exposure \\(CAPABILITIES §4\\)'`, spec.ts:74) — precisely the kind of label where an escaping defect would bite, and precisely what the selftest does not pin. The over-claim is propagated: DECISIONS.md:1732 ("every parseSpecFile extraction"), STATE.md:1532-1533 ("every parseSpecFile extraction"), tools/README.md:30 ("all parseSpecFile extractions"), AUDIT-COVERAGE.md:74 ("all parseSpecFile extractions"). Mitigating: a defect here fails loud (validator falsely reports a missing field) rather than silently corrupting a submitted command — but by this lab's own U70 precedent, an over-claimed coverage row is MAJOR.

**2. MINOR (claimed stop-arm unpinned): field()'s `\n##` wrap-stop condition has no assertion.**
D47 (DECISIONS.md:1730-1731) and the selftest header (spec-selftest.ts:20-21) claim wrapping stops "at the next `- **` field, at `## `, or at TRUE end-of-input" are pinned. Re-deriving each of the 26 expectations against `spec.ts:37`: every asserted field in fixture 1 terminates at `\n- \*\*`, fixture 2 terminates at end-of-input, and no asserted field anywhere terminates at `\n##`. (The `## Runs` exclusion test at spec-selftest.ts:94-98 exercises the *placeholder* split at spec.ts:55, a different mechanism.) Not currently load-bearing in real specs (every extracted field there is followed by another `- **` field), but the stated contract is one-third unasserted.

**3. MINOR (transcription check narrower than restated): fills.ts was re-run on 8 of 11 runs, restated as all.**
FILLS-RECOMPUTATION-2026-07-11.md:45-46 shows the actual command: `fills.ts 337 338 339 340 352 353 357 358` — runs 341, 355, 356 omitted. D47 (DECISIONS.md:1741-1742, "fills.ts re-run on the same runs prints identical values"), STATE.md U75 entry ("fills.ts re-run prints identical numbers") and AUDIT-COVERAGE.md:70 ("transcription re-run identical") read as full coverage. I closed the gap myself: ran `fills.ts` on all 11 runs — every n/filledMarkets/makerFills/takerFills identical to the raw SQL and to the doc, so no substantive error, but the restatement is broader than what was executed.

**4. MINOR (fallback asymmetry): `holdoutEndMs`-null and digitless-`numOrNull` arms unasserted.**
The bare fixture checks `holdoutBoundaryMs → null` (spec-selftest.ts:128) but not `holdoutEndMs → null`, even though `submit.ts:140` gates the holdout stage specifically on `holdoutEndMs == null`. `numOrNull`'s second arm (field present but digitless → null, spec.ts:81-82) is also untested. Both failure modes are loud; trivial.

# Claims positively re-verified

**HALF A.** (1) Selftest re-run: exit 0, exactly 26 PASS lines (26 `check()` call sites; the 27th grep hit is the function definition). (2) Independent derivation: I re-derived all 26 expectations from spec.ts's regexes by hand — all correct, including the subtle ones: the U10 EOF fixture (lazy match to `(?![\s\S])` keeps all 4 params), backtick-stripping before `--param` matching, `\S+=\S+` capturing `b=[0.1,0.2]`, placeholder alternation order (`EXP-NNN` absorbing its `NNN`, Set-insertion-order dedupe, second `<fill-me>` deduped, post-`## Runs` token excluded), title em-dash regex, whitespace collapse. No expectation mirrors tool output; the only real-world-state dependency is the documented `resolveSpecPath('EXP-001')` registry hit. (3) Fixture faithfulness: I parsed all 9 real registry specs + the template with spec.ts — every field extracts as expected (full params lists, both holdout bounds, zero placeholders on all 9; template yields the expected 17 placeholders and null expId). The one shape difference (real Strategy fields use `` `path`, id `id` `` with a comma; fixture omits it) is inert — both regexes at spec.ts:48-49 ignore the comma. No real-file shape parses differently from the pinned fixture shapes.

**HALF B.** (1) Re-ran the published SQL read-only (throwaway script under fable-lab/logs/, since deleted; only trade_as_maker/trade_as_taker + runs params/batch_uid selected, no pnl/outcome columns): all 11 rows reproduce the doc's recomputed column exactly, and taker_fills = 0 on all 11 as claimed. (2) Every "published (unit)" figure is really published where claimed and matches: U29 (STATE.md:321-335) 12/30+26 fills, 6/30, 3/30, 7/30, run 341 10 markets/6 maker fills; U35 (:401) runs 352/353 = 2/8+5 and 8/8+19; U36 (:420) 355/356 8/10 filled; U38 (:447) 392 played/1324 fills; U39 (:460) 348 played/1482 fills. The doc correctly marks 338's fill total and 355's totals as unpublished. (3) Static check confirmed by my own read of fills.ts:27-39 — selects exactly `backtestRuns.{id,params,batchUid}` and aggregates over `tradeAsMaker`/`tradeAsTaker` filtered by `runId`; no pnl/outcome/win/skip_reason column anywhere; the fixed header (fills.ts:9-11) now accurately documents the removed skip_reason claim. (4) Cell binding: DB params for 337/338/339/340 = (offset, jumpSize) (0.01,0.10)/(0.02,0.10)/(0.03,0.10)/(0.02,0.05), all `EXP-000-debug` — exactly the E15 cells in the U29 STATE entry, primary (0.01,0.10) → run 337.

**PROPAGATION.** "26 assertions" (D47, STATE, AUDIT-COVERAGE:74) — correct. "11 runs, all match" (D47:1739-1740, STATE, AUDIT-COVERAGE:70, R5 entry :123-127) — correct. tools/README.md:30 row present and accurate apart from the "all extractions" wording (finding 1). AUDIT-COVERAGE section-2 rows (fills.ts B+C+E, lib/spec.ts D+E) and section-4 R5-CLOSED entry consistent with the evidence, modulo findings 1 and 3.

**CHARTER.** Commit 3879b95 touches 8 files, all under fable-lab/ (0 outside). `wakeup.ts` check 6: `[ok] confirm-010-freeze: byte-identity holds since c403d7d (3 files, no commits, worktree clean)`; all wakeup checks green, RESULT "gated state holds".
