# Feed gap trials

Two standalone commands measure historical feed gaps before choosing the rules
for saved market-usability flags. They read the existing eligible market catalog
and local feed files. They do not run strategies or backtests, download files,
write database flags, change selection, or join the sync pipeline.

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

The backtest loader's existing five-minute Chainlink check is unchanged in this
phase. After reviewing these counts, choose the limits, then add persisted flags
and connect the checkers to sync and market selection.

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
pass both feeds. These are measurements for a threshold decision, not an approved
change to the existing loader or selection policy.
