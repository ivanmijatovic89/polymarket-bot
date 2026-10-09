//! `EngineResult` and `EngineMarketOutput`, the binary output (21 §10-§16).

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::job::{CANDIDATE_KEY_PATTERN, SLUG_PATTERN};
use crate::model_config::RULES_TABLE_VERSION_PATTERN;
use crate::num::{Decimal, OutDec2, OutDec4, SafeI64, SafeU64, Sha256Hex};
use crate::support::{ContractError, Version};
use crate::vocab::{
    ErrorClass, FailureClass, InputPath, Outcome, Profile, RejectReasonCode, ResultStatus,
    RulesSource, SkipReason, StatsSkipReason, TickCause,
};

/// Version of the `EngineResult` schema (`outputSchemaVersion`, 20 §3).
pub const OUTPUT_SCHEMA_VERSION: u32 = 1;

/// Pattern of `engineVersion` (semver, 20 §3).
pub const SEMVER_PATTERN: &str =
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$";

/// Pattern of an error cause (20 §4.1).
pub const CAUSE_PATTERN: &str = r"^[a-z][a-z0-9_]{0,47}$";

/// 21 §16 caps.
pub const ORDER_META_MAX_BYTES: usize = 16 * 1024;
pub const INTENT_META_MAX_BYTES: usize = 1024 * 1024;
pub const INTENT_META_MAX_ENTRIES: usize = 10_000;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineResult {
    pub output_schema_version: Version<OUTPUT_SCHEMA_VERSION>,
    /// Group-level status.
    pub status: ResultStatus,
    /// Present iff `status` is `error`.
    #[serde(deserialize_with = "crate::support::nullable")]
    pub error: Option<ErrorInfo>,
    /// Null only in a group-level error of a class that can be raised
    /// before the job is read ([`ErrorClass::may_precede_job_read`]);
    /// `echo` and `market` are null together.
    // D-PENDING: 21 §10 does not say what `echo` and `market` hold in a
    // group-level error raised before the job was parsed; chose null there,
    // limited to the classes `invalid_input`, `runtime` and `engine_fault`
    // (every other class needs a read job), and both are required otherwise.
    #[serde(deserialize_with = "crate::support::nullable")]
    pub echo: Option<Echo>,
    /// Null together with `echo` (see there).
    #[serde(deserialize_with = "crate::support::nullable")]
    pub market: Option<MarketEcho>,
    pub candidates: Vec<CandidateResult>,
    /// sha256 of the serialized deterministic section (every field except
    /// `diagnostics`).
    pub result_digest: Sha256Hex,
    pub diagnostics: Diagnostics,
}

/// Echo of the request for the shim's assertions (21 §12).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Echo {
    /// Engine crate semver (20 §3).
    #[schemars(regex(pattern = SEMVER_PATTERN))]
    pub engine_version: String,
    /// 40-hex source commit (20 §3).
    #[schemars(regex(pattern = r"^[0-9a-f]{40}$"))]
    pub engine_commit: String,
    #[schemars(length(min = 1))]
    pub strategy_id: String,
    #[schemars(range(min = 1))]
    pub job_schema_version: u32,
    pub profile: Profile,
    pub seed: SafeU64,
    pub model_config_sha256: Sha256Hex,
    /// Copied from `modelConfig.rules` (21 §10).
    #[schemars(regex(pattern = RULES_TABLE_VERSION_PATTERN))]
    pub rules_table_version: String,
    /// Copied from `market.rules` (21 §10).
    #[serde(deserialize_with = "crate::support::nullable")]
    #[schemars(range(min = 1))]
    pub snapshot_parser_version: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketEcho {
    #[schemars(regex(pattern = SLUG_PATTERN))]
    pub slug: String,
    /// Market id of the first counted tick; null when there was none.
    #[serde(deserialize_with = "crate::support::nullable")]
    #[schemars(length(min = 1, max = 255))]
    pub condition_id: Option<String>,
    pub rules_source: RulesSource,
}

/// One candidate's result: `output` iff `status = ok`, `error` iff
/// `status = error` (checked by [`CandidateResult::validate`]).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateResult {
    #[schemars(regex(pattern = CANDIDATE_KEY_PATTERN))]
    pub key: String,
    pub index: u32,
    pub status: ResultStatus,
    /// Hash of this candidate's effective ModelConfig (21 §1.1).
    pub model_config_sha256: Sha256Hex,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "EngineMarketOutput")]
    pub output: Option<EngineMarketOutput>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "ErrorInfo")]
    pub error: Option<ErrorInfo>,
}

/// `RunSingleMarketOutput` minus `idx` and `durationMs` (21 §11).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineMarketOutput {
    #[schemars(regex(pattern = SLUG_PATTERN))]
    pub slug: String,
    /// Null for the null-stats rows of 21 §13.
    #[serde(deserialize_with = "crate::support::nullable")]
    pub market_stats: Option<EngineMarketStats>,
    pub events_processed: SafeU64,
    pub events_by_type: EventsByType,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "SkipReason")]
    pub skip_reason: Option<SkipReason>,
    /// 1..32 non-empty strings of at most 512 characters (21 §13).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(length(min = 1, max = 32), inner(length(min = 1, max = 512)))]
    #[schemars(with = "Vec<String>")]
    pub coverage_reasons: Option<Vec<String>>,
}

