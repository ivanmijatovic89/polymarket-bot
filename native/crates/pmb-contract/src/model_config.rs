//! `ModelConfig` v1 (21 §6; sub-objects owned by 12 §4.5, 13 §7.3, 14 §9,
//! 12 §6.3, 12 §8, 11 §13.4).
//!
//! D57: until M3b the ts-compat config carries only the TypeScript latency
//! parameters (`execution.compatLatency` with the next-tick model choice) and
//! no realistic section. The realistic sections (`execution.latency`,
//! `cancelBeforeAck`, `makerQueue`, `sellGate`, `failureRates` and `clock`)
//! are typed here as optional keys so they can be filled in at M3b without
//! breaking v1 jobs; [`ModelConfig::validate`] rejects them in ts-compat and
//! requires them in realistic.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::canonical::{canonical_json, CanonicalError};
use crate::num::{Decimal, SafeU64, Sha256Hex};
use crate::support::{ensure, ContractError, Version};
use crate::vocab::{
    CancelBeforeAck, DepletionModel, FeeModel, LatencyModel, MakerModel, MakerQueuePrints,
    MissingSnapshot, Profile, ReportsModel, SellGate, TakerDelayModel,
};

/// Version of the `ModelConfig` schema (`modelConfigVersion`).
pub const MODEL_CONFIG_VERSION: u32 = 1;

/// The complete, producer-resolved model settings of a run (21 §6).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelConfig {
    pub model_config_version: Version<MODEL_CONFIG_VERSION>,
    pub profile: Profile,
    /// Run seed in `[0, 2^53 - 1]` (10 §6.1 RNG-1).
    pub seed: SafeU64,
    pub capital: CapitalConfig,
    pub execution: ExecutionConfig,
    /// Market-data clock (12 §4.5). Realistic only; absent in ts-compat
    /// until M3b (D57).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clock: Option<ClockConfig>,
    pub feeds: FeedsConfig,
    pub runner: RunnerConfig,
    pub risk: RiskConfig,
    pub rules: RulesConfig,
}

/// Per-market capital allowance (12 §9.4).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapitalConfig {
    pub starting_capital_usdc: Decimal,
}

/// `ModelConfig.execution` v1 (13 §7.3).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionConfig {
    pub models: ExecutionModels,
    /// Used iff `models.latency = compat` (13 §5.1).
    pub compat_latency: CompatLatency,
    /// Realistic latency components (13 §6.8). M3b.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latency: Option<LatencyCalibration>,
    /// M3b.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancel_before_ack: Option<CancelBeforeAck>,
    /// M3b.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maker_queue: Option<MakerQueueConfig>,
    /// M3b.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sell_gate: Option<SellGate>,
    /// M3b.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_rates: Option<FailureRates>,
}

/// The six model axes (13 §7.1, §7.3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionModels {
    pub latency: LatencyModel,
    pub fee: FeeModel,
    pub taker_delay: TakerDelayModel,
    pub depletion: DepletionModel,
    pub maker: MakerModel,
    pub reports: ReportsModel,
}

impl ExecutionModels {
    /// The pinned ts-compat composition (13 §7.3).
    pub const TS_COMPAT: ExecutionModels = ExecutionModels {
        latency: LatencyModel::Compat,
        fee: FeeModel::Flat700Bps4Dp,
        taker_delay: TakerDelayModel::Off,
        depletion: DepletionModel::None,
        maker: MakerModel::WorstQueue,
        reports: ReportsModel::Compat,
    };
}

/// Upper bound of `compatLatency.delayMs` and `jitterMs`.
// D-PENDING: 13 §5.1 gives no range for the compat delay and jitter; chose
// 0..=600,000 ms (the realistic component bound used below), enforced both
// by the schema and by `validate`.
pub const COMPAT_LATENCY_MAX_MS: u32 = 600_000;

/// TS latency parameters: one delay for every placement and cancel, jitter
/// only when the delay is positive (13 §5.1 `NextRealTick`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompatLatency {
    #[schemars(range(max = 600_000))]
    pub delay_ms: u32,
    #[schemars(range(max = 600_000))]
    pub jitter_ms: u32,
}

/// A latency distribution (13 §7.3).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Distribution {
    #[serde(rename_all = "camelCase")]
    Constant { ms: u32 },
    #[serde(rename_all = "camelCase")]
    Uniform { lo_ms: u32, hi_ms: u32 },
    /// 101 non-decreasing quantiles q0..q100.
    #[serde(rename_all = "camelCase")]
    Empirical {
        #[schemars(length(min = 101, max = 101))]
        quantiles_ms: Vec<u32>,
    },
    /// Parameters of ln(ms), decimal strings.
    #[serde(rename_all = "camelCase")]
    Lognormal { mu: Decimal, sigma: Decimal },
}

impl Distribution {
    /// Largest value the distribution can produce, when bounded.
    fn max_ms(&self) -> Option<u32> {
        match self {
            Distribution::Constant { ms } => Some(*ms),
            Distribution::Uniform { hi_ms, .. } => Some(*hi_ms),
            Distribution::Empirical { quantiles_ms } => quantiles_ms.last().copied(),
            Distribution::Lognormal { .. } => None,
        }
    }

