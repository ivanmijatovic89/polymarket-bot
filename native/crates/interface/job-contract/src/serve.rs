//! The `serve` message unions (20 §6.2; schemas `serveIn` and `serveOut`,
//! 20 §5.2, 21 §3). NDJSON, one message per line, tagged by `type`.
//!
//! [`ServeIn`] (TS to binary) is parsed by the binary and closed: a malformed
//! line, an unknown `type`, an unknown envelope field or a framing violation
//! is fatal (20 §6.2). The run section of a `context` and the job of a `job`
//! stay JSON at that level: [`resolve_job`] parses each job on its own,
//! through the same [`EngineJob::parse_value`] path as `run`, so an invalid
//! job gets its own `result` with its 21 §5.1 cause, identical to `run`
//! (20 §6.3 S1), and no other in-flight job is affected.
//! [`ServeOut`] (binary to TS) is emitted by the binary and validated by the
//! shim against the `serveOut` schema; Rust never parses it back, because an
//! `EngineResult` inside an internally tagged enum cannot carry exact
//! output-number tokens through serde's buffering (21 §18 N5).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::job::{EngineJob, JobBudget, JobOutputs, MarketSection, RunSection, JOB_SCHEMA_VERSION};
use crate::num::{SafeU64, Sha256Hex};
use crate::result::{EngineResult, CAUSE_PATTERN, SEMVER_PATTERN};
use crate::support::{ensure, ContractError, Version};
use crate::vocab::{EffectiveQos, ErrorClass, QosClass};

/// `protocolVersion` of this document (20 §3).
pub const PROTOCOL_VERSION: u32 = 2;

/// Pattern of the opaque ids TS chooses (`jobId`, `contextId`).
// D-PENDING: 20 §6.2 does not type `jobId`, `contextId` or the `ping` id;
// chose printable ASCII without spaces, 1..256 characters, for the first two
// (BullMQ job ids, a sha256 hex for contexts) and a safe integer for `id`.
pub const PROTOCOL_ID_PATTERN: &str = r"^[!-~]{1,256}$";

fn is_protocol_id(s: &str) -> bool {
    (1..=256).contains(&s.len()) && s.bytes().all(|b| (b'!'..=b'~').contains(&b))
}

/// TS to binary (20 §6.2).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ServeIn {
    /// Caches the run-level section under `contextId`; idempotent. The
    /// binary parses it with each job that references it (20 §6.3 S1).
    #[serde(rename_all = "camelCase")]
    Context {
        #[schemars(regex(pattern = PROTOCOL_ID_PATTERN))]
        context_id: String,
        #[schemars(with = "RunSection")]
        run: Box<Value>,
    },
    /// Starts a job; `job.run` is inline or replaced by `job.runRef`. An
    /// invalid job gets its own error result, as in `run` (20 §6.3 S1).
    #[serde(rename_all = "camelCase")]
    Job {
        #[schemars(regex(pattern = PROTOCOL_ID_PATTERN))]
        job_id: String,
        #[schemars(with = "ServeJob")]
        job: Box<Value>,
    },
    /// Cooperative abort; the job returns class `canceled`.
    #[serde(rename_all = "camelCase")]
    Cancel {
        #[schemars(regex(pattern = PROTOCOL_ID_PATTERN))]
        job_id: String,
    },
    /// Liveness probe.
    Ping { id: SafeU64 },
    /// Accept no new jobs, finish in-flight jobs, emit `drained`, exit 0.
    Drain,
}

/// An `EngineJob` whose run section is inline (`run`) or a cached context
/// (`runRef`), exactly one of the two (20 §6.2).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServeJob {
    pub job_schema_version: Version<JOB_SCHEMA_VERSION>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "RunSection")]
    pub run: Option<RunSection>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "String", regex(pattern = PROTOCOL_ID_PATTERN))]
    pub run_ref: Option<String>,
    pub market: MarketSection,
    pub outputs: JobOutputs,
    pub budget: JobBudget,
}

impl ServeIn {
    /// Parses one stdin line. Any failure is fatal for the process
    /// (`invalid_input: schema`, 20 §6.2): malformed JSON, an unknown
    /// `type`, an unknown envelope field, a bad id, a `context.run` or `job`
    /// that is not an object, or a job without exactly one of `run` and a
    /// string `runRef`. The job content is not read here (see
    /// [`resolve_job`]).
    pub fn parse_line(line: &str) -> Result<ServeIn, ContractError> {
        let msg: ServeIn = serde_json::from_str(line)
            .map_err(|e| ContractError::invalid_input("schema", e.to_string()))?;
        msg.validate()?;
        Ok(msg)
    }

