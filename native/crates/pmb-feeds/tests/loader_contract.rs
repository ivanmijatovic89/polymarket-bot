//! Job-contract checks of the feed loader on the committed fixture slices:
//! `market.feedFiles` validation (21 §5.1, 00 R14), the 14 §10 rows raised
//! before any file is read (V-9: window, symbol, model_config,
//! feed_availability) and their required message content.

use pmb_feeds::{
    load_market_feeds, required_days, DayCache, FeedCause, FeedDataset, FeedError, FeedFile,
    FeedOptions, FeedProfile, FeedRequest, FeedsModel, GammaStrike, LoadedFeeds, MarketFeedsInput,
    PtbAvailability, PtbStatus, UtcDay,
};
use std::path::{Path, PathBuf};

const M1: &str = "btc-updown-15m-1789570800"; // 2026-09-16 15:00 UTC

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/feeds")
}

fn binance_file(day: UtcDay) -> PathBuf {
    root().join(format!(
        "binance/aggTrades/BTCUSDT/BTCUSDT-aggTrades-{day}.parquet"
    ))
}

fn chainlink_file(day: UtcDay) -> PathBuf {
    root().join(format!(
        "telonex/crypto_prices/btcusd/btcusd-crypto-prices-{day}.parquet"
    ))
}

/// An owned `feedFiles` entry.
#[derive(Clone)]
struct Entry {
    feed: FeedDataset,
    symbol: String,
    day: UtcDay,
    path: PathBuf,
    bytes: u64,
}

fn entry(feed: FeedDataset, symbol: &str, day: UtcDay) -> Entry {
    let path = match feed {
        FeedDataset::BinanceAggTrades => binance_file(day),
        FeedDataset::ChainlinkCryptoPrices => chainlink_file(day),
    };
    let bytes = std::fs::metadata(&path).map_or(1, |m| m.len());
    Entry {
        feed,
        symbol: symbol.into(),
        day,
        path,
        bytes,
    }
}

/// The entries the shim lists for `slug` and `req` (21 §5.1).
fn shim_entries(slug: &str, req: &FeedRequest) -> Vec<Entry> {
    let window = pmb_core::parse_slug(slug).unwrap().window;
    let mut out = Vec::new();
    if req.binance_spot.is_some() {
        for d in required_days(FeedDataset::BinanceAggTrades, window) {
            out.push(entry(FeedDataset::BinanceAggTrades, "BTCUSDT", d));
        }
    }
    if req.chainlink.is_some() {
        for d in required_days(FeedDataset::ChainlinkCryptoPrices, window) {
            out.push(entry(FeedDataset::ChainlinkCryptoPrices, "btcusd", d));
        }
    }
    out
}

struct Job<'a> {
    slug: &'a str,
    request: FeedRequest,
    model: FeedsModel,
    files: Vec<Entry>,
    gamma: GammaStrike,
    ptb: Option<PtbAvailability<'a>>,
}

