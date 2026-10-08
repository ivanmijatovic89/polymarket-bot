//! Binance aggTrades day files → as-of price series (TS
//! `binanceAggTradesSource.ts`).
//!
//! Series = trades with `start - lookback <= ts_ms <= end + 2s`, ordered by
//! `agg_trade_id` (same-ms trades keep exchange order, so "latest at t" is
//! the highest id — live last-write-wins), seeded with the single latest
//! trade before the range when the covered day files hold one (live keeps the
//! last price forever, so a quiet gap must still yield a price).
//!
//! Hard errors: a missing day file, or no trade at all up to the window end.

use super::DataRoots;
use crate::pq::{self, Column};
use crate::slug::{utc_date_of, utc_dates_covering, Window};
use anyhow::{bail, Context, Result};
use parquet::data_type::{DoubleType, Int64Type};
use parquet::file::reader::{FileReader, SerializedFileReader};
use pmb_core::model::TsMs;
use std::fs::File;

/// Post-window tail: replay feed clocks (local receive time) run slightly
/// past the exchange-stamped window end.
pub const SERIES_TAIL_MS: i64 = 2_000;

/// Trades sorted by `agg_trade_id`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AggTradeSeries {
    /// Exchange trade time.
    pub ts_ms: Vec<TsMs>,
    pub price: Vec<f64>,
    /// Element 0 is the pre-range seed trade.
    pub seeded: bool,
}

impl AggTradeSeries {
    pub fn len(&self) -> usize {
        self.ts_ms.len()
    }
    pub fn is_empty(&self) -> bool {
        self.ts_ms.is_empty()
    }
}

struct Trade {
    id: i64,
    ts: i64,
    price: Option<f64>,
}

/// Loads the series for `pair` (e.g. `BTCUSDT`) covering
/// `[window.start - lookback, window.end + SERIES_TAIL_MS]`.
pub fn load_agg_trades(
    roots: &DataRoots,
    pair: &str,
    window: Window,
    lookback_ms: i64,
    notes: &mut Vec<String>,
) -> Result<AggTradeSeries> {
    let from = window.start_ms - lookback_ms;
    let to = window.end_ms + SERIES_TAIL_MS;
    let dates = utc_dates_covering(from, window.end_ms)?;
    let (mut paths, mut missing) = (Vec::new(), Vec::new());
    for d in &dates {
        let p = roots.agg_trades_day_path(pair, d);
        if p.is_file() {
            paths.push(p);
        } else {
            missing.push(d.as_str());
        }
    }
    if let (Some(first), Some(last)) = (missing.first(), missing.last()) {
        bail!(
            "[backtest:feeds] missing Binance aggTrades day file(s) for {pair}: {}. \
             Worker machines: npm run binance:download-aggtrades-r2-to-local -- --pair {pair} (pull from the R2 mirror). \
             Producer machine: npm run binance:download-aggtrades -- --pair {pair} --from {first} --to {last} (direct Binance download)",
            missing.join(", ")
        );
    }

    let readers = paths
        .iter()
        .map(|p| pq::open(p))
        .collect::<Result<Vec<_>>>()?;
    let mut cols = Vec::with_capacity(readers.len());
    for (r, p) in readers.iter().zip(&paths) {
        cols.push([
            pq::require_column(r, p, "agg_trade_id")?,
            pq::require_column(r, p, "ts_ms")?,
            pq::require_column(r, p, "price")?,
        ]);
    }
    let id_cols: Vec<usize> = cols.iter().map(|c| c[0]).collect();
    let ts_cols: Vec<usize> = cols.iter().map(|c| c[1]).collect();
    let plan = pq::plan_groups(&readers, &ts_cols, &id_cols, from, to);

    let mut buf = Buffers::default();
    let mut selected: Vec<Trade> = Vec::new();
    let mut seed: Option<Trade> = None;
    for g in &plan.range {
        buf.scan(&readers[g.file], g.group, &cols[g.file], |t| {
            if t.ts < from {
                if seed.as_ref().is_none_or(|s| t.id > s.id) {
                    seed = Some(t);
                }
            } else if t.ts <= to {
                selected.push(t);
            }
        })
        .with_context(|| paths[g.file].display().to_string())?;
    }
    for (g, max_id) in &plan.seed_only {
        if let (Some(s), Some(max)) = (&seed, max_id) {
            if s.id > *max {
                break;
            }
        }
        buf.scan(&readers[g.file], g.group, &cols[g.file], |t| {
            if t.ts < from && seed.as_ref().is_none_or(|s| t.id > s.id) {
                seed = Some(t);
            }
        })
        .with_context(|| paths[g.file].display().to_string())?;
    }
    selected.sort_by_key(|t| t.id);

    let in_range = selected.len();
    let mut series = AggTradeSeries {
        ts_ms: Vec::with_capacity(in_range + 1),
        price: Vec::with_capacity(in_range + 1),
        seeded: seed.is_some(),
    };
    for t in seed.iter().chain(&selected) {
        let Some(price) = t.price.filter(|p| p.is_finite()) else {
            bail!(
                "[backtest:feeds] NULL/invalid price in Binance aggTrades day file(s) for {pair} (agg_trade_id={}) — corrupt row; re-download with --force",
                t.id
            );
        };
        series.ts_ms.push(t.ts);
        series.price.push(price);
    }
    if series.is_empty() {
        bail!(
            "[backtest:feeds] Binance aggTrades day file(s) for {pair} contain no trades up to {} ({}) — corrupt/empty day file(s), \
             or the pair had no trades yet (listed later than this window?). If corruption is plausible, re-download on the producer with: \
             npm run binance:download-aggtrades -- --pair {pair} --from {} --to {} --force",
            iso(window.end_ms),
            dates.join(", "),
            dates[0],
            dates[dates.len() - 1]
        );
    }
    if in_range == 0 {
        notes.push(format!(
            "[backtest:feeds] no {pair} trades inside [{}, {}] — the whole market replays on the single pre-window price from {}. \
             Quiet gap, or truncated day file? (verify with: npm run verify:parquet -- {})",
            iso(from),
            iso(window.end_ms),
            iso(series.ts_ms[0]),
            paths[paths.len() - 1].display()
        ));
    }
    Ok(series)
}