/// Counted ticks per cause (21 §15). Absent keys are zero. Values are
/// integers >= 0; the engine emits the canonical form, which omits unseen
/// causes as TS does ([`EventsByType::from_counts`]), and accepts an
/// explicit 0 on input as 21 §15 allows.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EventsByType {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "SafeU64")]
    pub book: Option<SafeU64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "SafeU64")]
    pub price_change: Option<SafeU64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "SafeU64")]
    pub binance_agg_trade: Option<SafeU64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "SafeU64")]
    pub chainlink_round: Option<SafeU64>,
}

impl EventsByType {
    /// Builds the canonical form from the engine's fixed array, indexed by
    /// `TickCause::ALL` order.
    pub fn from_counts(counts: [u64; 4]) -> Option<Self> {
        let f = |c: u64| {
            if c == 0 {
                Some(None)
            } else {
                SafeU64::new(c).map(Some)
            }
        };
        Some(EventsByType {
            book: f(counts[0])?,
            price_change: f(counts[1])?,
            binance_agg_trade: f(counts[2])?,
            chainlink_round: f(counts[3])?,
        })
    }

    pub fn get(&self, cause: TickCause) -> u64 {
        let v = match cause {
            TickCause::Book => self.book,
            TickCause::PriceChange => self.price_change,
            TickCause::BinanceAggTrade => self.binance_agg_trade,
            TickCause::ChainlinkRound => self.chainlink_round,
        };
        v.map_or(0, SafeU64::get)
    }

    pub fn total(&self) -> u64 {
        TickCause::ALL.iter().map(|c| self.get(*c)).sum()
    }
}

/// `MarketStats` without `execution` and `recorderV4Capture` (21 §11).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineMarketStats {
    #[schemars(length(min = 1, max = 255))]
    pub market_id: String,
    #[schemars(regex(pattern = SLUG_PATTERN))]
    pub slug: String,
    pub final_outcome: Outcome,
    /// |x| < 1e10 (21 §11).
    // D-PENDING: 21 §18 N6 names a custom `columnRange` keyword without a
    // form; chose the standard minimum/maximum keywords, which compare
    // these bounds exactly, and keep `decimalScale` as the only custom one.
    #[schemars(extend("exclusiveMinimum" = -10_000_000_000_i64, "exclusiveMaximum" = 10_000_000_000_i64))]
    pub pnl: OutDec2,
    #[schemars(range(max = 2_147_483_647))]
    pub trade_count: u32,
    #[schemars(range(max = 2_147_483_647))]
    pub trade_as_maker: u32,
    #[schemars(range(max = 2_147_483_647))]
    pub trade_as_taker: u32,
    #[schemars(extend("minimum" = 0, "exclusiveMaximum" = 10_000_000_000_i64))]
    pub fees_paid: OutDec2,
    /// BUY VWAP; null iff that outcome has no BUY fill (21 §11).
    #[serde(deserialize_with = "crate::support::nullable")]
    #[schemars(extend("exclusiveMinimum" = 0, "exclusiveMaximum" = 1))]
    pub avg_entry_price_up: Option<OutDec4>,
    #[serde(deserialize_with = "crate::support::nullable")]
    #[schemars(extend("exclusiveMinimum" = 0, "exclusiveMaximum" = 1))]
    pub avg_entry_price_down: Option<OutDec4>,
    #[schemars(extend("minimum" = 0, "exclusiveMaximum" = 1_000_000_000_000_u64))]
    pub up_shares: OutDec2,
    #[schemars(extend("minimum" = 0, "exclusiveMaximum" = 1_000_000_000_000_u64))]
    pub down_shares: OutDec2,
    #[schemars(extend("minimum" = 0, "exclusiveMaximum" = 1_000_000_000_000_u64))]
    pub mergable_shares: OutDec2,
    #[schemars(extend("exclusiveMinimum" = -10_000_000_000_i64, "exclusiveMaximum" = 10_000_000_000_i64))]
    pub cost: OutDec2,
    #[schemars(extend("minimum" = 0, "exclusiveMaximum" = 10_000_000_000_i64))]
    pub split_cost: OutDec2,
    /// Opaque strategy meta objects (21 §16).
    pub intent_meta: Vec<Map<String, Value>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "StatsSkipReason")]
    pub skip_reason: Option<StatsSkipReason>,
    /// Object in realistic, null in ts-compat (11 §13.8). Absent only on
    /// TS-engine rows, which are not engine output.
    #[serde(deserialize_with = "crate::support::nullable")]
    pub rules: Option<MarketStatsRules>,
}

/// Per-market rules provenance (11 §13.8). Values of `feeEra`, `feeCurve`,
/// `feeSource` and rule ids come from the run's rule table (11 VR2).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketStatsRules {
    pub source: RulesSource,
    #[schemars(regex(pattern = RULES_TABLE_VERSION_PATTERN))]
    pub rules_table_version: String,
    #[serde(deserialize_with = "crate::support::nullable")]
    #[schemars(range(min = 1))]
    pub snapshot_parser_version: Option<u32>,
    pub fee_era: String,
    pub fee_curve: String,
    pub fee_source: String,
    /// Sorted, unique.
    pub unverified_rules: Vec<String>,
}

