//! Job loading and validation (21 §5, §5.1, §8, §19 "Rust ingress"): strict
//! parse through `pmb-contract`, version checks, the M1 capability checks
//! (profile, input mode, rules table, features), market identity, output
//! paths and the candidate's params.

use pmb_contract::job::EngineJob;
use pmb_contract::model_config::ModelConfig;
use pmb_contract::num::Sha256Hex;
use pmb_contract::result::{Echo, MarketEcho};
use pmb_contract::vocab::{InputMode, Profile, TraceLevel};
use pmb_contract::{JOB_SCHEMA_VERSION, MODEL_CONFIG_VERSION};
use pmb_core::ids::{ConditionId, TokenId};
use pmb_core::rules::RulesTableVersion;
use pmb_engine::strategy::{Interests, Requirements};
use pmb_engine::Strategy;
use serde_json::{Map, Value};
use std::path::PathBuf;

use crate::describe::{evaluate, has_feature, requests_nothing};
use crate::error::EngineError;
use crate::identity::engine_identity;
use crate::inputs::{provenance, rules_source_vocab};
use crate::io::local_abs_path;
use crate::params::{params_equal, ParamError, StrategyParams};

/// CLI overrides of the non-semantic `outputs` section (20 §5.4).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OutputOverrides {
    /// `--trace <path>`.
    pub trace_path: Option<String>,
    /// `--trace-level decisions|feeds`.
    pub trace_level: Option<TraceLevel>,
}

/// A requested parity trace (22 §3).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TraceRequest {
    /// Absolute output path.
    pub path: PathBuf,
    /// Level.
    pub level: TraceLevel,
}

/// The single candidate of a `run` job, resolved (21 §8).
pub struct CandidatePlan<P> {
    /// Candidate key.
    pub key: String,
    /// Candidate index (0).
    pub index: u32,
    /// Typed params.
    pub params: P,
    /// Normalized params.
    pub normalized: Map<String, Value>,
    /// Effective ModelConfig (21 §1.1).
    pub model_config: ModelConfig,
    /// Its `modelConfigSha256`.
    pub model_config_sha256: Sha256Hex,
    /// Requirements evaluated at load (the `describe` evaluation).
    pub requirements: Requirements,
    /// Interests evaluated at load.
    pub interests: Interests,
}

/// A validated `run` job.
pub struct JobPlan<P> {
    /// The job as parsed.
    pub job: EngineJob,
    /// The echo of the result (21 §10).
    pub echo: Echo,
    /// The one candidate.
    pub candidate: CandidatePlan<P>,
    /// Rules table of the run.
    pub rules_table: RulesTableVersion,
    /// Requested trace, after CLI overrides.
    pub trace: Option<TraceRequest>,
}

/// A job that failed after it was read: the error plus the echo when it
/// could be built (21 §10: `echo` is null only before the job was read).
#[derive(Debug)]
pub struct JobError {
    /// The error.
    pub error: EngineError,
    /// The echo, when available (boxed to keep the `Result` small).
    pub echo: Option<Box<Echo>>,
    /// The market echo; present iff `echo` is (21 §10).
    pub market: Option<Box<MarketEcho>>,
}

impl From<EngineError> for JobError {
    fn from(error: EngineError) -> JobError {
        JobError {
            error,
            echo: None,
            market: None,
        }
    }
}

/// The market echo of a read job before its input is decoded (21 §10):
/// no counted tick yet, so `conditionId` is null; `rulesSource` from the
/// job's captured rules under `table` (11 RS4).
pub fn market_echo(job: &EngineJob, table: RulesTableVersion) -> MarketEcho {
    MarketEcho {
        slug: job.market.slug.clone(),
        condition_id: None,
        rules_source: rules_source_vocab(provenance(&job.market.rules.captured, table).source()),
    }
}

