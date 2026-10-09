//! `EngineJob`, the binary input (21 §5, §8).

use std::collections::BTreeSet;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::model_config::{ExecutionConfig, ModelConfig};
use crate::num::{FiniteF64, SafeI64, SafeU64, Sha256Hex};
use crate::rules::MarketRules;
use crate::support::{ensure, tristate, ContractError, Version};
use crate::vocab::{FeedId, InputMode, PriceToBeatStatus, Profile, TraceLevel};

/// Version of the `EngineJob` schema (`jobSchemaVersion`, 20 §3).
pub const JOB_SCHEMA_VERSION: u32 = 1;

/// Pattern of a v1 market slug (21 §5.1, D06).
pub const SLUG_PATTERN: &str = r"^btc-updown-(5m|15m)-[0-9]{10}$";

/// Pattern of candidate keys (used as file names, 20 §5.5).
pub const CANDIDATE_KEY_PATTERN: &str = r"^[A-Za-z0-9._-]{1,128}$";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineJob {
    pub job_schema_version: Version<JOB_SCHEMA_VERSION>,
    pub run: RunSection,
    pub market: MarketSection,
    pub outputs: JobOutputs,
    pub budget: JobBudget,
}

/// Run-level section, identical for every market of a submission or group.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunSection {
    pub strategy_id: String,
    pub input_mode: InputMode,
    pub model_config: ModelConfig,
    #[schemars(length(min = 1))]
    pub candidates: Vec<CandidateSpec>,
}

/// One candidate (21 §8).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateSpec {
    #[schemars(regex(pattern = CANDIDATE_KEY_PATTERN))]
    pub key: String,
    pub index: u32,
    /// Opaque: validated by the strategy's `paramsSchema` (21 §3).
    pub params: Map<String, Value>,
    /// A complete `execution` object replacing the run's, or null (C4).
    pub execution: Option<ExecutionConfig>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketSection {
    #[schemars(regex(pattern = SLUG_PATTERN))]
    pub slug: String,
    pub condition_id: Option<String>,
    /// Null only for recorder-v4 in ts-compat (21 §5.1).
    pub window: Option<Window>,
    pub token_ids: TokenIds,
    pub outcome: crate::vocab::Outcome,
    pub rules: MarketRules,
    /// Tri-state: absent = not requested, null = catalog miss, object =
    /// resolved (21 §5.1).
    #[serde(default, skip_serializing_if = "Option::is_none", with = "tristate")]
    #[schemars(with = "Option<GammaPriceToBeat>")]
    pub gamma_price_to_beat: Option<Option<GammaPriceToBeat>>,
    pub feed_availability: FeedAvailability,
    pub input: InputRef,
    pub recorder_v4: Option<RecorderV4Input>,
    pub own_activity: Option<OwnActivity>,
    pub feed_files: Vec<FeedFile>,
}

