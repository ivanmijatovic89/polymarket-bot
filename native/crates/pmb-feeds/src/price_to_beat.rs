//! Price to beat from the job (14 §6): the producer-resolved strike
//! (`market.gammaPriceToBeat`) and its availability decision
//! (`market.feedAvailability.priceToBeat`). The binary only applies the
//! producer's result; it reads no clock (14 F-3, 21 §5.3).

use crate::error::{FeedCause, FeedError};
use pmb_core::{PriceToBeatPoint, TsMs, Window};

/// `market.gammaPriceToBeat` tri-state (21 §5.1).
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum GammaStrike {
    /// Field absent: the producer did not look it up.
    NotResolved,
    /// `null`: slug not in the catalog.
    CatalogMiss,
    /// Object: `priceToBeat` is a finite number or null.
    Resolved { price_to_beat: Option<f64> },
}

/// `feedAvailability.priceToBeat.status` (14 §6.2).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum PtbStatus {
    Fed,
    AbsentPreSeriesEpoch,
    AbsentFreshMarketGrace,
    UnavailablePipelineIncomplete,
    UnavailableUpstreamHole,
}

/// `feedAvailability.priceToBeat` (null when the strategy did not request
/// price to beat).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct PtbAvailability<'a> {
    pub status: PtbStatus,
    pub message: Option<&'a str>,
}

/// The fed price-to-beat source (14 F-28): visible iff the feed clock
/// `H >= available_at = start + L_p`.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct PriceToBeatSource {
    pub point: PriceToBeatPoint,
}

impl PriceToBeatSource {
    #[inline]
    pub fn available_at(&self) -> TsMs {
        self.point.received_at
    }
}

/// Outcome of the §6.2 table for a strategy that requests price to beat.
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum PtbResolution {
    Fed(PriceToBeatSource),
    /// Key stays absent: `AbsentPreSeriesEpoch` (info diagnostic) or
    /// `AbsentFreshMarketGrace` (warning diagnostic).
    Absent(PtbStatus),
}

fn inconsistent(slug: &str, what: &str) -> FeedError {
    FeedError::new(
        FeedCause::FeedAvailability,
        format!("price to beat for {slug}: {what} (producer bug, 14 §6.2)"),
    )
}

