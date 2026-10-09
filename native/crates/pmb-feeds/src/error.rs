//! Feed error classes and causes (14 §10; vocabulary of 20 §4.1).

use std::fmt;

/// Error class (20 §4): decides the retry policy, never the result.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum ErrorClass {
    InvalidInput,
    Runtime,
    DataMissing,
    DataDefect,
}

impl ErrorClass {
    pub const fn as_str(self) -> &'static str {
        match self {
            ErrorClass::InvalidInput => "invalid_input",
            ErrorClass::Runtime => "runtime",
            ErrorClass::DataMissing => "data_missing",
            ErrorClass::DataDefect => "data_defect",
        }
    }
}

/// The subset of 20 §4.1 causes the feed layer raises (14 §10).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum FeedCause {
    /// `invalid_input`: a feed the input mode or v1 cannot supply.
    UnsupportedFeed,
    /// `invalid_input`: feed symbol not derivable or mismatched (14 §11.1).
    Symbol,
    /// `invalid_input`: window not derivable while feeds are requested.
    Window,
    /// `invalid_input`: `ModelConfig.feeds` invalid (14 F-46).
    ModelConfig,
    /// `invalid_input`: `feedAvailability` missing or inconsistent (14 §6.2).
    FeedAvailability,
    /// `runtime`: a day file fails to decode (day files carry no sha256).
    DecodeUnverified,
    /// `runtime`: an I/O error other than a missing file.
    Io,
    /// `data_missing`: a required day file is not on this host.
    DayFileMissing,
    /// `data_missing`: a day file's size differs from its `feedFiles` entry.
    IntegrityMismatch,
    /// `data_defect`: invalid rows or no rows up to the window end.
    Corrupt,
    /// `data_defect`: Chainlink window before the coverage floor (14 F-19).
    PreCoverage,
    /// `data_defect`: Chainlink hole (F-26) or price-to-beat upstream hole.
    UpstreamHole,
    /// `data_defect`: price-to-beat pipeline not caught up (14 §6.2).
    PipelineIncomplete,
}

impl FeedCause {
    pub const fn as_str(self) -> &'static str {
        match self {
            FeedCause::UnsupportedFeed => "unsupported_feed",
            FeedCause::Symbol => "symbol",
            FeedCause::Window => "window",
            FeedCause::ModelConfig => "model_config",
            FeedCause::FeedAvailability => "feed_availability",
            FeedCause::DecodeUnverified => "decode_unverified",
            FeedCause::Io => "io",
            FeedCause::DayFileMissing => "day_file_missing",
            FeedCause::IntegrityMismatch => "integrity_mismatch",
            FeedCause::Corrupt => "corrupt",
            FeedCause::PreCoverage => "pre_coverage",
            FeedCause::UpstreamHole => "upstream_hole",
            FeedCause::PipelineIncomplete => "pipeline_incomplete",
        }
    }

    /// The class each feed cause belongs to (14 §10 table).
    pub const fn class(self) -> ErrorClass {
        match self {
            FeedCause::UnsupportedFeed
            | FeedCause::Symbol
            | FeedCause::Window
            | FeedCause::ModelConfig
            | FeedCause::FeedAvailability => ErrorClass::InvalidInput,
            FeedCause::DecodeUnverified | FeedCause::Io => ErrorClass::Runtime,
            FeedCause::DayFileMissing | FeedCause::IntegrityMismatch => ErrorClass::DataMissing,
            FeedCause::Corrupt
            | FeedCause::PreCoverage
            | FeedCause::UpstreamHole
            | FeedCause::PipelineIncomplete => ErrorClass::DataDefect,
        }
    }
}

/// A classified feed failure; the market fails with it (14 F-4).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FeedError {
    pub cause: FeedCause,
    pub message: String,
}

impl FeedError {
    pub fn new(cause: FeedCause, message: impl Into<String>) -> FeedError {
        FeedError {
            cause,
            message: message.into(),
        }
    }

    #[inline]
    pub fn class(&self) -> ErrorClass {
        self.cause.class()
    }
}

/// Reason text `<class>: <cause>: <message>` (20 §4.2).
impl fmt::Display for FeedError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}: {}: {}",
            self.class().as_str(),
            self.cause.as_str(),
            self.message
        )
    }
}

impl std::error::Error for FeedError {}

#[cfg(test)]
mod tests {
    use super::*;

    // spec: 20 §4.2 (reason format), 14 §10 (class per cause)
    #[test]
    fn reason_text_and_classes() {
        let e = FeedError::new(FeedCause::UpstreamHole, "hole");
        assert_eq!(e.to_string(), "data_defect: upstream_hole: hole");
        assert_eq!(
            FeedCause::IntegrityMismatch.class(),
            ErrorClass::DataMissing
        );
        assert_eq!(FeedCause::DecodeUnverified.class(), ErrorClass::Runtime);
        assert_eq!(FeedCause::Symbol.class(), ErrorClass::InvalidInput);
    }
}
