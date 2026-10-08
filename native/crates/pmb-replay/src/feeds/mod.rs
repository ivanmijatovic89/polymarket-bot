//! Historical external feeds for backtests (TS `src/backtest/feeds/*`).
//!
//! - [`binance`]: data.binance.vision aggTrades day files; a trade at exchange
//!   time `T` is visible at `T + binance_latency_ms`.
//! - [`chainlink`]: Telonex `crypto_prices` rounds, two-clock model: visible at
//!   broadcast time + `chainlink_latency_ms`, emitted with the round time.
//! - [`price_to_beat`]: Gamma strike from the job payload, visible at
//!   window start + `price_to_beat_latency_ms`.
//!
//! Missing data that should exist is a hard error (see each loader).

pub mod binance;
pub mod chainlink;
pub mod price_to_beat;
mod schedule;
mod state;

pub use schedule::{build_synthetic_schedule, SyntheticTickEvent};
pub use state::FeedState;

use crate::slug::{symbol_from_slug, window_from_slug, Window};
use anyhow::{bail, Result};
use pmb_core::feeds::FeedRequest;
use pmb_core::model::TsMs;
use price_to_beat::{GammaPriceToBeat, PriceToBeatFeed};
use std::path::{Path, PathBuf};

/// Feed latency / lookback knobs (TS env vars; defaults are measured values).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct FeedSettings {
    /// `BACKTEST_BINANCE_FEED_LATENCY_MS` (exchange trade time → bot receive).
    pub binance_latency_ms: i64,
    /// `BACKTEST_BINANCE_FEED_LOOKBACK_MS` (pre-window series start).
    pub binance_lookback_ms: i64,
    /// `BACKTEST_RTDS_CHAINLINK_LATENCY_MS` (Polymarket broadcast → bot only).
    pub chainlink_latency_ms: i64,
    /// `BACKTEST_RTDS_CHAINLINK_LOOKBACK_MS`.
    pub chainlink_lookback_ms: i64,
    /// `BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS`: in-window round gap that fails
    /// the market; 0 disables the check.
    pub chainlink_max_gap_ms: i64,
    /// `BACKTEST_PRICE_TO_BEAT_LATENCY_MS` (window start → first successful poll).
    pub price_to_beat_latency_ms: i64,
}

impl Default for FeedSettings {
    fn default() -> Self {
        Self {
            binance_latency_ms: 110,
            binance_lookback_ms: 300_000,
            chainlink_latency_ms: 320,
            chainlink_lookback_ms: 300_000,
            chainlink_max_gap_ms: 300_000,
            price_to_beat_latency_ms: 2_700,
        }
    }
}

impl FeedSettings {
    pub fn from_env() -> Self {
        Self::from_lookup(|k| std::env::var(k).ok())
    }

    /// Reads overrides through `get`; an empty, non-integer or negative value
    /// keeps the default (TS `envInt`).
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Self {
        let d = Self::default();
        let ms = |name: &str, fallback: i64| {
            get(name)
                .and_then(|v| v.trim().parse::<i64>().ok())
                .filter(|v| *v >= 0)
                .unwrap_or(fallback)
        };
        Self {
            binance_latency_ms: ms("BACKTEST_BINANCE_FEED_LATENCY_MS", d.binance_latency_ms),
            binance_lookback_ms: ms("BACKTEST_BINANCE_FEED_LOOKBACK_MS", d.binance_lookback_ms),
            chainlink_latency_ms: ms("BACKTEST_RTDS_CHAINLINK_LATENCY_MS", d.chainlink_latency_ms),
            chainlink_lookback_ms: ms(
                "BACKTEST_RTDS_CHAINLINK_LOOKBACK_MS",
                d.chainlink_lookback_ms,
            ),
            chainlink_max_gap_ms: ms("BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS", d.chainlink_max_gap_ms),
            price_to_beat_latency_ms: ms(
                "BACKTEST_PRICE_TO_BEAT_LATENCY_MS",
                d.price_to_beat_latency_ms,
            ),
        }
    }
}

