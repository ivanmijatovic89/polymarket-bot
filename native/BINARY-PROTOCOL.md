# Native strategy binary protocol

A native strategy artifact is one self-contained executable
(`aarch64-apple-darwin`): the engine plus one strategy, built from a strategy
crate whose `main` calls `pmb_sdk::strategy_main(factory)`. Identity = sha256 of
the binary bytes. R2 key `strategy-artifacts/native/<sha256>`; local cache
`data/strategy-artifacts/native/<sha256>` (mode 0755).

All JSON is UTF-8, camelCase, on stdout. Logs go to stderr. Exit code 0 =
success, 2 = invalid input (params/job), 1 = runtime error (message on stderr).

## `describe`

```
<bin> describe [--params '<json object>']
```

Validates params (unknown keys and invalid values are errors) and prints:

```json
{
  "protocolVersion": 1,
  "id": "overnight-opus55-lagsnipe.v15",
  "engineVersion": "0.1.0",
  "params": { "...": "normalized params with defaults applied" },
  "requiredFeeds": { "binanceWsSpotPrice": {}, "polymarketPriceToBeat": { "enabled": true } }
}
```

`requiredFeeds` uses the TS `ExternalFeedsRequestConfig` shape so the producer's
feed-eligibility code works unchanged; `null` when no feeds are needed.

## `run`

```
<bin> run --job <path | -> [--trace <path>] [--profile ts-compat|realistic]
```

Reads one `MarketJobData` JSON (exactly what the BullMQ market job carries),
runs the market, prints one `RunSingleMarketOutput` JSON. `--trace` writes the
canonical parity trace ([TRACE.md](TRACE.md)). Default profile: `ts-compat`.

## `run-group` (shared candidate replay, M4)

```
<bin> run-group --jobs <path | -> [--profile ...]
```

Input: JSON array of `MarketJobData` that differ only in `strategyParams`
(and `idx`). The market and feeds are read once. Output: JSON array of
`RunSingleMarketOutput` in input order. Incompatible jobs → exit 2.
