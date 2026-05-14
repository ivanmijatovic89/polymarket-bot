---
title: List Available PMXT Files
description: How to fetch and save the full list of downloadable Parquet files from the PMXT archive for v1 and v2.
---

# List Available PMXT Files

The PMXT archive publishes hourly Polymarket orderbook snapshots across two dataset versions. Before downloading files, run the listing script to fetch the complete catalogue for a given version and save it locally.

## Command

::: code-group

```bash [v2 (default)]
npx tsx src/pmxt/list-files.ts
```

```bash [v1]
npx tsx src/pmxt/list-files.ts --version v1
```

```bash [JSON output]
npx tsx src/pmxt/list-files.ts --version v2 --json
```

:::

## Options

| Flag | Default | Description |
|---|---|---|
| `--version` | `v2` | Archive version to scrape. Accepted values: `v1`, `v2`. |
| `--json` | off | Save output as a JSON array instead of a plain URL list. |

## Output

The script saves a file to `src/pmxt/` once all pages have been fetched:

| Version | Plain text | JSON |
|---|---|---|
| v2 | `src/pmxt/files-v2.txt` | `src/pmxt/files-v2.json` |
| v1 | `src/pmxt/files-v1.txt` | `src/pmxt/files-v1.json` |

**Plain text** — one download URL per line:

```
https://r2v2.pmxt.dev/polymarket_orderbook_2026-04-13T19.parquet
https://r2v2.pmxt.dev/polymarket_orderbook_2026-04-13T20.parquet
...
```

**JSON** — an array of objects sorted by timestamp:

```json
[
  {
    "url": "https://r2v2.pmxt.dev/polymarket_orderbook_2026-04-13T19.parquet",
    "filename": "polymarket_orderbook_2026-04-13T19.parquet",
    "timestamp": "2026-04-13T19"
  },
  ...
]
```

## What the script does

The PMXT archive site (`archive.pmxt.dev`) paginates the file index across multiple pages. The script fetches each page sequentially with a short delay between requests, extracts all Parquet download links, deduplicates them, and writes the sorted result to disk.

Progress is printed to stderr as each page is fetched:

```
Scraping Polymarket v2 archive
Source: https://archive.pmxt.dev/Polymarket/v2

  page 1 fetched (50 files, total: 50)
  page 2 fetched (50 files, total: 100)
  ...

Total files found: 736
Saved to: /path/to/src/pmxt/files-v2.txt
```

::: tip
v1 and v2 are hosted on different CDN domains (`r2.pmxt.dev` vs `r2v2.pmxt.dev`). The script handles this automatically based on the `--version` flag.
:::

::: warning
The archive grows by one file per hour. Re-run the script periodically to keep your local list up to date before downloading.
:::