impl<'a> Job<'a> {
    fn new(slug: &'a str, request: FeedRequest) -> Job<'a> {
        let files = pmb_core::parse_slug(slug)
            .map(|_| shim_entries(slug, &request))
            .unwrap_or_default();
        Job {
            slug,
            request,
            model: FeedsModel::DEFAULTS_2026_07_21,
            files,
            gamma: GammaStrike::NotResolved,
            ptb: None,
        }
    }

    fn load(&self) -> Result<LoadedFeeds, FeedError> {
        let refs: Vec<FeedFile<'_>> = self
            .files
            .iter()
            .map(|e| FeedFile {
                feed: e.feed,
                symbol: &e.symbol,
                day: e.day,
                path: &e.path,
                bytes: e.bytes,
            })
            .collect();
        load_market_feeds(
            &MarketFeedsInput {
                slug: self.slug,
                profile: FeedProfile::TsCompat,
                model: self.model,
                request: &self.request,
                feed_files: &refs,
                gamma: self.gamma,
                ptb_availability: self.ptb,
                diag_clock: None,
            },
            &DayCache::new(1 << 30),
        )
    }
}

fn binance() -> FeedRequest {
    FeedRequest {
        binance_spot: Some(FeedOptions::default()),
        ..FeedRequest::default()
    }
}

fn both() -> FeedRequest {
    FeedRequest {
        binance_spot: Some(FeedOptions::default()),
        chainlink: Some(FeedOptions::default()),
        price_to_beat: false,
    }
}

fn class_cause(e: &FeedError) -> (&'static str, &'static str) {
    (e.class().as_str(), e.cause.as_str())
}

// spec: 21 §5.1 market.feedFiles, 00 R14: the shim's exact list loads; a
// duplicate, foreign-symbol, unrequested-feed or unneeded-day entry is
// invalid_input: schema naming the entry, never a retried data_missing
#[test]
fn feed_files_must_match_the_request() {
    assert!(Job::new(M1, both()).load().is_ok());
    let d0916 = UtcDay::parse("2026-09-16").unwrap();

    // Duplicate (feed, symbol, day).
    let mut j = Job::new(M1, binance());
    j.files.push(j.files[0].clone());
    let e = j.load().unwrap_err();
    assert_eq!(class_cause(&e), ("invalid_input", "schema"), "{e}");
    assert!(e.message.contains("duplicate") && e.message.contains(M1));
    assert!(e.message.contains("BTCUSDT-aggTrades-2026-09-16.parquet"));

    // A differently spelled symbol for a requested feed.
    let mut j = Job::new(M1, binance());
    j.files[0].symbol = "btcusdt".into();
    let e = j.load().unwrap_err();
    assert_eq!(class_cause(&e), ("invalid_input", "schema"), "{e}");
    assert!(e.message.contains("btcusdt") && e.message.contains("\"BTCUSDT\""));
    let mut j = Job::new(M1, both());
    let cl = j
        .files
        .iter_mut()
        .find(|f| f.feed == FeedDataset::ChainlinkCryptoPrices)
        .unwrap();
    cl.symbol = "BTCUSD".into();
    assert_eq!(
        class_cause(&j.load().unwrap_err()),
        ("invalid_input", "schema")
    );

    // An entry for a feed the strategy does not request.
    let mut j = Job::new(M1, binance());
    j.files
        .push(entry(FeedDataset::ChainlinkCryptoPrices, "btcusd", d0916));
    let e = j.load().unwrap_err();
    assert_eq!(class_cause(&e), ("invalid_input", "schema"));
    assert!(e.message.contains("does not request"), "{e}");

    // A day outside the required day set.
    let mut j = Job::new(M1, binance());
    j.files.push(entry(
        FeedDataset::BinanceAggTrades,
        "BTCUSDT",
        UtcDay::parse("2026-07-26").unwrap(),
    ));
    let e = j.load().unwrap_err();
    assert_eq!(class_cause(&e), ("invalid_input", "schema"));
    assert!(e.message.contains("2026-07-26") && e.message.contains("[2026-09-16]"));

    // feedFiles without any feed request.
    let mut j = Job::new(M1, FeedRequest::default());
    j.files
        .push(entry(FeedDataset::BinanceAggTrades, "BTCUSDT", d0916));
    assert_eq!(
        class_cause(&j.load().unwrap_err()),
        ("invalid_input", "schema")
    );

    // A genuinely absent required day stays data_missing day_file_missing.
    let mut j = Job::new(M1, binance());
    j.files.clear();
    let e = j.load().unwrap_err();
    assert_eq!(class_cause(&e), ("data_missing", "day_file_missing"));
    assert!(e.message.contains("2026-09-16"));
}

// spec: 14 §10 / V-9 rows "Window not derivable while feeds are requested"
// (message names the slug) and "Feed symbol not derivable" (slug, symbol)
#[test]
fn window_and_symbol_rows() {
    for slug in [
        "not-a-slug",
        "btc-updown-15m-abc",
        "btc-updown-7m-1789570800",
    ] {
        let e = Job::new(slug, binance()).load().unwrap_err();
        assert_eq!(class_cause(&e), ("invalid_input", "window"), "{slug}: {e}");
        assert!(e.message.contains(slug), "{e}");
    }
    let eth = "eth-updown-15m-1789570800";
    let e = Job::new(eth, binance()).load().unwrap_err();
    assert_eq!(class_cause(&e), ("invalid_input", "symbol"), "{e}");
    assert!(e.message.contains(eth), "{e}");
    let req = FeedRequest {
        chainlink: Some(FeedOptions {
            symbol: Some("eth/usd".into()),
            tick_on_update: false,
        }),
        ..FeedRequest::default()
    };
    let e = Job::new(M1, req).load().unwrap_err();
    assert_eq!(class_cause(&e), ("invalid_input", "symbol"));
    assert!(
        e.message.contains(M1) && e.message.contains("eth/usd"),
        "{e}"
    );
    // An empty request needs no window: nothing is loaded.
    assert!(Job::new("not-a-slug", FeedRequest::default())
        .load()
        .is_ok());
}

// spec: 14 F-46 (the model is validated for every job), §6.2 (a non-null
// feedAvailability.priceToBeat without the request is a producer bug)
#[test]
fn model_and_availability_checked_without_a_request() {
    let mut j = Job::new(M1, FeedRequest::default());
    j.model.chainlink_max_gap_ms = 10;
    let e = j.load().unwrap_err();
    assert_eq!(class_cause(&e), ("invalid_input", "model_config"));
    assert!(e.message.contains("maxGapMs 10"), "{e}");

    let mut j = Job::new(M1, binance());
    j.ptb = Some(PtbAvailability {
        status: PtbStatus::Fed,
        message: None,
    });
    j.gamma = GammaStrike::Resolved {
        price_to_beat: Some(1.5),
        synced_at_ms: Some(1),
    };
    let e = j.load().unwrap_err();
    assert_eq!(class_cause(&e), ("invalid_input", "feed_availability"));
    assert!(e.message.contains(M1), "{e}");
    assert_eq!(e.cause, FeedCause::FeedAvailability);
}

static FAKE_NS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// A deterministic stand-in for the driver's monotonic clock: +1,000 ns per
/// read.
fn fake_clock() -> u64 {
    FAKE_NS.fetch_add(1_000, std::sync::atomic::Ordering::Relaxed)
}

// spec: 14 PF-7 (feed load time, cold or warm, cache hits and misses, bytes
// decoded, synthetic ticks scheduled, visibility-build time)
#[test]
fn load_measurements() {
    let req = FeedRequest {
        binance_spot: Some(FeedOptions {
            symbol: None,
            tick_on_update: true,
        }),
        chainlink: Some(FeedOptions {
            symbol: None,
            tick_on_update: true,
        }),
        price_to_beat: false,
    };
    let j = Job::new(M1, req);
    let refs: Vec<FeedFile<'_>> = j
        .files
        .iter()
        .map(|e| FeedFile {
            feed: e.feed,
            symbol: &e.symbol,
            day: e.day,
            path: &e.path,
            bytes: e.bytes,
        })
        .collect();
    let cache = DayCache::new(1 << 30);
    let input = MarketFeedsInput {
        slug: M1,
        profile: FeedProfile::TsCompat,
        model: j.model,
        request: &j.request,
        feed_files: &refs,
        gamma: j.gamma,
        ptb_availability: None,
        diag_clock: Some(fake_clock),
    };
    let cold = load_market_feeds(&input, &cache).unwrap();
    let s = cold.stats;
    assert_eq!((s.cache.misses, s.cache.hits), (2, 0), "cold");
    assert!(s.cache.bytes_decoded > 0);
    let sched = cold.feeds.schedule();
    assert_eq!(
        s.scheduled,
        [
            sched.scheduled(pmb_core::SyntheticKind::BinanceAggTrade),
            sched.scheduled(pmb_core::SyntheticKind::ChainlinkRound)
        ]
    );
    assert!(s.scheduled[0] > 0 && s.scheduled[1] > 0);
    let (load, build) = (s.load_ns.unwrap(), s.visibility_build_ns.unwrap());
    assert!(build > 0 && load > build, "{load} {build}");
    let warm = load_market_feeds(&input, &cache).unwrap().stats;
    assert_eq!((warm.cache.misses, warm.cache.hits), (0, 2), "warm");
    assert_eq!(warm.cache.bytes_decoded, 0);
    // Without a clock the durations stay unset; nothing else changes.
    let plain = MarketFeedsInput {
        diag_clock: None,
        ..input
    };
    let p = load_market_feeds(&plain, &cache).unwrap().stats;
    assert_eq!((p.load_ns, p.visibility_build_ns), (None, None));
    assert_eq!(p.scheduled, s.scheduled);
}

// spec: 14 F-18 and the §10 row "Binance seed-only window | warning only |
// file to verify": the fixture day holds no trade inside the 16:00 market's
// range, so the market replays on the seed and the warning names the file
#[test]
fn seed_only_warning_names_the_file() {
    let slug = "btc-updown-15m-1789574400"; // 2026-09-16 16:00 UTC
    let l = Job::new(slug, binance()).load().unwrap();
    let s = &l.feeds.binance().unwrap().series;
    assert_eq!((s.len(), s.in_range()), (1, 0));
    assert_eq!(l.diagnostics.len(), 1);
    let d = &l.diagnostics[0];
    assert_eq!(d.level, pmb_feeds::DiagLevel::Warning);
    let path = binance_file(UtcDay::parse("2026-09-16").unwrap());
    assert!(
        d.message.ends_with(&format!(
            "(verify with: npm run verify:parquet -- {})",
            path.display()
        )),
        "{}",
        d.message
    );
}
