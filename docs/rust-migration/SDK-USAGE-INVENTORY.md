# Strategy SDK usage and reference-semantics inventory

Status: **bounded static discovery complete; required strategy/version coverage, native SDK integration and behavioral acceptance pending**. This is a porting dependency inventory, not evidence that every required strategy is available or that the migration is complete. No strategy or saved JavaScript artifact was executed during this audit.

## Reference and limits

The engine baseline is `07245602d6ff9bca0dcdf772134cba3dd227526c`. External protocol sources are read from Git revision `155fa585bea79ad77c1002a167e62f1060261aeb` in `/Users/mijat/Sites/polymarket-protocols`. Engine source bytes were read from the pinned Git revision, with reviewed SDK and additional reference files checked against the isolated worktree. The source roots, immutable artifact locations and reference-coverage limitations come from [the artifact inventory](ARTIFACT-COMPATIBILITY-INVENTORY.md). Its JSON SHA-256 at inspection was `3b9bd7a35f6495480b41d8e224709e1f1cd21b1fec564979be6dca235dbc0661`.

[The machine-readable SDK observations](sdk-usage-inventory.json) record per-file hashes, revisions, imports, syntactic SDK calls, context-property paths, callback locations, await sites and candidate reference assignments. These candidates are not complete data-flow analysis. An assignment can store a scalar rather than an alias; an alias hidden behind a helper or dynamic property can be missed. Empty AST categories never prove absence of a behavior.

| Observed input | Count | Meaning |
| --- | ---: | --- |
| Pinned SDK/runner/plugin files | 13 | Reviewed interfaces and plugin implementations |
| Parsed strategy source candidates | 158 | 73 engine candidates and 85 external candidates; files, not loaded definitions or distinct strategy versions |
| Reachable relative-import source helpers | 21 | Static import/export closure under the inspected roots, not every dynamic dependency |
| Additional pinned reference files | 16 | Portfolio/order/replay/statistics/feed consumers and existing tests |
| Available immutable cache bundles | 155 | Unique byte hashes; read statically, never imported |
| Catalog bundle hashes unavailable locally | 219 | Required compatibility work remains pending until reference reconciliation and retrieval |

One generated research-results source (`results-SplitSellRedeem.v5.1-research-metrics.ts`, 2,507,638 bytes) was inspected for size/hash only and was not parsed. Current external sources do not prove equivalence to historical published bundles. Run, job, active-live and fleet references remain unreconciled; their required artifact counts are unknown, not zero. The earlier 73-definition loaded registry inventory and this broader static file inventory measure different things.

The temporary inspector used Node `v20.19.6` and TypeScript Compiler API `5.9.3`; its hash is recorded in the JSON. It was a reviewed one-off discovery tool, not a shipped inventory command. Context7 was used to confirm compiler API inspection. Future repeatable inventory tooling must preserve pinned bytes, hash checks and non-execution, and add explicit completeness checks.

## SDK surface to port

Strategies implement market and account callbacks, may return promises, and construct definitions with validated params, plugins and a fresh strategy instance. Native factory construction must preserve defaults, validation failures, optional fields and version identity. A historical `.mjs` artifact is a source reference, not a native executable. Each required artifact needs a verified mapping to a native implementation, schema, dependency/feed contract and build identity.

The shared native SDK must expose typed equivalents of `Strategy`, `StrategyDefinition`, `StrategyContext`, `MarketTick`, `PortfolioSnapshot`, the complete `Intent` and `AccountEvent` unions, and plugin interfaces. Observed imports include `OpenOrder`, `Fill`, `IntentMeta`, `PlaceLimitIntent`, external-feed and gate/volatility snapshot types. TypeScript `readonly` declarations alone do not make the nested runtime objects immutable.

The eight intent variants are `place_limit`, `place_batch`, `cancel_order`, `cancel_batch`, `cancel_market`, `cancel_all`, `split_positions` and `merge_positions`. The thirteen account-event variants are `cancel_failed`, `order_submitted`, `order_accepted`, `order_rejected`, `order_open`, `order_done`, `fill`, `positions_split`, `account_stream_status`, `ws_order_update`, `positions_merged`, `merge_failed` and `split_failed`. Supporting only the variants exercised by one benchmark is insufficient.