    fn validate(&self, what: &str, max: u32) -> Result<(), ContractError> {
        let cause = "model_config";
        match self {
            Distribution::Uniform { lo_ms, hi_ms } => ensure(lo_ms <= hi_ms, cause, || {
                format!("{what}: uniform loMs > hiMs")
            })?,
            Distribution::Empirical { quantiles_ms } => {
                ensure(quantiles_ms.len() == 101, cause, || {
                    format!("{what}: empirical needs 101 quantiles")
                })?;
                ensure(quantiles_ms.windows(2).all(|w| w[0] <= w[1]), cause, || {
                    format!("{what}: quantiles must be non-decreasing")
                })?;
            }
            Distribution::Lognormal { sigma, .. } => {
                ensure(!sigma.is_negative(), cause, || format!("{what}: sigma < 0"))?
            }
            Distribution::Constant { .. } => {}
        }
        if let Some(m) = self.max_ms() {
            ensure(m <= max, cause, || {
                format!("{what}: value {m} ms above {max}")
            })?;
        }
        Ok(())
    }
}

/// Realistic latency calibration (13 §6.8, §7.4). M3b.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LatencyCalibration {
    pub calibration_id: String,
    pub components: LatencyComponents,
}

/// The realistic latency components (13 §7.3).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LatencyComponents {
    pub place: Distribution,
    pub cancel: Distribution,
    pub ack: Distribution,
    pub cancel_ack: Distribution,
    pub fill_report: Distribution,
    pub mined: Distribution,
    pub confirmed: Distribution,
    pub failed: Distribution,
    pub chain_split: Distribution,
    pub chain_merge: Distribution,
}

/// Maker queue parameters (13 §6.5, §7.3). M3b.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MakerQueueConfig {
    pub cancel_ahead_share: Decimal,
    pub print_match_window_ms: u32,
    pub prints: MakerQueuePrints,
}

/// Failure rates (13 §7.3). M3b.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FailureRates {
    pub settlement: Decimal,
    pub chain: Decimal,
}

/// `ModelConfig.clock` (12 §4.5). Realistic, M3b.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClockConfig {
    pub market_data: MarketDataClock,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketDataClock {
    pub calibration_id: String,
    pub delay: Distribution,
}

/// `ModelConfig.feeds` (14 §9).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedsConfig {
    pub calibration_id: String,
    pub binance: FeedLatency,
    pub chainlink: ChainlinkFeed,
    pub price_to_beat: FeedLatency,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedLatency {
    pub latency: Distribution,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChainlinkFeed {
    pub latency: Distribution,
    /// 0 disables the gap check; otherwise at least 1,000 (14 §9).
    pub max_gap_ms: u32,
}

/// `ModelConfig.runner` (12 §6.3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunnerConfig {
    #[schemars(range(min = 1))]
    pub max_events_per_drain: u32,
}

/// `ModelConfig.risk` (12 §8).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RiskConfig {
    #[schemars(range(min = 1))]
    pub max_open_orders: u32,
    pub max_order_size: Decimal,
    pub max_abs_position: Decimal,
    pub max_loss_stop_usdc: Decimal,
}

/// `ModelConfig.rules` (11 §13.4).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RulesConfig {
    #[schemars(regex(pattern = RULES_TABLE_VERSION_PATTERN))]
    pub rules_table_version: String,
    pub missing_snapshot: MissingSnapshot,
}

/// Pattern of `rulesTableVersion` (`rules-table-v<N>`, 11 §13.5).
pub const RULES_TABLE_VERSION_PATTERN: &str = r"^rules-table-v[1-9][0-9]{0,5}$";

/// True when `s` matches [`RULES_TABLE_VERSION_PATTERN`].
pub fn is_rules_table_version(s: &str) -> bool {
    s.strip_prefix("rules-table-v").is_some_and(|n| {
        !n.is_empty()
            && n.len() <= 6
            && !n.starts_with('0')
            && n.bytes().all(|b| b.is_ascii_digit())
    })
}

fn is_calibration_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

