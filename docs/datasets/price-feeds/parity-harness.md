# Feeds Parity Harness

Measures — and tunes — how closely backtests track live trading at the exact
boundary strategies consume: `ctx.plugins.externalFeeds` + the orderbook
snapshot. The same probe strategy (`feedsParityProbe.v1`, zero intents) runs
in the LIVE bot (DRY_RUN=true) and in REPLAY over a parallel recording; the
harness compares the two per-tick views and suggests tuned latency envs.
Re-run it whenever fidelity needs re-checking (new feed, infra change, new
machine) — it is also the measuring instrument for the future
synthetic-feed-ticks work ([ADR](/backtest/adr-binance-driven-ticks)).

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

For the telonex base, run the comparison **twice** — the two cuts answer
different questions:

- **live vs replay-telonex** — end-to-end parity against the canonical
  dataset, but includes live WS jitter.
- **replay-recorded vs replay-telonex** (pass `--live-file
  replay-recorded.jsonl`) — both sides deterministic, zero jitter, so any
  disagreement is purely a **dataset difference** between our own recording
  and the Telonex orderbook stream. Target: ~100% top-of-book agreement at
  aligned exchange timestamps. Note this compares top-of-book only — a
  discrepancy deeper in the book would not show up here.

## What the report means

- **agreement** — % of seconds (1s grid over the overlap) where live and
  replay saw the same feed value. Target ≥99% — but ONLY meaningful for feeds
  whose value persists well beyond the grid step. Chainlink updates every ~1s,
  so most grid samples land near a transition boundary and inter-connection
  jitter turns them into coin flips (~30% observed is expected, not an error);
  for such feeds the lag stats below are the real fidelity measure. Binance's
  number is also depressed by sampling density (see the 2026-07-21 findings).
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

## First real run (2026-07-21, run `202607211243-btc`)

6h capture on the trading machine, 24 markets recorded, 21 replayed (the last
3 windows fell after the chainlink recorder's last closed hour). Findings, all
baked into the defaults by the follow-up commit:

- **binance**: mean bias **−1ms** at the 110ms default — the modeled latency
  is validated end-to-end; unchanged. (Raw recorder-level p50 that day was
  38ms — network conditions vary, but the strategy-eye-level bias is what
  matters and it was already zero.)
- **chainlink**: mean bias −86ms at 235 → default raised to **320**
  (residual bias 2ms after one tune iteration).
- **priceToBeat**: live availability measured across 24 markets:
  p50=2651ms, p90=3455ms, max=5384ms after window start — the old 30s
  owner-estimate default was ~27s too pessimistic → default now **2700**.
- **top-of-book agreement 99.9%** — recording/replay path itself is sound.
- **Sampling-density datum** (phase-2 motivation): replay logged ~20k binance
  value transitions that the live probe never observed (live's Polymarket
  ticks landed differently), ~24% of all transitions — quantifies what
  synthetic feed ticks ([ADR](/backtest/adr-binance-driven-ticks)) would recover.

## Safety

Capture forces `DRY_RUN=true` into the bot's env AND aborts unless the bot's
startup log confirms `dryRun=true` (this repo runs on a live-trading machine).
The probe emits no intents by construction; dry-run execution is a no-op stub
regardless. Prerequisites: MySQL + Gamma reachable for replay meta; the
telonex base additionally needs the covered slugs synced+converted locally
(the replay error names the commands).
