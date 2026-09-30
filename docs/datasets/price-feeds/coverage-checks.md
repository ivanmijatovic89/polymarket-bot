# Feed coverage checks

Two standalone commands measure historical feed gaps using the existing eligible
market catalog and local feed files. They are read-only by default. The approved
saved rule is **ten seconds for both feeds**; `--save` persists the results in the
existing market table. They do not run strategies or backtests, download files,
change selection, or join the sync pipeline yet.

```bash
npm run binance:check-coverage -- --symbol btc --timeframe 15m \
  --from 2026-04-02 --to 2026-09-18 --max-gap-seconds 10 \
  --output data/reports/binance-coverage.json

npm run telonex:crypto-prices:check-coverage -- --symbol btc --timeframe 15m \
  --from 2026-04-02 --to 2026-09-18 --max-gap-seconds 10 \
  --output data/reports/chainlink-coverage.json
```

Dates are inclusive UTC dates of **market starts**. Every matching eligible,
resolved `delta-typed` market is measured; there is no implicit 1,000-market
limit. The default `--read-from r2` uses R2 orderbook availability in the existing
eligibility query. `--read-from local` uses its local-orderbook condition instead.
In both cases the checker reads **local feed files only**.

## Trial rule

- Binance: measure gaps between trade timestamps (`ts_ms`).
- Chainlink: measure gaps between oracle round timestamps (`timestamp_us`),
  normalized to milliseconds. This is the existing loader's gap clock; it does
  not measure broadcast or network latency.
- Clip gaps to the market window, including its beginning and end. Combine gaps
  spanning midnight; a market ending exactly at midnight does not need the next
  day's file. Data before the window is not part of this trial.
- A gap **greater than** the chosen limit fails; exactly ten seconds passes a
  ten-second trial. Empty windows and invalid rows also fail. Prices must be
  finite and positive; Chainlink additionally validates asset identity and a
  positive broadcast timestamp. Undatable rows fail every requested window
  relying on that daily file.
- Missing or unreadable local files mean **unverified**, not permanently
  unusable. The summary retains these markets in its denominator.

“Usable” here means passing this **gap trial**, not proof that the source archive
contains every exchange event. The commands do not validate source checksums,
trade-ID continuity, lookback availability, or R2 copies. A genuine quiet period
can fail the chosen gap rule without implying lost records.

Each command scans a day once and prints usable/unusable/unverified counts at
the requested limit and at 5, 10, 15, 30, and 60 seconds. Comparisons reuse the
same measurements. Optional JSON reports contain the selection parameters,
counts, each market's maximum gap, row counts, and file errors. Existing reports
are never overwritten: choose a new output path for another run.

Exit status is zero for a completed trial, including known unusable windows;
unverified files or command failures produce a nonzero status. Run focused tests
with `npm run feeds:coverage:test`.

## Saving results

Apply migration `0037_telonex_market_feed_usability` with the existing migration
workflow before saving. It adds only two nullable columns to `telonex_markets`:

| Column | Meaning |
|---|---|
| `binance_usable` | Result for the market symbol's Binance spot feed |
| `chainlink_usable` | Result for the market symbol's Chainlink feed |

`NULL` means not checked; `1` means usable; `0` means checked and unusable.
Price-to-beat continues to use its existing value and needs no extra flag.

On the producer, append `--save` to either command. Each checker updates only its
own column, verifies the updates inside a transaction, and leaves other markets
and the other feed unchanged. Missing or unreadable files are skipped: they leave
a prior result unchanged, or keep `NULL` when none exists. No partial result is
committed if the database update fails. Repeated successful checks are idempotent.

Saving requires `--max-gap-seconds 10` (the default); other thresholds remain
available for read-only comparisons. After repairing feed files, rerun the
corresponding checker with `--save` to refresh the affected range. Worker cache
checks should remain read-only.

The backtest loader's existing five-minute Chainlink check is unchanged in this
phase. Automatic sync integration and filtering selection by these flags are
the next phase.

## Initial Bitcoin trial

Measured on September 30, 2026 with the commands above. The existing catalog
returned **16,091 eligible BTC 15m markets**, from April 2 through September 16
(last market start: 15:15 UTC), across 168 days. September 17–18 contributed no
eligible markets to this selection. Both feeds checked the same market set.

| Maximum allowed gap | Binance usable | Chainlink usable | Both feeds usable |
|---|---:|---:|---:|
| 5 seconds | 11,012 | 7,142 | 4,854 |
| **10 seconds** | **16,040** | **15,559** | **15,511** |
| 15 seconds | 16,091 | 15,617 | 15,617 |
| 30 seconds | 16,091 | 15,698 | 15,698 |
| 60 seconds | 16,091 | 15,812 | 15,812 |

At ten seconds, **51 Binance windows** and **532 Chainlink windows** fail. There
are **zero unverified markets** and no invalid rows in either feed. Chainlink has
173 windows with no updates at all; they are included in its failures. The largest
Binance in-window gap is 13.511 seconds.

Increasing both limits from ten to fifteen seconds recovers 106 markets that
pass both feeds. The chosen policy remains **ten seconds for both feeds**.
Of the 15,511 markets passing both checks, 15,219 also have price-to-beat;
292 have no price-to-beat value. The total set has 15,784 present and 307 missing.

On September 30, the two-column migration was applied to the configured database
and both checkers were rerun with `--save` for this range. All 16,091 results per
feed were read back and matched the reports. Flags outside this market set remain
`NULL`; no price-to-beat values were changed.
