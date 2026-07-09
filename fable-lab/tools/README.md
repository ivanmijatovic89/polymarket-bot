# Tools

Working scripts, run from the repo root with `npx tsx`. All are read-only
against the DB except `submit.ts --execute` (which launches a backtest).

| tool | purpose |
|---|---|
| `universe.ts` | eligible BTC 15m universe report + holdout boundary for registration |
| `results.ts` | THE canonical decisive readout for a run (`--run <id>` / `--batch <uid>`): N, q, t, EV ± CI, composition, day stability |
| `validate-experiment.ts` | spec completeness + spec-before-results + params-match-spec + holdout discipline checks |
| `submit.ts` | build (print) the exact stage command from a frozen spec; `--execute` to run |
| `index-registry.ts` | regenerate `protocol/registry/INDEX.md` |
| `lib/spec.ts` | shared experiment-spec parser |
| `fixtures/EXP-000-fixture.md` | parser/validator test fixture (not a real experiment) |

Conventions: DB access goes through `src/db/` helpers (telonex tables ONLY
via `src/db/telonexMarkets.ts`, per repo rule). No new dependencies.
