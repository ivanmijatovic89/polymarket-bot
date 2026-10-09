//! Feed goldens (14 §13 V-1 loader goldens, V-2 timeline goldens; 60 §7.1,
//! §7.2: exact). The TS generator `native/fixtures/gen/feeds_gen.ts` ran the
//! real TS loaders, provider, schedule and flusher over the committed slices
//! in `native/fixtures/feeds/`; these tests run the Rust feed layer over the
//! same slices and compare every value.
//!
//! The tick driver below plays the part of the engine loop for ts-compat on
//! telonex-delta (12 §5.3, 14 F-7, F-40, F-41, §8.4): flush before every real
//! tick, count before the inclusive window gate (12 §5.4), advance the feed
//! state on every tick delivered to the runner, flush the tail at the end.

use pmb_core::{FeedKind, FeedsView, PriceToBeatPoint, TsMs, Window};
use pmb_feeds::time::iso_ms;
use pmb_feeds::{
    load_market_feeds, required_days, synthetic_stamp, ts_compat_feed_clock, BinanceFeed,
    BinanceSeries, ChainlinkFeed, ChainlinkSeries, DayCache, FeedDataset, FeedFile, FeedOptions,
    FeedProfile, FeedRequest, FeedState, FeedsModel, GammaStrike, MarketFeeds, MarketFeedsInput,
    PriceToBeatSource, PtbAvailability, PtbStatus, SyntheticFlusher,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

fn golden() -> Value {
    let p = fixtures().join("golden/feeds/feeds_golden.json");
    serde_json::from_slice(&std::fs::read(&p).expect("read golden")).expect("parse golden")
}

fn sha(lines: &[String]) -> String {
    let mut h = Sha256::new();
    for l in lines {
        h.update(l.as_bytes());
        h.update(b"\n");
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn bits(v: f64) -> String {
    format!("{:016x}", v.to_bits())
}

fn slug_window(slug: &str) -> Window {
    pmb_core::parse_slug(slug).expect("fixture slug").window
}

/// `feedFiles` as the shim would list them: every required day present under
/// `root` with its size (21 §5, §9).
fn feed_files(
    root: &Path,
    window: Window,
) -> Vec<(FeedDataset, String, pmb_feeds::UtcDay, PathBuf, u64)> {
    let mut out = Vec::new();
    for feed in [
        FeedDataset::BinanceAggTrades,
        FeedDataset::ChainlinkCryptoPrices,
    ] {
        for day in required_days(feed, window) {
            let (symbol, path) = match feed {
                FeedDataset::BinanceAggTrades => (
                    "BTCUSDT",
                    root.join(format!(
                        "binance/aggTrades/BTCUSDT/BTCUSDT-aggTrades-{day}.parquet"
                    )),
                ),
                FeedDataset::ChainlinkCryptoPrices => (
                    "btcusd",
                    root.join(format!(
                        "telonex/crypto_prices/btcusd/btcusd-crypto-prices-{day}.parquet"
                    )),
                ),
            };
            if let Ok(m) = std::fs::metadata(&path) {
                out.push((feed, symbol.to_owned(), day, path, m.len()));
            }
        }
    }
    out
}

struct Job {
    slug: String,
    request: FeedRequest,
    model: FeedsModel,
    gamma: GammaStrike,
    ptb: Option<PtbAvailability<'static>>,
    root: PathBuf,
}

fn load(job: &Job, cache: &DayCache) -> Result<pmb_feeds::LoadedFeeds, pmb_feeds::FeedError> {
    let files = feed_files(&job.root, slug_window(&job.slug));
    let refs: Vec<FeedFile<'_>> = files
        .iter()
        .map(|(feed, symbol, day, path, bytes)| FeedFile {
            feed: *feed,
            symbol,
            day: *day,
            path,
            bytes: *bytes,
        })
        .collect();
    load_market_feeds(
        &MarketFeedsInput {
            slug: &job.slug,
            profile: FeedProfile::TsCompat,
            model: job.model,
            request: &job.request,
            feed_files: &refs,
            gamma: job.gamma,
            ptb_availability: job.ptb,
        },
        cache,
    )
}

fn binance_lines(s: &BinanceSeries) -> Vec<String> {
    (0..s.len())
        .map(|i| format!("{}|{}", s.ts(i), bits(s.price(i))))
        .collect()
}

fn chainlink_lines(s: &ChainlinkSeries) -> Vec<String> {
    (0..s.len())
        .map(|i| format!("{}|{}|{}", s.round(i), s.broadcast(i), bits(s.price(i))))
        .collect()
}

fn strs(v: &Value) -> Vec<String> {
    v.as_array()
        .expect("array")
        .iter()
        .map(|x| x.as_str().expect("string").to_owned())
        .collect()
}

// spec: 14 §13 V-1 (loader goldens: series arrays, seed presence, error class),
// 14 §10 (classes and causes), V-9 (error matrix rows covered by the fixtures)
#[test]
fn loader_goldens() {
    let g = golden();
    let cache = DayCache::new(64 << 20);
    let mut seen = 0;
    for case in g["loaders"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let feed = case["feed"].as_str().unwrap();
        let opts = Some(FeedOptions::default());
        let mut model = FeedsModel::DEFAULTS_2026_07_21;
        if let Some(gap) = case["maxGapMs"].as_i64() {
            model.chainlink_max_gap_ms = gap;
        }
        let job = Job {
            slug: case["slug"].as_str().unwrap().to_owned(),
            request: FeedRequest {
                binance_spot: (feed == "binance").then(|| opts.clone().unwrap()),
                chainlink: (feed == "chainlink").then(|| opts.clone().unwrap()),
                price_to_beat: false,
            },
            model,
            gamma: GammaStrike::NotResolved,
            ptb: None,
            root: fixtures()
                .join("feeds")
                .join(case["root"].as_str().unwrap()),
        };
        match (load(&job, &cache), case.get("ok")) {
            (Ok(l), Some(ok)) => {
                let (lines, seeded) = if feed == "binance" {
                    let s = &l.feeds.binance().unwrap().series;
                    (binance_lines(s), s.seeded())
                } else {
                    let s = &l.feeds.chainlink().unwrap().series;
                    (chainlink_lines(s), s.seeded())
                };
                assert_eq!(
                    lines.len() as u64,
                    ok["len"].as_u64().unwrap(),
                    "{name}: len"
                );
                assert_eq!(seeded, ok["seeded"].as_bool().unwrap(), "{name}: seeded");
                if let Some(full) = ok.get("lines") {
                    assert_eq!(lines, strs(full), "{name}: lines");
                } else {
                    assert_eq!(lines[..5].to_vec(), strs(&ok["head"]), "{name}: head");
                    assert_eq!(
                        lines[lines.len() - 5..].to_vec(),
                        strs(&ok["tail"]),
                        "{name}: tail"
                    );
                }
                assert_eq!(
                    sha(&lines),
                    ok["sha256"].as_str().unwrap(),
                    "{name}: sha256"
                );
            }
            (Err(e), None) => {
                let want = &case["error"];
                assert_eq!(
                    e.class().as_str(),
                    want["class"].as_str().unwrap(),
                    "{name}: {e}"
                );
                assert_eq!(
                    e.cause.as_str(),
                    want["cause"].as_str().unwrap(),
                    "{name}: {e}"
                );
            }
            (Ok(_), None) => panic!("{name}: Rust loaded, TS failed with {}", case["error"]),
            (Err(e), Some(_)) => panic!("{name}: Rust failed with {e}, TS loaded"),
        }
        seen += 1;
    }
    assert_eq!(seen, 14);
}

fn render(kind: &str, ts: i64, v: &FeedsView) -> String {
    let spot = |p: Option<&pmb_core::SpotPoint>| match p {
        Some(p) => format!("{},{},{}", p.source_ts.0, bits(p.value), p.received_at.0),
        None => "-".to_owned(),
    };
    let ptb = match v.price_to_beat() {
        Some(p) => format!(
            "{},{},{},{}",
            bits(p.open_price),
            p.received_at.0,
            iso_ms(p.event_start.0),
            iso_ms(p.end.0)
        ),
        None => "-".to_owned(),
    };
    format!(
        "{kind}|{ts}|bn={};cl={};ptb={ptb}",
        spot(v.binance_spot()),
        spot(v.chainlink_spot())
    )
}

/// One real tick: exchange ts, Telonex local time, 0 book / 1 price_change.
type Clock = (i64, Option<i64>, u8);

struct Driven {
    lines: Vec<String>,
    counts: BTreeMap<String, u64>,
}

/// The ts-compat telonex-delta tick loop, feed parts only (see module docs).
fn drive(feeds: &MarketFeeds, window: Window, ticks: &[Clock]) -> Driven {
    let mut state = FeedState::new();
    let mut flusher = SyntheticFlusher::new();
    let mut out = Driven {
        lines: Vec::new(),
        counts: BTreeMap::new(),
    };
    let mut prev = FeedsView::EMPTY;
    let mut dispatch = |kind: &str, ts: i64, clock: TsMs, state: &mut FeedState| {
        *out.counts.entry(kind.to_owned()).or_default() += 1;
        if ts < window.start_ms.0 || ts > window.end_ms.0 {
            out.lines.push(format!("{kind}|{ts}|gated"));
            return;
        }
        let v = *state.advance(feeds, clock);
        // spec: 14 P-13, V-7 (generations change iff the visible value changes)
        let changed = [
            v.binance_spot()
                .map(|p| (p.source_ts, p.value.to_bits(), p.received_at))
                != prev
                    .binance_spot()
                    .map(|p| (p.source_ts, p.value.to_bits(), p.received_at)),
            v.chainlink_spot()
                .map(|p| (p.source_ts, p.value.to_bits(), p.received_at))
                != prev
                    .chainlink_spot()
                    .map(|p| (p.source_ts, p.value.to_bits(), p.received_at)),
            v.price_to_beat()
                .map(|p| (p.open_price.to_bits(), p.received_at))
                != prev
                    .price_to_beat()
                    .map(|p| (p.open_price.to_bits(), p.received_at)),
        ];
        for (k, c) in FeedKind::ALL.iter().zip(changed) {
            assert_eq!(
                v.generation(*k),
                prev.generation(*k) + u64::from(c),
                "{k:?} at {ts}"
            );
        }
        prev = v;
        out.lines.push(render(kind, ts, &v));
    };
    let mut has_book = false;
    let mut last_exchange = TsMs(i64::MIN);
    for &(e, l, k) in ticks {
        let clock = ts_compat_feed_clock(TsMs(e), l.map(TsMs));
        for entry in flusher.take_before(feeds.schedule(), clock, has_book) {
            let s = synthetic_stamp(entry.v, last_exchange);
            dispatch(entry.kind.as_str(), s.0, s, &mut state);
        }
        has_book = true;
        last_exchange = TsMs(e);
        dispatch(
            if k == 0 { "book" } else { "price_change" },
            e,
            clock,
            &mut state,
        );
    }
    for entry in flusher.take_rest(feeds.schedule(), has_book) {
        let s = synthetic_stamp(entry.v, last_exchange);
        dispatch(entry.kind.as_str(), s.0, s, &mut state);
    }
    for kind in [
        pmb_core::SyntheticKind::BinanceAggTrade,
        pmb_core::SyntheticKind::ChainlinkRound,
    ] {
        assert_eq!(
            u64::from(flusher.dispatched(kind)),
            out.counts.get(kind.as_str()).copied().unwrap_or(0),
            "14 §8.4 counting"
        );
    }
    out
}

fn counts_of(v: &Value) -> BTreeMap<String, u64> {
    v.as_object()
        .unwrap()
        .iter()
        .map(|(k, n)| (k.clone(), n.as_u64().unwrap()))
        .collect()
}

fn read_clocks(slug: &str) -> Vec<Clock> {
    let p = fixtures().join(format!("feeds/clocks/{slug}.json"));
    let j: Value = serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap();
    let mut e = j["e0"].as_i64().unwrap();
    j["ticks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| {
            e += t[0].as_i64().unwrap();
            (
                e,
                t[1].as_i64().map(|d| e + d),
                t[2].as_u64().unwrap() as u8,
            )
        })
        .collect()
}

// spec: 14 §13 V-2 (timeline goldens on real fixture markets: per-tick
// snapshot and dispatch order), F-7, F-9..F-11, F-28, F-39..F-41, §8.4
#[test]
fn real_market_timelines() {
    let g = golden();
    let cache = DayCache::new(64 << 20);
    let mut seen = 0;
    for t in g["timelines"].as_array().unwrap() {
        let Some(cfg) = t.get("config") else { continue };
        let name = t["name"].as_str().unwrap();
        let slug = t["slug"].as_str().unwrap().to_owned();
        let flag = |k: &str| cfg[k].as_bool().unwrap();
        let opts = |tick: bool| FeedOptions {
            symbol: None,
            tick_on_update: tick,
        };
        let job = Job {
            request: FeedRequest {
                binance_spot: flag("binance").then(|| opts(flag("tickB"))),
                chainlink: flag("chainlink").then(|| opts(flag("tickC"))),
                price_to_beat: true,
            },
            model: FeedsModel::DEFAULTS_2026_07_21,
            gamma: GammaStrike::Resolved {
                price_to_beat: t["priceToBeat"].as_f64(),
            },
            ptb: Some(PtbAvailability {
                status: PtbStatus::Fed,
                message: None,
            }),
            root: fixtures().join("feeds"),
            slug,
        };
        let loaded = load(&job, &cache).unwrap_or_else(|e| panic!("{name}: {e}"));
        let d = drive(
            &loaded.feeds,
            slug_window(&job.slug),
            &read_clocks(&job.slug),
        );
        assert_eq!(d.counts, counts_of(&t["counts"]), "{name}: counts");
        assert_eq!(
            d.lines.len() as u64,
            t["len"].as_u64().unwrap(),
            "{name}: len"
        );
        assert_eq!(d.lines[..20].to_vec(), strs(&t["head"]), "{name}: head");
        for (i, line) in t["samples"].as_object().unwrap() {
            let i: usize = i.parse().unwrap();
            assert_eq!(d.lines[i], line.as_str().unwrap(), "{name}: line {i}");
        }
        assert_eq!(
            d.lines[d.lines.len() - 5..].to_vec(),
            strs(&t["tail"]),
            "{name}: tail"
        );
        let delivered = d.lines.iter().filter(|l| !l.ends_with("|gated")).count();
        assert_eq!(delivered as u64, t["delivered"].as_u64().unwrap(), "{name}");
        assert_eq!(
            sha(&d.lines),
            t["sha256"].as_str().unwrap(),
            "{name}: sha256"
        );
        seen += 1;
    }
    assert_eq!(seen, 10);
}

fn i64s(v: &Value) -> Vec<i64> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_i64().unwrap())
        .collect()
}
fn f64s(v: &Value) -> Vec<f64> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_f64().unwrap())
        .collect()
}

