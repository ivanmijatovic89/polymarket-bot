# Tools

Working scripts, run from the repo root with `npx tsx`. All are read-only
against the DB except `submit.ts --execute` (which launches a backtest).

| tool | purpose |
|---|---|
| `wakeup.ts` | ONE-COMMAND session boot (D42): runs all six wake-up checks — universe vs baseline, trades gate (converter set + converted bucket), fleet (registry probe + capacity relay), operator drift past the audited point (D35), zero-cost vendor quota probe, CONFIRM-010 freeze byte-identity — per-check pointers; exit 0 quiet / 2 fired / 1 unrunnable; STATE bullets stay authoritative |
| `universe.ts` | eligible BTC 15m universe report + holdout boundary for registration; also prints CATALOG AWAITING INGESTION (synced-not-ingested lag, U64/D38) (wake-up gate 1) |
| `run-backtest.ts` | THE lab backtest entry point (D7): registry-injection wrapper (idempotent under the fleet-gap registry patch since U54/D33), refuses non-sequential runs, pins/prints latency env, `--fill-mode` guard (D18) — every evidence run goes through it |
| `runs.ts` | list recent backtest runs (id, batchUid, strategy, size, status) — find run ids |
| `fills.ts` | maker/taker fill COUNTS for runs, PnL never selected (E15 outcome-mining-safe design read) |
| `entry-check.ts` | mechanical check of the shared "entry beats its price" prediction clause (intent_meta {exp, side, entryAsk}) |
| `venue-drift.ts` | per-UTC-month + `--pooled` aggregation of `[diag-venue]` log lines (D17 drift instrument; outcome-free) |
| `trades-coverage.ts` | Telonex catalog trades/quotes/onchain_fills channel coverage, split `converted` vs `awaiting-ingestion` (D20/D39; wake-up gate 2 — baseline = converted bucket) |
| `trades-schema-probe.ts` | D40 one-market Telonex `trades` file download + parquet inspection (schema/rows/timestamps; refuses holdout-side slugs; no R2, no DB writes; output gitignored). Blocked 2026-07-11 by vendor `limit_reached` quota — re-run when the operator confirms headroom |
| `holdout-lock-audit.ts` | global DB sweep: every post-boundary market ever replayed/failed by a lab run, no outcome columns (D32; re-run after any evidence run; exit 2 = classify new rows against `knowledge/HOLDOUT-LOCK-AUDIT-2026-07-10.md`) |
| `detach.mjs` | launch a command in its own session so it survives session death (D10) — how evidence runs go to background |
| `results.ts` | THE canonical decisive readout for a run (`--run <id>` / `--batch <uid>`): N, q, t, EV ± CI, composition, day stability |
| `validate-experiment.ts` | spec completeness + spec-before-results + params-match-spec + holdout discipline checks (`--selftest-holdout-rows` synthetic branch test, U55 — loud banner, never a real validation) |
| `submit.ts` | build (print) the exact stage command from a frozen spec (`smoke|probe|main|lat|grid|holdout`); `--execute` to run; holdout execution refuses unless the validator passes |
| `battery.ts` | robustness-battery comparison table across runs (`--exp EXP-014` / `--runs` / `--batches`) for the Judge |
| `index-registry.ts` | regenerate `protocol/registry/INDEX.md` |
| `calib.ts` / `calib2.ts` / `calib3.ts` / `calib4.ts` | frozen one-shot readers for CAL-001/-002/-003/-004 (`knowledge/CALIBRATION*.md`); constants are pre-registered — never edit post-read |
| `calib-selftest.ts` / `calib2-selftest.ts` / `calib3-selftest.ts` / `calib4-selftest.ts` | hand-computed synthetic-fixture selftests for the calib readers (D28) |
| `capacity.ts` | live fleet capacity via the :3051 dashboard API (alive worker slots per machine, staleness vs origin HEAD, wall-clock estimate); size every fleet batch with it (charter constraint 3; U58) |
| `parity.ts` | per-market row parity between two runs of the same spec across 19 deterministic columns (D36 fleet/local check; outcome-safe — values print only on mismatch; `--intersection` for superset runs; exit 2 = divergence) |
| `calib-coverage.sh` / `calib-integrity.sh` | CAL-001 outcome-free log checks: per-offset coverage recompute; integrity battery (dup/malformed/mirror/ts checks) |
| `lib/spec.ts` | shared experiment-spec parser |
| `fixtures/EXP-000-fixture.md` | parser/validator test fixture (not a real experiment) |

Conventions: DB access goes through `src/db/` helpers (telonex tables ONLY
via `src/db/telonexMarkets.ts`, per repo rule). No new dependencies.
