---
title: Parquet Event Writer
description: Reference for RotatingParquetEventRecorder — per-market writer lifecycle, temp-to-final rename semantics, SIGINT/SIGTERM handling, and the pre-book drop policy.
---

# Parquet Event Writer

`RotatingParquetEventRecorder` manages a pool of per-market Parquet writers. Each market gets its own writer instance and its own output file, keyed by the market's file key (the Gamma slug). Writers open lazily on the first qualifying event and close either on explicit rotation or on process shutdown.

## File Naming and Paths

Output files are placed in `baseDir` (default `data/events/<symbol>/`, overridable via `RECORD_BASE_DIR`):

```
<baseDir>/<fileKey>.parquet       ← final file (visible to readers)
<baseDir>/<fileKey>.parquet.tmp   ← in-progress write
```

The final `.parquet` file is only created by renaming the `.tmp` file. This atomic rename ensures that DuckDB and other Parquet readers never encounter a file with a missing or truncated footer.

The `fileKey` is sanitized before use: any character outside `[a-zA-Z0-9._-]` is replaced with `-`.

## Writer Lifecycle

### Opening

A writer is opened when an `append` call arrives for a market that has no existing writer, but only if the event type qualifies:

```
OPEN_ON_EVENT_TYPES = { 'book', 'disconnect', 'window_end', 'writer_lag_disconnect' }
```

Events with types outside this set are silently dropped if no writer exists for the market. This prevents the creation of files that contain only metadata (e.g., a `price_change` arriving before the initial `book`) while still allowing disconnect markers to be persisted even when no `book` was ever received.

### Pre-Book Drop Policy

After a writer is opened, events that arrive before the first `book` snapshot are dropped unless they are in the `ALLOW_BEFORE_BOOK_EVENT_TYPES` set:

```
ALLOW_BEFORE_BOOK_EVENT_TYPES = { 'disconnect', 'window_end', 'writer_lag_disconnect' }
```

This ensures that every `.parquet` file either starts with a `book` message or is a gap-marker-only file. A file that starts with `price_change` deltas without a preceding `book` would not be usable for orderbook reconstruction.

### Rotation

A writer is rotated (closed and replaced) when the `fileKey` for a market changes — which happens when the bot reconnects to a new 15-minute market window and the slug changes. The wall-clock boundary is managed externally by `record-live.ts` calling `closeAll()` on the scheduler tick; the recorder itself only rotates when the `fileKey` in an `append` call differs from the current `state.fileKey`.

### Closing

`closeAll()` drains all per-market operation chains and then calls `closeMarket()` for each active writer.

`closeMarket()`:

1. Flushes and closes the Parquet writer.
2. If `rowsWritten === 0`, deletes the `.tmp` file and logs a warning. Empty files are not renamed to `.parquet` because they contain only the Parquet schema header (DuckDB treats them as malformed).
3. Applies `finalPathTransform` if provided (used for the `-terminated` suffix on SIGINT/SIGTERM).
4. Renames `.tmp` → final path.
5. Calls `onFileFinalized` callback asynchronously (fire-and-forget) if provided.

## SIGINT / SIGTERM Handling

When the recording process receives SIGINT or SIGTERM, `record-live.ts` calls `closeAll` with a `finalPathTransform` that appends `-terminated` before the `.parquet` extension:

```
<fileKey>.parquet.tmp  →  <fileKey>-terminated.parquet
```

This naming convention signals to downstream consumers and backtest tooling that the file was closed mid-recording and may be missing events from the tail of the window. The file is otherwise structurally valid Parquet.

If the desired final path already exists (unlikely but possible on multiple restarts), `ensureNonExistingPath` appends a numeric suffix (`-2`, `-3`, …) until a non-existing path is found.

## Per-Market Serialization

All `append` and `closeMarket` operations for a given market are serialized through a per-market promise chain (`chainByMarket`). This prevents concurrent writes to the same Parquet writer, which is not thread-safe (in the Node.js sense of concurrent async operations on the same underlying resource).

The chain is structured as:

```typescript
const next = prev.then(fn, fn) // continue even if previous op failed
```

Errors in one operation do not block subsequent operations for the same market, but they will propagate to the caller of `append` / `appendMany`.

## appendMany Behavior

`appendMany` groups a batch of writes by `marketId` and processes each market's batch concurrently (across markets) but serially within each market. This is the primary write path used by `record-live.ts` when processing a burst of WebSocket messages.

## Environment Variables

| Variable                      | Default       | Description                                                                                                                                                                                                  |
| ----------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RECORD_BASE_DIR`             | `data/events` | Root directory for Parquet output files                                                                                                                                                                      |
| `RECORD_MAX_INFLIGHT_APPENDS` | _(unset)_     | Maximum number of concurrent append operations before the recorder applies backpressure. When the limit is reached, the recorder emits a `writer_lag_disconnect` synthetic event and closes the writer.      |
| `RECORD_SKIP_IF_OLDER_MS`     | _(unset)_     | If set, events whose `ts_local_ms` is older than `Date.now() - RECORD_SKIP_IF_OLDER_MS` are dropped before being written. Used to avoid writing stale events accumulated during a WebSocket reconnect delay. |
| `RECORD_STATS_INTERVAL_MS`    | _(unset)_     | Interval at which the recorder logs write throughput statistics.                                                                                                                                             |

::: tip
The `onFileFinalized` callback in `CloseAllOptions` is executed asynchronously and does not block the rotation. Long-running operations (database inserts, file uploads) should be placed in this callback rather than in the rotation hot path.
:::