pub(super) fn iso(ms: TsMs) -> String {
    let secs = ms.div_euclid(1000);
    let millis = ms.rem_euclid(1000);
    let tod = secs.rem_euclid(86_400);
    format!(
        "{}T{:02}:{:02}:{:02}.{millis:03}Z",
        utc_date_of(ms),
        tod / 3600,
        tod % 3600 / 60,
        tod % 60
    )
}

#[derive(Default)]
struct Buffers {
    id: Option<Column<i64>>,
    ts: Option<Column<i64>>,
    price: Option<Column<f64>>,
}

impl Buffers {
    /// Calls `f` for every row with a non-null `ts_ms` (SQL comparisons drop
    /// NULL timestamps). A null `agg_trade_id` is a hard error.
    fn scan(
        &mut self,
        reader: &SerializedFileReader<File>,
        group: usize,
        cols: &[usize; 3],
        mut f: impl FnMut(Trade),
    ) -> Result<()> {
        let rows = usize::try_from(reader.metadata().row_group(group).num_rows())?;
        let rg = reader.get_row_group(group)?;
        let id = self.id.get_or_insert_with(Column::new);
        let ts = self.ts.get_or_insert_with(Column::new);
        let price = self.price.get_or_insert_with(Column::new);
        id.read::<Int64Type>(rg.as_ref(), cols[0], rows)?;
        ts.read::<Int64Type>(rg.as_ref(), cols[1], rows)?;
        price.read::<DoubleType>(rg.as_ref(), cols[2], rows)?;
        for r in 0..rows {
            let Some(&t) = ts.get(r) else { continue };
            let Some(&i) = id.get(r) else {
                bail!("NULL agg_trade_id at row group {group} row {r}");
            };
            f(Trade {
                id: i,
                ts: t,
                price: price.get(r).copied(),
            });
        }
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::telonex::tests::temp_path;
    use parquet::file::properties::WriterProperties;
    use parquet::file::writer::SerializedFileWriter;
    use parquet::schema::parser::parse_message_type;
    use std::path::Path;
    use std::sync::Arc;

    /// Writes an aggTrades day file; each inner vec is one row group of
    /// `(agg_trade_id, ts_ms, price)`.
    pub(crate) fn write_day(path: &Path, groups: &[Vec<(i64, i64, f64)>]) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let schema = parse_message_type(
            "message s { OPTIONAL INT64 agg_trade_id; OPTIONAL DOUBLE price; OPTIONAL INT64 ts_ms; }",
        )
        .unwrap();
        let props = Arc::new(WriterProperties::builder().build());
        let mut w = SerializedFileWriter::new(File::create(path).unwrap(), Arc::new(schema), props)
            .unwrap();
        for rows in groups {
            let mut rg = w.next_row_group().unwrap();
            let def = vec![1i16; rows.len()];
            let mut c = rg.next_column().unwrap().unwrap();
            let v: Vec<i64> = rows.iter().map(|r| r.0).collect();
            c.typed::<Int64Type>().write_batch(&v, Some(&def), None).unwrap();
            c.close().unwrap();
            let mut c = rg.next_column().unwrap().unwrap();
            let v: Vec<f64> = rows.iter().map(|r| r.2).collect();
            c.typed::<DoubleType>().write_batch(&v, Some(&def), None).unwrap();
            c.close().unwrap();
            let mut c = rg.next_column().unwrap().unwrap();
            let v: Vec<i64> = rows.iter().map(|r| r.1).collect();
            c.typed::<Int64Type>().write_batch(&v, Some(&def), None).unwrap();
            c.close().unwrap();
            rg.close().unwrap();
        }
        w.close().unwrap();
    }

