# Market simulator

Open a backtest run in the dashboard and click **Simulator** beside a market's slug.
The page recreates that one market using the saved strategy artifact and parameters,
then lets you inspect the resulting trace. It does not place live orders or create a
new backtest run in the database.

## Playback

- Play/pause at 1×, 3×, 5× or 10× market time.
- Step backward/forward one strategy tick, or jump to the next action or fill.
- Drag the timeline or click a chart to seek. Click an execution event to see the
  portfolio immediately after that event, including multiple events on one tick.
- UP/DOWN charts show bid, ask, fill markers and the currently active order levels.
  Zoom to the last 60 or 15 seconds for a closer look. Future prices are hidden.
- The order panels distinguish requested, resting, partially filled and cancellation
  requested orders. The timeline retains acknowledgements, rejection reasons and
  the original intent/fill metadata.
- External feeds show the historical snapshot seen by the strategy at the selected
  point. The usual backtest feed loader supplies Binance, Chainlink and price-to-beat
  data when requested by the strategy. Missing historical feed files fail preparation
  with the existing loader's remediation message; they are never replaced by live prices.

The engine processes every original meaningful tick, in the same order as a normal
backtest, including any requested synthetic feed ticks. Only the chart overview is
reduced: each second retains its first/last quotes and bid/ask extrema. The detail
panel retains the top ten book levels per side; execution still uses the full depth.

## Accounting and verification

Paired shares are `min(UP quantity, DOWN quantity)`. The surplus on either side is
unpaired inventory. Remaining cost basis comes from the shared Portfolio.

Simulated cash is a reference ledger starting at the run's initial capital: buys and
fees subtract cash, sells add proceeds, splits consume collateral, and completed merges
return collateral. This balance is **not an execution-enforced wallet**. Open BUY
notional excludes possible future fees and is shown separately. Conditional settlement
PnL is net cash flow plus the shares of the hypothetical winning outcome. It can differ
slightly from the engine's saved PnL because Portfolio rounds accounting entries.

The engine separately enforces the per-market `startingCapital` allowance. Replay
uses the recorded `--starting-capital` value; if absent, it reports that the current
environment/default allowance is being substituted. This can change results for
older runs that predate capital enforcement. The allowance is shown in replay
settings and is independent of the aggregate initial capital used by the cash display.

The verification section compares PnL, costs, fees, holdings, pairs, maker/taker fills
and processed-event count with the saved market row. A mismatch remains visible and
does not prevent inspecting the reconstructed path.

Historical runs saved totals, not their original event trace. Therefore even matching
totals are labeled **reconstructed replay**, not exact historical playback. The page
records the strategy artifact hash, engine commit, source fingerprint, input parquet
hash, parameters, ordering, latency and current risk/feed settings. It identifies
missing original provenance and current-source substitutions. Nonzero jitter is
unseeded and can produce different results. No recorded shell command is executed.

## Operation

Use the existing `npm run dashboard` command on a host with Node 20, this repository,
its installed dependencies, database access, and the usual historical data/R2 access.
No worker patching, fleet preparation, migration or additional service is required.

Preparation runs in a separate child process through `runSingleMarket`, keeping the
dashboard responsive. One replay runs at a time; up to six requests may be active or
queued. Duplicate pending requests for the same run/market share a job. Completed
sessions are not silently reused for new requests; a URL containing a session id can
reopen that captured trace. **New replay** always resolves the current inputs again.

Display chunks and checkpoints are temporary files under `data/simulator-sessions/`.
The browser holds at most three chunks, each containing up to 2,000 ticks. Seeking
restores display data without serializing or rewinding a strategy closure. Preparation
can be canceled; failures and dashboard restarts are reported explicitly.

Sessions expire lazily when another replay starts: at most nine completed sessions
are retained, with a 24-hour age limit and a 2 GiB completed-cache budget. A single
trace is limited to 512 MiB compressed, two million ticks and 100,000 actions; preparation
has a five-minute deadline. Exceeding a limit reports an error rather than dropping
engine input. Active sessions are not evicted by cleanup.

Simulator APIs use the dashboard's existing allowed-host, same-origin and optional
`MISSION_CONTROL_TOKEN` protection. Only an existing run/market identity is accepted;
HTTP callers cannot provide executable code, strategy parameters or filesystem paths.

## Validation

Initial acceptance, before per-market capital enforcement was added to the engine,
replayed all ten markets in run **8180**, including all four losses.
Every saved metric and event count matched. The traces contained 65,387–128,222
strategy ticks per market, took approximately 1.9–4.0 seconds to capture, and occupied
3.0–5.9 MB compressed on the development host.

Focused tests cover observer parity, partial fills, account-triggered decisions,
synthetic ticks, cash flow, duplicate fills, chunk checkpoints, backward/equal clocks,
event-specific feed context and bounded browser caching:

```sh
node --import tsx --test src/backtest/simulator/*.test.ts dashboard/src/lib/server/simulatorPlayback.test.ts
npm run trading:test
npm run dashboard:test
npm run code:typecheck
npm run dashboard:typecheck
npm run dashboard:build
```