/// Market window in epoch ms (10 §5).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Window {
    pub start_ms: SafeU64,
    pub end_ms: SafeU64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TokenIds {
    #[serde(rename = "UP")]
    #[schemars(length(min = 1))]
    pub up: String,
    #[serde(rename = "DOWN")]
    #[schemars(length(min = 1))]
    pub down: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GammaPriceToBeat {
    pub price_to_beat: Option<FiniteF64>,
    pub synced_at_ms: Option<SafeU64>,
}

/// Producer-resolved feed availability (14 §6.2).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedAvailability {
    /// Null when the strategy did not request price-to-beat.
    pub price_to_beat: Option<PriceToBeatAvailability>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PriceToBeatAvailability {
    pub status: PriceToBeatStatus,
    /// Required for `unavailable_*`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Logical input file (15 I-8).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InputRef {
    pub path: String,
    pub bytes: SafeU64,
    pub sha256: Option<Sha256Hex>,
    pub format: InputFormat,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InputFormat {
    #[schemars(regex(pattern = r"^[a-z0-9][a-z0-9-]{0,63}$"))]
    pub name: String,
    #[schemars(range(min = 1))]
    pub version: u32,
}

/// Recorder V4 input (15 §5). `manifest` is opaque here and validated by the
/// V4 manifest schema (21 §3).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecorderV4Input {
    pub manifest: Map<String, Value>,
    pub allow_gaps: bool,
}

/// Own-activity ledger for decontaminated calibration replays (15 I-39).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OwnActivity {
    pub ledger: FileRef,
    pub clock: OwnActivityClock,
    pub max_placement_ms: SafeU64,
    pub restore_horizon_ms: SafeU64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileRef {
    pub path: String,
    pub bytes: SafeU64,
    pub sha256: Sha256Hex,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OwnActivityClock {
    pub offset_ms: SafeI64,
    pub uncertainty_ms: SafeU64,
}

/// One feed day file (14 §4.1, §5.1).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedFile {
    pub feed: FeedId,
    #[schemars(regex(pattern = r"^[A-Za-z0-9]{1,32}$"))]
    pub symbol: String,
    #[schemars(regex(pattern = r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"))]
    pub day: String,
    pub path: String,
    pub bytes: SafeU64,
}

/// Non-semantic output paths (21 §5.1, 22).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobOutputs {
    pub trace_path: Option<String>,
    pub trace_level: TraceLevel,
    pub ledger_path: Option<String>,
}

/// Non-semantic budget (21 §5.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobBudget {
    #[schemars(range(min = 1_000, max = 3_600_000))]
    pub wall_ms: u32,
    #[schemars(range(min = 1, max = 256))]
    pub threads: u16,
}

/// Parses a v1 slug into (timeframe ms, window start ms) (10 §5).
pub fn slug_window(slug: &str) -> Option<(u64, u64)> {
    let rest = slug.strip_prefix("btc-updown-")?;
    let (tf, epoch) = rest.split_once('-')?;
    let tf_ms = match tf {
        "5m" => 300_000,
        "15m" => 900_000,
        _ => return None,
    };
    if epoch.len() != 10 || !epoch.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let start_s: u64 = epoch.parse().ok()?;
    if start_s % (tf_ms / 1000) != 0 {
        return None;
    }
    Some((tf_ms, start_s * 1000))
}

fn check_path(p: &str, what: &str) -> Result<(), ContractError> {
    ensure(p.starts_with('/') && !p.contains('\0'), "path", || {
        format!("{what} must be an absolute local path, got {p:?}")
    })
}

