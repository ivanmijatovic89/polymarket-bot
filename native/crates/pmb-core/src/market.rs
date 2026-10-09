//! Market identity and window (10-domain-model.md §5 M2–M6).
//!
//! Only BTC up/down 5m and 15m markets are in scope (D06); every other slug
//! is a typed error.

use crate::fixed::{DurMs, TsMs};
use crate::ids::{ConditionId, TokenId};
use crate::outcome::{Outcome, PerOutcome};
use std::fmt;

/// Underlying symbol (D06: BTC only).
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Symbol {
    Btc,
}

impl Symbol {
    /// Slug token (`btc`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Symbol::Btc => "btc",
        }
    }
}

/// Market timeframe (D06: 5m and 15m).
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Timeframe {
    M5,
    M15,
}

impl Timeframe {
    /// Slug token (`5m`, `15m`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Timeframe::M5 => "5m",
            Timeframe::M15 => "15m",
        }
    }
    pub const fn duration(self) -> DurMs {
        match self {
            Timeframe::M5 => DurMs(300_000),
            Timeframe::M15 => DurMs(900_000),
        }
    }
    pub fn parse(s: &str) -> Option<Timeframe> {
        match s {
            "5m" => Some(Timeframe::M5),
            "15m" => Some(Timeframe::M15),
            _ => None,
        }
    }
}

/// Market version (11 §10): `v1` (CTF) or `v2` (Protocol V2).
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum MarketVersion {
    V1,
    V2,
}

impl MarketVersion {
    pub const fn as_str(self) -> &'static str {
        match self {
            MarketVersion::V1 => "v1",
            MarketVersion::V2 => "v2",
        }
    }
    /// Any value other than `v1`/`v2` is invalid input (11 V1).
    pub fn parse(s: &str) -> Option<MarketVersion> {
        match s {
            "v1" => Some(MarketVersion::V1),
            "v2" => Some(MarketVersion::V2),
            _ => None,
        }
    }
}

/// Half-open market window `[start_ms, end_ms)` (M5, D23).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct Window {
    pub start_ms: TsMs,
    pub end_ms: TsMs,
}

impl Window {
    #[inline]
    pub fn contains(&self, t: TsMs) -> bool {
        self.start_ms <= t && t < self.end_ms
    }
    #[inline]
    pub fn duration(&self) -> DurMs {
        DurMs(self.end_ms.0 - self.start_ms.0)
    }
}

/// A slug that is not a supported up/down market.
#[derive(Copy, Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum SlugError {
    #[error("slug is not `<symbol>-updown-<timeframe>-<epochSeconds>`")]
    Syntax,
    #[error("unsupported symbol (only btc, D06)")]
    UnsupportedSymbol,
    #[error("unsupported timeframe (only 5m and 15m, D06)")]
    UnsupportedTimeframe,
    #[error("epoch seconds are not canonical decimal digits or out of range")]
    Epoch,
    #[error("window start is not aligned to the timeframe")]
    Misaligned,
}

/// What a supported slug encodes.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct SlugInfo {
    pub symbol: Symbol,
    pub timeframe: Timeframe,
    pub window: Window,
}

/// Parses `btc-updown-{5m|15m}-{epochSeconds}` (M5; window as in TS
/// `src/polymarket/upDownSlugWindow.ts`). Stricter than TS: other symbols and
/// timeframes, leading zeros and starts not aligned to the timeframe are
/// rejected.
pub fn parse_slug(slug: &str) -> Result<SlugInfo, SlugError> {
    let mut parts = slug.split('-');
    let (Some(sym), Some(kind), Some(tf), Some(epoch), None) = (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) else {
        return Err(SlugError::Syntax);
    };
    if kind != "updown" || sym.is_empty() || !sym.bytes().all(|b| b.is_ascii_lowercase()) {
        return Err(SlugError::Syntax);
    }
    let symbol = match sym {
        "btc" => Symbol::Btc,
        _ => return Err(SlugError::UnsupportedSymbol),
    };
    let timeframe = Timeframe::parse(tf).ok_or(SlugError::UnsupportedTimeframe)?;
    if epoch.is_empty()
        || !epoch.bytes().all(|b| b.is_ascii_digit())
        || (epoch.len() > 1 && epoch.starts_with('0'))
    {
        return Err(SlugError::Epoch);
    }
    let sec: i64 = epoch.parse().map_err(|_| SlugError::Epoch)?;
    let start = sec.checked_mul(1000).ok_or(SlugError::Epoch)?;
    let dur = timeframe.duration().0;
    if start % dur != 0 {
        return Err(SlugError::Misaligned);
    }
    let end = start.checked_add(dur).ok_or(SlugError::Epoch)?;
    Ok(SlugInfo {
        symbol,
        timeframe,
        window: Window {
            start_ms: TsMs(start),
            end_ms: TsMs(end),
        },
    })
}