/// On-disk roots of the feed day files (TS `binance/paths.ts`,
/// `telonex/cryptoPrices/paths.ts`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DataRoots {
    /// `data/binance` (holds `aggTrades/<PAIR>/…`).
    pub binance: PathBuf,
    /// `data/telonex/crypto_prices` (holds `<asset_id>/…`).
    pub crypto_prices: PathBuf,
}

impl DataRoots {
    /// Default layout under the repository root.
    pub fn under(repo_root: &Path) -> Self {
        Self {
            binance: repo_root.join("data/binance"),
            crypto_prices: repo_root.join("data/telonex/crypto_prices"),
        }
    }

    /// Honors `BINANCE_DATA_BASE_DIR` / `TELONEX_CRYPTO_PRICES_BASE_DIR`
    /// (relative values anchor at `repo_root`).
    pub fn from_env(repo_root: &Path) -> Self {
        let dir = |name: &str, default: &str| {
            let v = std::env::var(name).unwrap_or_default();
            let v = v.trim();
            repo_root.join(if v.is_empty() { default } else { v })
        };
        Self {
            binance: dir("BINANCE_DATA_BASE_DIR", "data/binance"),
            crypto_prices: dir("TELONEX_CRYPTO_PRICES_BASE_DIR", "data/telonex/crypto_prices"),
        }
    }

    pub fn agg_trades_day_path(&self, pair: &str, date: &str) -> PathBuf {
        self.binance
            .join("aggTrades")
            .join(pair)
            .join(format!("{pair}-aggTrades-{date}.parquet"))
    }

    pub fn crypto_prices_day_path(&self, asset_id: &str, date: &str) -> PathBuf {
        self.crypto_prices
            .join(asset_id)
            .join(format!("{asset_id}-crypto-prices-{date}.parquet"))
    }
}

/// Binance WS feed symbol → day-file pair spelling (`btcusdt` → `BTCUSDT`).
pub fn binance_pair(feed_symbol: &str) -> Result<String> {
    let s = feed_symbol.trim().to_ascii_uppercase();
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_alphanumeric()) {
        bail!("[binance] invalid feed symbol: {feed_symbol:?}");
    }
    Ok(s)
}

/// Default Binance feed symbol of a traded market (`btc` → `btcusdt`).
pub fn default_binance_feed_symbol(market_symbol: &str) -> String {
    format!("{}usdt", market_symbol.trim().to_ascii_lowercase())
}

fn plain_symbol(s: &str) -> Result<String> {
    let s = s.trim().to_ascii_lowercase();
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_alphanumeric()) {
        bail!("[crypto-prices] invalid symbol: {s:?}");
    }
    Ok(s)
}

/// Market symbol → RTDS chainlink feed symbol (`btc` → `btc/usd`).
pub fn chainlink_feed_symbol(market_symbol: &str) -> Result<String> {
    Ok(format!("{}/usd", plain_symbol(market_symbol)?))
}

/// Chainlink feed symbol → `crypto_prices` asset id (`btc/usd` → `btcusd`;
/// plain symbols get a `usd` suffix unless they already end with it).
pub fn chainlink_asset_id(feed_symbol: &str) -> Result<String> {
    let s = feed_symbol.trim().to_ascii_lowercase();
    if let Some(base) = s.strip_suffix("/usd") {
        if !base.is_empty() && base.bytes().all(|b| b.is_ascii_alphanumeric()) {
            return Ok(format!("{base}usd"));
        }
    }
    let s = plain_symbol(&s)?;
    Ok(if s.ends_with("usd") { s } else { format!("{s}usd") })
}

/// Binance aggTrade feed fulfilled from history.
#[derive(Clone, Debug, PartialEq)]
pub struct BinanceFeed {
    /// WS feed symbol, e.g. `btcusdt`.
    pub symbol: String,
    pub series: binance::AggTradeSeries,
    pub latency_ms: i64,
    pub tick_on_update: bool,
}