/// `ErrorInfo` (21 §10).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ErrorInfo {
    pub class: ErrorClass,
    #[schemars(regex(pattern = CAUSE_PATTERN))]
    pub cause: String,
    /// One line, at most 1,000 characters.
    #[schemars(length(max = 1000), regex(pattern = r"^[^\n\r]*$"))]
    pub message: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "ErrorDetail")]
    pub detail: Option<ErrorDetail>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ErrorDetail {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "String")]
    pub callback: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "SafeU64")]
    pub seq: Option<SafeU64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "SafeU64")]
    pub ts_ms: Option<SafeU64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "String")]
    pub location: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "String")]
    pub path: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "String")]
    pub fix_command: Option<String>,
}

impl ErrorInfo {
    pub fn validate(&self) -> Result<(), ContractError> {
        let cause_ok = {
            let b = self.cause.as_bytes();
            !b.is_empty()
                && b.len() <= 48
                && b[0].is_ascii_lowercase()
                && b.iter()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_')
        };
        if !cause_ok {
            return Err(ContractError::invalid_output(
                "schema",
                format!("bad cause {:?}", self.cause),
            ));
        }
        if self.message.chars().count() > 1000 || self.message.contains(['\n', '\r']) {
            return Err(ContractError::invalid_output(
                "schema",
                "message must be one line <= 1000 chars",
            ));
        }
        Ok(())
    }

    /// `backtest_run_failures.reason` text (20 §4.2).
    pub fn reason_text(&self) -> String {
        format!("{}: {}: {}", self.class, self.cause, self.message)
    }
}

/// A failure row's classified columns (21 §14, 42 §3.6).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FailureRow {
    pub failure_class: FailureClass,
    /// The cause (`failure_detail`), or the skip reason for `market_skip`.
    pub failure_detail: String,
    pub reason: String,
}

impl FailureRow {
    /// Row for a native error; `None` for `canceled` (never persisted).
    pub fn from_error(e: &ErrorInfo) -> Option<Self> {
        Some(FailureRow {
            failure_class: FailureClass::from_error_class(e.class)?,
            failure_detail: e.cause.clone(),
            reason: e.reason_text(),
        })
    }

    /// Row for a null-`marketStats` market (21 §13; reason texts as
    /// `aggregateProcessor.ts` `nullMarketStatsReason`).
    pub fn market_skip(skip: SkipReason, coverage_reasons: &[String]) -> Self {
        let reason = match skip {
            SkipReason::IncompleteCapture => format!("incomplete_capture: {}", coverage_reasons.join("; ")),
            SkipReason::UnresolvedOutcome => {
                "unresolved_outcome: market has no final outcome/result_id, so PnL cannot be computed".into()
            }
            SkipReason::NoResolution => {
                "no_resolution: market token map or resolution data was unavailable".into()
            }
            SkipReason::NoSlug => "no_slug: could not parse market slug from input file path".into(),
            SkipReason::NoActivity => "no_market_stats: no_activity".into(),
        };
        FailureRow {
            failure_class: FailureClass::MarketSkip,
            failure_detail: skip.as_str().into(),
            reason,
        }
    }
}

/// Machine-dependent metrics; never compared, never persisted (21 §10).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Diagnostics {
    pub started_at_ms: SafeU64,
    pub finished_at_ms: SafeU64,
    pub wall_ms: SafeU64,
    pub busy_ms: SafeU64,
    pub cpu_ms: SafeU64,
    pub peak_rss_bytes: SafeU64,
    pub thread: u32,
    pub cache: CacheStats,
    /// Final exchange-time skew (12 §4.4 XT4); null without market events.
    #[serde(deserialize_with = "crate::support::nullable")]
    pub skew_ms: Option<SafeI64>,
    pub input_path: InputPath,
    /// Data-anomaly, rules, engine and attribution counters under their
    /// owners' names (15 §8, 10, 11, 12, 13 §7.2); zero counters may be
    /// omitted. Values are counts or count-by-reason maps.
    pub anomalies: BTreeMap<String, AnomalyValue>,
    pub counters: Vec<CandidateCounters>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CacheStats {
    pub hits: SafeU64,
    pub misses: SafeU64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum AnomalyValue {
    Count(SafeU64),
    ByReason(BTreeMap<String, SafeU64>),
}

/// Capital-aware counters per candidate (21 §10).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateCounters {
    pub key: String,
    pub orders_placed: SafeU64,
    /// Keyed by reject reason code (the text before `(`; a closed
    /// vocabulary, 21 §17, 10 §10.2).
    pub orders_rejected: BTreeMap<RejectReasonCode, SafeU64>,
    pub orders_canceled: SafeU64,
    pub buy_notional_usdc: Decimal,
    pub sell_notional_usdc: Decimal,
    pub peak_reserved_usdc: Decimal,
    pub strategy_ticks_skipped: SafeU64,
}

fn bad(field: &str, why: impl std::fmt::Display) -> ContractError {
    ContractError::invalid_output("self_check", format!("{field}: {why}"))
}

