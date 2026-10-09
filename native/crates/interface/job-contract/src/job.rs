//! `EngineJob`, the binary input (21 §5, §8).

use std::collections::BTreeSet;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::model_config::{ExecutionConfig, ModelConfig};
use crate::num::{FiniteF64, SafeI64, SafeU64, Sha256Hex};
use crate::rules::MarketRules;
use crate::support::{ensure, tristate, ContractError, Version};
use crate::vocab::{FeedId, InputMode, JournalReplay, PriceToBeatStatus, Profile, TraceLevel};

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
    /// Equals the binary's strategy id (21 §5.1).
    #[schemars(length(min = 1))]
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
    #[serde(deserialize_with = "crate::support::nullable")]
    pub execution: Option<ExecutionConfig>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketSection {
    #[schemars(regex(pattern = SLUG_PATTERN))]
    pub slug: String,
    /// `telonex_markets.market_id`, the V4 manifest or the journal header;
    /// null when unknown (15 I-18).
    #[serde(deserialize_with = "crate::support::nullable")]
    #[schemars(length(min = 1, max = 255))]
    pub condition_id: Option<String>,
    /// Null only for recorder-v4 in ts-compat (21 §5.1).
    #[serde(deserialize_with = "crate::support::nullable")]
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
    /// Required iff `inputMode` is `recorder-v4` (15 §5).
    #[serde(deserialize_with = "crate::support::nullable")]
    pub recorder_v4: Option<RecorderV4Input>,
    /// Required iff `inputMode` is `journal` (15 §9, I-50, I-51).
    // D-PENDING: 21 §5 omits `journal` and 15 §9 marks it "journal only";
    // chose a required, nullable key like `recorderV4`.
    #[serde(deserialize_with = "crate::support::nullable")]
    pub journal: Option<JournalInput>,
    /// Calibration only (15 I-39).
    #[serde(deserialize_with = "crate::support::nullable")]
    pub own_activity: Option<OwnActivity>,
    pub feed_files: Vec<FeedFile>,
}

/// Journal replay options (15 §9, I-50, I-51).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JournalInput {
    pub replay: JournalReplay,
    /// Turns the run into a what-if replay that cannot serve as a
    /// determinism proof (I-51).
    pub allow_engine_mismatch: bool,
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
    #[serde(deserialize_with = "crate::support::nullable")]
    pub price_to_beat: Option<FiniteF64>,
    #[serde(deserialize_with = "crate::support::nullable")]
    pub synced_at_ms: Option<SafeU64>,
}

/// Producer-resolved feed availability (14 §6.2).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedAvailability {
    /// Null when the strategy did not request price-to-beat.
    #[serde(deserialize_with = "crate::support::nullable")]
    pub price_to_beat: Option<PriceToBeatAvailability>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PriceToBeatAvailability {
    pub status: PriceToBeatStatus,
    /// Required for `unavailable_*` (14 §6.2); one line.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(length(min = 1, max = 1000), regex(pattern = r"^[^\n\r]*$"))]
    #[schemars(with = "String")]
    pub message: Option<String>,
}

/// Logical input file (15 I-8).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InputRef {
    pub path: String,
    pub bytes: SafeU64,
    /// Required for `recorder-v4` and `journal` inputs (15 §9).
    #[serde(deserialize_with = "crate::support::nullable")]
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
    #[serde(deserialize_with = "crate::support::nullable")]
    pub trace_path: Option<String>,
    pub trace_level: TraceLevel,
    #[serde(deserialize_with = "crate::support::nullable")]
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

