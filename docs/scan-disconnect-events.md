# scan-disconnect-events

Scans a folder of `.parquet` files and counts `event_type === "disconnect"` events.

## Script location

`src/parquet/cli/scan-disconnect-events.ts`

## Run

```bash
# direct
tsx src/parquet/cli/scan-disconnect-events.ts <folder>

# via npm
npm run -s scan:disconnect-events -- <folder>
```

## Options

- `--no-recursive`: only scan the given folder (default is recursive)
- `--limit-rows N`: scan at most N rows per file (default 0 = scan all rows)

## Output

- Prints each file (relative to the input folder)
- For files that contain disconnects, prints:
  - `disconnects=<count>`
  - `last_event_disconnect=<true|false>` (whether the last row in the file is a disconnect)
  - `gaps=<count>` and `gap_ms_*` stats, where each gap is:
    - \( \Delta t = \text{next.ts_local_ms} - \text{disconnect.ts_local_ms} \)
- Final summary:
  - `files`: total parquet files scanned
  - `files_with_disconnect`: how many files had at least one `disconnect`
  - `files_with_last_event_disconnect`: how many files ended with `disconnect`
  - `total_disconnects`: total disconnect rows across all scanned files
  - `total_disconnects_without_next_event`: disconnects that had no following row (typically because disconnect was the last row)
  - `gaps` and `gap_ms_*`: aggregated gap stats across all files
  - `files_errored`: how many files failed to read