/// An `io::Write` that counts bytes and fails as soon as they exceed
/// `cap`, so a size check never builds the serialized buffer (R8).
struct CappedCounter {
    bytes: usize,
    cap: usize,
}

impl std::io::Write for CappedCounter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.bytes += buf.len();
        if self.bytes > self.cap {
            return Err(std::io::Error::other("cap exceeded"));
        }
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// True when the compact serialization of `v` is at most `cap` bytes.
fn serialized_within<T: Serialize + ?Sized>(v: &T, cap: usize) -> bool {
    serde_json::to_writer(&mut CappedCounter { bytes: 0, cap }, v).is_ok()
}

/// 21 §16 per-market caps; `Err(cause)` is `intent_meta_limit`.
pub fn check_intent_meta_caps(meta: &[Map<String, Value>]) -> Result<(), &'static str> {
    if meta.len() > INTENT_META_MAX_ENTRIES || !serialized_within(meta, INTENT_META_MAX_BYTES) {
        return Err("intent_meta_limit");
    }
    Ok(())
}

/// 21 §16 per-order cap; `false` means reject reason `meta_too_large`.
pub fn order_meta_within_cap(meta: &Map<String, Value>) -> bool {
    serialized_within(meta, ORDER_META_MAX_BYTES)
}

/// 21 §18 N1/N2 inside opaque meta: no `-0` and no integer beyond
/// ±(2^53 − 1). serde_json values cannot hold NaN or infinities, and a
/// strategy float `-0.0` would be emitted as `-0.0`. The engine maps `-0.0`
/// to `0` when it builds meta ([`normalize_negative_zero`], as
/// `JSON.stringify` does); an unsafe integer is a strategy contract breach.
pub fn check_meta_numbers(v: &Value) -> Result<(), &'static str> {
    match v {
        Value::Number(n) => {
            if let Some(f) = n.as_f64().filter(|_| n.is_f64()) {
                if f == 0.0 && f.is_sign_negative() {
                    return Err("-0 (21 §18 N1)");
                }
            } else if n.as_u64().is_some_and(|u| u > crate::num::MAX_SAFE_INTEGER)
                || n.as_i64()
                    .is_some_and(|i| i.unsigned_abs() > crate::num::MAX_SAFE_INTEGER)
            {
                return Err("integer beyond ±(2^53-1) (21 §18 N2)");
            }
            Ok(())
        }
        Value::Array(a) => a.iter().try_for_each(check_meta_numbers),
        Value::Object(m) => m.values().try_for_each(check_meta_numbers),
        Value::Null | Value::Bool(_) | Value::String(_) => Ok(()),
    }
}

/// Maps every `-0.0` inside `v` to `0`, as `JSON.stringify` renders `-0`
/// (21 §16, §18 N1). For the engine when it builds an order's meta.
pub fn normalize_negative_zero(v: &mut Value) {
    match v {
        Value::Number(n) => {
            if n.as_f64().is_some_and(|f| f == 0.0 && f.is_sign_negative()) && n.is_f64() {
                *v = Value::from(0);
            }
        }
        Value::Array(a) => a.iter_mut().for_each(normalize_negative_zero),
        Value::Object(m) => m.values_mut().for_each(normalize_negative_zero),
        Value::Null | Value::Bool(_) | Value::String(_) => {}
    }
}

impl EngineMarketOutput {
    /// Egress self-check of 21 §19 for one candidate output. A failure is
    /// `invalid_output: self_check` (engine bug).
    pub fn self_check(&self) -> Result<(), ContractError> {
        if self.events_by_type.total() != self.events_processed.get() {
            return Err(bad("eventsByType", "does not sum to eventsProcessed"));
        }
        if let Some(r) = &self.coverage_reasons {
            if r.is_empty()
                || r.len() > 32
                || r.iter().any(|s| s.is_empty() || s.chars().count() > 512)
            {
                return Err(bad(
                    "coverageReasons",
                    "1..32 non-empty strings of <= 512 chars",
                ));
            }
        }
        if self.coverage_reasons.is_some()
            && self.skip_reason != Some(SkipReason::IncompleteCapture)
        {
            return Err(bad(
                "coverageReasons",
                "only with skipReason incomplete_capture",
            ));
        }
        if let Some(s) = &self.market_stats {
            if s.slug != self.slug {
                return Err(bad("marketStats.slug", "differs from output slug"));
            }
            // 21 §13: every row with stats had a counted tick (no counted
            // tick at all is the null-stats `no_activity` case).
            if self.events_processed.get() == 0 {
                return Err(bad("marketStats", "stats need at least one counted tick"));
            }
            s.self_check()?;
        }
        // 21 §13 taxonomy, engine-decided rows only (no_slug, no_resolution
        // and unresolved_outcome are TS short-circuits and never engine
        // output).
        match (&self.market_stats, self.skip_reason) {
            (Some(s), None) => {
                if s.skip_reason.is_some() {
                    return Err(bad(
                        "marketStats.skipReason",
                        "an activity row has no skipReason",
                    ));
                }
            }
            (Some(s), Some(SkipReason::NoActivity)) => {
                if s.skip_reason != Some(StatsSkipReason::NoInWindowActivity) {
                    return Err(bad("skipReason", "zero row needs marketStats.skipReason"));
                }
                if s.trade_count != 0 || s.up_shares.units() != 0 || s.down_shares.units() != 0 {
                    return Err(bad(
                        "marketStats",
                        "a zero row has no fills and no UP/DOWN quantity",
                    ));
                }
            }
            (None, Some(SkipReason::NoActivity)) => {
                if self.events_processed.get() != 0 {
                    return Err(bad("marketStats", "null with counted ticks"));
                }
            }
            (None, Some(SkipReason::IncompleteCapture)) => {
                if self.coverage_reasons.is_none() {
                    return Err(bad("coverageReasons", "required for incomplete_capture"));
                }
            }
            (stats, skip) => {
                return Err(bad(
                    "skipReason",
                    format!(
                        "invalid combination (stats present: {}, skip: {skip:?})",
                        stats.is_some()
                    ),
                ))
            }
        }
        Ok(())
    }
}