    const DAY: i64 = 1_789_516_800_000; // 2026-09-16T00:00:00Z

    #[test]
    fn selects_range_seeds_and_orders_by_id() {
        let root = temp_path("binance");
        let roots = DataRoots::under(&root);
        let p = roots.agg_trades_day_path("BTCUSDT", "2026-09-16");
        let t0 = DAY + 3_600_000;
        write_day(
            &p,
            &[
                vec![(1, DAY + 10, 1.0), (2, DAY + 20, 2.0)],
                // id order differs from ts order on purpose
                vec![(5, t0 - 1, 5.0), (3, t0 - 50, 3.0), (7, t0 + 5, 7.0), (6, t0, 6.0)],
                vec![(8, t0 + 900_000 + 2_000, 8.0), (9, t0 + 900_000 + 2_001, 9.0)],
            ],
        );
        let window = Window {
            start_ms: t0,
            end_ms: t0 + 900_000,
        };
        let mut notes = vec![];
        let s = load_agg_trades(&roots, "BTCUSDT", window, 0, &mut notes).unwrap();
        assert!(s.seeded);
        assert_eq!(s.price, vec![5.0, 6.0, 7.0, 8.0]);
        assert_eq!(s.ts_ms, vec![t0 - 1, t0, t0 + 5, t0 + 900_000 + 2_000]);
        assert!(notes.is_empty());

        // quiet window: only the seed → warning, not an error
        let window = Window {
            start_ms: t0 + 10_000,
            end_ms: t0 + 20_000,
        };
        let s = load_agg_trades(&roots, "BTCUSDT", window, 0, &mut notes).unwrap();
        assert_eq!(s.price, vec![7.0]);
        assert_eq!(notes.len(), 1);

        // nothing at or before the window → hard error
        let window = Window {
            start_ms: DAY,
            end_ms: DAY + 5,
        };
        let err = load_agg_trades(&roots, "BTCUSDT", window, 0, &mut notes).unwrap_err();
        assert!(err.to_string().contains("contain no trades"), "{err}");

        // missing day file → hard error naming the dates
        let window = Window {
            start_ms: DAY - 1000,
            end_ms: DAY + 1000,
        };
        let err = load_agg_trades(&roots, "BTCUSDT", window, 0, &mut notes).unwrap_err();
        assert!(err.to_string().contains("missing Binance aggTrades day file(s) for BTCUSDT: 2026-09-15"), "{err}");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn iso_format() {
        assert_eq!(iso(DAY + 3_723_004), "2026-09-16T01:02:03.004Z");
    }
}
