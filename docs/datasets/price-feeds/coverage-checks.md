# Feed coverage checks

Two standalone commands measure historical feed gaps using the existing eligible
market catalog and local feed files. They are read-only by default. The approved
saved rule is **ten seconds for both feeds**; `--save` persists the results in the
existing market table. The individual Binance and Chainlink upload commands now
run their checker after successful mirroring, and market selection reads the saved
results before applying its limit. No strategy or backtest runs during checking.

```bash
npm run binance:check-coverage -- --symbol btc --timeframe 15m \
  --from 2026-04-02 --to 2026-09-18 --max-gap-seconds 10 \
  --output data/reports/binance-coverage.json

npm run telonex:crypto-prices:check-coverage -- --symbol btc --timeframe 15m \
  --from 2026-04-02 --to 2026-09-18 --max-gap-seconds 10 \
  --output data/reports/chainlink-coverage.json
```

Dates are inclusive UTC dates of **market starts**. Every matching eligible,
resolved market with a `delta-typed` or `paired` conversion is measured; there is no implicit 1,000-market
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

The loader's existing checks remain active, including the five-minute Chainlink
execution guard. Selection uses the stricter saved ten-second rule. This does not
change tick ordering, modeled latency, strategy execution, or completion status.

## Upload and sync integration

Each individual upload command now follows the same sequence:

1. Mirror its local feed files to R2.
2. Check all eligible converted markets for that symbol, across all timeframes.
3. Save only that feed's verified results at the fixed ten-second threshold.

This also runs when every file was already uploaded, so newly cataloged markets
and previously unchecked windows receive flags. Upload failures or interruptions
prevent saving. `--dry-run` measures coverage but never saves it. Known unusable
windows are not sync failures; unverified files fail the step and remain distinct
in sync/fleet summaries. Dry runs also report how many saved flags need updating.
Dates before Chainlink's documented April 2, 2026 source
epoch are known unusable rather than missing local files.

`data:sync:main` calls those same upload commands once per symbol; it does not run
additional check steps. Standalone uploads therefore behave identically. Worker
sync and fleet worker sync continue pulling local copies without writing shared
flags. A cache miss on one worker cannot change the global eligible universe.

For a repair, force-download the affected source files, run the corresponding
upload command with `--force`, then force-pull repaired copies on workers. This
also covers replacement files whose byte size did not change (the existing mirror
and pull inventories compare sizes). Upload completion refreshes flags; the two
standalone checkers remain available for an explicit range. For a full recheck:

```bash
npm run binance:check-coverage -- --symbol btc --timeframe all --sync --save
npm run telonex:crypto-prices:check-coverage -- --symbol btc --timeframe all --sync --save
```

These save commands are producer operations: mirror repaired data before saving.
The checkers themselves do not upload files or verify worker caches.

## Selection contract

`EligibleMarketsQuery.requiredFeeds` accepts the effective
`ExternalFeedsRequestPlugin.config`. The active `pluginSet` takes precedence over
`plugins`, exactly as execution does. No plugin or an empty request adds no gates.

| Requested feed | SQL eligibility requirement |
|---|---|
| `binanceWsSpotPrice` | `binance_usable = true` |
| `rtdsCryptoPrices` | `chainlink_usable = true` |
| `polymarketPriceToBeat.enabled === true` | `price_to_beat IS NOT NULL` |

`tickOnUpdate: false` still requests its feed. Price-to-beat omitted or disabled
adds no condition. Missing price-to-beat is excluded when requested, including
pre-recording dates, pending backfill, and the loader's publication-grace cases.
There is no additional price-to-beat flag.

Flags certify each market's own Binance USDT pair and Chainlink USD asset.
Matching explicit symbol overrides are accepted; cross-asset requests are rejected
with an explanation because these two columns cannot certify another asset.
Replay's existing first-Chainlink-symbol behavior is preserved. RTDS Binance is
still unsupported and is not substituted with Binance WS: an RTDS request follows
the existing replay behavior of loading Chainlink.

The shared list, slug, and count APIs apply these gates before any limit. Stable
ordering uses market start and slug; latest selects the newest eligible rows and
returns chronological order, while random samples the eligible universe. The CLI
and extension planner resolve the strategy before selection. Explicit slugs are
filtered and excluded slugs are named; explicit files/directories retain their
existing loader checks rather than entering catalog selection.

`selectEligibleTelonexMarkets` returns markets, an availability summary, and an
explicit shortfall. The summary separates known false flags, unverified `NULL`
flags, and missing price-to-beat; these independent counts can overlap. Unknown
flags are excluded from verified selection, not relabeled unusable. A limited CLI
run or extension with insufficient eligible markets stops before launching jobs.
Unbounded runs use the available verified universe and print the same summary.
Selection never scans feed files and never selects by performance.

Migration `0038_backtest_feed_eligibility` adds a nullable JSON field to the
existing run table, recording the requested feeds, ten-second policy, and
selection counts. It adds no coverage table or extra market flags. New run
coverage reports use the saved request and the shared eligibility predicate.
Older runs retain their orderbook coverage report with an explicit legacy label;
the dashboard does not execute strategy code to guess historical requirements.
Extensions resolve the parent's strategy/artifact and parameters; if a recorded
feed request differs from the current strategy, a new run is required. Existing
parent metadata is retained. Saved market results/failures continue identifying
the actual selected markets; later flag refreshes may change today's eligible
universe without rewriting historical results.

After selection, loader failures remain visible failures. These flags measure
in-window gaps; lookback/cache availability and execution guards remain relevant.
A custom stricter loader policy can still reject a preselected market.

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


## Integration verification

Read-only database checks reproduced the trial counts through the shared API:
16,091 base markets, 16,040 Binance, 15,559 Chainlink, 15,784 price-to-beat,
and 15,219 requiring all three. Limits of 100, 500, and 1,000 returned exactly
that many markets with matching chronological prefixes. Slug lists, newest
selection, random eligibility, and the worker R2 selection path agreed.

All 15 saved failed slugs from the issue's run 8450 are excluded by the new filter.
A CLI admission check requesting 20,000 markets in the trial range exited with
15,219 available and a 4,781 shortfall before launching any jobs. No fleet replay,
mission restart, or deployment was performed for this verification.