impl EngineMarketStats {
    /// Ranges and identities of 21 §11 at the persisted precision.
    pub fn self_check(&self) -> Result<(), ContractError> {
        const E10_2DP: i64 = 1_000_000_000_000; // 1e10 at 2 dp
        const E12_2DP: i64 = 100_000_000_000_000; // 1e12 at 2 dp
        if !crate::support::is_char_len_within(&self.market_id, 1, 255) {
            return Err(bad("marketId", "must be 1..255 characters"));
        }
        if self.trade_count > i32::MAX as u32 {
            return Err(bad("tradeCount", "above 2^31-1"));
        }
        if u64::from(self.trade_as_maker) + u64::from(self.trade_as_taker)
            != u64::from(self.trade_count)
        {
            return Err(bad("tradeAsMaker + tradeAsTaker", "!= tradeCount"));
        }
        for (n, v) in [("pnl", self.pnl), ("cost", self.cost)] {
            if v.units().abs() >= E10_2DP {
                return Err(bad(n, "|x| >= 1e10"));
            }
        }
        for (n, v) in [("feesPaid", self.fees_paid), ("splitCost", self.split_cost)] {
            if v.units() < 0 || v.units() >= E10_2DP {
                return Err(bad(n, "outside [0, 1e10)"));
            }
        }
        for (n, v) in [
            ("upShares", self.up_shares),
            ("downShares", self.down_shares),
            ("mergableShares", self.mergable_shares),
        ] {
            if v.units() < 0 || v.units() >= E12_2DP {
                return Err(bad(n, "outside [0, 1e12)"));
            }
        }
        if self.mergable_shares != self.up_shares.min(self.down_shares) {
            return Err(bad("mergableShares", "!= min(upShares, downShares)"));
        }
        for (n, v) in [
            ("avgEntryPriceUp", self.avg_entry_price_up),
            ("avgEntryPriceDown", self.avg_entry_price_down),
        ] {
            if let Some(p) = v {
                if p.units() <= 0 || p.units() >= 10_000 {
                    return Err(bad(n, "outside (0, 1)"));
                }
            }
        }
        if let Some(r) = &self.rules {
            let sorted = r.unverified_rules.windows(2).all(|w| w[0] < w[1]);
            if !sorted {
                return Err(bad("rules.unverifiedRules", "must be sorted and unique"));
            }
        }
        if check_intent_meta_caps(&self.intent_meta).is_err() {
            return Err(bad("intentMeta", "above the 21 §16 caps"));
        }
        for m in &self.intent_meta {
            m.values()
                .try_for_each(check_meta_numbers)
                .map_err(|why| bad("intentMeta", why))?;
        }
        Ok(())
    }
}

impl CandidateResult {
    pub fn validate(&self) -> Result<(), ContractError> {
        if !crate::job::is_candidate_key(&self.key) {
            return Err(bad("candidates[].key", "outside the key pattern"));
        }
        match (self.status, &self.output, &self.error) {
            (ResultStatus::Ok, Some(o), None) => o.self_check(),
            (ResultStatus::Error, None, Some(e)) => {
                e.validate()?;
                // 21 §13, §14; 20 §4.3: only a strategy fault fails one
                // candidate; every other class, and `result_too_large`
                // (raised by the shim, 41 §6.2), fails the job.
                if e.class != ErrorClass::StrategyFault || e.cause == "result_too_large" {
                    return Err(bad(
                        "candidates[].error",
                        format!("{}: {} is not a candidate-level error", e.class, e.cause),
                    ));
                }
                Ok(())
            }
            _ => Err(bad("candidate", "output iff ok, error iff error")),
        }
    }
}

impl EngineResult {
    /// Rust reading of a result (parity tooling, fixtures): strict
    /// deserialization (`invalid_output: schema`), then [`Self::validate`]
    /// (`invalid_output: self_check`).
    pub fn parse(text: &str) -> Result<EngineResult, ContractError> {
        let r: EngineResult = serde_json::from_str(text)
            .map_err(|e| ContractError::invalid_output("schema", e.to_string()))?;
        r.validate()?;
        Ok(r)
    }