    /// Envelope rules beyond the serde shape (fatal, 20 §6.2).
    pub fn validate(&self) -> Result<(), ContractError> {
        let id_ok = |id: &str| {
            ensure(is_protocol_id(id), "schema", || {
                format!("id {id:?} must be 1..256 printable ASCII characters")
            })
        };
        match self {
            ServeIn::Context { context_id, run } => {
                id_ok(context_id)?;
                ensure(run.is_object(), "schema", || {
                    "context.run must be a JSON object".into()
                })
            }
            ServeIn::Job { job_id, job } => {
                id_ok(job_id)?;
                let Some(obj) = job.as_object() else {
                    return Err(ContractError::invalid_input(
                        "schema",
                        "job must be a JSON object",
                    ));
                };
                ensure(
                    obj.contains_key("run") != obj.contains_key("runRef"),
                    "schema",
                    || "a serve job carries exactly one of run and runRef".into(),
                )?;
                match obj.get("runRef") {
                    None => Ok(()),
                    Some(Value::String(id)) => id_ok(id),
                    Some(_) => Err(ContractError::invalid_input(
                        "schema",
                        "job.runRef must be a string",
                    )),
                }
            }
            ServeIn::Cancel { job_id } => id_ok(job_id),
            ServeIn::Ping { .. } | ServeIn::Drain => Ok(()),
        }
    }
}

/// The complete, validated job of a `job` message whose envelope passed
/// [`ServeIn::validate`] (20 §6.2). `runRef` is resolved by `lookup` to
/// the cached `context.run`; an unknown context is
/// `invalid_input: context_missing`. The job is then parsed exactly as
/// `run` parses a job file ([`EngineJob::parse_value`]: strict schema,
/// 21 §5.1 causes, [`EngineJob::validate`]), so its error, if any, is the
/// per-job result `run` would give (20 §6.3 S1).
///
/// A referenced context is read in place: the job and the cached run
/// section are deserialized separately, without copying either document
/// (R8). Only when one of them fails does it build the combined document,
/// so the error is the exact one `run` reports for it.
pub fn resolve_job<'a>(
    job: &Value,
    lookup: impl FnOnce(&str) -> Option<&'a Value>,
) -> Result<EngineJob, ContractError> {
    let Some(obj) = job.as_object() else {
        return Err(ContractError::invalid_input(
            "schema",
            "job must be a JSON object",
        ));
    };
    match obj.get("runRef") {
        None => EngineJob::parse_value(job),
        Some(r) => {
            let id = r.as_str().unwrap_or_default();
            let run_doc = lookup(id).ok_or_else(|| {
                ContractError::invalid_input("context_missing", format!("unknown runRef {id:?}"))
            })?;
            // The job's fields equal EngineJob's with `run` replaced by
            // `runRef`, so both parts deserialize iff the combined document
            // does, to the same values.
            if let (Ok(part), Ok(run)) =
                (ServeJob::deserialize(job), RunSection::deserialize(run_doc))
            {
                let resolved = EngineJob {
                    job_schema_version: part.job_schema_version,
                    run,
                    market: part.market,
                    outputs: part.outputs,
                    budget: part.budget,
                };
                resolved.validate()?;
                return Ok(resolved);
            }
            let mut doc = obj.clone();
            doc.remove("runRef");
            doc.insert("run".into(), run_doc.clone());
            EngineJob::parse_value(&Value::Object(doc))
        }
    }
}

/// Binary to TS (20 §6.2). Serialize-only (see the module docs).
#[derive(Clone, Debug, PartialEq, Serialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ServeOut {
    /// First line, exactly once.
    Ready(Box<Ready>),
    /// Exactly one per accepted job, including canceled and failed jobs.
    #[serde(rename_all = "camelCase")]
    Result {
        #[schemars(regex(pattern = PROTOCOL_ID_PATTERN))]
        job_id: String,
        result: Box<EngineResult>,
    },
    /// At most once per second per job.
    #[serde(rename_all = "camelCase")]
    Progress {
        #[schemars(regex(pattern = PROTOCOL_ID_PATTERN))]
        job_id: String,
        events_processed: SafeU64,
        elapsed_ms: SafeU64,
        in_callback: Option<InCallback>,
    },
    /// Reply to `ping`.
    #[serde(rename_all = "camelCase")]
    Pong {
        id: SafeU64,
        inflight: Vec<InflightJob>,
        rss_bytes: SafeU64,
        cache_bytes: SafeU64,
    },
    /// Back-pressure from the RSS limit.
    Busy {
        reason: String,
    },
    Idle {
        reason: String,
    },
    /// After `drain`; then exit 0.
    Drained {
        completed: SafeU64,
    },
    /// Last line before a non-zero exit.
    Fatal {
        class: ErrorClass,
        #[schemars(regex(pattern = CAUSE_PATTERN))]
        cause: String,
        #[schemars(length(max = 1000), regex(pattern = r"^[^\n\r]*$"))]
        message: String,
    },
}