Context includes plugins, market metadata, position/book metrics, balance and warmup. Portfolio views include capital, clock, realized PnL, positions, open/WS/history orders, recent fills/splits and asset-to-market mapping. Tick source information includes receipt/source ordering and `bigint` sequence fields. Raw messages, market snapshots and externally driven synthetic tick forms are part of the contract. The existing typed math/market/Portfolio kernels are useful foundations; strategy-facing wrappers and reference identity remain integration work.

All five toolkit exports require ports:

| Function | Required behavior |
| --- | --- |
| `safeProbabilityPrice` | Finite guard, probability clamp, JavaScript signed-zero behavior |
| `parseGammaMarketStartMs` | Nonempty `eventStartTime` takes precedence over `startDate`; preserve accepted `Date.parse` behavior and invalid-date result |
| `requiredTradeRank` | `MATCHED` = 1, `MINED` = 2, other statuses = 3 |
| `isOrderTradeStatusAtLeast` | Missing order is false; otherwise compare stored rank with the required rank |
| `isWarmed` | Missing warmup is true, warming is false, **error is true**; strategies may independently reject error |

Fees/constants are also imported by available bundles and external helpers. Reuse the reviewed shared fee kernel, preserving selector/default semantics. Do not replace the status/date/warmup behavior with a superficially similar convenience API.

## Confirmed reference behavior

### Metadata mutations survive into statistics

External `protocols/pair-game-astra/strategies/observer.ts` stores the incoming `intent.meta` object in its order record (line 64). On the first fill it attaches `this.tape` to that same metadata (line 93). The tape continues changing with subsequent observations. Source SHA-256 is `9dc0a9806229f96c309ad53e3cf6105e86fcbf6859fb6de7757d94f6f7fee682`.

The same operations were statically confirmed in available immutable bundle `36ca952492d9a76e5f115d932779731fc3d99aec37c8edd87d85e04a17ea3050`, catalog strategy `pair-game-astra.v2`. This is source-level proof of the alias, not execution coverage for that strategy.

The engine retains the reference through these consumers:

1. `OrderManager.ts:498` attaches `intent.meta` to the submitted order.
2. `Portfolio.ts:609` and its other history updates attach `o.meta`, rather than cloning it.
3. `runSingleMarket.ts:324` reads the history metadata after the awaited runner callback and attaches it to a harvested trade.
4. `marketStats.ts:179` retains that trade's metadata in the statistics list.

A tape mutation on a later callback can therefore affect metadata already attached to an earlier harvested trade. Cloning a `serde_json::Value` at each stage changes the result. Serializing metadata immediately on fill also changes when its contents are observed. Shared mutable metadata is an acceptance requirement, not an optional historical quirk.

The observer's first Parquet callback also streams and hashes the input file (`observer.ts:41–48`) and records bytes and source identity. This helper work affects outputs and elapsed time. A complete benchmark must include it at the corresponding stage, or apply the same separately measured preparation to both implementations. Removing diagnostic/evidence work cannot justify a production speed claim.

### Retained tick and context

`protocols/split-sell-redeem/strategies/decision-observer.ts:36–38` keeps `currentTick = tick` and `currentContext = ctx`; its later `snapshot()` reads those references. Its SHA-256 is `48720fc49de3a6085699ffb678913bf5394cbc6167b5e8188417af2814497226`. Fifteen available immutable bundles contain the same assignment pattern. This proves retained callback references; it does not prove every such reference crosses an `await`.

Portfolio snapshots freeze the outer object and capital, but their nested maps and records are not recursively frozen. Map wrappers and recent-item arrays are rebuilt when the cache is invalidated; some record values remain shared. History records can be replaced while earlier references remain reachable. The existing Portfolio value/output parity does not certify retained `OpenOrder`, `Position`, raw fill/split or nested metadata identity.

### Custom plugin composition is supported

