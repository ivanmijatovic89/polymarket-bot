//! `EngineResult` and `EngineMarketOutput`, the binary output (21 §10-§16).

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::num::{Decimal, OutDec2, OutDec4, SafeI64, SafeU64, Sha256Hex};
use crate::support::{tristate, ContractError, Version};
use crate::vocab::{
    ErrorClass, FailureClass, InputPath, Outcome, Profile, ResultStatus, RulesSource, SkipReason,
    StatsSkipReason, TickCause,
};

/// Version of the `EngineResult` schema (`outputSchemaVersion`, 20 §3).
pub const OUTPUT_SCHEMA_VERSION: u32 = 1;

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
    pub error: Option<ErrorInfo>,
    /// Null only when a group-level error happened before the job was read.
    pub echo: Option<Echo>,
    /// Null only when a group-level error happened before the market's rules
    /// were classified.
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
    pub engine_version: String,
    pub engine_commit: String,
    pub strategy_id: String,
    pub job_schema_version: u32,
    pub profile: Profile,
    pub seed: SafeU64,
    pub model_config_sha256: Sha256Hex,
    pub rules_table_version: String,
    pub snapshot_parser_version: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketEcho {
    pub slug: String,
    /// Market id of the first counted tick; null when there was none.
    pub condition_id: Option<String>,
    pub rules_source: RulesSource,
}

/// One candidate's result: `output` iff `status = ok`, `error` iff
/// `status = error` (checked by [`CandidateResult::validate`]).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateResult {
    pub key: String,
    pub index: u32,
    pub status: ResultStatus,
    /// Hash of this candidate's effective ModelConfig (21 §1.1).
    pub model_config_sha256: Sha256Hex,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<EngineMarketOutput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorInfo>,
}

/// `RunSingleMarketOutput` minus `idx` and `durationMs` (21 §11).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineMarketOutput {
    pub slug: String,
    pub market_stats: Option<EngineMarketStats>,
    pub events_processed: SafeU64,
    pub events_by_type: EventsByType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skip_reason: Option<SkipReason>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(length(min = 1, max = 32))]
    pub coverage_reasons: Option<Vec<String>>,
}

/// Counted ticks per cause (21 §15). Absent keys are zero; present values
/// are at least 1, so the form is canonical (TS omits unseen types).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EventsByType {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(range(min = 1))]
    pub book: Option<SafeU64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(range(min = 1))]
    pub price_change: Option<SafeU64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(range(min = 1))]
    pub binance_agg_trade: Option<SafeU64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(range(min = 1))]
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
    pub slug: String,
    pub final_outcome: Outcome,
    pub pnl: OutDec2,
    #[schemars(range(max = 2_147_483_647))]
    pub trade_count: u32,
    #[schemars(range(max = 2_147_483_647))]
    pub trade_as_maker: u32,
    #[schemars(range(max = 2_147_483_647))]
    pub trade_as_taker: u32,
    #[schemars(extend("minimum" = 0))]
    pub fees_paid: OutDec2,
    #[schemars(extend("exclusiveMinimum" = 0, "exclusiveMaximum" = 1))]
    pub avg_entry_price_up: Option<OutDec4>,
    #[schemars(extend("exclusiveMinimum" = 0, "exclusiveMaximum" = 1))]
    pub avg_entry_price_down: Option<OutDec4>,
    #[schemars(extend("minimum" = 0, "exclusiveMaximum" = 1_000_000_000_000_u64))]
    pub up_shares: OutDec2,
    #[schemars(extend("minimum" = 0, "exclusiveMaximum" = 1_000_000_000_000_u64))]
    pub down_shares: OutDec2,
    #[schemars(extend("minimum" = 0, "exclusiveMaximum" = 1_000_000_000_000_u64))]
    pub mergable_shares: OutDec2,
    pub cost: OutDec2,
    #[schemars(extend("minimum" = 0))]
    pub split_cost: OutDec2,
    /// Opaque strategy meta objects (21 §16).
    pub intent_meta: Vec<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skip_reason: Option<StatsSkipReason>,
    /// Tri-state: object in realistic, null in ts-compat, absent on TS rows
    /// (11 §13.8).
    #[serde(default, skip_serializing_if = "Option::is_none", with = "tristate")]
    #[schemars(with = "Option<MarketStatsRules>")]
    pub rules: Option<Option<MarketStatsRules>>,
}

/// Per-market rules provenance (11 §13.8). Values of `feeEra`, `feeCurve`,
/// `feeSource` and rule ids come from the run's rule table (11 VR2).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketStatsRules {
    pub source: RulesSource,
    pub rules_table_version: String,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<ErrorDetail>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ErrorDetail {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub callback: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seq: Option<SafeU64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ts_ms: Option<SafeU64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
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
    /// Keyed by reject reason code (the text before `(`, 21 §17).
    pub orders_rejected: BTreeMap<String, SafeU64>,
    pub orders_canceled: SafeU64,
    pub buy_notional_usdc: Decimal,
    pub sell_notional_usdc: Decimal,
    pub peak_reserved_usdc: Decimal,
    pub strategy_ticks_skipped: SafeU64,
}

