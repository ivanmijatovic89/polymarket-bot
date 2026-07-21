# Feeds Parity Harness

Measures — and tunes — how closely backtests track live trading at the exact
boundary strategies consume: `ctx.plugins.externalFeeds` + the orderbook
snapshot. The same probe strategy (`feedsParityProbe.v1`, zero intents) runs
in the LIVE bot (DRY_RUN=true) and in REPLAY over a parallel recording; the
harness compares the two per-tick views and suggests tuned latency envs.
Re-run it whenever fidelity needs re-checking (new feed, infra change, new
machine) — it is also the measuring instrument for the future
synthetic-feed-ticks work ([ADR](./adr-binance-driven-ticks.md)).

## The loop

```bash
# 1. Capture (default 6h): DRY_RUN=true bot + record:live in parallel
npm run feeds:parity -- capture --symbol btc --minutes 360

# 2. Same evening: replay the recording with the same probe
npm run feeds:parity -- replay --run <runId>                # --base recorded (default)

# 3. Compare + tune loop
npm run feeds:parity -- compare --run <runId>
npm run feeds:parity -- tune --run <runId> --apply          # re-replays with suggested envs, prints residual

# 4. Next day (canonical dataset): after telonex sync/convert of the covered slugs
npm run feeds:parity -- replay --run <runId> --base telonex
npm run feeds:parity -- compare --run <runId> --replay-file replay-telonex.jsonl
```

Everything lands in `data/feeds-parity/<runId>/`: `manifest.json` (symbol,
window, latency-env snapshot, covered recordings, every replay's exact envs),
`live.jsonl`, `replay-*.jsonl`, child logs, and `report-*.json`.

## What the report means

- **agreement** — % of seconds (1s grid over the overlap) where live and
  replay saw the same feed value. Target ≥99%.
- **lag** (the tuning signal) — for each feed value transition live saw, the
  signed time offset to the same transition in replay. **Mean ≈ bias**
  (fixable: lower/raise the latency env by it); **spread ≈ jitter** (two
  different WS connections — ±100–300ms is physics, not error). Target after
  tuning: |mean| ≤ 50ms.
- **priceToBeat first-seen Δ** — replay's `availableAt` model vs when the live
  poller actually got the strike. Tunes `BACKTEST_PRICE_TO_BEAT_LATENCY_MS`.
- **top-of-book agreement** — same-exchange-timestamp book states must match
  (validates the recording/replay path itself). Target ≥99%.

`tune` prints suggestions (`current − meanBias`) and with `--apply` re-runs
replay+compare using them. **It never writes to code or env files** — baking a
new default is a deliberate human commit.

## Knobs it tunes

| env | meaning |
|---|---|
| `BACKTEST_BINANCE_FEED_LATENCY_MS` | Binance trade → bot visibility |
| `BACKTEST_RTDS_CHAINLINK_LATENCY_MS` | Polymarket broadcast → bot visibility |
| `BACKTEST_PRICE_TO_BEAT_LATENCY_MS` | window start → strike availability |

## Trust, but verify the instrument itself

Both self-tests ran against a real telonex market and must keep passing after
harness changes:

- **Neutrality**: identical replay twice → compare = 100% agreement, 0 lag,
  0 unmatched, ptb Δ=0 (the comparator invents nothing).
- **Sensitivity**: replay with chainlink latency +500ms → measured mean lag
  ≈ +500ms, binance untouched, and one `tune --apply` iteration converged the
  suggestion back to the true default (235ms, ±2ms).

Unit tests: `npx tsx --test src/cli/research/feedsParityCompare.test.ts src/strategies/feedsParityProbe.v1.test.ts`.

## Safety

Capture forces `DRY_RUN=true` into the bot's env AND aborts unless the bot's
startup log confirms `dryRun=true` (this repo runs on a live-trading machine).
The probe emits no intents by construction; dry-run execution is a no-op stub
regardless. Prerequisites: MySQL + Gamma reachable for replay meta; the
telonex base additionally needs the covered slugs synced+converted locally
(the replay error names the commands).
