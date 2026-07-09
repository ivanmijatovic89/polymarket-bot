# EXP-000 — fixture for tool validation (not a real experiment)

## Spec

- **Registered:** 2026-07-09 (commit: fixture)
- **Idea:** none — this file exists to exercise the tools
- **lineage_cells:** 1
- **Mechanism class:** `spread-capture`
- **Hypothesis (who loses and why):** Fixture hypothesis: impatient takers
  cross wide spreads; this sentence exists so the parser has content.
- **Falsifiable prediction:** Fixture prediction: parser extracts this field.
- **Strategy:** `src/strategies/templates/Template.v1.ts`, id `template.v1`
- **Primary parameter cell:** `--param buyPrice=0.4 --param sellPrice=0.6`
- **Robustness neighborhood:** buyPrice ±0.05, sellPrice ±0.05
- **Simulator-bias exposure (CAPABILITIES §4):** Fixture: maker-heavy, would
  be classified simulator-favored.
- **Windows (computed by tools/universe.ts at registration):**
  - Exploration: `market_start_ms` < 1767225600000 (2026-01-01T00:00:00Z)
  - Holdout: `market_start_ms` >= 1767225600000, one-shot
- **Sample rules:** probe = `--random --limit 500 --to-ms 1767225600000`;
  main = extend to full exploration window; holdout = full holdout window.
- **Decision rules (copied from EPISTEMOLOGY at registration):**
  - probe kill: q̂ ≤ 0 with t ≤ −1, or prediction contradicted
  - main advance: t ≥ 2 on primary cell + battery pass
  - holdout confirm: t ≥ 2 on holdout alone
- **Latency curve points:** delay ∈ {0, 150, 300}, jitter 0

## Runs (append-only)

## Verdicts (append-only)
