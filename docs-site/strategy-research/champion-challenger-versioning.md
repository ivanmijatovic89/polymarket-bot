---
title: Champion/Challenger Strategy Versioning
description: How strategy families, baseline versions, candidates, and promotions should be organized.
---

# Champion/Challenger Strategy Versioning

Use this pattern for strategy families under active research.

## Terms

| Term | Meaning |
| --- | --- |
| Family | Strategy line, for example `split`. |
| Champion | Current baseline version, for example `split/v1`. |
| Candidate | Experiment trying to beat a champion. |
| Promotion | Candidate becomes the next champion version. |
| Rejection | Candidate does not justify promotion. |

## Folder Pattern

```txt
src/strategies/<family>/
  FAMILY.md
  RULES.md

  v1/
    Strategy.ts
    VERSION.md
    RESULTS.md
    candidates/
      001-short-hypothesis/
        Strategy.ts
        CANDIDATE.md
        RESULTS.md

  v2/
    Strategy.ts
    VERSION.md
    RESULTS.md
    candidates/
```

`Strategy.ts` may use a family-specific name, for example `Split.ts`.

## Version Rules

- `v1`, `v2`, `v3` are promoted champion versions only.
- Candidates live under the version they are trying to beat.
- Do not name candidates `v1.1`, `v1.2`, etc.
- A candidate becomes `vN+1` only after explicit promotion.
- A parameter sweep alone does not create a new version.
- A promoted version must represent a meaningful behavior change.

## Candidate Naming

```txt
NNN-short-hypothesis
```

Examples:

```txt
001-sell-price-offset
002-netchange-gate
003-highlow-range-gate
004-toxic-fill-filter
005-earlier-disable-window
```

The number preserves order. The text must describe intent.

## Required Files

Family:

| File | Purpose |
| --- | --- |
| `FAMILY.md` | Current champion, rejected/dead lines, likely next work. |
| `RULES.md` | Family-specific rules. |

Champion version:

| File | Purpose |
| --- | --- |
| `Strategy.ts` | Implementation. |
| `VERSION.md` | Status, origin, thesis, behavior, params, risks, promotion history. |
| `RESULTS.md` | Backtest/evaluation summaries. |

Candidate:

| File | Purpose |
| --- | --- |
| `Strategy.ts` | Candidate implementation. |
| `CANDIDATE.md` | Parent, hypothesis, change, expected impact, kill criteria. |
| `RESULTS.md` | Backtest/evaluation summaries and final decision. |

## Promotion Rule

When a candidate is promoted:

1. Create `vN+1/`.
2. Move/copy the promoted implementation into `vN+1/`.
3. Create `vN+1/VERSION.md`.
4. Link back to the promoted candidate.
5. Record why it became champion.
6. Start future candidates under `vN+1/`.

## LLM Reading Order

1. `docs-site/strategy-research/index.md`
2. `docs-site/strategy-research/champion-challenger-versioning.md`
3. `src/strategies/<family>/FAMILY.md`
4. `src/strategies/<family>/RULES.md`
5. the relevant `VERSION.md` or `CANDIDATE.md`
6. the relevant `RESULTS.md`
7. the strategy implementation

This document defines organization only. Backtest evaluation rules are separate.
