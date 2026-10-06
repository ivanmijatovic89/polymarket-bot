# Historical Feed Calibration

This tool replays and compares existing calibration runs under `data/feeds-parity/<runId>/`. It preserves the evidence behind the historical Binance/Chainlink latency defaults and synthetic-tick measurements. The capture command was retired with the standalone recorder.

For new capture, use [Recorder V4](/datasets/recording/recorder-v4). V4 records actual receipt order and does not apply these historical feed-latency offsets. This harness does not accept V4 packages; use V4 verification and its replay parity tests for those.

## Analyze an existing run

```bash
npm run feeds:parity -- replay --run <runId> # recorded base
npm run feeds:parity -- compare --run <runId>
npm run feeds:parity -- tune --run <runId> --apply

# Requires the run's covered Telonex slugs synced and converted locally.
npm run feeds:parity -- replay --run <runId> --base telonex
npm run feeds:parity -- compare --run <runId> --replay-file replay-telonex.jsonl
```

The existing run must include its `manifest.json`, `live.jsonl`, and covered recording files. Replay/compare writes `replay-*.jsonl`, child logs, and `report-*.json` alongside that evidence.

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

## Measuring synthetic feed ticks

Historical runs that captured `tickOnUpdate=true` and `logEveryTick=true` retain those probe parameters in their manifests, and replay reuses them automatically. `logEveryTick=true` was required —
default sampling would fold a synthetic tick into the value-change row it
usually coincides with. Probe rows carry `eventType` and `synthetic: true`,
and the report gains a `synthetic ticks` line: live vs replay counts and
backward-time counts. Acceptance: count Δ ≤ max(1%, 5) per window; backward-`exchangeTsMs`
synthetic rows ≈ 0 on either side (exchangeTsMs is the field the monotone
clamp stamps, so a clamp regression is observable — but occasional single
inversions mirror Polymarket's own non-monotone exchange stamps arriving on
a real book tick between two synthetic ticks, and are not a clamp defect);
and the non-opted-in numbers unchanged (machinery inert when off).

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

## Replay prerequisites

The probe emits no intents. Existing-run replay needs MySQL and Gamma access for historical market metadata; the Telonex base additionally needs its covered slugs synced and converted locally. The CLI no longer starts a live bot or recorder.