fn is_input_format_name(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 64
        && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

fn is_feed_symbol(s: &str) -> bool {
    !s.is_empty() && s.len() <= 32 && s.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// `YYYY-MM-DD` with a real calendar date.
fn is_day(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let num = |r: std::ops::Range<usize>| -> Option<u32> {
        let t = &s[r];
        t.bytes()
            .all(|c| c.is_ascii_digit())
            .then(|| t.parse().ok())?
    };
    let (Some(y), Some(m), Some(d)) = (num(0..4), num(5..7), num(8..10)) else {
        return false;
    };
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&d)
}

/// True when `k` matches [`CANDIDATE_KEY_PATTERN`].
pub fn is_candidate_key(k: &str) -> bool {
    !k.is_empty()
        && k.len() <= 128
        && k.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

type SectionCheck = fn(&Value) -> Result<(), String>;

/// Whether `v` deserializes as `T`.
fn fits<T: serde::de::DeserializeOwned>(v: &Value) -> Result<(), String> {
    T::deserialize(v).map(drop).map_err(|e| e.to_string())
}

/// Which section of a job a deserialization error belongs to, so the
/// error carries the cause of 21 §5.1 instead of a generic `schema`.
fn diagnose(doc: &Value) -> ContractError {
    let schema = |m: String| ContractError::invalid_input("schema", m);
    let Some(obj) = doc.as_object() else {
        return schema("a job is a JSON object".into());
    };
    // 20 §3: an unsupported version is `invalid_input: version`.
    match obj.get("jobSchemaVersion").and_then(Value::as_u64) {
        Some(v) if v == u64::from(JOB_SCHEMA_VERSION) => {}
        other => {
            return ContractError::invalid_input(
                "version",
                format!(
                    "jobSchemaVersion {other:?} is not supported (accepts {JOB_SCHEMA_VERSION})"
                ),
            )
        }
    }

    let sections: [(&str, &'static str, SectionCheck); 11] = [
        ("/run/strategyId", "strategy_id", fits::<String>),
        ("/run/inputMode", "input_mode", fits::<InputMode>),
        ("/run/modelConfig", "model_config", fits::<ModelConfig>),
        ("/run/candidates", "params", fits::<Vec<CandidateSpec>>),
        ("/market/slug", "market", fits::<String>),
        ("/market/conditionId", "market", fits::<Option<String>>),
        ("/market/tokenIds", "market", fits::<TokenIds>),
        ("/market/outcome", "market", fits::<crate::vocab::Outcome>),
        ("/market/rules", "rules", fits::<MarketRules>),
        ("/market/window", "window", fits::<Option<Window>>),
        (
            "/market/feedAvailability",
            "feed_availability",
            fits::<FeedAvailability>,
        ),
    ];
    for (ptr, cause, check) in sections {
        let Some(value) = doc.pointer(ptr) else {
            // A missing key belongs to its section when its parent exists.
            let parent = ptr.rsplit_once('/').map_or("", |(p, _)| p);
            if doc.pointer(parent).is_some_and(Value::is_object) {
                return ContractError::invalid_input(cause, format!("{ptr}: missing"));
            }
            continue;
        };
        if let Err(e) = check(value) {
            return ContractError::invalid_input(cause, format!("{ptr}: {e}"));
        }
    }
    if let Some(g) = doc.pointer("/market/gammaPriceToBeat") {
        if let Err(e) = fits::<Option<GammaPriceToBeat>>(g) {
            return ContractError::invalid_input(
                "feed_availability",
                format!("/market/gammaPriceToBeat: {e}"),
            );
        }
    }
    match serde_json::from_value::<EngineJob>(doc.clone()) {
        Err(e) => schema(e.to_string()),
        Ok(_) => schema("job does not match the schema".into()),
    }
}

impl EngineJob {
    /// Rust ingress (21 §19): strict deserialization, then [`Self::validate`].
    /// A schema violation gets the cause of the section it is in (21 §5.1:
    /// `version`, `input_mode`, `model_config`, `params`, `rules`, `window`,
    /// `feed_availability`, else `schema`); every error is `invalid_input`.
    ///
    /// The text is read as a JSON document first and then parsed by
    /// [`Self::parse_value`], so `run` and `serve` (which embeds the job in
    /// a protocol line) give byte-identical errors for the same job
    /// (20 §6.3 S1).
    pub fn parse(text: &str) -> Result<EngineJob, ContractError> {
        let doc: Value = serde_json::from_str(text)
            .map_err(|e| ContractError::invalid_input("schema", format!("not JSON: {e}")))?;
        Self::parse_value(&doc)
    }

    /// [`Self::parse`] over a JSON document.
    pub fn parse_value(doc: &Value) -> Result<EngineJob, ContractError> {
        let job = EngineJob::deserialize(doc).map_err(|_| diagnose(doc))?;
        job.validate()?;
        Ok(job)
    }

    /// The job-level rules of 21 §5.1, §7.1 and §8 that need neither the
    /// binary's capabilities nor the file system. Capability checks
    /// (strategy id, input modes, profiles, rules tables, features,
    /// `maxCandidates`), file existence, integrity, input format support,
    /// requiredFeeds (C3) and the params schema are the binary's.
    pub fn validate(&self) -> Result<(), ContractError> {
        let run = &self.run;
        let m = &self.market;
        let mc = &run.model_config;
        ensure(
            !run.strategy_id.is_empty() && crate::support::is_plain_ascii(&run.strategy_id),
            "strategy_id",
            || "strategyId must be non-empty printable ASCII".into(),
        )?;
        mc.validate()?;
        self.validate_candidates()?;
        self.validate_market()?;

        // Paths (absolute, local; 20 G3).
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

        // Budget (21 §5.1).
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

    /// 21 §8 C1, C2, C4.
    fn validate_candidates(&self) -> Result<(), ContractError> {
        let run = &self.run;
        let mc = &run.model_config;
        ensure(!run.candidates.is_empty(), "params", || {
            "no candidates".into()
        })?;
        let mut keys = BTreeSet::new();
        for (i, cand) in run.candidates.iter().enumerate() {
            ensure(cand.index as usize == i, "params", || {
                format!("candidate {i} has index {} (C1)", cand.index)
            })?;
            ensure(is_candidate_key(&cand.key), "params", || {
                format!("bad candidate key {:?}", cand.key)
            })?;
            ensure(keys.insert(cand.key.as_str()), "params", || {
                format!("duplicate candidate key {:?} (C1)", cand.key)
            })?;
            if let Some(x) = &cand.execution {
                ensure(mc.profile != Profile::TsCompat, "params", || {
                    "ts-compat candidates cannot vary execution (21 §8 C4)".into()
                })?;
                // 21 §5.1: every §8 candidate rule is `invalid_input: params`,
                // including an effective execution invalid for the profile (C4).
                mc.effective(Some(x)).validate().map_err(|e| {
                    ContractError::invalid_input(
                        "params",
                        format!("candidate {:?} execution: {}", cand.key, e.message),
                    )
                })?;
            }
        }
        for (i, a) in run.candidates.iter().enumerate() {
            for b in &run.candidates[i + 1..] {
                let ea = a.execution.as_ref().unwrap_or(&mc.execution);
                let eb = b.execution.as_ref().unwrap_or(&mc.execution);
                ensure(!(a.params == b.params && ea == eb), "params", || {
                    format!("candidates {:?} and {:?} are duplicates (C2)", a.key, b.key)
                })?;
            }
        }
        Ok(())
    }

    fn validate_market(&self) -> Result<(), ContractError> {
        let run = &self.run;
        let m = &self.market;
        let profile = run.model_config.profile;

        // Identity and window (21 §5.1, 10 §5).
        let (tf_ms, start_ms) = slug_window(&m.slug).ok_or_else(|| {
            ContractError::invalid_input("market", format!("bad slug {:?}", m.slug))
        })?;
        // 21 §5.2: (ts-compat, recorder-v4) has no strategy gate, so its
        // window is null (TS `strategyWindow` is null for V4); every other
        // combination carries the slug window (D23 for realistic).
        let window_is_null =
            run.input_mode == InputMode::RecorderV4 && profile == Profile::TsCompat;
        match &m.window {
            Some(w) => {
                ensure(!window_is_null, "window", || {
                    "window must be null for recorder-v4 in ts-compat (21 §5.2)".into()
                })?;
                ensure(
                    w.start_ms.get() == start_ms && w.end_ms.get() == start_ms + tf_ms,
                    "window",
                    || "window must equal the slug window (10 §5)".into(),
                )?
            }
            None => ensure(window_is_null, "window", || {
                "window may be null only for recorder-v4 in ts-compat".into()
            })?,
        }
        ensure(
            !m.token_ids.up.is_empty()
                && !m.token_ids.down.is_empty()
                && m.token_ids.up != m.token_ids.down,
            "market",
            || "tokenIds must be distinct and non-empty".into(),
        )?;
        if let Some(cid) = &m.condition_id {
            // Characters, as JSON Schema `maxLength` and MySQL varchar(255)
            // count them (21 §3: Rust and TS reject the same values).
            ensure(
                crate::support::is_char_len_within(cid, 1, 255),
                "market",
                || "conditionId must be 1..255 characters".into(),
            )?;
        }
        m.rules.validate()?;
        self.validate_feed_availability()?;

        // Input mode specific objects (15 §5, §9).
        ensure(
            (run.input_mode == InputMode::RecorderV4) == m.recorder_v4.is_some(),
            "schema",
            || "recorderV4 is required iff inputMode is recorder-v4".into(),
        )?;
        ensure(
            (run.input_mode == InputMode::Journal) == m.journal.is_some(),
            "schema",
            || "journal is required iff inputMode is journal".into(),
        )?;
        ensure(
            run.input_mode == InputMode::TelonexDelta || m.input.sha256.is_some(),
            "schema",
            || "input.sha256 is required for recorder-v4 and journal inputs (15 §9)".into(),
        )?;
        ensure(
            is_input_format_name(&m.input.format.name) && m.input.format.version >= 1,
            "schema",
            || "input.format must be {name: ^[a-z0-9][a-z0-9-]{0,63}$, version >= 1}".into(),
        )?;
        for f in &m.feed_files {
            ensure(is_feed_symbol(&f.symbol), "schema", || {
                format!(
                    "feedFiles[].symbol {:?} must be 1..32 ASCII alphanumerics",
                    f.symbol
                )
            })?;
            ensure(is_day(&f.day), "schema", || {
                format!("feedFiles[].day {:?} must be a YYYY-MM-DD date", f.day)
            })?;
        }
        Ok(())
    }

    /// 14 §6.2: `gammaPriceToBeat` is absent iff price-to-beat was not
    /// requested, which is when `feedAvailability.priceToBeat` is null, and
    /// the status MUST be the one the producer's TS logic derives from
    /// `gammaPriceToBeat` (`wireBacktestExternalFeeds.ts:283-344`); any other
    /// combination is a producer bug, `invalid_input: feed_availability`:
    ///
    /// | `gammaPriceToBeat` | allowed `status` |
    /// |---|---|
    /// | object, `priceToBeat` set | `fed` only (a strike always feeds) |
    /// | `null` (catalog miss) | `absent_*`, `unavailable_pipeline_incomplete` |
    /// | object, both null (never synced) | `absent_*`, `unavailable_pipeline_incomplete` |
    /// | object, synced, `priceToBeat` null | `absent_*`, `unavailable_upstream_hole` |
    ///
    /// `absent_*` accepts every strike-less form because TS checks the
    /// series epoch and the fresh-market grace before it looks at the
    /// catalog row. `unavailable_*` needs a message.
    fn validate_feed_availability(&self) -> Result<(), ContractError> {
        let m = &self.market;
        let c = "feed_availability";
        let Some(p) = &m.feed_availability.price_to_beat else {
            return ensure(m.gamma_price_to_beat.is_none(), c, || {
                "gammaPriceToBeat is present but feedAvailability.priceToBeat is null".into()
            });
        };
        let Some(gamma) = &m.gamma_price_to_beat else {
            return Err(ContractError::invalid_input(
                c,
                "feedAvailability.priceToBeat is set but gammaPriceToBeat is absent",
            ));
        };
        let strike = gamma.as_ref().and_then(|g| g.price_to_beat);
        let synced = gamma.as_ref().is_some_and(|g| g.synced_at_ms.is_some());
        let consistent = match p.status {
            PriceToBeatStatus::Fed => strike.is_some(),
            PriceToBeatStatus::AbsentPreSeriesEpoch | PriceToBeatStatus::AbsentFreshMarketGrace => {
                strike.is_none()
            }
            PriceToBeatStatus::UnavailablePipelineIncomplete => strike.is_none() && !synced,
            PriceToBeatStatus::UnavailableUpstreamHole => strike.is_none() && synced,
        };
        ensure(consistent, c, || {
            format!(
                "status {} is inconsistent with gammaPriceToBeat (strike {}, synced {synced}; 14 §6.2)",
                p.status,
                if strike.is_some() { "present" } else { "absent" },
            )
        })?;
        if matches!(
            p.status,
            PriceToBeatStatus::UnavailablePipelineIncomplete
                | PriceToBeatStatus::UnavailableUpstreamHole
        ) {
            ensure(
                p.message.as_deref().is_some_and(|s| !s.is_empty()),
                c,
                || "unavailable_* requires a message".into(),
            )?;
        }
        if let Some(msg) = &p.message {
            ensure(
                !msg.is_empty() && msg.chars().count() <= 1000 && !msg.contains(['\n', '\r']),
                c,
                || "feedAvailability message must be one line of 1..1000 characters".into(),
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_window_parses_the_v1_universe() {
        // spec: 21 §5.1 market.slug (D06), 10 §5
        assert_eq!(
            slug_window("btc-updown-15m-1780272000"),
            Some((900_000, 1_780_272_000_000))
        );
        assert_eq!(
            slug_window("btc-updown-5m-1780272300"),
            Some((300_000, 1_780_272_300_000))
        );
        for bad in [
            "btc-updown-15m-1780272300",
            "btc-updown-1h-1780272000",
            "eth-updown-15m-1780272000",
            "btc-updown-15m-178027200",
            "btc-updown-15m-+780272000",
        ] {
            assert_eq!(slug_window(bad), None, "{bad}");
        }
    }

    #[test]
    fn feed_days_are_calendar_dates() {
        // spec: 14 §4.1 day files
        assert!(is_day("2026-06-01"));
        assert!(is_day("2028-02-29"));
        for bad in [
            "2026-02-29",
            "2026-13-01",
            "2026-6-01",
            "2026-06-00",
            "20260601",
        ] {
            assert!(!is_day(bad), "{bad}");
        }
    }

    /// The telonex-delta fixture job turned realistic (13 §7.3 sections),
    /// with a second candidate that varies `execution`.
    fn realistic_group_job() -> Value {
        let c = |ms: u32| serde_json::json!({"kind": "constant", "ms": ms});
        let mut v: Value = serde_json::from_str(include_str!(
            "../../../../contract/fixtures/jobs/valid/telonex-delta-ts-compat.json"
        ))
        .unwrap();
        let mc = &mut v["run"]["modelConfig"];
        mc["profile"] = "realistic".into();
        mc["execution"] = serde_json::json!({
            "models": {"latency": "exact", "fee": "schedule", "takerDelay": "on",
                       "depletion": "persistent_deficit", "maker": "queue", "reports": "settlement"},
            "compatLatency": {"delayMs": 0, "jitterMs": 0},
            "latency": {"calibrationId": "uncalibrated-2026-10", "components": {
                "place": c(58), "cancel": c(45), "ack": c(58), "cancelAck": c(45),
                "fillReport": c(58), "mined": c(2000), "confirmed": c(10000), "failed": c(2000),
                "chainSplit": c(4000), "chainMerge": c(4000)}},
            "cancelBeforeAck": "defer_until_ack",
            "makerQueue": {"cancelAheadShare": "0.5", "printMatchWindowMs": 1000, "prints": "auto"},
            "sellGate": "Mined",
            "failureRates": {"settlement": "0", "chain": "0"}
        });
        mc["clock"] = serde_json::json!({"marketData": {"calibrationId": "uncalibrated-2026-10",
                                                        "delay": c(20)}});
        let mut variant = mc["execution"].clone();
        variant["sellGate"] = "Confirmed".into();
        let cands = v["run"]["candidates"].as_array_mut().unwrap();
        let mut second = cands[0].clone();
        second["key"] = "variant".into();
        second["index"] = 1.into();
        second["execution"] = variant;
        cands.push(second);
        v
    }

    #[test]
    fn candidate_execution_errors_are_params_errors() {
        // spec: 21 §5.1 run.candidates -> invalid_input: params; §8 C4
        let v = realistic_group_job();
        EngineJob::parse(&v.to_string()).unwrap();
        let mut bad = v.clone();
        bad["run"]["candidates"][1]["execution"]["sellGate"] = Value::Null;
        bad["run"]["candidates"][1]["execution"]
            .as_object_mut()
            .unwrap()
            .remove("sellGate");
        let e = EngineJob::parse(&bad.to_string()).unwrap_err();
        assert_eq!(
            (e.class, e.cause),
            (crate::vocab::ErrorClass::InvalidInput, "params"),
            "{e}"
        );
        assert!(e.message.contains("\"variant\""), "{e}");
    }

    #[test]
    fn realistic_jobs_need_a_window_in_every_mode() {
        // spec: 21 §5.1 market.window, §5.2 (realistic: every input mode, D23)
        let mut v = realistic_group_job();
        v["run"]["inputMode"] = "recorder-v4".into();
        v["market"]["recorderV4"] = serde_json::json!({"manifest": {}, "allowGaps": false});
        v["market"]["input"]["sha256"] = "a".repeat(64).into();
        EngineJob::parse(&v.to_string()).unwrap();
        v["market"]["window"] = Value::Null;
        assert_eq!(
            EngineJob::parse(&v.to_string()).unwrap_err().cause,
            "window"
        );
    }

    #[test]
    fn condition_id_length_counts_characters() {
        // spec: 21 §3 (Rust and TS reject the same values), §11 varchar(255)
        let mut v: Value = serde_json::from_str(include_str!(
            "../../../../contract/fixtures/jobs/valid/telonex-delta-ts-compat.json"
        ))
        .unwrap();
        v["market"]["conditionId"] = "é".repeat(255).into();
        EngineJob::parse(&v.to_string()).unwrap();
        v["market"]["conditionId"] = "é".repeat(256).into();
        assert_eq!(
            EngineJob::parse(&v.to_string()).unwrap_err().cause,
            "market"
        );
    }

    #[test]
    fn non_json_and_non_object_jobs_are_schema_errors() {
        // spec: 21 §19 Rust ingress, 20 §4.1 invalid_input causes
        for text in ["", "[]", "{", "null"] {
            let e = EngineJob::parse(text).unwrap_err();
            assert!(e.is_invalid_input_schema(), "{text:?}: {e}");
        }
        let e = EngineJob::parse("{}").unwrap_err();
        assert_eq!(e.cause, "version");
    }
}
