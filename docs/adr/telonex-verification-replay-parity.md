---
title: ADR Telonex Verification Replay Parity
description: Architecture decision record for verifying Telonex conversions through backtest replay and full orderbook comparison.
---

# ADR: Telonex Verification Replay Parity

## Status

Accepted.

## Context

Telonex raw `book_snapshot_full` files are used as a historical source for Polymarket backtests. The repository has a mission-critical invariant: live trading and backtests must run the same strategy logic on the same tick stream semantics.

The Telonex pipeline introduces conversion steps between the raw source and the backtest engine:

- the `paired` converter writes a typed `orderbook_pair` format;
- the `delta` converter writes live-style `book` and `price_change` events.

A converter can pass simple checks while still being unsafe for strategy research. Row counts can match even if a level is wrong. Timestamps can match even if a carried side is stale in the wrong place. Top-of-book checks can pass even if deeper levels are wrong. Because strategies may depend on full depth, converter correctness has to be measured at the same boundary that strategies consume: the `MarketEngine` snapshot emitted during replay.

## Decision

Telonex converter verification must replay converted files through the same orderbook path used by backtests and compare the full orderbook state on every emitted strategy tick.

The verifier must:

1. Discover raw files and Up/Down asset mapping from database state by `--slug`.
2. Generate converter output into local temporary files.
3. Build expected snapshots directly from raw Telonex ticks.
4. Replay converted output through the same replay adapters used by backtest.
5. Compare both assets, bids, asks, all levels, and numeric price/size equality on every emitted strategy tick.
6. Stop at the first mismatch with diagnostics that identify converter, tick, reason, asset, side, and level.
7. Fail if any raw Telonex row is dropped during parsing.

The verifier must not:

- require manual raw file paths for normal use;
- infer Up/Down from filenames;
- upload verifier output to R2;
- certify a converter using only row counts, schemas, timestamps, or top-of-book checks.

## Consequences

This decision makes verification slower than a schema-only test, but it verifies the behavior that actually matters: what strategies see during replay.

It also means expected snapshot logic must be maintained alongside converter semantics. When a converter intentionally changes tick semantics, the expected provider must change with it.

The design has a useful side effect: `replayOrderBookForMarket()` is shared outside the backtest CLI, so verification can exercise the real replay path without importing the whole CLI process.

## Implementation Notes

The current verifier is `src/telonex/verify-conversion.ts`.

Raw input is read with DuckDB through `streamSortedTickGroupsFromInputs()` in `src/telonex/converters/parsing.ts`. DuckDB is used because large nested Telonex Parquet files can exceed the default Node heap when decoded through `parquetjs`.

R2 downloads use `getObjectToFile()` instead of `getObjectBuffer()` so raw files are streamed to disk rather than buffered in memory.

Expected snapshots are streamed through a one-snapshot queue. This avoids storing every expected snapshot for markets with hundreds of thousands of raw rows.

Batch verification is implemented as orchestration only. `src/telonex/verify-conversion-batch.ts` selects slugs from `telonex_markets` and runs the single-slug verifier for each slug; it does not duplicate comparison logic.

## Alternatives Considered

### Compare converter output rows directly to raw rows

Rejected. The paired and delta formats intentionally have different row semantics from the raw files. Delta can omit unchanged snapshots, and paired can carry forward one side. Direct row equality would reject valid outputs and still would not prove replay correctness.

### Compare only top-of-book

Rejected. Strategies can use deeper levels or derived metrics from full depth. Full orderbook comparison is required.

### Compare only converted Parquet schema and row counts

Rejected. Schema and row counts do not prove that `MarketEngine` reconstructs the correct state.

### Use `parquetjs` for all raw reads

Rejected for large raw Telonex files. It caused JavaScript heap failures on large nested book snapshots. DuckDB handles the nested Parquet scan more reliably for this workload.

## Related Documentation

- [Verify Telonex Conversions](/datasets/telonex/verify)
- [Convert Telonex Data](/datasets/telonex/convert)
- [Telonex Overview](/datasets/telonex/overview)