`protocols/split-sell-redeem/strategies/feed-callbacks.v1.ts:107` wraps gate plugins with `bookOnly`, forwards `onMarket`/`snapshot`/`reset`, and sets `handlesSyntheticTicks: false`. The underlying gate implementations opt into synthetic ticks. This exact wrapper was found in bundle `0d0e6276d4e18cae0e8dbfa2a866d920fb63e9eb5f0d187212c26eee0f8423ae`. A fixed plugin enum that ignores wrapper-level behavior would diverge.

## Plugin and runner contracts

Construction counts below are distinct inspected files containing recognized construction calls. They do not count logical strategies, effective instances or complete runtime usage.

| Plugin | Source candidate files | Available bundle files |
| --- | ---: | ---: |
| `ExternalFeedsRequestPlugin` | 78 | 86 |
| `TimeWindowGatePlugin` | 37 | 17 |
| `DwellGatePlugin` | 37 | 17 |
| `TimeWindowVolatility` | 12 | 0 |
| `TechnicalIndicatorsPlugin` | 6 | 0 |

`DeribitVolatilityIndexPlugin` exists in the SDK. Its required-version classification remains pending; absence of a recognized construction call in available inputs is not authorization to omit it. The live CLI also constructs legacy `ExternalFeedsPlugin` when no request plugin is present; no strategy-side constructor is needed for that path to be required.

### Dispatch, caching and receipt capture

- The runner serializes market/account work in FIFO order. A rejected callback rejects/logs that call without poisoning later work. Market ticks are not dropped when the queue grows.
- `captureMarketTick` runs synchronously **before** work enters the serial queue. Market/balance/warmup providers are read inside processing. Moving feed capture into processing can give an earlier tick a later observation.
- The runner updates plugins and builds one cached plugin snapshot for a tick. Account callbacks reuse the cached plugin object and recompute their other context. Old retained contexts must keep the corresponding old object.
- `PluginSet` preserves registration order. Duplicate IDs update both instances; snapshot construction keeps the last value, while `listIds()` keeps first occurrence order. Falsy IDs and `undefined` snapshots are skipped; `null` is retained.
- Synthetic ticks skip `onMarket` unless the wrapper's flag is exactly true, but snapshot construction still runs for every plugin. Capture is independent of the synthetic flag. `reset` invokes every plugin and replaces the cache.
- Real book ticks advance execution/expiry and drain account events before strategy decisions. Synthetic unchanged-book callbacks may emit intents but do not advance execution; queued work awaits a real tick.
- Rotation cancels/reconciles old orders, starts a new episode and constructs fresh strategy/plugins. The first rotating tick was captured through the previous plugin set before the new set exists; a new request plugin may fall back to its provider. Preserve this baseline ordering in a fixture rather than silently claiming universal new-episode capture.
- The runner retains previous episode ledgers and order/asset routing for late account events. Those events update the appropriate old ledger without running the new episode's strategy against them.
- Account-event drain limits, including default 4,200 and the existing queued-event discard behavior on exhaustion, need explicit acceptance. This differs from the market queue. Initial zero timestamps also trigger the current `timestamp || Date.now()` clock fallback.

`ExternalFeedsRequestPlugin` binds captures to **tick object identity** in a WeakMap. Fulfillment is separate from construction. Captures clone supported feed records at receipt; snapshot uses captured data when present and otherwise its provider. Reset clears the last tick, not the WeakMap. Duplicate use of one tick object and rotation fallback need dedicated cases. Request detection is structural, including configuration and fulfillment methods; native wrappers must preserve effective behavior across plugin composition.

Feed snapshots retain separate observation/exchange timestamps and receipt timestamps. Binance book-ticker prices/quantities/update IDs are strings. Chainlink full-accuracy values, opening references, conflicts, source metadata and website comparison states must survive. Missing data before its first arrival stays absent. V4 receipt observations and historical datasets have different supported availability contracts; unsupported requests must fail as the baseline does. Warmup/balance and asynchronous completion inputs need capture when comparing live-equivalent sessions.

### Stateful and asynchronous plugins

