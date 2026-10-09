//! Loading one market's historical feeds (14 §3 to §6, §8.2, §10): the
//! Rust counterpart of TS `wireBacktestExternalFeeds`, without env, wall
//! clock or path derivation (14 F-3). The result is immutable and shared by
//! every candidate of the market read (14 F-42, 16 §6).

use crate::binance::{build_binance_series, BinanceDay, BinanceSeries};
use crate::cache::{CacheStats, DayCache};
use crate::chainlink::{build_chainlink_series, ChainlinkDay, ChainlinkSeries};
use crate::config::{FeedProfile, FeedsModel, CHAINLINK_COVERAGE_FROM_MS, LOOKBACK_MS};
use crate::error::{FeedCause, FeedError};
use crate::price_to_beat::{
    resolve_price_to_beat, GammaStrike, PriceToBeatSource, PtbAvailability, PtbResolution,
    PtbStatus,
};
use crate::request::{resolve_binance_symbol, resolve_chainlink_symbol, FeedRequest};
use crate::schedule::SyntheticSchedule;
use crate::time::{days_covering, iso_ms, UtcDay};
use pmb_core::{parse_slug, SlugError, Window};
use std::path::Path;
use std::sync::Arc;

/// Feed dataset ids of `market.feedFiles` (21 §17).
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum FeedDataset {
    BinanceAggTrades,
    ChainlinkCryptoPrices,
}

impl FeedDataset {
    pub const fn as_str(self) -> &'static str {
        match self {
            FeedDataset::BinanceAggTrades => "binance_agg_trades",
            FeedDataset::ChainlinkCryptoPrices => "chainlink_crypto_prices",
        }
    }
}

/// One `market.feedFiles` entry (21 §5). `symbol` is the Binance pair
/// (`BTCUSDT`) or the Chainlink asset id (`btcusd`).
// D-PENDING: 21 shows only the Binance spelling of `feedFiles[].symbol`;
// chose the crypto_prices asset id (`btcusd`) for Chainlink, the day-file
// directory name (14 §5.1).
#[derive(Copy, Clone, Debug)]
pub struct FeedFile<'a> {
    pub feed: FeedDataset,
    pub symbol: &'a str,
    pub day: UtcDay,
    pub path: &'a Path,
    pub bytes: u64,
}

/// Engine constants for the producer preflight (14 §4.3, F-47): the days a
/// market needs per feed (F-12, F-20). Chainlink has none before coverage.
pub fn required_days(feed: FeedDataset, window: Window) -> Vec<UtcDay> {
    let (start, end) = (window.start_ms.0, window.end_ms.0);
    match feed {
        FeedDataset::BinanceAggTrades => days_covering(start - LOOKBACK_MS, end),
        FeedDataset::ChainlinkCryptoPrices if start < CHAINLINK_COVERAGE_FROM_MS => Some(vec![]),
        FeedDataset::ChainlinkCryptoPrices => {
            days_covering((start - LOOKBACK_MS).max(CHAINLINK_COVERAGE_FROM_MS), end)
        }
    }
    .unwrap_or_default()
}

/// The Binance spot feed of a market.
#[derive(Clone, Debug)]
pub struct BinanceFeed {
    /// Resolved feed symbol (`btcusdt`, F-16).
    pub symbol: &'static str,
    pub series: BinanceSeries,
    pub tick_on_update: bool,
}

/// The Chainlink spot feed of a market.
#[derive(Clone, Debug)]
pub struct ChainlinkFeed {
    /// Resolved feed symbol (`btc/usd`, F-24).
    pub symbol: &'static str,
    pub asset_id: &'static str,
    pub series: ChainlinkSeries,
    pub tick_on_update: bool,
}

/// Immutable feeds of one market read (14 F-42).
#[derive(Clone, Debug, Default)]
pub struct MarketFeeds {
    window: Option<Window>,
    binance: Option<BinanceFeed>,
    chainlink: Option<ChainlinkFeed>,
    price_to_beat: Option<PriceToBeatSource>,
    schedule: SyntheticSchedule,
}

impl MarketFeeds {
    /// No feed requested.
    pub fn empty() -> MarketFeeds {
        MarketFeeds::default()
    }