impl EngineJob {
    /// The job-level rules of 21 §5.1, §7.1 and §8 that need neither the
    /// binary's capabilities nor the file system. Capability checks
    /// (strategy id, input modes, rules tables, features, `maxCandidates`),
    /// file existence, integrity and the params schema are the binary's.
    pub fn validate(&self) -> Result<(), ContractError> {
        let run = &self.run;
        let m = &self.market;
        let mc = &run.model_config;
        ensure(!run.strategy_id.is_empty(), "strategy_id", || {
            "empty strategyId".into()
        })?;
        mc.validate()?;

        // Candidates (C1, C2, C4).
        let mut keys = BTreeSet::new();
        for (i, cand) in run.candidates.iter().enumerate() {
            ensure(cand.index as usize == i, "params", || {
                format!("candidate {i} has index {}", cand.index)
            })?;
            ensure(keys.insert(cand.key.as_str()), "params", || {
                format!("duplicate candidate key {:?}", cand.key)
            })?;
            ensure(
                !cand.key.is_empty()
                    && cand.key.len() <= 128
                    && cand
                        .key
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-')),
                "params",
                || format!("bad candidate key {:?}", cand.key),
            )?;
            if let Some(x) = &cand.execution {
                ensure(mc.profile != Profile::TsCompat, "params", || {
                    "ts-compat candidates cannot vary execution (21 §8 C4)".into()
                })?;
                mc.effective(Some(x)).validate()?;
            }
        }
        ensure(!run.candidates.is_empty(), "params", || {
            "no candidates".into()
        })?;
        for (i, a) in run.candidates.iter().enumerate() {
            for b in &run.candidates[i + 1..] {
                let ea = a.execution.as_ref().unwrap_or(&mc.execution);
                let eb = b.execution.as_ref().unwrap_or(&mc.execution);
                ensure(!(a.params == b.params && ea == eb), "params", || {
                    format!("candidates {:?} and {:?} are duplicates (C2)", a.key, b.key)
                })?;
            }
        }

        // Market identity and window.
        let (tf_ms, start_ms) = slug_window(&m.slug).ok_or_else(|| {
            ContractError::invalid_input("market", format!("bad slug {:?}", m.slug))
        })?;
        match &m.window {
            Some(w) => ensure(
                w.start_ms.get() == start_ms && w.end_ms.get() == start_ms + tf_ms,
                "window",
                || "window must equal the slug window (10 §5)".into(),
            )?,
            None => ensure(
                run.input_mode == InputMode::RecorderV4 && mc.profile == Profile::TsCompat,
                "window",
                || "window may be null only for recorder-v4 in ts-compat".into(),
            )?,
        }
        ensure(
            !m.token_ids.up.is_empty()
                && !m.token_ids.down.is_empty()
                && m.token_ids.up != m.token_ids.down,
            "market",
            || "tokenIds must be distinct and non-empty".into(),
        )?;
        if let Some(cid) = &m.condition_id {
            ensure(!cid.is_empty(), "market", || "empty conditionId".into())?;
        }
        m.rules.validate()?;

        // Feed availability (14 §6.2).
        if let Some(Some(g)) = &m.gamma_price_to_beat {
            if let Some(p) = &m.feed_availability.price_to_beat {
                if p.status == PriceToBeatStatus::Fed {
                    ensure(g.price_to_beat.is_some(), "feed_availability", || {
                        "status fed requires gammaPriceToBeat.priceToBeat".into()
                    })?;
                }
            }
        }
        if let Some(p) = &m.feed_availability.price_to_beat {
            let unavailable = matches!(
                p.status,
                PriceToBeatStatus::UnavailablePipelineIncomplete
                    | PriceToBeatStatus::UnavailableUpstreamHole
            );
            ensure(
                !unavailable || p.message.as_deref().is_some_and(|s| !s.is_empty()),
                "feed_availability",
                || "unavailable_* requires a message".into(),
            )?;
            if p.status == PriceToBeatStatus::Fed {
                ensure(
                    matches!(&m.gamma_price_to_beat, Some(Some(_))),
                    "feed_availability",
                    || "status fed requires a resolved gammaPriceToBeat".into(),
                )?;
            }
        }

        // Input mode specific objects.
        ensure(
            (run.input_mode == InputMode::RecorderV4) == m.recorder_v4.is_some(),
            "schema",
            || "recorderV4 is required iff inputMode is recorder-v4".into(),
        )?;

        // Paths (absolute, local).
        check_path(&m.input.path, "market.input.path")?;
        for f in &m.feed_files {
            check_path(&f.path, "feedFiles[].path")?;
        }
        if let Some(o) = &m.own_activity {
            check_path(&o.ledger.path, "ownActivity.ledger.path")?;
        }
        if let Some(p) = &self.outputs.trace_path {
            check_path(p, "outputs.tracePath")?;
        }
        if let Some(p) = &self.outputs.ledger_path {
            check_path(p, "outputs.ledgerPath")?;
        }

        // Budget.
        ensure(
            (1_000..=3_600_000).contains(&self.budget.wall_ms),
            "schema",
            || "budget.wallMs outside 1000..3600000".into(),
        )?;
        ensure((1..=256).contains(&self.budget.threads), "schema", || {
            "budget.threads outside 1..256".into()
        })?;
        Ok(())
    }
}