- **Dwell:** inclusive price bounds, per-asset continuous timers, reset on invalid/out-of-range prices, unchanged reference behavior for backward clocks and missing IDs, cached snapshots and synthetic opt-in.
- **Time window:** start-date precedence, inclusive elapsed-time bounds, missing/invalid dates, per-tick cache and synthetic opt-in.
- **Rolling volatility:** strict `timestamp < cutoff` eviction, sample/order semantics, ordered windows, readiness at coverage ≥ 93% and at least six samples, stale last-ready values, and identical arithmetic order. `snapshot()` itself updates `lastComputed` when ready; refresh frequency is observable despite the interface's purity guidance.
- **Technical indicators:** fire-and-forget episode request, in-flight guard, reset/late-completion filtering, both 1h/15m candle requests, closed-candle alignment, required lookback/sample lengths, and ATR/ADX/Bollinger/realized-volatility calculation order. Preserve session boundaries, errors and warnings. Pin the indicator implementation; identical formula names do not guarantee binary64 parity.
- **Deribit:** equivalent asynchronous lifecycle plus 60-second candles, 300/900/3,600-second aggregation, bucket counts, ordered OHLC, currency and alignment handling. Classification remains open, not excluded.

The optional backtest technical-indicator wait uses wall-clock polling/timeout and refreshes snapshots. Native ports need the same configured behavior and a deterministic completion/control trace for acceptance. A benchmark must account for the wait and I/O when enabled.

## Proposed native SDK boundary

Use one native strategy/session implementation for both live and replay. Typed numeric kernels remain typed; JSON is an inspection/output boundary, not the per-tick strategy interface.

Introduce session-owned, generation-checked handles for objects whose identity and mutation are observable. Metadata handles must be shared by intent, submitted order, order history, harvested trade and statistics. Retained tick/context/plugin views and mutable ledger records require equivalent lifetimes. Borrowed typed views can serve ordinary immediate reads, but cannot be the only API when required strategies retain references.

The value representation must preserve the relevant JavaScript domain: binary64 including signed zero and internal non-finite values, UTF-16 strings, missing versus null, ordered object keys, arrays and shared nodes. JSON serialization occurs at the original observation boundary; shared references serialize their current contents, and cycles follow an explicit equivalent failure contract. Do not emit internal handle IDs into existing statistics or replace shared metadata with detached copies. Do not retire alias behavior without a separately authorized baseline change.

Keep snapshot wrapper/map identity distinct from mutable record identity. Rebuilding an outer snapshot must not silently deep-clone its records; mutating a snapshot's map wrapper must not alter the internal ledger index. Conversely, a shared `Position`/order/metadata mutation must remain visible where the baseline shares that record. Strategy-retained roots keep handles alive; pruning a ledger map cannot invalidate a still-retained object. Cycle-aware ownership and reclamation need design/tests before declaring this graph complete.

A serialized native session can own the object graph and strategy state. Feed and asynchronous provider completions enter through typed receipt/control envelopes. Avoid holding mutable graph access across provider waits; retain safe handles instead. Different markets/sessions may run on separate workers without changing within-session ordering. Both live and replay feed this same runner, plugins, strategy factory and intent lifecycle; neither delegates per-tick decisions to TypeScript.

Diagnostics/evidence helpers, schema validation, file hashing/decompression, artifact identity and final serialization remain required work. The available bundles include Node crypto/zlib imports and external helper dependencies. Their native equivalents belong in the measured workflow, with per-version source mapping and output fixtures.

## Dependency-ordered implementation and acceptance

These are proposed work items, not newly completed ledger requirements.