/// Parses a job document strictly (21 §3: unknown fields are rejected).
/// The causes follow 21 §5.1: a foreign `jobSchemaVersion` is
/// `invalid_input: version`, a foreign `modelConfigVersion` is
/// `invalid_input: model_config`, an input mode that is not native
/// (`recorded`, `telonex-paired`, or any other string) is
/// `invalid_input: input_mode`; any other mismatch is `invalid_input: schema`.
pub fn parse_job(bytes: &[u8]) -> Result<EngineJob, EngineError> {
    let v: Value = serde_json::from_slice(bytes)
        .map_err(|e| EngineError::invalid_input("schema", format!("job is not JSON: {e}")))?;
    let Value::Object(top) = &v else {
        return Err(EngineError::invalid_input(
            "schema",
            "job is not a JSON object",
        ));
    };
    match top.get("jobSchemaVersion") {
        Some(Value::Number(n)) if n.as_u64() == Some(u64::from(JOB_SCHEMA_VERSION)) => {}
        Some(other) => {
            return Err(EngineError::invalid_input(
                "version",
                format!(
                    "jobSchemaVersion {other} is not supported (this binary accepts [{JOB_SCHEMA_VERSION}])"
                ),
            ))
        }
        None => {
            return Err(EngineError::invalid_input(
                "schema",
                "missing jobSchemaVersion",
            ))
        }
    }
    if let Some(mcv) = v.pointer("/run/modelConfig/modelConfigVersion") {
        if mcv.as_u64() != Some(u64::from(MODEL_CONFIG_VERSION)) {
            return Err(EngineError::invalid_input(
                "model_config",
                format!(
                    "modelConfigVersion {mcv} is not supported (this binary accepts [{MODEL_CONFIG_VERSION}])"
                ),
            ));
        }
    }
    if let Some(Value::String(mode)) = v.pointer("/run/inputMode") {
        if !InputMode::ALL.iter().any(|m| m.as_str() == mode) {
            return Err(EngineError::invalid_input(
                "input_mode",
                format!(
                    "input mode {mode:?} is not a native input mode (20 §5.6; native modes: {})",
                    InputMode::ALL
                        .iter()
                        .map(|m| m.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            ));
        }
    }
    serde_json::from_slice::<EngineJob>(bytes)
        .map_err(|e| EngineError::invalid_input("schema", format!("job: {e}")))
}

fn model_config_sha(mc: &ModelConfig) -> Result<Sha256Hex, EngineError> {
    mc.sha256()
        .map_err(|e| EngineError::invalid_input("model_config", e.to_string()))
}

/// The echo of a parsed job (21 §10, §12).
pub fn echo_of(job: &EngineJob) -> Result<Echo, EngineError> {
    let mc = &job.run.model_config;
    let id = engine_identity();
    Ok(Echo {
        engine_version: id.engine_version.to_string(),
        engine_commit: id.engine_commit.to_string(),
        strategy_id: job.run.strategy_id.clone(),
        job_schema_version: JOB_SCHEMA_VERSION,
        profile: mc.profile,
        seed: mc.seed,
        model_config_sha256: model_config_sha(mc)?,
        rules_table_version: mc.rules.rules_table_version.clone(),
        snapshot_parser_version: job.market.rules.snapshot_parser_version,
    })
}

fn params_message(errs: &[ParamError]) -> String {
    let parts: Vec<String> = errs
        .iter()
        .map(|e| {
            if e.path.is_empty() {
                e.message.clone()
            } else {
                format!("{}: {}", e.path, e.message)
            }
        })
        .collect();
    format!("invalid params: {}", parts.join("; "))
}

/// Validates a parsed job for `run` against this binary (21 §5.1, §19)
/// and resolves its candidate.
pub fn plan_job<T>(
    job: EngineJob,
    overrides: &OutputOverrides,
) -> Result<JobPlan<T::Params>, JobError>
where
    T: Strategy,
    T::Params: StrategyParams,
{
    let echo = echo_of(&job)?;
    match plan_inner::<T>(&job, overrides) {
        Ok((candidate, rules_table, trace)) => Ok(JobPlan {
            job,
            echo,
            candidate,
            rules_table,
            trace,
        }),
        // `echo` and `market` are present together (21 §10); without a
        // known rules table there is no `rulesSource`, so both are null
        // (the error is then `invalid_input`, which may precede the read).
        Err(error) => {
            let market = RulesTableVersion::parse(&job.run.model_config.rules.rules_table_version)
                .map(|t| market_echo(&job, t));
            Err(JobError {
                error,
                echo: market.is_some().then(|| Box::new(echo)),
                market: market.map(Box::new),
            })
        }
    }
}

type Planned<P> = (CandidatePlan<P>, RulesTableVersion, Option<TraceRequest>);

/// The trace output in effect (20 §5.4: `--trace`/`--trace-level` override
/// `job.outputs`). Every given path is checked (21 §5.1, also the job's
/// when a flag overrides it), `--trace-level` without a path is refused
/// (R14), and a trace is refused while this binary lacks the feature
/// (20 §3 `features`), before any input is decoded.
pub fn trace_request(
    job: &EngineJob,
    overrides: &OutputOverrides,
) -> Result<Option<TraceRequest>, EngineError> {
    let from_job = job
        .outputs
        .trace_path
        .as_deref()
        .map(|p| local_abs_path(p, "outputs.tracePath"))
        .transpose()?;
    let from_flag = overrides
        .trace_path
        .as_deref()
        .map(|p| local_abs_path(p, "--trace"))
        .transpose()?;
    let Some(path) = from_flag.or(from_job) else {
        if overrides.trace_level.is_some() {
            return Err(EngineError::invalid_input(
                "flag",
                "--trace-level needs a trace path (--trace or outputs.tracePath)",
            ));
        }
        return Ok(None);
    };
    let level = overrides.trace_level.unwrap_or(job.outputs.trace_level);
    let feature = match level {
        TraceLevel::Decisions => "parity_trace",
        TraceLevel::Feeds => "parity_trace_feeds",
    };
    if !has_feature(feature) {
        return Err(EngineError::invalid_input(
            "flag",
            format!(
                "a parity trace needs feature {feature}, which this binary lacks before \
                 integration (intent and event records, 22 §3.2)"
            ),
        ));
    }
    Ok(Some(TraceRequest { path, level }))
}

fn plan_inner<T>(
    job: &EngineJob,
    overrides: &OutputOverrides,
) -> Result<Planned<T::Params>, EngineError>
where
    T: Strategy,
    T::Params: StrategyParams,
{
    job.validate()?;
    let run = &job.run;
    let mc = &run.model_config;
    let m = &job.market;

    if run.strategy_id != T::ID {
        return Err(EngineError::invalid_input(
            "strategy_id",
            format!(
                "job strategyId {:?} is not this binary's strategy {:?}",
                run.strategy_id,
                T::ID
            ),
        ));
    }
    match run.input_mode {
        InputMode::TelonexDelta => {}
        InputMode::RecorderV4 => {
            return Err(EngineError::invalid_input(
                "input_mode",
                "input mode recorder-v4 is not supported before M7",
            ))
        }
        InputMode::Journal => {
            return Err(EngineError::invalid_input(
                "input_mode",
                "input mode journal is not supported before M8",
            ))
        }
    }
    match mc.profile {
        Profile::TsCompat => {}
        Profile::Realistic => {
            return Err(EngineError::invalid_input(
                "profile",
                "profile realistic is not supported before M3b",
            ))
        }
    }
    let rules_table = RulesTableVersion::parse(&mc.rules.rules_table_version).ok_or_else(|| {
        EngineError::invalid_input(
            "rules_table_version",
            format!(
                "rulesTableVersion {:?} is not compiled into this binary",
                mc.rules.rules_table_version
            ),
        )
    })?;
    if run.candidates.len() != 1 {
        return Err(EngineError::invalid_input(
            "params",
            format!(
                "run takes exactly one candidate, got {} (candidate groups: run-group, M4)",
                run.candidates.len()
            ),
        ));
    }
    if m.own_activity.is_some() {
        return Err(EngineError::invalid_input(
            "schema",
            "market.ownActivity requires feature own_activity, which this binary lacks",
        ));
    }
    if job.outputs.ledger_path.is_some() {
        return Err(EngineError::invalid_input(
            "flag",
            "outputs.ledgerPath requires feature ledger, which lands in M3b",
        ));
    }
    if let Some(cid) = &m.condition_id {
        ConditionId::parse(cid).map_err(|e| {
            EngineError::invalid_input("market", format!("conditionId {cid:?}: {e:?}"))
        })?;
    }
    for (name, t) in [("UP", &m.token_ids.up), ("DOWN", &m.token_ids.down)] {
        TokenId::parse(t)
            .map_err(|e| EngineError::invalid_input("market", format!("tokenIds.{name}: {e:?}")))?;
    }
    local_abs_path(&m.input.path, "market.input.path")?;
    for f in &m.feed_files {
        local_abs_path(&f.path, "market.feedFiles[].path")?;
    }

    // Outputs: CLI flags override the job (20 §5.4); never result-affecting.
    let trace = trace_request(job, overrides)?;

    // The candidate (21 §8): params must be describe-normalized (C2).
    let cand = &run.candidates[0];
    let ev = evaluate::<T>(&cand.params)
        .map_err(|errs| EngineError::invalid_input("params", params_message(&errs)))?;
    if !params_equal(
        &Value::Object(ev.normalized.clone()),
        &Value::Object(cand.params.clone()),
    ) {
        return Err(EngineError::invalid_input(
            "params",
            "candidate params are not describe-normalized (21 §8 C2)",
        ));
    }
    if !requests_nothing(&ev.requirements) {
        // Seam: pmb-feeds and pmb-plugins are wired at integration.
        return Err(EngineError::invalid_input(
            "unsupported_feed",
            "feeds and plugins are not wired before integration",
        ));
    }
    let effective = mc.effective(cand.execution.as_ref());
    let effective_sha = model_config_sha(&effective)?;
    Ok((
        CandidatePlan {
            key: cand.key.clone(),
            index: cand.index,
            params: ev.params,
            normalized: ev.normalized,
            model_config: effective,
            model_config_sha256: effective_sha,
            requirements: ev.requirements,
            interests: ev.interests,
        },
        rules_table,
        trace,
    ))
}
