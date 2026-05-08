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

npm run -s scan:disconnect-events -- data/events_7_batch_566/btc   --delete-files-where-disconnects-equal-or-greater=3 --delete-files-with-last-event-disconnect
```

## Options

- `--no-recursive`: only scan the given folder (default is recursive)
- `--limit-rows N`: scan at most N rows per file (default 0 = scan all rows)
- `--delete-files-where-disconnects-equal-or-greater=N`: delete files where disconnect count is >= N (N must be >= 1)
- `--delete-files-with-last-event-disconnect`: delete files where the last event is a disconnect

Both delete flags can be used together; deletion uses OR logic.

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
- Prints a `disconnects_per_file` table with `level`, `count`, and `count_ge` (>= level).
- If delete flags are provided and matches exist, it prompts to:
  - show the list of files that will be deleted
  - confirm by typing `delete`