/// Applies the 14 §6.2 table. `availability` is `None` when the job carries
/// `feedAvailability.priceToBeat: null`.
pub fn resolve_price_to_beat(
    slug: &str,
    window: Window,
    latency_ms: i64,
    gamma: GammaStrike,
    availability: Option<PtbAvailability<'_>>,
) -> Result<PtbResolution, FeedError> {
    let Some(av) = availability else {
        return Err(inconsistent(
            slug,
            "the strategy requests it but feedAvailability.priceToBeat is null",
        ));
    };
    let strike = match gamma {
        GammaStrike::Resolved {
            price_to_beat: Some(p),
        } => Some(p),
        _ => None,
    };
    let no_strike_ok = matches!(
        gamma,
        GammaStrike::CatalogMiss
            | GammaStrike::Resolved {
                price_to_beat: None
            }
    );
    let message = || av.message.filter(|m| !m.is_empty());
    match av.status {
        PtbStatus::Fed => {
            let Some(p) = strike.filter(|p| p.is_finite()) else {
                return Err(inconsistent(
                    slug,
                    "status fed without a finite gammaPriceToBeat.priceToBeat",
                ));
            };
            Ok(PtbResolution::Fed(PriceToBeatSource {
                point: PriceToBeatPoint {
                    open_price: p,
                    received_at: TsMs(window.start_ms.0 + latency_ms),
                    event_start: window.start_ms,
                    end: window.end_ms,
                },
            }))
        }
        PtbStatus::AbsentPreSeriesEpoch if strike.is_none() => Ok(PtbResolution::Absent(av.status)),
        PtbStatus::AbsentFreshMarketGrace if no_strike_ok => Ok(PtbResolution::Absent(av.status)),
        PtbStatus::UnavailablePipelineIncomplete if no_strike_ok => {
            let Some(m) = message() else {
                return Err(inconsistent(slug, "unavailable_* without a message"));
            };
            Err(FeedError::new(FeedCause::PipelineIncomplete, m))
        }
        PtbStatus::UnavailableUpstreamHole if no_strike_ok => {
            let Some(m) = message() else {
                return Err(inconsistent(slug, "unavailable_* without a message"));
            };
            Err(FeedError::new(FeedCause::UpstreamHole, m))
        }
        s => Err(inconsistent(
            slug,
            &format!("status {s:?} is inconsistent with gammaPriceToBeat {gamma:?}"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorClass;

    const START: i64 = 1_789_570_800_000;

    fn win() -> Window {
        Window {
            start_ms: TsMs(START),
            end_ms: TsMs(START + 900_000),
        }
    }

    fn av(status: PtbStatus, message: Option<&str>) -> Option<PtbAvailability<'_>> {
        Some(PtbAvailability { status, message })
    }

    // spec: 14 §6.2 table (every row), F-28 (availability at start + L_p)
    #[test]
    fn availability_table() {
        let fed = GammaStrike::Resolved {
            price_to_beat: Some(117_234.51),
        };
        let none = GammaStrike::Resolved {
            price_to_beat: None,
        };
        let s = "btc-updown-15m-1789570800";
        match resolve_price_to_beat(s, win(), 2_700, fed, av(PtbStatus::Fed, None)).unwrap() {
            PtbResolution::Fed(src) => {
                assert_eq!(src.available_at(), TsMs(START + 2_700));
                assert_eq!(src.point.open_price, 117_234.51);
                assert_eq!(src.point.end, TsMs(START + 900_000));
            }
            other => panic!("{other:?}"),
        }
        let r = resolve_price_to_beat(s, win(), 0, none, av(PtbStatus::AbsentPreSeriesEpoch, None));
        assert_eq!(
            r.unwrap(),
            PtbResolution::Absent(PtbStatus::AbsentPreSeriesEpoch)
        );
        let r = resolve_price_to_beat(
            s,
            win(),
            0,
            GammaStrike::NotResolved,
            av(PtbStatus::AbsentPreSeriesEpoch, None),
        );
        assert!(r.is_ok());
        let r = resolve_price_to_beat(
            s,
            win(),
            0,
            none,
            av(PtbStatus::AbsentFreshMarketGrace, None),
        );
        assert_eq!(
            r.unwrap(),
            PtbResolution::Absent(PtbStatus::AbsentFreshMarketGrace)
        );
        let e = resolve_price_to_beat(
            s,
            win(),
            0,
            GammaStrike::CatalogMiss,
            av(
                PtbStatus::UnavailablePipelineIncomplete,
                Some("run telonex:sync"),
            ),
        )
        .unwrap_err();
        assert_eq!(
            (e.class(), e.cause),
            (ErrorClass::DataDefect, FeedCause::PipelineIncomplete)
        );
        assert_eq!(e.message, "run telonex:sync");
        let e = resolve_price_to_beat(
            s,
            win(),
            0,
            none,
            av(PtbStatus::UnavailableUpstreamHole, Some("hole")),
        )
        .unwrap_err();
        assert_eq!(e.cause, FeedCause::UpstreamHole);
        // Producer bugs: invalid_input feed_availability.
        for (g, a) in [
            (fed, None),
            (none, av(PtbStatus::Fed, None)),
            (GammaStrike::NotResolved, av(PtbStatus::Fed, None)),
            (fed, av(PtbStatus::AbsentPreSeriesEpoch, None)),
            (fed, av(PtbStatus::AbsentFreshMarketGrace, None)),
            (
                GammaStrike::NotResolved,
                av(PtbStatus::AbsentFreshMarketGrace, None),
            ),
            (none, av(PtbStatus::UnavailableUpstreamHole, None)),
            (none, av(PtbStatus::UnavailablePipelineIncomplete, Some(""))),
            (
                GammaStrike::Resolved {
                    price_to_beat: Some(f64::NAN),
                },
                av(PtbStatus::Fed, None),
            ),
        ] {
            let e = resolve_price_to_beat(s, win(), 0, g, a).unwrap_err();
            assert_eq!(e.cause, FeedCause::FeedAvailability, "{g:?} {a:?}");
        }
    }
}
