# Rust engine (live-first) — status

## For the owner

The goal was re-planned on 2026-10-09: Recorder V4 first, a minimal exchange adapter with your probe sessions early, the simulator built from measurements, Telonex later. The previous attempt stays on branch `native-engine` as reference. Nothing here has run a market yet; N0 is the bootstrap.

## Current state

- Host / worktree: worker-1 `/Users/worker-1/Sites/polymarket-bot-rust-live-first`
- Branch: `rust-live-first` from `origin/main` @ ad2f11b8 (green: yes); draft PR: not yet opened
- Spec: `native/spec/00-goal.md` … `11-v4-input.md`; decisions E01–E10
- Milestone / step: N0 / open items: draft PR, V4 inventory in this file, fleet check
- Binaries: none
- Data roots: symlinks `data/{events,binance,telonex,recorder-v4-cache}` → fleet copy (read-only); `data/strategy-artifacts`, `data/native-tapes` local
- Calibration: none (`native/calibration/` empty; every model parameter is `unmeasured` until P0)
- Rules capture: LaunchAgent `com.pmb.rules-capture` running on worker-1 since 2026-10-09 09:48Z (previous attempt, M1.0); files imported in N5
- Paused: none (fleet worker and Global Runtime untouched)
- Last proof: `(cd native && cargo test --workspace)` → pmb-book 11, pmb-contract 34 + 6, pmb-core 41, pmb-replay golden 1, all green (2026-10-09 18:49, leaf crates only)
- Waiting on user: none
- Next action: finish N0 (draft PR, V4 inventory, fleet check), then N1 step plan

## Milestone plans

### N0 (started 2026-10-09)

- [x] 0.1 Branch, worktree, data and `node_modules` links, `.env`
- [x] 0.2 Leaf crates carried (`pmb-core`, `pmb-book`, `pmb-contract`, `pmb-replay`); CI job, `native:ci:local`, Prettier exclusions, `deny.toml`
- [x] 0.3 Spec 00–03, 10, 11; goal prompt; this file
- [ ] 0.4 Draft PR "DO NOT MERGE before gate C: Rust engine, live-first"
- [ ] 0.5 V4 inventory (read-only DB query) and local cache check recorded here
- [ ] 0.6 N0 proof command run and recorded; fleet check (`ps`)

## Log (newest first)

### 2026-10-09 19:00 — N0 bootstrap by the owner's review session

- Branch and worktree created from `origin/main`; four leaf crates copied from `native-engine` @ 6d8a8224 and their tests pass; bootstrap config (CI job, scripts, Prettier) applied from the previous attempt's bootstrap commit.
- Spec written: 00 goal and principles, 01 milestones N0–N9 with proofs and gates A–D, 02 decisions E01–E10 (E06 lists the carried old decisions), 03 reuse map, 10 exchange facts and probe list (extracted from sources; contradictions listed at its end), 11 V4 input contract (extracted from sources).
- V4 catalog on 2026-10-09 (read-only query): 211 complete BTC 15m and 589 complete BTC 5m packages since 2026-10-06, every feed complete, every package resolved.
