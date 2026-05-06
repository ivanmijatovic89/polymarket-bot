# Data Recording + Parquet

## Recording Entry

`src/cli/record-live.ts`

## What Gets Recorded

Each row stores:

- `ingest_seq`
- `ts_local_ms`
- `ts_exchange_ms` (when available)
- `event_type`
- `raw_json`

Schema lives in `src/parquet/io/eventSchema.ts`.

## File Lifecycle

- writer creates temporary files (`*.tmp` semantics)
- finalized parquet files are renamed atomically
- on graceful close, files are closed and moved to final name
- rotation is based on market/file key (15m window slug)

Implementation: `src/parquet/io/eventWriter.ts`

## Indexing and Validation

- raw event indexing: `src/parquet/indexer/rawEventIndexer.ts`
- utilities:
  - `src/parquet/cli/verify-parquet.ts`
  - `src/parquet/cli/list-backtest-files.ts`
  - `src/parquet/cli/scan-disconnect-events.ts`

## Market Slug Semantics

Current windows are up/down 15m slugs:

`<symbol>-updown-15m-<epochStart>`

Helpers:

- `src/utils/timeWindows.ts`
- `src/polymarket/upDown15mWindowGuard.ts`

## Recording Safety Rules

- do not change schema lightly (impacts replay compatibility)
- do not drop raw payload fidelity
- keep ordering fields stable (`ingest_seq`)