/// The `ready` line (20 §6.2, 16 §10.1-§10.2).
#[derive(Clone, Debug, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Ready {
    pub protocol_version: Version<PROTOCOL_VERSION>,
    pub contract_sha256: Sha256Hex,
    #[schemars(regex(pattern = SEMVER_PATTERN))]
    pub engine_version: String,
    #[schemars(length(min = 1))]
    pub strategy_id: String,
    pub pid: u32,
    #[schemars(range(min = 1, max = 256))]
    pub threads: u16,
    #[schemars(range(min = 1))]
    pub max_inflight: u32,
    pub job_schema_versions: Vec<u32>,
    pub stack_bytes: SafeU64,
    pub qos: Qos,
    /// The process role read back after the class is set (16 §10.2).
    #[schemars(regex(pattern = r"^[a-z][a-z0-9_-]{0,63}$"))]
    pub process_role: String,
    pub perf_levels: Vec<PerfLevel>,
}

/// Requested and effective thread QoS (16 §10.2).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Qos {
    pub requested: QosClass,
    pub effective: EffectiveQos,
}

/// One `hw.perflevelN` entry (16 §10.1).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PerfLevel {
    #[schemars(length(min = 1, max = 64))]
    pub name: String,
    pub physical_cpu: u32,
}

/// A candidate inside strategy code for more than 1 s (40 §8.2.3, 41 §8).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InCallback {
    pub candidate_index: u32,
    #[schemars(regex(pattern = crate::job::CANDIDATE_KEY_PATTERN))]
    pub candidate_key: String,
    #[schemars(length(min = 1, max = 64))]
    pub callback: String,
    pub since_ms: SafeU64,
}

/// One in-flight job in `pong`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InflightJob {
    #[schemars(regex(pattern = PROTOCOL_ID_PATTERN))]
    pub job_id: String,
    pub events_processed: SafeU64,
    pub elapsed_ms: SafeU64,
    pub in_callback: Option<InCallback>,
}

