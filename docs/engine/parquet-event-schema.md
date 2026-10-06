---
title: Historical and Converted Raw-Event Parquet Schema
description: The raw-event schema retained for historical recordings and Telonex/PMXT conversions; separate from Recorder V4.
---

# Historical and Converted Raw-Event Parquet Schema

`rawMarketEventParquetSchema` in `src/parquet/io/eventSchema.ts` is used by historical `recorded` replay and raw-event Telonex/PMXT converters. It is not the Recorder V4 format. For new recordings, use the [V4 field contract and archive layout](/datasets/recording/recorder-v4).

## Columns

All columns use GZIP compression.

| Column | Parquet type | Meaning |
| --- | --- | --- |
| `ingest_seq` | Required `INT64` | Sequence within the source stream; used for deterministic recorded-order replay |
| `ts_local_ms` | Required `INT64` | Local receipt time for historical captures; converter-defined source time for converted data |
| `ts_exchange_ms` | Optional `INT64` | Exchange timestamp when available |
| `event_type` | Required `UTF8` | Market event type or historical synthetic control marker |
| `raw_json` | Required `UTF8` | Original market payload or a converter-generated market message |

These columns do not imply a shared receipt clock across independently collected sources. Sequence values from separate sessions are not globally comparable. Timestamp provenance depends on the selected source and converter.

## Historical control markers

Existing files may contain `disconnect`, `window_end`, or `writer_lag_disconnect` rows. The market decoder ignores these markers for orderbook mutation and strategy ticks. The [historical disconnect scanner](/datasets/tools/scan-disconnect-events) can inspect them; it is not a V4 coverage validator.

## Related formats

The same source file defines the paired and typed-delta schemas used by [Telonex converters](/datasets/telonex/convert). Recorder V4 has its own compact schema, mixed-feed dispatcher, coverage admission, and checksum verification. Use `record:v4:verify` for those packages.