fn bad(field: &str, why: impl std::fmt::Display) -> ContractError {
    ContractError::invalid_output("self_check", format!("{field}: {why}"))
}

/// 21 §16 per-market caps; `Err(cause)` is `intent_meta_limit`.
pub fn check_intent_meta_caps(meta: &[Map<String, Value>]) -> Result<(), &'static str> {
    if meta.len() > INTENT_META_MAX_ENTRIES {
        return Err("intent_meta_limit");
    }
    let bytes = serde_json::to_vec(meta)
        .map_err(|_| "intent_meta_limit")?
        .len();
    if bytes > INTENT_META_MAX_BYTES {
        return Err("intent_meta_limit");
    }
    Ok(())
}

/// 21 §16 per-order cap; `false` means reject reason `meta_too_large`.
pub fn order_meta_within_cap(meta: &Map<String, Value>) -> bool {
    serde_json::to_vec(meta).is_ok_and(|b| b.len() <= ORDER_META_MAX_BYTES)
}

impl EngineMarketOutput {
    /// Egress self-check of 21 §19 for one candidate output. A failure is
    /// `invalid_output: self_check` (engine bug).
    pub fn self_check(&self) -> Result<(), ContractError> {
        if self.events_by_type.total() != self.events_processed.get() {
            return Err(bad("eventsByType", "does not sum to eventsProcessed"));
        }
        for c in TickCause::ALL {
            if self.events_by_type.get(*c) == 0
                && match c {
                    TickCause::Book => self.events_by_type.book.is_some(),
                    TickCause::PriceChange => self.events_by_type.price_change.is_some(),
                    TickCause::BinanceAggTrade => self.events_by_type.binance_agg_trade.is_some(),
                    TickCause::ChainlinkRound => self.events_by_type.chainlink_round.is_some(),
                }
            {
                return Err(bad("eventsByType", format!("explicit zero for {c}")));
            }
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
        match (&self.market_stats, self.skip_reason) {
            (Some(s), None) => {
                if s.slug != self.slug {
                    return Err(bad("marketStats.slug", "differs from output slug"));
                }
                s.self_check()?;
            }
            (Some(s), Some(SkipReason::NoActivity)) => {
                if s.skip_reason != Some(StatsSkipReason::NoInWindowActivity) {
                    return Err(bad("skipReason", "zero row needs marketStats.skipReason"));
                }
                s.self_check()?;
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
        if self.market_id.is_empty() || self.market_id.len() > 255 {
            return Err(bad("marketId", "must be 1..255 chars"));
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
        if let Some(Some(r)) = &self.rules {
            let sorted = r.unverified_rules.windows(2).all(|w| w[0] < w[1]);
            if !sorted {
                return Err(bad("rules.unverifiedRules", "must be sorted and unique"));
            }
        }
        if check_intent_meta_caps(&self.intent_meta).is_err() {
            return Err(bad("intentMeta", "above the 21 §16 caps"));
        }
        Ok(())
    }
}

impl CandidateResult {
    pub fn validate(&self) -> Result<(), ContractError> {
        match (self.status, &self.output, &self.error) {
            (ResultStatus::Ok, Some(o), None) => o.self_check(),
            (ResultStatus::Error, None, Some(e)) => e.validate(),
            _ => Err(bad("candidate", "output iff ok, error iff error")),
        }
    }
}

impl EngineResult {
    /// Structural checks of 21 §10 plus every candidate's self-check.
    pub fn validate(&self) -> Result<(), ContractError> {
        match (self.status, &self.error) {
            (ResultStatus::Ok, None) => {
                if self.echo.is_none() || self.market.is_none() {
                    return Err(bad("echo/market", "required when status is ok"));
                }
            }
            (ResultStatus::Error, Some(e)) => e.validate()?,
            _ => return Err(bad("error", "present iff status is error")),
        }
        for (i, c) in self.candidates.iter().enumerate() {
            if c.index as usize != i {
                return Err(bad("candidates", "indices must be 0..N-1 in order"));
            }
            c.validate()?;
            if let (Some(o), Some(m)) = (&c.output, &self.market) {
                if o.slug != m.slug {
                    return Err(bad("candidates[].output.slug", "differs from market.slug"));
                }
            }
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
        let bytes = serde_json::to_vec(&DeterministicView(self))?;
        let d: [u8; 32] = Sha256::digest(&bytes).into();
        Ok(Sha256Hex::from_digest(&d))
    }
}