    /// Egress self-check of 21 §19 for the whole result: §10 structure,
    /// echo and rules-provenance consistency (11 §13.8), every candidate's
    /// §11-§16 checks, and `resultDigest` (§10, 20 G5). A failure is `invalid_output: self_check`
    /// (an `ErrorInfo` outside its pattern is `invalid_output: schema`).
    pub fn validate(&self) -> Result<(), ContractError> {
        match (self.status, &self.error) {
            (ResultStatus::Ok, None) => {}
            (ResultStatus::Error, Some(e)) => e.validate()?,
            _ => return Err(bad("error", "present iff status is error")),
        }
        if self.echo.is_some() != self.market.is_some() {
            return Err(bad("echo/market", "null together or present together"));
        }
        if self.echo.is_none()
            && !self
                .error
                .as_ref()
                .is_some_and(|e| e.class.may_precede_job_read())
        {
            return Err(bad(
                "echo/market",
                "null only in a group-level error raised before the job is read",
            ));
        }
        // 21 §14: a group-level error fails the market for every candidate.
        if self.status == ResultStatus::Error
            && self.candidates.iter().any(|c| c.status == ResultStatus::Ok)
        {
            return Err(bad("candidates", "an ok candidate in a group-level error"));
        }
        if let Some(e) = &self.echo {
            e.validate()?;
        }
        if let Some(m) = &self.market {
            if crate::job::slug_window(&m.slug).is_none() {
                return Err(bad("market.slug", "outside the v1 slug universe"));
            }
            if m.condition_id
                .as_ref()
                .is_some_and(|c| !crate::support::is_char_len_within(c, 1, 255))
            {
                return Err(bad("market.conditionId", "must be 1..255 characters"));
            }
        }
        let mut keys = std::collections::BTreeSet::new();
        for (i, c) in self.candidates.iter().enumerate() {
            if c.index as usize != i {
                return Err(bad("candidates", "indices must be 0..N-1 in order"));
            }
            if !keys.insert(c.key.as_str()) {
                return Err(bad("candidates", "duplicate key"));
            }
            c.validate()?;
            // 21 §11: every output's slug equals market.slug, null-stats
            // outputs included, so a failure row lands on the right market.
            if let (Some(o), Some(m)) = (&c.output, &self.market) {
                if o.slug != m.slug {
                    return Err(bad("candidates[].output.slug", "differs from market.slug"));
                }
            }
            let Some(stats) = c.output.as_ref().and_then(|o| o.market_stats.as_ref()) else {
                continue;
            };
            if let Some(m) = &self.market {
                // 21 §10, §11: stats imply a counted tick, which set
                // market.conditionId; marketId is that same id (D69 A-17).
                match &m.condition_id {
                    Some(cid) if &stats.market_id == cid => {}
                    Some(_) => {
                        return Err(bad(
                            "marketStats.marketId",
                            "differs from market.conditionId",
                        ))
                    }
                    None => {
                        return Err(bad(
                            "market.conditionId",
                            "null although a candidate has marketStats",
                        ))
                    }
                }
            }
            if let (Some(e), Some(m)) = (&self.echo, &self.market) {
                match (e.profile, &stats.rules) {
                    (Profile::TsCompat, None) => {}
                    (Profile::TsCompat, Some(_)) => {
                        return Err(bad(
                            "marketStats.rules",
                            "must be null in ts-compat (11 §13.8)",
                        ))
                    }
                    (Profile::Realistic, None) => {
                        return Err(bad("marketStats.rules", "required in realistic (11 §13.8)"))
                    }
                    (Profile::Realistic, Some(r)) => {
                        if r.source != m.rules_source
                            || r.rules_table_version != e.rules_table_version
                            || r.snapshot_parser_version != e.snapshot_parser_version
                        {
                            return Err(bad(
                                "marketStats.rules",
                                "source, rulesTableVersion and snapshotParserVersion must equal the echo",
                            ));
                        }
                    }
                }
            }
        }
        // Last, so a specific violation above is reported first.
        let digest = self.compute_digest().map_err(|e| bad("resultDigest", e))?;
        if digest != self.result_digest {
            return Err(bad(
                "resultDigest",
                format!("does not match the deterministic section ({digest})"),
            ));
        }
        Ok(())
    }
}