impl ServeOut {
    /// One compact NDJSON line without the trailing newline (G1, G10).
    pub fn to_line(&self) -> String {
        serde_json::to_string(self).expect("serve messages serialize")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn job_fixture() -> EngineJob {
        serde_json::from_str(include_str!(
            "../../../../contract/fixtures/jobs/valid/telonex-delta-ts-compat.json"
        ))
        .unwrap()
    }

    #[test]
    fn serve_in_messages_parse_and_resolve() {
        // spec: 20 §6.2 (context, job with runRef, cancel, ping, drain)
        let job = job_fixture();
        let ctx = json!({"type": "context", "contextId": "ctx-1", "run": job.run});
        let ServeIn::Context { run, .. } = ServeIn::parse_line(&ctx.to_string()).unwrap() else {
            panic!("context");
        };
        let mut serve_job = serde_json::to_value(&job).unwrap();
        let obj = serve_job.as_object_mut().unwrap();
        obj.remove("run");
        obj.insert("runRef".into(), json!("ctx-1"));
        let line = json!({"type": "job", "jobId": "bull:42", "job": serve_job}).to_string();
        let ServeIn::Job { job: sj, .. } = ServeIn::parse_line(&line).unwrap() else {
            panic!("job");
        };
        let resolved = resolve_job(&sj, |id| (id == "ctx-1").then_some(&*run)).unwrap();
        assert_eq!(resolved, job);
        let missing = resolve_job(&sj, |_| None).unwrap_err();
        assert_eq!(missing.cause, "context_missing");
        let inline = serde_json::to_value(&job).unwrap();
        assert_eq!(resolve_job(&inline, |_| None).unwrap(), job);
        for line in [
            r#"{"type":"cancel","jobId":"bull:42"}"#,
            r#"{"type":"ping","id":7}"#,
            r#"{"type":"drain"}"#,
        ] {
            let msg = ServeIn::parse_line(line).unwrap();
            assert_eq!(serde_json::to_string(&msg).unwrap(), line);
        }
    }

    #[test]
    fn serve_in_protocol_violations_are_fatal_schema_errors() {
        // spec: 20 §6.2 (malformed line, unknown type or field is fatal)
        let job = job_fixture();
        let both = json!({"type": "job", "jobId": "j", "job": {
            "jobSchemaVersion": 1, "run": job.run, "runRef": "ctx",
            "market": job.market, "outputs": job.outputs, "budget": job.budget}});
        let neither = json!({"type": "job", "jobId": "j", "job": {
            "jobSchemaVersion": 1, "market": job.market, "outputs": job.outputs,
            "budget": job.budget}});
        for line in [
            "not json".to_owned(),
            r#"{"type":"shutdown"}"#.to_owned(),
            r#"{"type":"ping","id":7,"extra":1}"#.to_owned(),
            r#"{"type":"cancel","jobId":"has space"}"#.to_owned(),
            both.to_string(),
            neither.to_string(),
            r#"{"type":"job","jobId":"j","job":5}"#.to_owned(),
            r#"{"type":"job","jobId":"j","job":{"runRef":7}}"#.to_owned(),
            r#"{"type":"context","contextId":"c","run":[]}"#.to_owned(),
        ] {
            let e = ServeIn::parse_line(&line).unwrap_err();
            assert_eq!(
                (e.class, e.cause),
                (ErrorClass::InvalidInput, "schema"),
                "{line}"
            );
        }
    }

    /// An invalid job is a per-job error with the cause `run` gives for the
    /// same job, never a fatal protocol error, inline or through a context.
    #[test]
    fn invalid_jobs_get_the_run_error_not_a_fatal_one() {
        // spec: 20 §6.3 S1 (serve result == run result), §6.2; 21 §5.1 causes
        let job = serde_json::to_value(job_fixture()).unwrap();
        type Patch = fn(&mut Value);
        let patches: [(&str, Patch); 5] = [
            ("rules", |j| {
                j["market"]["rules"]["captured"]["takerBaseFee"] =
                    json!({"value": "0", "origin": "gamma", "phase": "pre_start", "snapshotId": 5});
            }),
            ("window", |j| j["market"]["window"]["startMs"] = json!("x")),
            ("version", |j| j["jobSchemaVersion"] = json!(2)),
            ("path", |j| {
                j["market"]["input"]["path"] = json!("r2://bucket/x.parquet")
            }),
            ("model_config", |j| {
                j["run"]["modelConfig"]["capital"]["startingCapitalUsdc"] = json!(500)
            }),
        ];
        for (cause, patch) in patches {
            let mut bad = job.clone();
            patch(&mut bad);
            let run_err = EngineJob::parse(&bad.to_string()).unwrap_err();
            assert_eq!(run_err.cause, cause, "{run_err}");
            // Inline run.
            let line = json!({"type": "job", "jobId": "j1", "job": bad}).to_string();
            let ServeIn::Job { job: sj, .. } = ServeIn::parse_line(&line).unwrap() else {
                panic!("job");
            };
            assert_eq!(resolve_job(&sj, |_| None).unwrap_err(), run_err, "{cause}");
            // Through a context.
            let run = bad["run"].clone();
            let mut by_ref = bad.clone();
            let obj = by_ref.as_object_mut().unwrap();
            obj.remove("run");
            obj.insert("runRef".into(), json!("ctx"));
            let ctx = json!({"type": "context", "contextId": "ctx", "run": run}).to_string();
            let ServeIn::Context { run, .. } = ServeIn::parse_line(&ctx).unwrap() else {
                panic!("context");
            };
            assert_eq!(
                resolve_job(&by_ref, |_| Some(&*run)).unwrap_err(),
                run_err,
                "{cause} by ref"
            );
        }
    }

    #[test]
    fn serve_out_lines_are_compact_and_tagged() {
        // spec: 20 §6.2 (binary to TS), G1 (one compact JSON object per line)
        let ready = ServeOut::Ready(Box::new(Ready {
            protocol_version: Version,
            contract_sha256: Sha256Hex::parse(&"a".repeat(64)).unwrap(),
            engine_version: "1.0.0".into(),
            strategy_id: "engine-exerciser.v2.rs".into(),
            pid: 4242,
            threads: 8,
            max_inflight: 8,
            job_schema_versions: vec![1],
            stack_bytes: SafeU64::new(8_388_608).unwrap(),
            qos: Qos {
                requested: QosClass::Default,
                effective: EffectiveQos::Default,
            },
            process_role: "default".into(),
            perf_levels: vec![PerfLevel {
                name: "Performance".into(),
                physical_cpu: 4,
            }],
        }));
        let line = ready.to_line();
        assert!(
            line.starts_with(r#"{"type":"ready","protocolVersion":2,"#),
            "{line}"
        );
        assert!(!line.contains('\n'));
        let progress = ServeOut::Progress {
            job_id: "bull:42".into(),
            events_processed: SafeU64::new(10).unwrap(),
            elapsed_ms: SafeU64::new(1000).unwrap(),
            in_callback: None,
        };
        assert_eq!(
            progress.to_line(),
            r#"{"type":"progress","jobId":"bull:42","eventsProcessed":10,"elapsedMs":1000,"inCallback":null}"#
        );
        assert_eq!(
            ServeOut::Drained {
                completed: SafeU64::new(3).unwrap()
            }
            .to_line(),
            r#"{"type":"drained","completed":3}"#
        );
    }
}
