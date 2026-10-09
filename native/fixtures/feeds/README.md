# Feed golden inputs

Small input slices for the feed goldens of `14-feeds-and-plugins.md` §13
(V-1 loader goldens, V-2 timeline goldens) and `60-verification.md` §7.1.
The TS generator `native/fixtures/gen/feeds_gen.ts` and the Rust tests in
`native/crates/pmb-feeds/tests/feeds_golden.rs` read only these files, so CI
needs no data roots.

## How the slices were made

`npx tsx native/fixtures/gen/feeds_slice.ts` (run once on worker-1 on
2026-10-09, reading the read-only `data/` symlinks into the fleet copy). The
fixture markets and constants are in `native/fixtures/gen/feeds_markets.ts`:

| Market                      | Window (UTC)     | Binance days           | Chainlink day          | Notes                                                        |
| --------------------------- | ---------------- | ---------------------- | ---------------------- | ------------------------------------------------------------ |
| `btc-updown-15m-1789570800` | 2026-09-16 15:00 | 2026-09-16             | 2026-09-16             | PolyBolt era                                                 |
| `btc-updown-15m-1785028500` | 2026-07-26 01:15 | 2026-07-26             | 2026-07-26             | Telonex local clock steps backwards (14 F-8)                 |
| `btc-updown-15m-1773100800` | 2026-03-10 00:00 | 2026-03-09, 2026-03-10 | none (pre-coverage)    | lookback spans two days (14 F-12)                            |
| `btc-updown-15m-1789516800` | 2026-09-16 00:00 | 2026-09-15, 2026-09-16 | 2026-09-15, 2026-09-16 | lookback and seeds in the previous day (14 F-12, F-20, F-22) |

- Two markets read 2026-09-16, so each day file is sliced once with the
  ranges of every market that reads it.
- `binance/aggTrades/BTCUSDT/BTCUSDT-aggTrades-<day>.parquet`: the rows of
  the real day file with `start - 300 s - 2 s <= ts_ms <= end + 2 s + 2 s`,
  columns `agg_trade_id`, `price`, `ts_ms` only, ordered by `agg_trade_id`
  (DuckDB `COPY ... (FORMAT parquet, COMPRESSION zstd)`). The 2 s margin keeps
  a real seed trade before the lookback start.
- `telonex/crypto_prices/btcusd/btcusd-crypto-prices-<day>.parquet`: all
  columns of the raw Telonex day file for rows with
  `start - 300 s - 2 s <= timestamp_us / 1000 <= end + 5 s + 2 s`.
- `clocks/<slug>.json`: the real tick clocks of the market's telonex-delta
  file (`data/events/telonex/delta-typed/btc/15m/<slug>.parquet`), produced by
  the real TS reader `replayTelonexDeltaParquetForMarket` (one entry per
  `onSnapshot`: exchange time `E`, Telonex local time `L`, event type), then
  thinned deterministically to about 2,500 ticks: every k-th tick, the first
  30 and the last, two ticks around every backward local-clock step, and every
  tick within 50 ms of the window start or end. Encoded as
  `[E_i - E_{i-1}, L_i - E_i | null, 0 book | 1 price_change]` with `e0` the
  first `E`.
- `crafted/<case>/...`: tiny hand-made day files (written by the same script
  through DuckDB `VALUES`) for loader edge cases: Binance timestamps not
  monotone in id order with same-ms trades (`binance-nonmono`), no trade up to
  the window end (`binance-empty`), Chainlink broadcast order differing from
  round order with microsecond boundary rows (`chainlink-twoclock`), a 400 s
  hole inside the window (`chainlink-hole`), a NULL broadcast time on a
  member row (`chainlink-nullbc`) and a row without a round time
  (`chainlink-nullround`). Their window is 2026-09-16 12:00 UTC, except
  `chainlink-twoday` (2026-09-17 00:00 UTC: seed and lookback in the
  2026-09-16 file, members in both files, broadcast order across files).
- `crafted/<case>/...` GF-5 divergence inputs (60 §7.1): TS loads them, the
  spec fails the market `data_defect: corrupt`. Binance NULL, zero and
  negative prices (`binance-nullprice`, `binance-zeroprice`,
  `binance-negprice`, 14 F-17), a NULL `ts_ms` (`binance-nullts`), a
  duplicate `agg_trade_id` (`binance-dupid`), a seed row with a NULL broadcast time
  (`chainlink-seed-nullbc`), a zero price (`chainlink-zeroprice`) and a
  foreign `asset_id` (`chainlink-foreign-asset`) (14 F-25).
  `feeds_slice.ts --crafted-only` rewrites only the crafted files (no data
  roots needed).

The slices are inputs, not goldens: regenerating them is only needed when a
fixture market or crafted case is added. After changing a slice, rerun
`npx tsx native/fixtures/gen/feeds_gen.ts` and commit both. The generator
also accepts `--out-dir <dir>` (writes `<dir>/feeds/feeds_golden.json` only,
for `npm run native:goldens:check`, 60 GF-4) and `--check`.