/// Chainlink round feed fulfilled from history.
#[derive(Clone, Debug, PartialEq)]
pub struct ChainlinkFeed {
    /// RTDS feed symbol, e.g. `btc/usd`.
    pub symbol: String,
    /// `crypto_prices` asset id, e.g. `btcusd`.
    pub asset_id: String,
    pub series: chainlink::RoundSeries,
    /// Broadcast → bot leg only (the round → broadcast lag is in the data).
    pub latency_ms: i64,
    pub tick_on_update: bool,
}

/// Everything a market's strategy requested, loaded once per market (shared
/// by every candidate replay of that market).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FeedSources {
    pub binance: Option<BinanceFeed>,
    pub chainlink: Option<ChainlinkFeed>,
    pub price_to_beat: Option<PriceToBeatFeed>,
}

impl FeedSources {
    pub fn is_empty(&self) -> bool {
        self.binance.is_none() && self.chainlink.is_none() && self.price_to_beat.is_none()
    }
}

/// Market context the feed loaders need.
#[derive(Clone, Debug)]
pub struct FeedContext<'a> {
    pub slug: &'a str,
    /// Job `strategyWindow`; the slug window is used when absent.
    pub strategy_window: Option<Window>,
    pub gamma_price_to_beat: &'a GammaPriceToBeat,
    pub settings: FeedSettings,
    pub roots: &'a DataRoots,
    /// Wall clock (publication-lag / fresh-market rules only).
    pub now_ms: TsMs,
}