/// Immutable market data, shared read-only across candidates (M5, P5).
///
/// It deliberately has no final outcome: see [`FinalOutcome`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MarketInfo {
    pub slug: Box<str>,
    pub symbol: Symbol,
    pub timeframe: Timeframe,
    pub condition_id: ConditionId,
    /// Indexed by [`Outcome`]; from `marketResolution.tokenMap` (M2).
    pub tokens: PerOutcome<TokenId>,
    pub window: Window,
    pub version: MarketVersion,
    pub neg_risk: bool,
}

impl MarketInfo {
    /// Builds the info from a slug plus the job's identities; symbol,
    /// timeframe and window come from the slug.
    pub fn new(
        slug: &str,
        condition_id: ConditionId,
        tokens: PerOutcome<TokenId>,
        version: MarketVersion,
        neg_risk: bool,
    ) -> Result<MarketInfo, SlugError> {
        let s = parse_slug(slug)?;
        Ok(MarketInfo {
            slug: slug.into(),
            symbol: s.symbol,
            timeframe: s.timeframe,
            condition_id,
            tokens,
            window: s.window,
            version,
            neg_risk,
        })
    }

    /// Outcome of a token id (M3: readers map rows by token id, never by
    /// column position). `None` for a foreign token.
    #[inline]
    pub fn outcome_of(&self, token: &TokenId) -> Option<Outcome> {
        if *token == self.tokens[Outcome::Up] {
            Some(Outcome::Up)
        } else if *token == self.tokens[Outcome::Down] {
            Some(Outcome::Down)
        } else {
            None
        }
    }
}

/// The resolved winner, used only for settlement (M6).
///
/// It is not part of [`MarketInfo`] or of any type the engine lends to
/// strategy code: the engine keeps it in its settlement step only, so the
/// strategy context has no path to it. Its field is private and it exposes
/// only the settlement payout.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct FinalOutcome(Outcome);

impl FinalOutcome {
    pub const fn new(winner: Outcome) -> Self {
        FinalOutcome(winner)
    }
    #[inline]
    pub const fn winner(self) -> Outcome {
        self.0
    }
    /// Payout per share of `o`: 1 for the winner, 0 for the loser (12 §9.5).
    #[inline]
    pub fn payout_micros(self, o: Outcome) -> i64 {
        if o == self.0 {
            crate::SCALE
        } else {
            0
        }
    }
}

impl fmt::Display for FinalOutcome {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0.label())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_parsing() {
        let s = parse_slug("btc-updown-15m-1780272000").unwrap();
        assert_eq!(s.symbol, Symbol::Btc);
        assert_eq!(s.timeframe, Timeframe::M15);
        assert_eq!(s.window.start_ms, TsMs(1_780_272_000_000));
        assert_eq!(s.window.end_ms, TsMs(1_780_272_900_000));
        let m5 = parse_slug("btc-updown-5m-1780272300").unwrap();
        assert_eq!(m5.window.duration(), DurMs(300_000));
        assert!(m5.window.contains(TsMs(1_780_272_300_000)));
        assert!(!m5.window.contains(TsMs(1_780_272_600_000)));
        let bad = [
            ("eth-updown-15m-1780272000", SlugError::UnsupportedSymbol),
            ("btc-updown-1h-1780272000", SlugError::UnsupportedTimeframe),
            ("btc-updown-4h-1780272000", SlugError::UnsupportedTimeframe),
            ("btc-updown-15m-1780272300", SlugError::Misaligned),
            ("btc-updown-15m-01780272000", SlugError::Epoch),
            ("btc-updown-15m-", SlugError::Epoch),
            ("btc-updown-15m-12x", SlugError::Epoch),
            ("btc-updown-15m-99999999999999999999", SlugError::Epoch),
            ("btc-up-15m-1780272000", SlugError::Syntax),
            ("btc-updown-15m-1780272000-x", SlugError::Syntax),
            ("BTC-updown-15m-1780272000", SlugError::Syntax),
            ("", SlugError::Syntax),
        ];
        for (slug, want) in bad {
            assert_eq!(parse_slug(slug), Err(want), "{slug}");
        }
    }

    #[test]
    fn market_info_and_final_outcome() {
        let up = TokenId::parse("1").unwrap();
        let down = TokenId::parse("2").unwrap();
        let cid = ConditionId::parse(
            "0x5f65177b394277fd294cd75650044e32ba009a95022d88a0c1d565897d72f8f1",
        )
        .unwrap();
        let m = MarketInfo::new(
            "btc-updown-5m-1780272000",
            cid,
            PerOutcome::new(up, down),
            MarketVersion::V1,
            false,
        )
        .unwrap();
        assert_eq!(m.outcome_of(&down), Some(Outcome::Down));
        assert_eq!(m.outcome_of(&TokenId::parse("3").unwrap()), None);
        let f = FinalOutcome::new(Outcome::Up);
        assert_eq!(f.payout_micros(Outcome::Up), 1_000_000);
        assert_eq!(f.payout_micros(Outcome::Down), 0);
        assert_eq!(f.to_string(), "UP");
        assert_eq!(MarketVersion::parse("v3"), None);
    }
}
