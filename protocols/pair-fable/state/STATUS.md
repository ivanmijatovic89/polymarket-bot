# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 13)

## Current work

Session 13 executed E-025 (verdict) and launched E-026 (in flight):

**E-025 VERDICT (trade-print calibration, no fleet runs).** Built
`tools/tradeprobe.ts`, scanned the 36 recorded live-WS btc markets.
**T140/W140 = 0.65** (frozen branch T ≤ 2×W): the trade-confirmed
front-of-queue ceiling sits BELOW worst-queue; cancel share of ToB
decreases = **99.1%** ⇒ E-024's O bound was cancels — verdict downgraded
to "O-bound uninformative" (annotated in both places). Fill model =
acceptable capacity bound; maker kills stand WITHOUT the optimism
caveat; E-013 fill-limited restored to ~market fact (T ceiling ≈610
sh/~97 fills per mkt); the human's 700-trades figure ≈ ALL prints/mkt
(704–1,189 measured) ⇒ likely counts placements, not fills; HF ToB
gross ceiling ≈$8.5/mkt ⇒ HF axis deprioritized on economics. P-011
resolved self-served. Parity: recorded-vs-telonex O0 ratio 0.995 on 24
common slugs. hf-fill-probe.md §Result E-025.

**Axis 4a (size as f(price)) answered from existing evidence** (no
runs): E-019's ev(X) is strictly monotone declining + run-872 top band
negative ⇒ every entry-price band ≤ 0 ⇒ a ladder is a convex
reweighting bounded by the best band ≈ 0 from below. Deprioritized (not
killed); reopen if any band ever measures > 0 at ≥2 SE. pair-v12.md
§Axis 4a.

**E-026 IN FLIGHT (pair-v12 averaging down, ruling axis 4b).**
Pre-registered (design-ts 9a864a9 BEFORE code), code pair.v12.ts (commit
99e3ff8), smoke PASS run 915 (mechanism fires: 28 A-fills / 10 mkts).
5-run grid on pinned 800 @140/20, gate 0.98, submitted 10:42–10:43 UTC,
batch uids:

| config | batchUid |
| --- | --- |
| δ=0.99 imb20 (regression ≡ 872) | pf-e026-20260731T104231-itiq17 |
| δ=0.05 imb20 | pf-e026-20260731T104256-g3fqcz |
| δ=0.10 imb20 | pf-e026-20260731T104312-vr4g42 |
| δ=0.05 imb40 | pf-e026-20260731T104329-6z8p5q |
| δ=0.10 imb40 | pf-e026-20260731T104347-m21m0o |

Recover run ids: `backtest_runs WHERE batch_uid LIKE 'pf-e026-%'`.

## Next step

1. **Read E-026 results** (session 14): check the regression config
   FIRST (must ≡ run 872 within |Δev| ≤ 0.01, else INVALID → fix code);
   then frozen bars vs parent 872 (−1.5019): KILL if all Δev ≤ +0.05;
   ITERATE (→ gate-0.95 sweep vs 873) if any ≥ +0.05 with anatomy
   mechanism confirmation. Run results.ts + anatomy.ts (note: 'A' fill
   mode is new — verify anatomy handles it before reading decomposition)
   + CAP-BREACH integrity check + daily corr vs 872.
2. Then axis 5 (time-varying policy) design, the last undesigned ruling
   axis. Session 15 is a self-check session (every fifth).
3. Review gate M1–M4 (M5 handled in v1/v12 schema): required BEFORE
   first champion promotion / LIVE-CANDIDATE — none imminent, but
   implement early per mission if a candidate approaches the bar.

## Blockers

None.

## Needs human

- Carried: P-002/P-003/P-005/P-006/P-007/P-009/P-010 (all `proposed`).
- P-011 resolved this session (E-025 self-serve calibration; no engine
  work needed).

## Standing session guards

- Never end a session waiting on ANY in-flight work (fleet, local scan,
  background task, monitor) — record how to resume in STATUS, return
  `continue` (inbox dad421a6). Long local jobs: `--checkpoint` +
  `--time-budget-s` foreground chunking (mktselect/bookscan/fillprobe).
- Write .global-runtime/session-result.json BEFORE the final message,
  every session, no exceptions.
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine commits
  (this session: only protocol commits moved HEAD).
- Queue submissions require a CLEAN tree pushed to origin/main (push via
  `git push origin HEAD:main` from the wt/pair-fable worktree).
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes). FULL reference for v1-b: run 914
  (no expiry — FULL runs don't drift).
- JOURNAL entries are for the HUMAN: plain language, 3–6 short lines, at
  most one evidence pointer per conclusion (inbox 330fa938, permanent).
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329). Submit each config as its OWN command — zsh
  word-splitting broke a submission loop this session (silent no-op).
- Class kills need an identity argument (evaluator.md §Kill standards,
  binding per inbox 8758567d); N failures kill a family only.
- Fill model: calibrated by E-025 (acceptable capacity bound at ToB;
  W within 0.65–1.6× of trade-confirmed). The old "no HF maker code
  until calibrated" guard is retired; HF ToB axis deprioritized on
  measured economics (~$8.5/mkt gross ceiling).
- Sibling-memory recheck at session start (`ls protocols/*/memory`) —
  2026-07-31 s12: still only pair-fable has memory (s13: unchanged).
- zsh does not word-split unquoted vars; spell out args in submission
  loops. Also `=word` expansion: quote bare `===` etc. in echo.
- Smoke cannot catch latency-race bugs (≤20 quiet markets): any strategy
  with taker/burst-capable paths needs a mechanical post-run integrity
  check (CAP-BREACH is the template).

## Inbox processed through

2026-07-31T08:30:52.409Z-d904e17d (recorded in memory/market-context.md).