| Item | Work | Dependencies and acceptance |
| --- | --- | --- |
| SDK-01 | Reconcile required immutable versions; retrieve missing bytes and trace source/dependencies/schema/feed descriptors | Artifact/run/job/live/fleet inventory; exact native artifact mapping, no ID-only substitution |
| SDK-02 | Shared value/reference graph and serialization boundary | Metadata/record/snapshot alias fixtures; cycles, pruning and lifetimes; extend current typed Portfolio rather than discard its tests |
| SDK-03 | Typed strategy factory/context, tick/receipt and provider interfaces | SDK-02; every union variant and context field, metrics wrappers, deterministic episode state |
| SDK-04 | Toolkit/date/status/warmup and fee integration | Can proceed beside graph design; boundary/default/invalid-input fixtures |
| SDK-05 | Plugin composition, ordered registration, caching, refresh, reset and synthetic dispatch | SDK-02/03; duplicate IDs, retained snapshots and custom wrappers |
| SDK-06 | Feed request fulfillment/capture plus native historical/V4/live providers | SDK-05; receipt-time capture, availability/source validation and missing fields |
| SDK-07 | Dwell/time-window/rolling-volatility kernels and SDK wrappers | Pure arithmetic can proceed early; integration depends on SDK-05; exact boundary and stale-state traces |
| SDK-08 | Technical-indicator/Deribit providers, calculations and asynchronous completion lifecycle | SDK-05/06; pinned algorithms, late completion, polling/wait and error fixtures |
| SDK-09 | Required strategy versions, external observers/helpers and schema/catalog/build mapping | SDK-01 plus each used SDK item; callback, intent, diagnostics and final metadata parity |
| SDK-10 | Complete serial runner, rotation, account routing and execution integration | Earlier items plus OrderManager/adapters; captured live/replay traces, batch/database/fleet acceptance and complete benchmark |

SDK-04 and pure SDK-07 kernels can run in parallel with SDK-02/03 contract work. Different plugin/provider owners can then work behind agreed interfaces. Root should own integration and requirement accounting; each owner must report its source hashes, covered versions, fixtures, failures and still-pending consumers.

Required regressions include:

1. Attach one mutable tape to intent metadata, harvest a fill, mutate the tape later, then serialize trade/market/batch outputs. Verify both value and shared identity at each boundary. Test stale open-order/history references, mutable positions, raw fills/splits and recent-item aliases separately.
2. Retain a tick/context across subsequent callbacks and an awaited helper. Check wrapper/record identities, cache invalidation, graph lifetime after pruning, missing/null, numeric-key ordering, `-0`, UTF-16 and non-finite internal values. Include repeated references and serialization cycles.
3. Block processing, receive successive feed observations/ticks, then resume. Assert each captured snapshot reflects receipt time. Include repeated tick object identity, first rotating tick, provider fallback and account callbacks sharing the tick's plugin cache.
4. Test synthetic ticks with each flag, `bookOnly`, duplicate IDs, snapshot refresh side effects, plugin reset and retained old snapshots. Check queued intents, fills, expiry and real-tick advancement.
5. Test callback rejection followed by another tick, mixed market/account queue ordering, late previous-episode events, zero timestamps and drain-limit exhaustion.
6. Test dwell/window inclusivity and backward clocks; volatility cutoff ties, six-sample/93% boundaries, stale readiness and repeated snapshot refresh; technical-indicator/Deribit insufficient/misaligned data, failure, in-flight reset and late completion.
7. Compare every required native strategy/version against a pinned, reviewed TypeScript oracle on the same recorded inputs. Include external observer file hashing and diagnostic work. Then measure the full agreed batch/database/fleet workflow with build/input hashes and equivalent outputs.

Useful existing baseline tests are `StrategyRunner.serial.test.ts`, `StrategyRunner.syntheticTicks.test.ts`, `StrategyRunner.clock.test.ts`, `PluginSet.syntheticTicks.test.ts`, `backtestExternalFeedsProvider.test.ts` and `syntheticTickSchedule.test.ts`; their pinned hashes are in the JSON. They are fixtures to extend, not sufficient SDK acceptance on their own. A reference command is:

```sh
/Users/mijat/.nvm/versions/node/v20.19.6/bin/node --import tsx --test src/trading/StrategyRunner.serial.test.ts src/trading/StrategyRunner.syntheticTicks.test.ts src/trading/StrategyRunner.clock.test.ts src/strategy/plugins/PluginSet.syntheticTicks.test.ts src/backtest/feeds/backtestExternalFeedsProvider.test.ts src/backtest/feeds/syntheticTickSchedule.test.ts
```

No tests or live connections were invoked for this static inventory. Native SDK/plugin acceptance commands will be recorded when those implementations and fixtures exist. The prior aggregate/core differential suites remain their own bounded evidence. This inventory does not certify a production speedup, complete strategy compatibility, or end-to-end live/backtest parity.
