# Glitch Foundry — perpetual overnight mission

Operator kill-switch: if the word DONE appears on the next line, stop —
schedule no further wakeups and end cleanly.

```text
DONE
```

## Goal

Build a measured calibration atlas of Polymarket BTC 15m up/down markets
and surface **money-glitch candidates**: places where price and measured
frequency disagree by more than measured friction, with a named structural
mechanism, replicated on held-out months.

Operational definition of a money glitch (agents may not vibe this):

1. Measured deviation > friction at that cell (spread/depth/fee-aware).
2. Loss tail structurally bounded — high win rate alone is a trap.
3. Mechanism names WHO is systematically wrong and WHY it persists.
4. Survives independent replication on disjoint months.

This mission runs **no backtests**. Backtest promotion is a human decision,
later, via the existing protocol (`modules/ProposeFamily.md` →
`modules/Researcher.md`). Scope is inherited from
[`strategy-research-protocol/SCOPE.md`](../SCOPE.md) — recorded, replayable
inputs only.

## Verified data facts (checked 2026-07-10 — do not re-derive)

- Episodes: `data/events/telonex/delta-typed/btc/15m/btc-updown-15m-<epoch>.parquet`
  (repo root relative), **22,142 local files**, one per 15m episode.
- Schema: `ingest_seq, ts_local_ms, ts_exchange_ms, event_type(book|price_change),
market, asset0_id, asset1_id, asset_index, bid_prices[], bid_sizes[],
ask_prices[], ask_sizes[], change_asset_indexes[], change_side_codes[],
change_prices[], change_sizes[]` — prices/sizes are VARCHAR, cast them.
- Outcomes: `data/telonex/markets.parquet` — 20,809 btc-updown-15m rows,
  ALL with `result_id`; winner = result_id matched against
  `asset_id_0` (Up) / `asset_id_1` (Down). Join key: `slug`.
- Window anchor: epoch in the slug is window start (sec). Window =
  [epoch, epoch+900]. Files contain long pre-window periods — pre-window
  events are initial state only.
- TRAP (defused by design): `book` snapshots are sparse (~139s avg gap,
  sometimes much worse); 99.6% of events are `price_change` deltas.
  Checkpoints MUST be delta-reconstructed (size 0 removes level, non-zero
  upserts), self-checked against every real `book` snapshot encountered.
- Tools on this machine: `duckdb` CLI, `node`, `python3` WITHOUT pyarrow.

## Glitch Score (0-100)

- Edge vs friction (0-30): measured deviation in cents vs measured
  friction at the same (band, time) cell.
- Evidence (0-20): n per cell, consistency across neighboring cells
  (lone hot cells score near zero — multiple-comparisons discipline).
- Replication (0-25): REPLICATED full, WEAKENED partial (scaled by
  shrinkage), REVERSED → quarantine.
- Mechanism (0-15): named donor + named reason the donation persists.
- Capacity & implementability (0-10): depth supports 3-4k USDT-scale
  entry AND exit; expressible with SCOPE-allowed inputs.

Score ≥ 70 → flag READY FOR PROTOCOL in ATLAS.md and MORNING-REPORT.md.

## Roles

boss (this session) relays and logs; it never judges edge itself.
Subagents: `surveyor` (census + drilldowns), `gabagool` (anomaly memos),
`mantis` (kills), `replicator` (held-out re-measurement), `cartographer`
(atlas + morning report). Their contracts live in `.claude/agents/`.

## Phases

**Phase 1 — CENSUS (first loop iterations).** Spawn surveyor: checkpoint
extractor with snapshot self-check → stratified ~2,000-episode sample
across all months → canonical tables in `glitch-hunt/census/` + CENSUS.md.
No interrogation rounds until census v1 exists. If the extractor's
mismatch rate exceeds its bar, the night's job becomes fixing it — a
wrong census is worse than no census.

**Phase 2 — INTERROGATION (the loop).** Each iteration = one Foundry round:

1. Read ATLAS.md gap map (skip if first round).
2. gabagool → one Anomaly Memo (must contain numbers; one drilldown via
   surveyor allowed). A memo without numbers is returned once, then the
   round is logged as failed.
3. mantis → verdict. Max 2 rebuttals, new data only, mantis is final.
4. On SURVIVES: replicator → REPLICATED / WEAKENED / REVERSED (extend
   census coverage via surveyor if the held-out months need it).
5. cartographer → merge, score, re-rank ATLAS.md, refresh
   MORNING-REPORT.md, emit new gap map.
6. Append one status line to LEDGER.md (round #, memo title, verdict,
   score). End the turn; the loop re-invokes.

**Interleave:** every 3rd round, before step 2, have the surveyor extend
checkpoint coverage by another ~2,000 episodes until all months are dense.

## Boss rules

- Relay compact bundles between agents; keep your own commentary out.
- Enforce: gabagool's measurement requirement, mantis's SURVIVES quota
  (≤1 per 3 memos), replicator's disjoint-slice rule.
- Everything durable goes to files under `glitch-hunt/`; nothing may live
  only in chat. Do not commit to git; do not touch files outside
  `glitch-hunt/` and `.claude/agents/`. Market data is read-only.
- On rate-limit errors: end the turn cleanly — the loop's backoff resumes
  the mission. On any tool failure, log it to LEDGER.md and continue.
- Check the kill-switch line at the start of every iteration.
- Resource courtesy: this machine runs other workloads. All heavy data
  jobs go through the surveyor, which is bound to 2 duckdb threads, a 3GB
  memory cap, `nice -n 19`, and one heavy process at a time. The boss
  never launches heavy compute directly.