impl EngineResult {
    /// Egress self-check against the job that produced the result (21 §19
    /// Rust egress; the same facts the shim asserts in §12): the echo
    /// equals the request, `market.slug` and every `finalOutcome` equal the
    /// job's, and the candidates match the request's keys, indices and
    /// effective ModelConfig hashes, in order. A mismatch is an engine bug:
    /// `invalid_output: self_check`.
    pub fn validate_against(&self, job: &crate::job::EngineJob) -> Result<(), ContractError> {
        self.validate()?;
        let mc = &job.run.model_config;
        let (Some(echo), Some(market)) = (&self.echo, &self.market) else {
            return Ok(()); // group-level error before the job was read (§10)
        };
        let sha = mc.sha256().map_err(|e| bad("echo.modelConfigSha256", e))?;
        let checks = [
            ("echo.profile", echo.profile == mc.profile),
            ("echo.seed", echo.seed == mc.seed),
            (
                "echo.rulesTableVersion",
                echo.rules_table_version == mc.rules.rules_table_version,
            ),
            (
                "echo.snapshotParserVersion",
                echo.snapshot_parser_version == job.market.rules.snapshot_parser_version,
            ),
            ("echo.modelConfigSha256", echo.model_config_sha256 == sha),
            ("echo.strategyId", echo.strategy_id == job.run.strategy_id),
            (
                "echo.jobSchemaVersion",
                echo.job_schema_version == crate::job::JOB_SCHEMA_VERSION,
            ),
            ("market.slug", market.slug == job.market.slug),
            // 11 RS4: `fallback` iff no field is captured.
            (
                "market.rulesSource",
                job.market.rules.captured.is_empty()
                    == (market.rules_source == RulesSource::Fallback),
            ),
            // 21 §5.1: a job conditionId equals the observed one (else the
            // engine fails `data_defect: foreign_file`).
            (
                "market.conditionId",
                match (&job.market.condition_id, &market.condition_id) {
                    (Some(want), Some(got)) => want == got,
                    _ => true,
                },
            ),
        ];
        for (field, ok) in checks {
            if !ok {
                return Err(bad(field, "differs from the job"));
            }
        }
        if self.status == ResultStatus::Error && self.candidates.is_empty() {
            return Ok(());
        }
        if self.candidates.len() != job.run.candidates.len() {
            return Err(bad("candidates", "count differs from the job"));
        }
        for (got, want) in self.candidates.iter().zip(&job.run.candidates) {
            let eff = mc
                .effective(want.execution.as_ref())
                .sha256()
                .map_err(|e| bad("candidates[].modelConfigSha256", e))?;
            if got.key != want.key || got.index != want.index || got.model_config_sha256 != eff {
                return Err(bad(
                    "candidates[]",
                    format!("{:?} does not match the job's candidate", got.key),
                ));
            }
            let stats = got.output.as_ref().and_then(|o| o.market_stats.as_ref());
            if stats.is_some_and(|s| s.final_outcome != job.market.outcome) {
                return Err(bad(
                    "marketStats.finalOutcome",
                    "differs from market.outcome",
                ));
            }
        }
        Ok(())
    }
}

impl Echo {
    fn validate(&self) -> Result<(), ContractError> {
        let semver_ok = {
            let (core, pre) = match self.engine_version.split_once('-') {
                Some((c, p)) => (c, Some(p)),
                None => (self.engine_version.as_str(), None),
            };
            let parts: Vec<&str> = core.split('.').collect();
            parts.len() == 3
                && parts.iter().all(|p| {
                    !p.is_empty()
                        && p.bytes().all(|b| b.is_ascii_digit())
                        && (p.len() == 1 || !p.starts_with('0'))
                })
                && pre.is_none_or(|p| {
                    !p.is_empty()
                        && p.bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
                })
        };
        if !semver_ok {
            return Err(bad("echo.engineVersion", "not semver"));
        }
        if self.engine_commit.len() != 40
            || !self
                .engine_commit
                .bytes()
                .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        {
            return Err(bad("echo.engineCommit", "not 40 lowercase hex digits"));
        }
        if self.strategy_id.is_empty() || self.job_schema_version == 0 {
            return Err(bad("echo", "empty strategyId or jobSchemaVersion 0"));
        }
        if !crate::model_config::is_rules_table_version(&self.rules_table_version) {
            return Err(bad("echo.rulesTableVersion", "outside rules-table-v<N>"));
        }
        if self.snapshot_parser_version == Some(0) {
            return Err(bad("echo.snapshotParserVersion", "must be positive"));
        }
        Ok(())
    }
}

/// Serializes every deterministic field in type order (digest excluded by
/// the caller).
struct DeterministicView<'a>(&'a EngineResult);

impl Serialize for DeterministicView<'_> {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let r = self.0;
        let mut st = s.serialize_struct("EngineResult", 6)?;
        st.serialize_field("outputSchemaVersion", &r.output_schema_version)?;
        st.serialize_field("status", &r.status)?;
        st.serialize_field("error", &r.error)?;
        st.serialize_field("echo", &r.echo)?;
        st.serialize_field("market", &r.market)?;
        st.serialize_field("candidates", &r.candidates)?;
        st.end()
    }
}