impl ModelConfig {
    /// Semantic validation beyond the schema: 13 §7.3 consistency, 14 §9
    /// ranges, D57 profile shape. Errors are `invalid_input: model_config`.
    pub fn validate(&self) -> Result<(), ContractError> {
        let c = "model_config";
        let x = &self.execution;
        ensure(self.capital.starting_capital_usdc.micros() > 0, c, || {
            "capital.startingCapitalUsdc must be > 0".into()
        })?;
        for (name, d) in [
            ("risk.maxOrderSize", &self.risk.max_order_size),
            ("risk.maxAbsPosition", &self.risk.max_abs_position),
            ("risk.maxLossStopUsdc", &self.risk.max_loss_stop_usdc),
        ] {
            ensure(d.micros() > 0, c, || format!("{name} must be > 0"))?;
        }
        ensure(
            x.compat_latency.delay_ms <= COMPAT_LATENCY_MAX_MS
                && x.compat_latency.jitter_ms <= COMPAT_LATENCY_MAX_MS,
            c,
            || format!("execution.compatLatency values above {COMPAT_LATENCY_MAX_MS} ms"),
        )?;
        ensure(self.runner.max_events_per_drain > 0, c, || {
            "runner.maxEventsPerDrain must be > 0".into()
        })?;
        ensure(self.risk.max_open_orders > 0, c, || {
            "risk.maxOpenOrders must be > 0".into()
        })?;
        ensure(
            is_rules_table_version(&self.rules.rules_table_version),
            c,
            || format!("bad rulesTableVersion {:?}", self.rules.rules_table_version),
        )?;

        // Feeds (14 §9, F-46, F-50).
        let f = &self.feeds;
        ensure(is_calibration_id(&f.calibration_id), c, || {
            "feeds.calibrationId must be a non-empty id".into()
        })?;
        f.binance
            .latency
            .validate("feeds.binance.latency", 10_000)?;
        f.chainlink
            .latency
            .validate("feeds.chainlink.latency", 10_000)?;
        f.price_to_beat
            .latency
            .validate("feeds.priceToBeat.latency", 60_000)?;
        ensure(
            f.chainlink.max_gap_ms == 0 || f.chainlink.max_gap_ms >= 1_000,
            c,
            || "feeds.chainlink.maxGapMs must be 0 or >= 1000".into(),
        )?;

        let realistic_sections = [
            ("execution.latency", x.latency.is_some()),
            ("execution.cancelBeforeAck", x.cancel_before_ack.is_some()),
            ("execution.makerQueue", x.maker_queue.is_some()),
            ("execution.sellGate", x.sell_gate.is_some()),
            ("execution.failureRates", x.failure_rates.is_some()),
            ("clock", self.clock.is_some()),
        ];
        match self.profile {
            Profile::TsCompat => {
                ensure(x.models == ExecutionModels::TS_COMPAT, c, || {
                    "ts-compat requires the compat model values (13 §7.3)".into()
                })?;
                for (name, present) in realistic_sections {
                    ensure(!present, c, || {
                        format!(
                            "{name} is a realistic section, absent in ts-compat until M3b (D57)"
                        )
                    })?;
                }
                for (name, d) in [
                    ("binance", &f.binance.latency),
                    ("chainlink", &f.chainlink.latency),
                    ("priceToBeat", &f.price_to_beat.latency),
                ] {
                    ensure(matches!(d, Distribution::Constant { .. }), c, || {
                        format!("ts-compat requires a constant feeds.{name}.latency (14 F-50)")
                    })?;
                }
            }
            Profile::Realistic => {
                for (name, present) in realistic_sections {
                    ensure(present, c, || format!("realistic requires {name}"))?;
                }
                if x.models.reports == ReportsModel::Compat {
                    ensure(x.sell_gate == Some(SellGate::Matched), c, || {
                        "realistic with reports=compat requires sellGate=Matched (13 §7.3)".into()
                    })?;
                }
                if let Some(l) = &x.latency {
                    ensure(is_calibration_id(&l.calibration_id), c, || {
                        "execution.latency.calibrationId".into()
                    })?;
                    let k = &l.components;
                    for (n, d) in [
                        ("place", &k.place),
                        ("cancel", &k.cancel),
                        ("ack", &k.ack),
                        ("cancelAck", &k.cancel_ack),
                        ("fillReport", &k.fill_report),
                        ("mined", &k.mined),
                        ("confirmed", &k.confirmed),
                        ("failed", &k.failed),
                        ("chainSplit", &k.chain_split),
                        ("chainMerge", &k.chain_merge),
                    ] {
                        d.validate(n, 600_000)?;
                    }
                }
                if let Some(clock) = &self.clock {
                    ensure(
                        is_calibration_id(&clock.market_data.calibration_id),
                        c,
                        || "clock.marketData.calibrationId".into(),
                    )?;
                    clock
                        .market_data
                        .delay
                        .validate("clock.marketData.delay", 600_000)?;
                }
            }
        }
        Ok(())
    }

    /// Canonical JSON of 21 §6.1 (sorted keys, no whitespace, no floats).
    pub fn canonical_json(&self) -> Result<String, CanonicalError> {
        let value = serde_json::to_value(self).map_err(|e| CanonicalError(e.to_string()))?;
        canonical_json(&value)
    }

    /// `modelConfigSha256`: sha256 of the canonical UTF-8 bytes (21 §6.1).
    pub fn sha256(&self) -> Result<Sha256Hex, CanonicalError> {
        let text = self.canonical_json()?;
        let digest: [u8; 32] = Sha256::digest(text.as_bytes()).into();
        Ok(Sha256Hex::from_digest(&digest))
    }

    /// The effective ModelConfig of a candidate: `execution` replaced by the
    /// candidate's when that is non-null (21 §1.1, §8).
    pub fn effective(&self, candidate_execution: Option<&ExecutionConfig>) -> ModelConfig {
        let mut out = self.clone();
        if let Some(x) = candidate_execution {
            out.execution = x.clone();
        }
        out
    }
}
