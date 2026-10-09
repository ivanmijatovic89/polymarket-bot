//! The strategy's feed request (30 §10, 14 §11) and symbol resolution
//! (14 F-49).

use crate::error::{FeedCause, FeedError};
use pmb_core::Symbol;

/// Options of one spot feed (30 §10 `FeedOptions`).
#[derive(Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct FeedOptions {
    /// Explicit feed symbol; allowed only when it equals the derived one
    /// (14 F-49).
    pub symbol: Option<String>,
    /// Opt into synthetic strategy ticks for this feed (14 F-35).
    pub tick_on_update: bool,
}

/// The feeds a strategy requests (30 §10). The type admits exactly one
/// Chainlink symbol (14 F-38).
#[derive(Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct FeedRequest {
    pub binance_spot: Option<FeedOptions>,
    pub chainlink: Option<FeedOptions>,
    pub price_to_beat: bool,
}

impl FeedRequest {
    pub fn is_empty(&self) -> bool {
        self.binance_spot.is_none() && self.chainlink.is_none() && !self.price_to_beat
    }

    /// Whether any requested feed opts into synthetic ticks (14 F-35).
    pub fn ticks_on_update(&self) -> bool {
        self.binance_spot.as_ref().is_some_and(|o| o.tick_on_update)
            || self.chainlink.as_ref().is_some_and(|o| o.tick_on_update)
    }
}

// D-PENDING: F-49 says "equals the derived one" without a normalization
// rule (TS trims and lowercases); chose exact byte equality, so `BTCUSDT` or
// ` btcusdt` is `invalid_input: symbol` (fail loud, R14).
fn check_symbol(
    feed: &str,
    explicit: Option<&str>,
    derived: &'static str,
    slug: &str,
) -> Result<&'static str, FeedError> {
    match explicit {
        None => Ok(derived),
        Some(s) if s == derived => Ok(derived),
        Some(s) => Err(FeedError::new(
            FeedCause::Symbol,
            format!(
                "{feed} symbol {s:?} does not match the market {slug} (derived {derived:?}); \
                 a foreign feed symbol is not supported (14 F-49)"
            ),
        )),
    }
}

/// Resolved Binance feed symbol (`btcusdt`) for the traded market.
pub fn resolve_binance_symbol(
    opts: &FeedOptions,
    market: Symbol,
    slug: &str,
) -> Result<&'static str, FeedError> {
    check_symbol(
        "binance",
        opts.symbol.as_deref(),
        market.binance_feed_symbol(),
        slug,
    )
}

/// Resolved Chainlink feed symbol (`btc/usd`) for the traded market.
pub fn resolve_chainlink_symbol(
    opts: &FeedOptions,
    market: Symbol,
    slug: &str,
) -> Result<&'static str, FeedError> {
    check_symbol(
        "chainlink",
        opts.symbol.as_deref(),
        market.chainlink_feed_symbol(),
        slug,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // spec: 14 F-49 (explicit symbol only when equal to the derived one)
    #[test]
    fn symbol_resolution() {
        let slug = "btc-updown-15m-1789570800";
        let mut o = FeedOptions::default();
        assert_eq!(
            resolve_binance_symbol(&o, Symbol::Btc, slug).unwrap(),
            "btcusdt"
        );
        assert_eq!(
            resolve_chainlink_symbol(&o, Symbol::Btc, slug).unwrap(),
            "btc/usd"
        );
        o.symbol = Some("btcusdt".into());
        assert!(resolve_binance_symbol(&o, Symbol::Btc, slug).is_ok());
        o.symbol = Some("ethusdt".into());
        let e = resolve_binance_symbol(&o, Symbol::Btc, slug).unwrap_err();
        assert_eq!(e.cause, FeedCause::Symbol);
        assert!(e.message.contains(slug) && e.message.contains("ethusdt"));
        o.symbol = Some("BTC/USD".into());
        assert!(resolve_chainlink_symbol(&o, Symbol::Btc, slug).is_err());
    }

    #[test]
    fn request_flags() {
        let mut r = FeedRequest::default();
        assert!(r.is_empty() && !r.ticks_on_update());
        r.price_to_beat = true;
        assert!(!r.is_empty() && !r.ticks_on_update());
        r.chainlink = Some(FeedOptions {
            symbol: None,
            tick_on_update: true,
        });
        assert!(r.ticks_on_update());
    }
}