impl EngineResult {
    /// `resultDigest`: sha256 of the compact serialization of the
    /// deterministic section in Rust field order (21 §10, 20 G5).
    pub fn compute_digest(&self) -> Result<Sha256Hex, serde_json::Error> {
        use sha2::{Digest, Sha256};
        /// Hashes the serialization as it is written, without a buffer (R8).
        struct HashWriter(Sha256);
        impl std::io::Write for HashWriter {
            fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
                self.0.update(buf);
                Ok(buf.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let mut w = HashWriter(Sha256::new());
        serde_json::to_writer(&mut w, &DeterministicView(self))?;
        let d: [u8; 32] = w.0.finalize().into();
        Ok(Sha256Hex::from_digest(&d))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn intent_meta_caps() {
        // spec: 21 §16 caps (10,000 entries, 1 MiB per market; 16 KiB per order)
        let small: Map<String, Value> = json!({"k": 1}).as_object().unwrap().clone();
        assert!(check_intent_meta_caps(&vec![small.clone(); INTENT_META_MAX_ENTRIES]).is_ok());
        assert_eq!(
            check_intent_meta_caps(&vec![small.clone(); INTENT_META_MAX_ENTRIES + 1]),
            Err("intent_meta_limit")
        );
        let big: Map<String, Value> = json!({"k": "x".repeat(ORDER_META_MAX_BYTES)})
            .as_object()
            .unwrap()
            .clone();
        assert!(!order_meta_within_cap(&big));
        assert!(order_meta_within_cap(&small));
        assert_eq!(
            check_intent_meta_caps(&vec![big; 70]),
            Err("intent_meta_limit"),
            "70 x 16 KiB > 1 MiB"
        );
    }

    #[test]
    fn meta_numbers_follow_n1_and_n2() {
        // spec: 21 §18 N1 (no -0), N2 (|int| <= 2^53-1), §16 (JSON.stringify maps -0 to 0)
        let ok = json!({"a": [1, -2.5, 9007199254740991_u64, -9007199254740991_i64, null], "b": {"c": 0.0}});
        assert!(check_meta_numbers(&ok).is_ok());
        for bad in [
            json!({"edge": -0.0}),
            json!([{"x": [9007199254740992_u64]}]),
            json!(-9007199254740992_i64),
        ] {
            assert!(check_meta_numbers(&bad).is_err(), "{bad}");
        }
        let mut v = json!({"edge": -0.0, "list": [-0.0, 1.5]});
        normalize_negative_zero(&mut v);
        assert_eq!(
            serde_json::to_string(&v).unwrap(),
            r#"{"edge":0,"list":[0,1.5]}"#
        );
        assert!(check_meta_numbers(&v).is_ok());
    }

    #[test]
    fn events_by_type_accepts_explicit_zero() {
        // spec: 21 §15 (values are integers >= 0); the emitted form omits zeros
        let e: EventsByType = serde_json::from_str(r#"{"book":0,"price_change":3}"#).unwrap();
        assert_eq!(e.total(), 3);
        assert_eq!(
            serde_json::to_string(&EventsByType::from_counts([0, 3, 0, 0]).unwrap()).unwrap(),
            r#"{"price_change":3}"#
        );
    }

    #[test]
    fn digest_is_sha256_of_the_compact_deterministic_section() {
        // spec: 21 §10 resultDigest, 20 G5 (streamed hashing equals hashing the bytes)
        use sha2::{Digest, Sha256};
        let r: EngineResult = serde_json::from_str(include_str!(
            "../../../contract/fixtures/results/valid/ok-ts-compat.json"
        ))
        .unwrap();
        let bytes = serde_json::to_vec(&DeterministicView(&r)).unwrap();
        let d: [u8; 32] = Sha256::digest(&bytes).into();
        assert_eq!(r.compute_digest().unwrap(), Sha256Hex::from_digest(&d));
        assert_eq!(r.compute_digest().unwrap(), r.result_digest);
    }

    #[test]
    fn events_by_type_canonical_form() {
        // spec: 21 §15 (fixed array by cause, unseen causes omitted)
        let e = EventsByType::from_counts([1, 4823, 0, 0]).unwrap();
        assert_eq!(
            serde_json::to_string(&e).unwrap(),
            r#"{"book":1,"price_change":4823}"#
        );
        assert_eq!(e.total(), 4824);
        assert!(EventsByType::from_counts([1 << 53, 0, 0, 0]).is_none());
    }

    #[test]
    fn failure_rows_carry_class_and_cause() {
        // spec: 21 §14 failure_class / failure_detail, 20 §4.2 reason text
        let e = ErrorInfo {
            class: ErrorClass::DataDefect,
            cause: "upstream_hole".into(),
            message: "Chainlink hole".into(),
            detail: None,
        };
        let row = FailureRow::from_error(&e).unwrap();
        assert_eq!(row.failure_class, FailureClass::DataDefect);
        assert_eq!(row.failure_detail, "upstream_hole");
        assert_eq!(row.reason, "data_defect: upstream_hole: Chainlink hole");
        let canceled = ErrorInfo {
            class: ErrorClass::Canceled,
            ..e
        };
        assert!(FailureRow::from_error(&canceled).is_none());
        let skip = FailureRow::market_skip(SkipReason::NoActivity, &[]);
        assert_eq!(skip.failure_class, FailureClass::MarketSkip);
        assert_eq!(skip.reason, "no_market_stats: no_activity");
    }

    #[test]
    fn output_money_is_an_exact_token() {
        // spec: 21 §18 N5, 10 §4 Q2 (no exponent, no -0, no f64 round trip)
        #[derive(Serialize)]
        struct S {
            a: OutDec2,
            b: OutDec4,
        }
        let s = S {
            a: OutDec2::from_micros_half_away(-1_005_000),
            b: OutDec4::from_micros_half_away(512_350),
        };
        assert_eq!(
            serde_json::to_string(&s).unwrap(),
            r#"{"a":-1.01,"b":0.5124}"#
        );
        let tiny = OutDec2::from_micros_half_away(-4_999);
        assert_eq!(serde_json::to_string(&tiny).unwrap(), "0");
    }
}