// spec: 14 §13 V-2 (crafted sequences: backward local clocks, equal
// timestamps, events before the first book, out-of-window real ticks, tail
// flush), F-10 (cursor in series order with a backward trade time)
#[test]
fn crafted_timelines() {
    let g = golden();
    let mut seen = 0;
    for t in g["timelines"].as_array().unwrap() {
        let Some(input) = t.get("input") else {
            continue;
        };
        let name = t["name"].as_str().unwrap();
        let w = &input["window"];
        let window = Window {
            start_ms: TsMs(w["startMs"].as_i64().unwrap()),
            end_ms: TsMs(w["endMs"].as_i64().unwrap()),
        };
        let b = &input["binance"];
        let c = &input["chainlink"];
        let p = &input["priceToBeat"];
        let feeds = MarketFeeds::from_parts(
            window,
            Some(BinanceFeed {
                symbol: "btcusdt",
                series: BinanceSeries::from_parts(
                    i64s(&b["tsMs"]),
                    f64s(&b["value"]),
                    false,
                    b["latencyMs"].as_i64().unwrap(),
                    FeedProfile::TsCompat,
                ),
                tick_on_update: b["tickOnUpdate"].as_bool().unwrap(),
            }),
            Some(ChainlinkFeed {
                symbol: "btc/usd",
                asset_id: "btcusd",
                series: ChainlinkSeries::from_parts(
                    i64s(&c["tsMs"]),
                    i64s(&c["visibleAtMs"]),
                    f64s(&c["value"]),
                    false,
                    c["latencyMs"].as_i64().unwrap(),
                ),
                tick_on_update: c["tickOnUpdate"].as_bool().unwrap(),
            }),
            Some(PriceToBeatSource {
                point: PriceToBeatPoint {
                    open_price: p["openPrice"].as_f64().unwrap(),
                    received_at: TsMs(window.start_ms.0 + p["latencyMs"].as_i64().unwrap()),
                    event_start: window.start_ms,
                    end: window.end_ms,
                },
            }),
        );
        let ticks: Vec<Clock> = input["ticks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| {
                (
                    x[0].as_i64().unwrap(),
                    x[1].as_i64(),
                    x[2].as_u64().unwrap() as u8,
                )
            })
            .collect();
        let d = drive(&feeds, window, &ticks);
        assert_eq!(d.lines, strs(&t["lines"]), "{name}");
        assert_eq!(d.counts, counts_of(&t["counts"]), "{name}: counts");
        seen += 1;
    }
    assert_eq!(seen, 2);
}

// spec: 14 F-35 (without opt-in nothing is scheduled), V-7 (tickOnUpdate off
// equals a run without schedule)
#[test]
fn no_opt_in_means_no_schedule() {
    let job = Job {
        slug: "btc-updown-15m-1789570800".into(),
        request: FeedRequest {
            binance_spot: Some(FeedOptions::default()),
            chainlink: Some(FeedOptions::default()),
            price_to_beat: false,
        },
        model: FeedsModel::DEFAULTS_2026_07_21,
        gamma: GammaStrike::NotResolved,
        ptb: None,
        root: fixtures().join("feeds"),
    };
    let l = load(&job, &DayCache::new(1 << 30)).unwrap();
    assert!(l.feeds.schedule().is_empty());
    assert!(
        l.stats.binance_zero_copy,
        "14 PF-2: single monotone day is zero-copy"
    );
}
