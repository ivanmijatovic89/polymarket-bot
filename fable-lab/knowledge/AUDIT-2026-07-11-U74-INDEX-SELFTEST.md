# AUDIT — U74 index-registry selftest unit (fresh-context verifier)

_Commissioned session 57 after U74 (commit 103ff1d), per the D31 practice.
Report reproduced VERBATIM below. Disposition (U74b, same session): all four
findings applied — (1) the D46 mis-cite corrected by an amendment AND the
plain-line verdict rule actually added to SCIENTIST.md's Judge step;
(2) regex tightened with a `(?!\*)` lookahead so the colon-inside-bold spec
field `- **Decision:** …` no longer matches (new assertion; inertness
re-proven byte-identical on the real INDEX); (3) fence/HTML-comment matching
pinned as ACCEPTED RESIDUE with two assertions (fence-stripping rejected:
real specs carry 2-10 balanced fences each, one unbalanced fence would
swallow a genuine later verdict); (4) STATE header "every shape" over-claim
reworded. Selftest is now 25 assertions._

---

# U74 VERIFICATION REPORT — commit 103ff1d

**VERDICT: sound-with-findings** — the selftest is real, hand-computed, passes 22/22 on re-run; the refactor is proven inert; propagation is largely faithful. One provenance claim in D46 is false, and the selftest's shape coverage is slightly over-claimed.

## Findings

1. **MAJOR — D46 mis-cites SCIENTIST.md as the source of the plain-line verdict rule.** `fable-lab/DECISIONS.md:1700-1701` says the U30 quirk is intended because "verdicts must be plain `- decision:` lines — SCIENTIST.md already instructs this." It does not. `fable-lab/protocol/sessions/SCIENTIST.md` contains no plain-line / no-blockquote / INDEX-parser instruction anywhere (grep for plain/blockquote/quote/index: only line 57 "append its verdict verbatim", which if anything permits pasting a Judge verdict blockquoted). The only place the rule is documented is the U30 Done note at `fable-lab/STATE.md:340-342`. This is exactly the D31 "restating from memory instead of quoting the source" defect class, and it matters: the justification for pinning the quirk as INTENDED behavior rests on an instruction that doesn't exist in the governing session doc.

2. **MINOR — un-pinned matching shape produces garbage status: colon-inside-bold.** `lastDecision('- **Decision:** kill if q<=0\n')` returns `"** kill if q<=0"` (verified by direct import). The selftest (`fable-lab/tools/index-registry-selftest.ts:56`) pins only the colon-outside form `**decision**: x`; the colon-inside form — the *same* typographic convention every real spec already uses for `- **Decision rules (…):**` — matches the regex and would render a garbage status in INDEX. Plausible false positive if a future spec writes its rule as `- **Decision:** kill if q≤0`. Not currently triggered: a corpus-wide regex sweep of all 9 registry files matched only true verdict lines, and the template matched nothing (re-verified).

3. **MINOR — regex matches decision lines inside code fences and HTML comment blocks; not pinned.** Verified: `lastDecision('```\n- decision: kill\n```')` → `"kill"`, and `lastDecision('<!--\n- decision: kill\n-->')` → `"kill"`. The template's verdict-fields HTML comment (`fable-lab/protocol/templates/EXPERIMENT.md:46`) escapes this only because no commented line happens to start with `decision:`. A spec quoting the verdict format in a fenced example would silently set status.

4. **MINOR — STATE.md header over-claims exhaustiveness.** `fable-lab/STATE.md:8-9`: "22 hand-computed assertions pin **every** matching/non-matching decision-line shape". Findings 2-3 show at least three matching shapes are unpinned. D46 itself and the U74 Done entry enumerate rather than claim "every", so the over-claim is confined to the header paragraph.

## Claims positively re-verified

- **Refactor inert:** re-ran `npx tsx fable-lab/tools/index-registry.ts` on the real registry (9 experiments); `git diff -- fable-lab/protocol/registry/INDEX.md` empty — byte-identical. Nothing to restore.
- **Selftest passes:** `npx tsx fable-lab/tools/index-registry-selftest.ts` → 22 PASS lines, exit 0. Count confirmed: 14 unit + 3 pipeline + 4 dir-arm + 1 guard = 22, matching the "22 assertions" claim in D46/STATE/AUDIT-COVERAGE.
- **Assertions are independent, not mirrored:** every unit expectation is a hand-written literal; I re-derived each against the regex (blockquote `>` blocked by `[-*]?`, "Decision rules:" blocked by ` rules` before the colon, mid-line blocked by anchored `^\s*[-*]?\s*`, last-match-wins, case-insensitive label with verbatim value). `EXPECTED_INDEX` is a hand-written string; the `?`-fallback row follows from `lib/spec.ts:46` (title regex requires `# EXP-\d+ — …`; EXP-103 fixture deliberately lacks the em-dash). The non-experiment file exclusion follows from the `/^EXP-\d+.*\.md$/i` filter.
- **Real-corpus safety:** ran the regex over all 9 `fable-lab/protocol/registry/experiments/*.md` — matches are exactly the true verdict lines (EXP-001: advance→kill; all others: kill), agreeing with the committed INDEX statuses. No current false positives.
- **Guard behavior:** refusal on non-selftest path exercised by the selftest itself (exit 2); guard is import-time, so unset env → `REGISTRY_DIR` unchanged (real regen proven above). No bypass found beyond the documented by-design rule that any path containing "selftest" passes.
- **`main()` guard:** `import.meta.url === pathToFileURL(process.argv[1]).href` — selftest imports `lastDecision` without triggering a write (its own INDEX writes go through spawned child processes into gitignored `fable-lab/logs/`).
- **Propagation:** DECISIONS D46 (`fable-lab/DECISIONS.md:1676`), STATE header + U74 Done entry (`fable-lab/STATE.md:3-14, 1490-1506`), AUDIT-COVERAGE R4-CLOSED (`knowledge/AUDIT-COVERAGE.md:115-119`) + section-2 row (line 73, coverage C+D+E — consistent), `tools/README.md:24` row — all present and, apart from findings 1 and 4, restate the work accurately.
- **U30 provenance:** STATE.md:340-342 does document the quirk and EXP-007 incident; the quirk-as-intended framing is corroborated there (just not in SCIENTIST.md — finding 1).
- **Charter:** `git show --stat 103ff1d` — all 7 files under `fable-lab/`; no threshold values changed in D46; the three CONFIRM-010 freeze files (`tools/calib3.ts`, `strategies/_fixtures/diag-calib.ts`, `tools/calib-integrity.sh`) untouched; `npx tsx fable-lab/tools/wakeup.ts` re-run — check 6 green: "byte-identity holds since c403d7d (3 files, no commits, worktree clean)".
- **"tsc clean":** `npx tsc --noEmit` exit 0.
