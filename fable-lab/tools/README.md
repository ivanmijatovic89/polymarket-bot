# Tools

Working scripts, run from the repo root with `npx tsx`. All are read-only
against the DB except `submit.ts --execute` (which launches a backtest).

| tool | purpose |
|---|---|
| `universe.ts` | eligible BTC 15m universe report + holdout boundary for registration |
| `results.ts` | THE canonical decisive readout for a run (`--run <id>` / `--batch <uid>`): N, q, t, EV ± CI, composition, day stability |
| `validate-experiment.ts` | spec completeness + spec-before-results + params-match-spec + holdout discipline checks |
| `submit.ts` | build (print) the exact stage command from a frozen spec (`smoke|probe|main|lat|grid|holdout`); `--execute` to run; holdout execution refuses unless the validator passes |
| `battery.ts` | robustness-battery comparison table across runs (`--exp EXP-014` / `--runs` / `--batches`) for the Judge |
| `index-registry.ts` | regenerate `protocol/registry/INDEX.md` |
| `calib.ts` / `calib2.ts` / `calib3.ts` | frozen one-shot readers for CAL-001/-002/-003 (`knowledge/CALIBRATION*.md`); constants are pre-registered — never edit post-read |
| `calib-selftest.ts` / `calib2-selftest.ts` / `calib3-selftest.ts` | hand-computed synthetic-fixture selftests for the calib readers (D28) |
| `holdout-lock-audit.ts` | global DB sweep: every post-boundary market ever replayed/failed by a fable-lab run, no outcome columns (U50; re-run after any evidence run; exit 2 = rows to classify against `knowledge/HOLDOUT-LOCK-AUDIT-2026-07-10.md`) |
| `lib/spec.ts` | shared experiment-spec parser |
| `fixtures/EXP-000-fixture.md` | parser/validator test fixture (not a real experiment) |

Conventions: DB access goes through `src/db/` helpers (telonex tables ONLY
via `src/db/telonexMarkets.ts`, per repo rule). No new dependencies.
