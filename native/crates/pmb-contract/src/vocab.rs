//! Closed vocabularies of 21 §17 (and the error classes of 20 §4). Every
//! enum has exhaustive serde: an unknown value is a schema violation.

use std::fmt;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

macro_rules! closed_enum {
    (
        $(#[$meta:meta])*
        pub enum $name:ident { $( $(#[$vmeta:meta])* $variant:ident => $text:literal ),+ $(,)? }
    ) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema)]
        pub enum $name {
            $( $(#[$vmeta])* #[serde(rename = $text)] $variant ),+
        }

        impl $name {
            /// Every value, in declaration order.
            pub const ALL: &'static [$name] = &[$($name::$variant),+];

            /// The exact wire string.
            pub const fn as_str(self) -> &'static str {
                match self { $($name::$variant => $text),+ }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(self.as_str())
            }
        }
    };
}

closed_enum! {
    /// Native input modes (21 §17). `recorded` and `telonex-paired` are not
    /// native modes (20 §5.6).
    pub enum InputMode {
        TelonexDelta => "telonex-delta",
        RecorderV4 => "recorder-v4",
        Journal => "journal",
    }
}

closed_enum! {
    /// Execution profile (21 §17, 13 §7.2).
    pub enum Profile {
        TsCompat => "ts-compat",
        Realistic => "realistic",
    }
}

closed_enum! {
    /// Market outcome; also the `tokenIds` keys and `finalOutcome` (21 §17).
    pub enum Outcome {
        Up => "UP",
        Down => "DOWN",
    }
}

closed_enum! {
    /// Top-level `skipReason` of a market output (21 §13, §17).
    pub enum SkipReason {
        NoSlug => "no_slug",
        NoResolution => "no_resolution",
        UnresolvedOutcome => "unresolved_outcome",
        NoActivity => "no_activity",
        IncompleteCapture => "incomplete_capture",
    }
}

closed_enum! {
    /// `marketStats.skipReason` (MySQL enum, 21 §17).
    pub enum StatsSkipReason {
        NoInWindowActivity => "no_in_window_activity",
    }
}

closed_enum! {
    /// Tick causes: the `eventsByType` keys (21 §15, 12 §5.3).
    pub enum TickCause {
        Book => "book",
        PriceChange => "price_change",
        BinanceAggTrade => "binance_agg_trade",
        ChainlinkRound => "chainlink_round",
    }
}

closed_enum! {
    /// Error classes (20 §4; the only class list).
    pub enum ErrorClass {
        Runtime => "runtime",
        InvalidInput => "invalid_input",
        DataMissing => "data_missing",
        DataDefect => "data_defect",
        Timeout => "timeout",
        InvalidOutput => "invalid_output",
        StrategyFault => "strategy_fault",
        EngineFault => "engine_fault",
        /// `serve` only; shim-internal, never persisted.
        Canceled => "canceled",
        Killed => "killed",
    }
}

impl ErrorClass {
    /// Process exit code of the class (20 §4); `None` for `canceled`
    /// (no exit) and `killed` (a signal observed by the shim).
    pub const fn exit_code(self) -> Option<i32> {
        match self {
            ErrorClass::Runtime => Some(1),
            ErrorClass::InvalidInput => Some(2),
            ErrorClass::DataMissing => Some(3),
            ErrorClass::DataDefect => Some(4),
            ErrorClass::Timeout => Some(5),
            ErrorClass::InvalidOutput => Some(6),
            ErrorClass::StrategyFault => Some(7),
            ErrorClass::EngineFault => Some(8),
            ErrorClass::Canceled | ErrorClass::Killed => None,
        }
    }

    /// Classes a group-level error may have when it is raised before the
    /// job is read, so the result has no `echo` and no `market` (21 §10):
    /// a job that does not parse (`invalid_input`), an unreadable job file
    /// (`runtime`), or a caught panic (`engine_fault`). Every other class
    /// needs a read job.
    pub const fn may_precede_job_read(self) -> bool {
        matches!(
            self,
            ErrorClass::InvalidInput | ErrorClass::Runtime | ErrorClass::EngineFault
        )
    }

    /// Deterministic classes never burn retries (21 §14).
    pub const fn is_deterministic(self) -> bool {
        matches!(
            self,
            ErrorClass::InvalidInput
                | ErrorClass::DataDefect
                | ErrorClass::StrategyFault
                | ErrorClass::EngineFault
                | ErrorClass::InvalidOutput
                | ErrorClass::Killed
        )
    }
}

closed_enum! {
    /// `failure_class` column of failure rows (21 §14, 42 §3.6).
    pub enum FailureClass {
        Runtime => "runtime",
        InvalidInput => "invalid_input",
        DataMissing => "data_missing",
        DataDefect => "data_defect",
        Timeout => "timeout",
        InvalidOutput => "invalid_output",
        StrategyFault => "strategy_fault",
        EngineFault => "engine_fault",
        Killed => "killed",
        MarketSkip => "market_skip",
        MissingChildResult => "missing_child_result",
        InvalidMarketStats => "invalid_market_stats",
    }
}

impl FailureClass {
    /// The failure class of an error class; `None` for `canceled`, which is
    /// never persisted (21 §14).
    pub const fn from_error_class(c: ErrorClass) -> Option<Self> {
        Some(match c {
            ErrorClass::Runtime => FailureClass::Runtime,
            ErrorClass::InvalidInput => FailureClass::InvalidInput,
            ErrorClass::DataMissing => FailureClass::DataMissing,
            ErrorClass::DataDefect => FailureClass::DataDefect,
            ErrorClass::Timeout => FailureClass::Timeout,
            ErrorClass::InvalidOutput => FailureClass::InvalidOutput,
            ErrorClass::StrategyFault => FailureClass::StrategyFault,
            ErrorClass::EngineFault => FailureClass::EngineFault,
            ErrorClass::Killed => FailureClass::Killed,
            ErrorClass::Canceled => return None,
        })
    }
}

closed_enum! {
    /// Reject reason codes: the `RejectReason` enum of 10 §10.2, serialized
    /// as the text before `(` of today's TS strings (21 §17; the keys of
    /// `diagnostics.counters[].ordersRejected`). Equal to `pmb-core`'s
    /// `RejectReason::code()` values, engine origin first.
    pub enum RejectReasonCode {
        InvalidPrice => "invalid_price",
        InvalidSize => "invalid_size",
        UnknownOutcome => "missing_assetId",
        PostOnlyRequiresResting => "post_only_requires_gtc_or_gtd",
        GtdRequiresExpiry => "gtd_requires_expireAtMs",
        GtdExpiryTooSoon => "gtd_expireAtMs_too_soon",
        InsufficientCapital => "insufficient_capital",
        InsufficientInventory => "insufficient_inventory",
        RiskMaxOpenOrders => "risk_max_open_orders",
        RiskMaxOrderSize => "risk_max_order_size",
        RiskMaxAbsPosition => "risk_max_abs_position",
        RiskLossStop => "risk_loss_stop",
        BatchTooLarge => "batch_too_large",
        SelfCross => "self_cross",
        MetaTooLarge => "meta_too_large",
        StrategyHalted => "strategy_halted",
        KillSwitch => "kill_switch",
        InvalidTick => "invalid_tick",
        PriceOutOfBounds => "price_out_of_bounds",
        SizeBelowMinimum => "size_below_minimum",
        NotionalBelowMinimum => "notional_below_minimum",
        SizePrecision => "size_precision",
        AmountPrecision => "amount_precision",
        PostOnlyWouldCross => "post_only_would_cross",
        GtdLeadTooShort => "gtd_lead_too_short",
        MarketClosed => "market_closed",
        TradingRestricted => "trading_restricted",
        RateLimited => "rate_limited",
        InsufficientExchangeBalance => "insufficient_exchange_balance",
        NotFoundAfterAmbiguous => "not_found_after_ambiguous",
        Unmapped => "unmapped",
    }
}

closed_enum! {
    /// Rules provenance of a market (11 RS4).
    pub enum RulesSource {
        Snapshot => "snapshot",
        Partial => "partial",
        Fallback => "fallback",
    }
}

closed_enum! {
    /// Origin of a captured rules value (11 §13.1).
    pub enum RulesOrigin {
        Gamma => "gamma",
        Clob => "clob",
        V4Bootstrap => "v4_bootstrap",
        LiveGamma => "live_gamma",
        LiveClob => "live_clob",
    }
}

closed_enum! {
    /// Capture phase relative to the market start (11 §13.1).
    pub enum RulesPhase {
        PreStart => "pre_start",
        PostStart => "post_start",
    }
}

closed_enum! {
    /// Market exchange version (11 V1).
    pub enum MarketVersion {
        V1 => "v1",
        V2 => "v2",
    }
}

closed_enum! {
    /// `ModelConfig.rules.missingSnapshot` (11 §13.4; one value in v1).
    pub enum MissingSnapshot {
        DatedFallback => "dated_fallback",
    }
}

closed_enum! {
    /// Feed ids of `market.feedFiles` (21 §17).
    pub enum FeedId {
        BinanceAggTrades => "binance_agg_trades",
        ChainlinkCryptoPrices => "chainlink_crypto_prices",
    }
}

closed_enum! {
    /// `market.journal.replay` (15 §9, I-50).
    // D-PENDING: 15 §9 shows only "determinism"; chose a one-value enum
    // (`allowEngineMismatch` selects the what-if replay of I-51).
    pub enum JournalReplay {
        Determinism => "determinism",
    }
}

closed_enum! {
    /// Parity trace level (22 §3.2, 20 §5.4).
    pub enum TraceLevel {
        Decisions => "decisions",
        Feeds => "feeds",
    }
}

closed_enum! {
    /// `serve --qos` values (16 §10.2), echoed as `ready.qos.requested`.
    pub enum QosClass {
        UserInitiated => "user-initiated",
        Default => "default",
        Utility => "utility",
        Background => "background",
    }
}

closed_enum! {
    /// The thread QoS class read back after setting it (16 §10.2); a
    /// clamped process can report a class it did not request.
    // D-PENDING: 16 §10.2 lists only the requestable classes; chose to add
    // the other macOS classes (`user-interactive`, `unspecified`) for the
    // read-back value.
    pub enum EffectiveQos {
        UserInteractive => "user-interactive",
        UserInitiated => "user-initiated",
        Default => "default",
        Utility => "utility",
        Background => "background",
        Unspecified => "unspecified",
    }
}

closed_enum! {
    /// Group-level and candidate-level result status (21 §10).
    pub enum ResultStatus {
        Ok => "ok",
        Error => "error",
    }
}

closed_enum! {
    /// Input path taken by the reader (16 §7.5 NT-5), diagnostics only.
    pub enum InputPath {
        Tape => "tape",
        V1 => "v1",
    }
}

closed_enum! {
    /// Producer-resolved price-to-beat availability (14 §6.2).
    pub enum PriceToBeatStatus {
        Fed => "fed",
        AbsentPreSeriesEpoch => "absent_pre_series_epoch",
        AbsentFreshMarketGrace => "absent_fresh_market_grace",
        UnavailablePipelineIncomplete => "unavailable_pipeline_incomplete",
        UnavailableUpstreamHole => "unavailable_upstream_hole",
    }
}

closed_enum! {
    /// `ModelConfig.execution.models.latency` (13 §7.3).
    pub enum LatencyModel {
        Exact => "exact",
        Compat => "compat",
    }
}

closed_enum! {
    /// `ModelConfig.execution.models.fee` (13 §7.3).
    pub enum FeeModel {
        Schedule => "schedule",
        Flat700Bps4Dp => "flat_700bps_4dp",
    }
}

closed_enum! {
    /// `ModelConfig.execution.models.takerDelay` (13 §7.3).
    pub enum TakerDelayModel {
        On => "on",
        Off => "off",
    }
}

closed_enum! {
    /// `ModelConfig.execution.models.depletion` (13 §7.3).
    pub enum DepletionModel {
        PersistentDeficit => "persistent_deficit",
        ResetOnUpdate => "reset_on_update",
        None => "none",
    }
}

closed_enum! {
    /// `ModelConfig.execution.models.maker` (13 §7.3).
    pub enum MakerModel {
        Queue => "queue",
        TradeThrough => "trade_through",
        WorstQueue => "worst_queue",
    }
}

closed_enum! {
    /// `ModelConfig.execution.models.reports` (13 §7.3).
    pub enum ReportsModel {
        Settlement => "settlement",
        Compat => "compat",
    }
}

closed_enum! {
    /// `ModelConfig.execution.cancelBeforeAck` (13 §7.3; realistic, M3b).
    pub enum CancelBeforeAck {
        DeferUntilAck => "defer_until_ack",
        Immediate => "immediate",
    }
}

closed_enum! {
    /// `ModelConfig.execution.sellGate` (13 §7.3; realistic, M3b).
    pub enum SellGate {
        Matched => "Matched",
        Mined => "Mined",
        Confirmed => "Confirmed",
    }
}

closed_enum! {
    /// `ModelConfig.execution.makerQueue.prints` (13 §7.3; realistic, M3b).
    pub enum MakerQueuePrints {
        Auto => "auto",
        Off => "off",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_strings_round_trip_and_unknowns_fail() {
        for v in ErrorClass::ALL {
            let s = serde_json::to_string(v).unwrap();
            assert_eq!(s, format!("\"{}\"", v.as_str()));
            assert_eq!(serde_json::from_str::<ErrorClass>(&s).unwrap(), *v);
        }
        assert!(serde_json::from_str::<Profile>("\"Realistic\"").is_err());
        assert!(serde_json::from_str::<InputMode>("\"recorded\"").is_err());
        // A superseded class name (20 §4.4), built at run time so the drift
        // guard never sees it in source.
        let superseded = format!("\"{}_{}\"", "input", "invalid");
        assert!(serde_json::from_str::<ErrorClass>(&superseded).is_err());
        assert!(serde_json::from_str::<RejectReasonCode>("\"insufficient_capital\"").is_ok());
        assert!(serde_json::from_str::<RejectReasonCode>(
            "\"insufficient_capital(required=1,available=0)\""
        )
        .is_err());
        assert_eq!(FailureClass::from_error_class(ErrorClass::Canceled), None);
        assert_eq!(ErrorClass::DataDefect.exit_code(), Some(4));
    }
}
