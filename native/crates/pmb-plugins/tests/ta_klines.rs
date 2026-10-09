//! 14 §13 V-6 (a), 60 §7.2 "TA candles vs klines": candles built from the
//! local aggTrades day files (14 P-8, through the PF-5 cache) equal the
//! Binance REST klines the TS oracle reads, OHLC exact and volume within
//! relative 1e-9. Fixture: `native/fixtures/golden/plugins/ta_klines.json`,
//! written once by `native/fixtures/gen/plugins_klines_gen.ts` (the only
//! place that uses the network).
//!
//! `kline_fixture_is_contiguous_and_ta_ready` always runs. The day-file
//! comparison needs the fleet dataset (`data/binance/aggTrades/BTCUSDT`,
//! about 200 days for the samples), so it is ignored by default; run it with
//! `cargo test -p pmb-plugins --test ta_klines -- --ignored`
//! (`PMB_AGGTRADES_DIR` overrides the directory).

use parquet::column::reader::ColumnReader;
use parquet::file::reader::{FileReader, SerializedFileReader};
use pmb_core::TsMs;
use pmb_plugins::{
    compute_technical_indicators, AggTrade, Candle, CandleCache, CandleInterval, PluginMarket,
    TaInput, TaOutput, UtcDay,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const GENERATOR: &str = "plugins_klines_gen.ts";
const LIMIT_1H: usize = 170;
const LIMIT_15M: usize = 50;
const VOLUME_REL_TOL: f64 = 1e-9;

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// One kline row: the candle (decimal strings parsed with `str::parse`, the
/// correctly rounded double TS's `Number` gives) and the trade count.
#[derive(Clone, Copy, Debug)]
struct Kline {
    candle: Candle,
    trades: i64,
}

struct Sample {
    t0: i64,
    slug: String,
    h1: (i64, i64, usize),
    m15: (i64, i64, usize),
}

struct Fixture {
    samples: Vec<Sample>,
    h1: BTreeMap<i64, Kline>,
    m15: BTreeMap<i64, Kline>,
}

fn num(v: &Value) -> f64 {
    v.as_str()
        .expect("decimal string")
        .parse()
        .expect("decimal")
}

fn klines(rows: &Value, interval: CandleInterval) -> BTreeMap<i64, Kline> {
    rows.as_array()
        .unwrap()
        .iter()
        .map(|r| {
            let open = r[0].as_i64().unwrap();
            let close_time = r[6].as_i64().unwrap();
            assert_eq!(close_time, open + interval.ms() - 1);
            let k = Kline {
                candle: Candle {
                    open_time: TsMs(open),
                    close_time: TsMs(close_time),
                    open: num(&r[1]),
                    high: num(&r[2]),
                    low: num(&r[3]),
                    close: num(&r[4]),
                    volume: num(&r[5]),
                },
                trades: r[7].as_i64().unwrap(),
            };
            (open, k)
        })
        .collect()
}

fn fixture() -> Fixture {
    let p = manifest_dir().join("../../fixtures/golden/plugins/ta_klines.json");
    let v: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
    // spec: 60 §7.1 GF-2 (header, produced by the committed generator)
    let h = &v["header"];
    assert_eq!(h["generator"], format!("native/fixtures/gen/{GENERATOR}"));
    let gen = std::fs::read(manifest_dir().join("../../fixtures/gen").join(GENERATOR)).unwrap();
    let sha: String = Sha256::digest(&gen)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    assert_eq!(
        h["generatorSha256"].as_str(),
        Some(sha.as_str()),
        "regenerate"
    );
    assert_eq!(v["symbol"], "BTCUSDT");
    let range = |s: &Value, k: &str| {
        (
            s[format!("{k}FirstOpen")].as_i64().unwrap(),
            s[format!("{k}LastOpen")].as_i64().unwrap(),
            s[format!("{k}Count")].as_u64().unwrap() as usize,
        )
    };
    let samples = v["samples"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| Sample {
            t0: s["t0"].as_i64().unwrap(),
            slug: s["slug"].as_str().unwrap().to_owned(),
            h1: range(s, "h1"),
            m15: range(s, "m15"),
        })
        .collect();
    Fixture {
        samples,
        h1: klines(&v["klines1h"], CandleInterval::H1),
        m15: klines(&v["klines15m"], CandleInterval::M15),
    }
}

/// The klines TS received for one request: open times in `[first, last]`.
fn received(all: &BTreeMap<i64, Kline>, (first, last, count): (i64, i64, usize)) -> Vec<Kline> {
    let v: Vec<Kline> = all.range(first..=last).map(|(_, k)| *k).collect();
    assert_eq!(v.len(), count);
    v
}

/// TA as the TS plugin computes it from REST klines: keep the closed ones
/// and take the last 160 / 40 (`TechnicalIndicatorsPlugin.ts:253-260`).
fn ta_from_klines(market: &PluginMarket, h1: &[Kline], m15: &[Kline]) -> TaOutput {
    let as_of = TsMs(market.window.start_ms.0 - 1);
    let closed = |v: &[Kline], n: usize| -> Vec<Candle> {
        let c: Vec<Candle> = v
            .iter()
            .map(|k| k.candle)
            .filter(|c| c.close_time <= as_of)
            .collect();
        c[c.len().saturating_sub(n)..].to_vec()
    };
    let (h1, m15) = (closed(h1, 160), closed(m15, 40));
    compute_technical_indicators(market, Some(TaInput { h1: &h1, m15: &m15 })).unwrap()
}

// spec: 14 §13 V-6 (a) (at least 50 sampled market starts), P-9, P-12: the
// REST klines TS reads have no missing interval and no trade-less candle in
// any sampled window, so the time-bounded P-12 window equals TS's
// positional "last 160 of 170" window, and TA is ready on every sample.
#[test]
fn kline_fixture_is_contiguous_and_ta_ready() {
    let f = fixture();
    assert!(f.samples.len() >= 50, "{} samples", f.samples.len());
    for s in &f.samples {
        let market = PluginMarket::from_slug(&s.slug).unwrap();
        assert_eq!(market.window.start_ms, TsMs(s.t0));
        let h1 = received(&f.h1, s.h1);
        let m15 = received(&f.m15, s.m15);
        assert_eq!((h1.len(), m15.len()), (LIMIT_1H, LIMIT_15M));
        for (v, interval) in [(&h1, CandleInterval::H1), (&m15, CandleInterval::M15)] {
            assert!(v
                .windows(2)
                .all(|w| { w[1].candle.open_time.0 - w[0].candle.open_time.0 == interval.ms() }));
            assert!(v.iter().all(|k| k.trades > 0 && k.candle.volume > 0.0));
            assert!(v.last().unwrap().candle.open_time.0 < s.t0);
        }
        let out = ta_from_klines(&market, &h1, &m15);
        assert!(out.ready().is_some(), "{}: {out:?}", s.slug);
        // all received klines given at once: the time bound picks the same
        let all_h1: Vec<Candle> = h1.iter().map(|k| k.candle).collect();
        let all_m15: Vec<Candle> = m15.iter().map(|k| k.candle).collect();
        let bounded = compute_technical_indicators(
            &market,
            Some(TaInput {
                h1: &all_h1,
                m15: &all_m15,
            }),
        )
        .unwrap();
        assert_eq!(format!("{bounded:?}"), format!("{out:?}"), "{}", s.slug);
    }
}

fn aggtrades_dir() -> PathBuf {
    std::env::var_os("PMB_AGGTRADES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| manifest_dir().join("../../../data/binance/aggTrades/BTCUSDT"))
}

/// Reads all rows of one non-null column of one row group.
fn read_i64(rg: &dyn parquet::file::reader::RowGroupReader, col: usize, rows: usize) -> Vec<i64> {
    let ColumnReader::Int64ColumnReader(mut r) = rg.get_column_reader(col).unwrap() else {
        panic!("column {col} is not INT64");
    };
    let (mut vals, mut def) = (Vec::with_capacity(rows), Vec::with_capacity(rows));
    while vals.len() < rows {
        let (n, _, _) = r
            .read_records(rows - vals.len(), Some(&mut def), None, &mut vals)
            .unwrap();
        assert!(n > 0, "column {col} ended early");
    }
    assert_eq!(vals.len(), rows, "column {col} has nulls");
    vals
}

fn read_f64(rg: &dyn parquet::file::reader::RowGroupReader, col: usize, rows: usize) -> Vec<f64> {
    let ColumnReader::DoubleColumnReader(mut r) = rg.get_column_reader(col).unwrap() else {
        panic!("column {col} is not DOUBLE");
    };
    let (mut vals, mut def) = (Vec::with_capacity(rows), Vec::with_capacity(rows));
    while vals.len() < rows {
        let (n, _, _) = r
            .read_records(rows - vals.len(), Some(&mut def), None, &mut vals)
            .unwrap();
        assert!(n > 0, "column {col} ended early");
    }
    assert_eq!(vals.len(), rows, "column {col} has nulls");
    vals
}

/// Decodes one day file (14 §4.1 columns) into trades in `agg_trade_id`
/// order, plus each trade's count of exchange trades
/// (`last_trade_id - first_trade_id + 1`, what a kline's `trades` counts).
fn read_day(path: &Path) -> (Vec<AggTrade>, Vec<i64>) {
    let r = SerializedFileReader::new(std::fs::File::open(path).unwrap_or_else(|e| {
        panic!(
            "{}: {e} (V-6 (a) needs the local BTCUSDT day files)",
            path.display()
        )
    }))
    .unwrap();
    let schema = r.metadata().file_metadata().schema_descr();
    let col = |name: &str| {
        (0..schema.num_columns())
            .find(|&i| schema.column(i).name() == name)
            .unwrap_or_else(|| panic!("{}: no column {name}", path.display()))
    };
    let (c_id, c_px, c_qty, c_first, c_last, c_ts) = (
        col("agg_trade_id"),
        col("price"),
        col("qty"),
        col("first_trade_id"),
        col("last_trade_id"),
        col("ts_ms"),
    );
    let mut rows: Vec<(AggTrade, i64)> = Vec::new();
    for g in 0..r.num_row_groups() {
        let rg = r.get_row_group(g).unwrap();
        let n = rg.metadata().num_rows() as usize;
        let id = read_i64(rg.as_ref(), c_id, n);
        let px = read_f64(rg.as_ref(), c_px, n);
        let qty = read_f64(rg.as_ref(), c_qty, n);
        let first = read_i64(rg.as_ref(), c_first, n);
        let last = read_i64(rg.as_ref(), c_last, n);
        let ts = read_i64(rg.as_ref(), c_ts, n);
        for i in 0..n {
            rows.push((
                AggTrade {
                    id: id[i],
                    ts: TsMs(ts[i]),
                    price: px[i],
                    qty: qty[i],
                },
                last[i] - first[i] + 1,
            ));
        }
    }
    // Series order is agg_trade_id (14 F-10); a sorted file is untouched.
    if !rows.windows(2).all(|w| w[0].0.id < w[1].0.id) {
        rows.sort_by_key(|r| r.0.id);
    }
    rows.into_iter().unzip()
}

// spec: 14 §13 V-6 (a), 60 §7.2 (OHLC exact, volume relative 1e-9), 14 P-8,
// PF-5; TA from aggTrades candles equals TA from the klines TS reads (P-9)
#[test]
#[ignore = "needs the local BTCUSDT aggTrades day files (fleet dataset); run with --ignored"]
fn aggtrade_candles_equal_rest_klines() {
    let f = fixture();
    let dir = aggtrades_dir();
    // exchange-trade counts per (interval, open time), filled by the loader
    let counts: Mutex<BTreeMap<(CandleInterval, i64), i64>> = Mutex::new(BTreeMap::new());
    let load = |pair: &str, day: UtcDay| -> Result<Vec<AggTrade>, String> {
        let (trades, n) = read_day(&dir.join(format!("{pair}-aggTrades-{day}.parquet")));
        let mut c = counts.lock().unwrap();
        for (t, k) in trades.iter().zip(&n) {
            for iv in [CandleInterval::H1, CandleInterval::M15] {
                *c.entry((iv, t.ts.0.div_euclid(iv.ms()) * iv.ms()))
                    .or_default() += k;
            }
        }
        Ok(trades)
    };
    let cache = CandleCache::new();
    let (mut candles, mut max_rel, mut days) = (0usize, 0.0f64, 0u32);
    for s in &f.samples {
        let market = PluginMarket::from_slug(&s.slug).unwrap();
        let (ta, used) = cache.ta_candles(&market, &load).unwrap().unwrap();
        days += used.misses;
        let input = ta.input();
        // the P-12 window is complete: 160 1h and 40 15m closed candles
        assert_eq!(input.m15.len(), 40, "{}", s.slug);
        let closed_h1 = input.h1.iter().filter(|c| c.close_time.0 < s.t0).count();
        assert_eq!(closed_h1, 160, "{}", s.slug);
        for (built, rest, iv) in [
            (input.h1, &f.h1, CandleInterval::H1),
            (input.m15, &f.m15, CandleInterval::M15),
        ] {
            for c in built.iter().filter(|c| c.close_time.0 < s.t0) {
                let k = rest.get(&c.open_time.0).unwrap_or_else(|| {
                    panic!("{}: no {} kline at {}", s.slug, iv.as_str(), c.open_time.0)
                });
                let at = format!("{} {} {}", s.slug, iv.as_str(), c.open_time.0);
                assert_eq!(c.close_time, k.candle.close_time, "{at}");
                assert_eq!(
                    (c.open, c.high, c.low, c.close),
                    (k.candle.open, k.candle.high, k.candle.low, k.candle.close),
                    "{at}: OHLC"
                );
                let rel = (c.volume - k.candle.volume).abs() / k.candle.volume;
                assert!(
                    rel <= VOLUME_REL_TOL,
                    "{at}: volume {} vs {}",
                    c.volume,
                    k.candle.volume
                );
                max_rel = max_rel.max(rel);
                let n = counts.lock().unwrap()[&(iv, c.open_time.0)];
                assert_eq!(n, k.trades, "{at}: exchange trade count");
                candles += 1;
            }
        }
        // TA on the aggTrades candles equals TA on the klines TS receives
        let from_trades = compute_technical_indicators(&market, Some(input)).unwrap();
        let from_klines = ta_from_klines(&market, &received(&f.h1, s.h1), &received(&f.m15, s.m15));
        assert!(from_trades.ready().is_some(), "{}", s.slug);
        assert_eq!(
            format!("{from_trades:?}"),
            format!("{from_klines:?}"),
            "{}",
            s.slug
        );
    }
    eprintln!(
        "V-6 (a): {} samples, {candles} candles, {days} day files, max volume relative diff {max_rel:e}",
        f.samples.len()
    );
    assert!(candles >= 50 * 200);
}