    /// Assembles feeds from built parts and derives the synthetic schedule
    /// from the opted-in series (14 F-35, F-39).
    pub fn from_parts(
        window: Window,
        binance: Option<BinanceFeed>,
        chainlink: Option<ChainlinkFeed>,
        price_to_beat: Option<PriceToBeatSource>,
    ) -> MarketFeeds {
        let schedule = SyntheticSchedule::build(
            binance
                .as_ref()
                .filter(|b| b.tick_on_update)
                .map(|b| &b.series),
            chainlink
                .as_ref()
                .filter(|c| c.tick_on_update)
                .map(|c| &c.series),
            window,
        );
        MarketFeeds {
            window: Some(window),
            binance,
            chainlink,
            price_to_beat,
            schedule,
        }
    }

    pub fn window(&self) -> Option<Window> {
        self.window
    }
    #[inline]
    pub fn binance(&self) -> Option<&BinanceFeed> {
        self.binance.as_ref()
    }
    #[inline]
    pub fn chainlink(&self) -> Option<&ChainlinkFeed> {
        self.chainlink.as_ref()
    }
    #[inline]
    pub fn price_to_beat(&self) -> Option<&PriceToBeatSource> {
        self.price_to_beat.as_ref()
    }
    /// Empty unless a feed opted into synthetic ticks (14 F-35).
    #[inline]
    pub fn schedule(&self) -> &SyntheticSchedule {
        &self.schedule
    }
}

/// Inputs of [`load_market_feeds`], all from the job.
#[derive(Clone, Debug)]
pub struct MarketFeedsInput<'a> {
    pub slug: &'a str,
    pub profile: FeedProfile,
    pub model: FeedsModel,
    pub request: &'a FeedRequest,
    pub feed_files: &'a [FeedFile<'a>],
    /// `market.gammaPriceToBeat`.
    pub gamma: GammaStrike,
    /// `market.feedAvailability.priceToBeat`.
    pub ptb_availability: Option<PtbAvailability<'a>>,
}

/// Diagnostic severity.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum DiagLevel {
    Info,
    Warning,
}

/// A non-fatal feed finding (14 F-18 seed-only warning, §6.2 absences).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FeedDiagnostic {
    pub level: DiagLevel,
    pub message: String,
}

/// Load measurements (14 PF-7).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct FeedLoadStats {
    pub cache: CacheStats,
    pub binance_elements: u32,
    pub chainlink_elements: u32,
    pub binance_zero_copy: bool,
}

/// Feeds plus what the loader observed.
#[derive(Clone, Debug)]
pub struct LoadedFeeds {
    pub feeds: Arc<MarketFeeds>,
    pub diagnostics: Vec<FeedDiagnostic>,
    pub stats: FeedLoadStats,
}

/// Matches the required days of one feed against `feedFiles`. Entries are
/// validated by [`check_feed_files`] first, so each day has at most one.
fn find_files<'a>(
    files: &'a [FeedFile<'a>],
    feed: FeedDataset,
    days: &[UtcDay],
) -> (Vec<&'a FeedFile<'a>>, Vec<UtcDay>) {
    let (mut found, mut missing) = (Vec::new(), Vec::new());
    for d in days {
        match files.iter().find(|f| f.feed == feed && f.day == *d) {
            Some(f) => found.push(f),
            None => missing.push(*d),
        }
    }
    (found, missing)
}

/// What `market.feedFiles` may list for one requested feed: the derived
/// symbol (Binance pair or Chainlink asset id, 14 F-49) and the day set
/// (F-12, F-20).
struct ExpectedFiles {
    feed: FeedDataset,
    symbol: &'static str,
    days: Vec<UtcDay>,
}