/// Loads every requested feed (TS `wireBacktestExternalFeeds`). Returns the
/// sources and the feed window (`None` when nothing was requested).
/// Warnings and info lines the TS engine logs are appended to `notes`.
pub fn load_feeds(
    req: &FeedRequest,
    ctx: &FeedContext<'_>,
    notes: &mut Vec<String>,
) -> Result<(FeedSources, Option<Window>)> {
    if req.is_empty() {
        return Ok((FeedSources::default(), None));
    }
    let slug = ctx.slug;
    let Some(window) = ctx.strategy_window.or_else(|| window_from_slug(slug)) else {
        bail!("[backtest:feeds] strategy requests external feeds but the market window is underivable (unparseable slug: {slug})");
    };
    let slug_symbol = symbol_from_slug(slug);
    let mut sources = FeedSources::default();
    let mut fulfilled = Vec::new();
    let explicit = |o: &Option<String>| {
        o.as_deref()
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty())
    };

    if let Some(opts) = &req.binance_spot {
        let Some(symbol) =
            explicit(&opts.symbol).or_else(|| slug_symbol.map(default_binance_feed_symbol))
        else {
            bail!("[backtest:feeds] strategy requests the binance feed with no symbol and none is derivable from the slug ({slug})");
        };
        if let Some(s) = slug_symbol.filter(|s| !symbol.starts_with(s)) {
            notes.push(format!("[backtest:feeds] strategy requests binance symbol={symbol} but market slug is {slug} — feeding {symbol} (same as live; market symbol {s})"));
        }
        let series = binance::load_agg_trades(
            ctx.roots,
            &binance_pair(&symbol)?,
            window,
            ctx.settings.binance_lookback_ms,
            notes,
        )?;
        fulfilled.push(format!("binanceWsSpotPrice(symbol={symbol} trades={})", series.len()));
        sources.binance = Some(BinanceFeed {
            symbol,
            series,
            latency_ms: ctx.settings.binance_latency_ms,
            tick_on_update: opts.tick_on_update,
        });
    }

    if let Some(opts) = &req.chainlink {
        let symbol = match explicit(&opts.symbol) {
            Some(s) => s,
            None => match slug_symbol {
                Some(s) => chainlink_feed_symbol(s)?,
                None => bail!("[backtest:feeds] strategy requests the rtds chainlink feed with no symbol and none is derivable from the slug ({slug})"),
            },
        };
        let asset_id = chainlink_asset_id(&symbol)?;
        if let Some(s) = slug_symbol.filter(|s| !asset_id.starts_with(s)) {
            notes.push(format!("[backtest:feeds] strategy requests chainlink symbol={symbol} but market slug is {slug} — feeding {symbol} (same as live; market symbol {s})"));
        }
        let series = chainlink::load_rounds(
            ctx.roots,
            &asset_id,
            window,
            ctx.settings.chainlink_lookback_ms,
            ctx.settings.chainlink_max_gap_ms,
            ctx.now_ms,
        )?;
        fulfilled.push(format!("rtdsChainlink(symbol={symbol} rounds={})", series.len()));
        sources.chainlink = Some(ChainlinkFeed {
            symbol,
            asset_id,
            series,
            latency_ms: ctx.settings.chainlink_latency_ms,
            tick_on_update: opts.tick_on_update,
        });
    }

    if req.price_to_beat {
        sources.price_to_beat = price_to_beat::resolve(
            slug,
            window,
            ctx.gamma_price_to_beat,
            ctx.settings.price_to_beat_latency_ms,
            ctx.now_ms,
            notes,
        )?;
        if let Some(p) = &sources.price_to_beat {
            fulfilled.push(format!("polymarketPriceToBeat(openPrice={})", p.value));
        }
    }

    if !fulfilled.is_empty() {
        notes.push(format!(
            "[backtest:feeds] fulfilled slug={slug}: {}",
            fulfilled.join(", ")
        ));
    }
    Ok((sources, Some(window)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_from_lookup() {
        let s = FeedSettings::from_lookup(|k| match k {
            "BACKTEST_BINANCE_FEED_LATENCY_MS" => Some(" 150 ".into()),
            "BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS" => Some("0".into()),
            "BACKTEST_RTDS_CHAINLINK_LATENCY_MS" => Some("-5".into()),
            "BACKTEST_PRICE_TO_BEAT_LATENCY_MS" => Some("".into()),
            _ => None,
        });
        assert_eq!(s.binance_latency_ms, 150);
        assert_eq!(s.chainlink_max_gap_ms, 0);
        assert_eq!(s.chainlink_latency_ms, 320);
        assert_eq!(s.price_to_beat_latency_ms, 2_700);
    }

    #[test]
    fn symbols_and_paths() {
        assert_eq!(binance_pair("btcusdt").unwrap(), "BTCUSDT");
        assert!(binance_pair("btc/usdt").is_err());
        assert_eq!(default_binance_feed_symbol("BTC"), "btcusdt");
        assert_eq!(chainlink_feed_symbol("eth").unwrap(), "eth/usd");
        assert_eq!(chainlink_asset_id("btc/usd").unwrap(), "btcusd");
        assert_eq!(chainlink_asset_id("btcusd").unwrap(), "btcusd");
        assert_eq!(chainlink_asset_id("sol").unwrap(), "solusd");
        assert!(chainlink_asset_id("btc/eur").is_err());
        let roots = DataRoots::under(Path::new("/repo"));
        assert_eq!(
            roots.agg_trades_day_path("BTCUSDT", "2026-09-16"),
            PathBuf::from("/repo/data/binance/aggTrades/BTCUSDT/BTCUSDT-aggTrades-2026-09-16.parquet")
        );
        assert_eq!(
            roots.crypto_prices_day_path("btcusd", "2026-09-16"),
            PathBuf::from("/repo/data/telonex/crypto_prices/btcusd/btcusd-crypto-prices-2026-09-16.parquet")
        );
    }

    #[test]
    fn no_request_loads_nothing() {
        let roots = DataRoots::under(Path::new("/nonexistent"));
        let gamma = GammaPriceToBeat::NotResolved;
        let ctx = FeedContext {
            slug: "not-a-slug",
            strategy_window: None,
            gamma_price_to_beat: &gamma,
            settings: FeedSettings::default(),
            roots: &roots,
            now_ms: 0,
        };
        let mut notes = vec![];
        let (s, w) = load_feeds(&FeedRequest::default(), &ctx, &mut notes).unwrap();
        assert!(s.is_empty() && w.is_none());
        let req = FeedRequest {
            price_to_beat: true,
            ..FeedRequest::default()
        };
        let err = load_feeds(&req, &ctx, &mut notes).unwrap_err();
        assert!(err.to_string().contains("window is underivable"));
    }
}