/// `market.feedFiles` lists exactly what the request needs (21 §5.1, 00 R14):
/// no duplicate `(feed, symbol, day)`, no feed the strategy does not request,
/// no symbol other than the derived one and no day outside the required day
/// set. A violation is a shim or producer bug, `invalid_input: schema`, never
/// a retried `data_missing` whose message would ask to download files that
/// are present. A missing required day is checked per feed afterwards
/// (`data_missing: day_file_missing`, 14 §10).
fn check_feed_files(
    slug: &str,
    files: &[FeedFile<'_>],
    expected: &[ExpectedFiles],
) -> Result<(), FeedError> {
    let mut seen = std::collections::BTreeSet::new();
    for f in files {
        let entry = format!(
            "{{feed: {}, symbol: {}, day: {}, path: {}}}",
            f.feed.as_str(),
            f.symbol,
            f.day,
            f.path.display()
        );
        let bad = |why: String| {
            Err(FeedError::new(
                FeedCause::Schema,
                format!("market.feedFiles entry {entry} for {slug}: {why} (21 §5.1)"),
            ))
        };
        if !seen.insert((f.feed, f.symbol, f.day)) {
            return bad("duplicate (feed, symbol, day)".into());
        }
        let Some(want) = expected.iter().find(|e| e.feed == f.feed) else {
            return bad("the strategy does not request this feed".into());
        };
        if f.symbol != want.symbol {
            return bad(format!(
                "symbol differs from the derived {:?} (14 F-49)",
                want.symbol
            ));
        }
        if !want.days.contains(&f.day) {
            return bad(format!(
                "day is outside the required day set [{}] (14 F-12, F-20)",
                join_days(&want.days)
            ));
        }
    }
    Ok(())
}

fn join_days(days: &[UtcDay]) -> String {
    days.iter()
        .map(UtcDay::to_string)
        .collect::<Vec<_>>()
        .join(", ")
}

/// Loads every requested feed of one market (14 §4 to §6, §8.2) in the TS
/// order Binance, Chainlink, price to beat, so the first failing feed is the
/// same as in TS. Errors are classified per 14 §10.
pub fn load_market_feeds(
    input: &MarketFeedsInput<'_>,
    cache: &DayCache,
) -> Result<LoadedFeeds, FeedError> {
    let req = input.request;
    let mut stats = FeedLoadStats::default();
    let mut diagnostics = Vec::new();
    let slug = input.slug;
    // F-46: the model is validated whatever the request.
    input.model.validate()?;
    // 14 §6.2: `feedAvailability.priceToBeat` is null iff the strategy does
    // not request price to beat; a non-null value without the request is a
    // producer bug.
    if !req.price_to_beat && input.ptb_availability.is_some() {
        return Err(FeedError::new(
            FeedCause::FeedAvailability,
            format!(
                "price to beat for {slug}: feedAvailability.priceToBeat is set but the strategy \
                 does not request price to beat (producer bug, 14 §6.2)"
            ),
        ));
    }
    if req.is_empty() {
        check_feed_files(slug, input.feed_files, &[])?;
        return Ok(LoadedFeeds {
            feeds: Arc::new(MarketFeeds::empty()),
            diagnostics,
            stats,
        });
    }
    let info = parse_slug(slug).map_err(|e| match e {
        SlugError::UnsupportedSymbol => FeedError::new(
            FeedCause::Symbol,
            format!("feed symbol not derivable from slug {slug}: {e}"),
        ),
        _ => FeedError::new(
            FeedCause::Window,
            format!(
                "strategy requests external feeds but the window of {slug} is underivable: {e}"
            ),
        ),
    })?;
    let window = info.window;
    let start = window.start_ms.0;
    let mut expected = Vec::with_capacity(2);
    if req.binance_spot.is_some() {
        expected.push(ExpectedFiles {
            feed: FeedDataset::BinanceAggTrades,
            symbol: info.symbol.binance_pair(),
            days: required_days(FeedDataset::BinanceAggTrades, window),
        });
    }
    if req.chainlink.is_some() {
        expected.push(ExpectedFiles {
            feed: FeedDataset::ChainlinkCryptoPrices,
            symbol: info.symbol.chainlink_asset_id(),
            days: required_days(FeedDataset::ChainlinkCryptoPrices, window),
        });
    }
    check_feed_files(slug, input.feed_files, &expected)?;

    let mut binance = None;
    if let Some(opts) = &req.binance_spot {
        let symbol = resolve_binance_symbol(opts, info.symbol, slug)?;
        let pair = info.symbol.binance_pair();
        let days = required_days(FeedDataset::BinanceAggTrades, window);
        let (files, missing) = find_files(input.feed_files, FeedDataset::BinanceAggTrades, &days);
        if let (Some(first), Some(last)) = (missing.first(), missing.last()) {
            return Err(FeedError::new(
                FeedCause::DayFileMissing,
                format!(
                    "missing Binance aggTrades day file(s) for {pair}: {}. Worker machines: npm \
                     run binance:download-aggtrades-r2-to-local -- --pair {pair} (pull from the R2 \
                     mirror). Producer machine: npm run binance:download-aggtrades -- --pair \
                     {pair} --from {first} --to {last} (direct Binance download)",
                    join_days(&missing)
                ),
            ));
        }
        let loaded: Vec<Arc<BinanceDay>> = files
            .iter()
            .map(|f| cache.binance_day(pair, f.day, f.path, f.bytes, &mut stats.cache))
            .collect::<Result<_, _>>()?;
        let built = build_binance_series(
            pair,
            &loaded,
            window,
            input.model.binance.constant_ms(),
            input.profile,
        )?;
        if let Some(w) = built.warning {
            diagnostics.push(FeedDiagnostic {
                level: DiagLevel::Warning,
                message: w,
            });
        }
        stats.binance_elements = built.series.len() as u32;
        stats.binance_zero_copy = built.series.is_zero_copy();
        binance = Some(BinanceFeed {
            symbol,
            series: built.series,
            tick_on_update: opts.tick_on_update,
        });
    }

    let mut chainlink = None;
    if let Some(opts) = &req.chainlink {
        let symbol = resolve_chainlink_symbol(opts, info.symbol, slug)?;
        let asset = info.symbol.chainlink_asset_id();
        if start < CHAINLINK_COVERAGE_FROM_MS {
            return Err(FeedError::new(
                FeedCause::PreCoverage,
                format!(
                    "market window starts {}, before crypto_prices coverage ({}): the Chainlink \
                     feed cannot exist for this market. Exclude pre-coverage markets (--from-ms \
                     {CHAINLINK_COVERAGE_FROM_MS}) or drop the Chainlink request",
                    iso_ms(start),
                    UtcDay::of_ms(CHAINLINK_COVERAGE_FROM_MS)
                ),
            ));
        }
        let days = required_days(FeedDataset::ChainlinkCryptoPrices, window);
        let (files, missing) =
            find_files(input.feed_files, FeedDataset::ChainlinkCryptoPrices, &days);
        if let (Some(first), Some(last)) = (missing.first(), missing.last()) {
            return Err(FeedError::new(
                FeedCause::DayFileMissing,
                format!(
                    "missing Telonex crypto_prices day file(s) for {asset}: {}. Worker machines: \
                     npm run telonex:crypto-prices:download-r2-to-local -- --asset {asset} (pull \
                     from the R2 mirror). Producer machine: npm run \
                     telonex:crypto-prices:download -- --asset {asset} --from {first} --to {last} \
                     (direct Telonex download)",
                    join_days(&missing)
                ),
            ));
        }
        let loaded: Vec<Arc<ChainlinkDay>> = files
            .iter()
            .map(|f| cache.chainlink_day(asset, f.day, f.path, f.bytes, &mut stats.cache))
            .collect::<Result<_, _>>()?;
        let series = build_chainlink_series(
            asset,
            &loaded,
            window,
            input.model.chainlink.constant_ms(),
            input.model.chainlink_max_gap_ms,
        )?;
        stats.chainlink_elements = series.len() as u32;
        chainlink = Some(ChainlinkFeed {
            symbol,
            asset_id: asset,
            series,
            tick_on_update: opts.tick_on_update,
        });
    }

    let mut price_to_beat = None;
    if req.price_to_beat {
        match resolve_price_to_beat(
            slug,
            window,
            input.model.price_to_beat.constant_ms(),
            input.gamma,
            input.ptb_availability,
        )? {
            PtbResolution::Fed(src) => price_to_beat = Some(src),
            PtbResolution::Absent(status) => diagnostics.push(match status {
                PtbStatus::AbsentFreshMarketGrace => FeedDiagnostic {
                    level: DiagLevel::Warning,
                    message: format!(
                        "price to beat requested but the market settled recently and the backfill \
                         has not caught up: key stays absent for {slug}"
                    ),
                },
                _ => FeedDiagnostic {
                    level: DiagLevel::Info,
                    message: format!(
                        "price to beat requested but {slug} predates its series' recording epoch: \
                         key stays absent"
                    ),
                },
            }),
        }
    }

    Ok(LoadedFeeds {
        feeds: Arc::new(MarketFeeds::from_parts(
            window,
            binance,
            chainlink,
            price_to_beat,
        )),
        diagnostics,
        stats,
    })
}
