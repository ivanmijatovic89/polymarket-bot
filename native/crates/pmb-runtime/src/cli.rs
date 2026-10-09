//! Command line of a strategy binary (20 §1, §5): hand-parsed, strict
//! (R14: unknown subcommands, flags and repeated flags exit 2 with an error
//! document), one stdout document per invocation (G1).

use std::io::Read;
use std::path::PathBuf;

use pmb_contract::result::ErrorDetail;
use pmb_contract::vocab::TraceLevel;
use pmb_engine::Strategy;
use serde_json::{json, Map, Value};

use crate::backend::Backend;
use crate::describe::{describe_doc, evaluate, result_entry, schema_doc};
use crate::error::{EngineError, MESSAGE_MAX_CHARS};
use crate::identity::PROTOCOL_VERSION;
use crate::io::{local_abs_path, read_capped, read_document_file, DOCUMENT_CAP_BYTES};
use crate::job::OutputOverrides;
use crate::params::{ParamError, StrategyParams};
use crate::run::{
    error_outcome, on_job_thread, run_job_bytes, JobClock, RunOutcome, DEFAULT_STACK_MB,
};
use crate::selftest::selftest;

/// Largest accepted `--stack-mb` (measurement option, 16 EX-6).
pub const MAX_STACK_MB: usize = 1024;

/// Where `run` reads its job.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JobSource {
    /// `--job -`: stdin, capped at 64 MiB (G9).
    Stdin,
    /// `--job <abs path>`.
    File(PathBuf),
}

/// Arguments of `run` (20 §5.4).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunArgs {
    /// The job.
    pub job: JobSource,
    /// Output overrides (`--trace`, `--trace-level`).
    pub overrides: OutputOverrides,
    /// Job thread stack in MiB (G11).
    pub stack_mb: usize,
    /// `--tape-dir` (16 §7.5). Process configuration, never
    /// result-affecting (G5).
    // D-PENDING: derived tapes (16 §7.5 NT-5) are not built yet; the flag is
    // validated and the canonical file is always read (`inputPath: v1`),
    // which 20 §6.1 allows ("a bad or stale tape is never an error").
    pub tape_dir: Option<PathBuf>,
}

/// A parsed command line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Command {
    /// `describe [--params <json>] [--params-file <path>]`.
    Describe {
        /// `--params`.
        params: Option<String>,
        /// `--params-file`.
        params_file: Option<PathBuf>,
    },
    /// `schema`.
    Schema,
    /// `selftest`.
    Selftest,
    /// `run`.
    Run(RunArgs),
}

/// What the process prints and returns.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Outcome {
    /// The one stdout document (G1).
    pub document: String,
    /// Exit code (20 §4).
    pub exit_code: i32,
    /// The last stderr line on a non-zero exit (20 §4).
    pub reason: Option<String>,
}

fn args_error(message: impl Into<String>) -> EngineError {
    EngineError::invalid_input("args", message)
}

/// Splits `--name value` / `--name=value` flags; every flag takes a value.
fn flags(rest: &[String], allowed: &[&str]) -> Result<Vec<(String, String)>, EngineError> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut i = 0;
    while i < rest.len() {
        let a = &rest[i];
        let Some(body) = a.strip_prefix("--") else {
            return Err(args_error(format!("unexpected argument {a:?}")));
        };
        let (name, value) = match body.split_once('=') {
            Some((n, v)) => (n.to_string(), v.to_string()),
            None => {
                let v = rest
                    .get(i + 1)
                    .ok_or_else(|| args_error(format!("--{body} needs a value")))?;
                i += 1;
                (body.to_string(), v.clone())
            }
        };
        if !allowed.contains(&name.as_str()) {
            return Err(args_error(format!(
                "unknown flag --{name} (accepted: {})",
                allowed
                    .iter()
                    .map(|f| format!("--{f}"))
                    .collect::<Vec<_>>()
                    .join(", ")
            )));
        }
        if out.iter().any(|(n, _)| *n == name) {
            return Err(args_error(format!("--{name} given twice")));
        }
        out.push((name, value));
        i += 1;
    }
    Ok(out)
}

fn take(fl: &mut Vec<(String, String)>, name: &str) -> Option<String> {
    let i = fl.iter().position(|(n, _)| n == name)?;
    Some(fl.remove(i).1)
}

/// Parses the arguments after the program name.
pub fn parse(args: &[String]) -> Result<Command, EngineError> {
    let Some(sub) = args.first() else {
        return Err(args_error(
            "missing subcommand (describe | schema | selftest | run)",
        ));
    };
    let rest = &args[1..];
    match sub.as_str() {
        "describe" => {
            let mut fl = flags(rest, &["params", "params-file"])?;
            let params = take(&mut fl, "params");
            let params_file = take(&mut fl, "params-file")
                .map(|p| local_abs_path(&p, "--params-file"))
                .transpose()?;
            if params.is_some() && params_file.is_some() {
                return Err(args_error("--params and --params-file are exclusive"));
            }
            Ok(Command::Describe {
                params,
                params_file,
            })
        }
        "schema" | "selftest" => {
            if let Some(a) = rest.first() {
                return Err(args_error(format!("{sub} takes no arguments, got {a:?}")));
            }
            Ok(if sub == "schema" {
                Command::Schema
            } else {
                Command::Selftest
            })
        }
        "run" => {
            let mut fl = flags(
                rest,
                &[
                    "job",
                    "trace",
                    "trace-level",
                    "ledger",
                    "sim-trace",
                    "stack-mb",
                    "tape-dir",
                ],
            )?;
            if take(&mut fl, "ledger").is_some() {
                return Err(EngineError::invalid_input(
                    "flag",
                    "--ledger needs feature ledger, which lands in M3b",
                ));
            }
            if take(&mut fl, "sim-trace").is_some() {
                return Err(EngineError::invalid_input(
                    "flag",
                    "--sim-trace needs feature sim_trace, which lands in M3c",
                ));
            }
            let job = match take(&mut fl, "job") {
                None => return Err(args_error("run needs --job <path | ->")),
                Some(j) if j == "-" => JobSource::Stdin,
                Some(j) => JobSource::File(local_abs_path(&j, "--job")?),
            };
            let trace = take(&mut fl, "trace");
            if let Some(t) = &trace {
                local_abs_path(t, "--trace")?;
            }
            let trace_level = match take(&mut fl, "trace-level").as_deref() {
                None => None,
                Some("decisions") => Some(TraceLevel::Decisions),
                Some("feeds") => Some(TraceLevel::Feeds),
                Some(other) => {
                    return Err(args_error(format!(
                        "--trace-level {other:?} is not decisions or feeds"
                    )))
                }
            };
            let stack_mb = match take(&mut fl, "stack-mb") {
                None => DEFAULT_STACK_MB,
                Some(s) => match s.parse::<usize>() {
                    Ok(n) if (1..=MAX_STACK_MB).contains(&n) => n,
                    _ => {
                        return Err(args_error(format!(
                            "--stack-mb {s:?} is not an integer in 1..={MAX_STACK_MB}"
                        )))
                    }
                },
            };
            let tape_dir = take(&mut fl, "tape-dir")
                .map(|p| local_abs_path(&p, "--tape-dir"))
                .transpose()?;
            Ok(Command::Run(RunArgs {
                job,
                overrides: OutputOverrides {
                    trace_path: trace,
                    trace_level,
                },
                stack_mb,
                tape_dir,
            }))
        }
        "run-group" => Err(args_error(
            "run-group is not available before M4 (candidate groups)",
        )),
        "serve" => Err(args_error("serve is not available before M5a (executor)")),
        "paper" => Err(args_error("paper is not available before M8 (paper mode)")),
        "live" => Err(args_error(
            "live exists only in the real-orders variant (20 §1, §7); this binary is standard",
        )),
        other => Err(args_error(format!(
            "unknown subcommand {other:?} (describe | schema | selftest | run)"
        ))),
    }
}

/// The error document of the one-shot subcommands other than `run`
/// (G1). `run` always prints an `EngineResult`.
// D-PENDING: 20 G1 requires one JSON document on failure but defines its
// shape only for `run` (`EngineResult`); chose
// `{type:"error", protocolVersion, error: ErrorInfo, errors?}`.
pub fn error_document(e: &EngineError, param_errors: Option<&[ParamError]>) -> String {
    let mut doc = json!({
        "type": "error",
        "protocolVersion": PROTOCOL_VERSION,
        "error": e.info(),
    });
    if let Some(errs) = param_errors {
        doc["errors"] = Value::Array(errs.iter().map(ParamError::to_json).collect());
    }
    doc.to_string()
}

fn error_outcome_doc(e: EngineError, param_errors: Option<&[ParamError]>) -> Outcome {
    Outcome {
        document: error_document(&e, param_errors),
        exit_code: e.exit_code(),
        reason: Some(e.reason()),
    }
}

fn from_run(o: RunOutcome) -> Outcome {
    let document = o.document();
    if document.len() > DOCUMENT_CAP_BYTES {
        // G9: never emit an oversize document.
        let e = EngineError::invalid_output(
            "line_too_large",
            format!("result document of {} bytes exceeds 64 MiB", document.len()),
        );
        return from_run(error_outcome(
            e,
            o.result.echo.clone(),
            o.result.market.clone(),
            &JobClock::start(),
        ));
    }
    Outcome {
        document,
        exit_code: o.exit_code,
        reason: o.reason,
    }
}

/// The error outcome for `args` (the document shape depends on the
/// subcommand: `run` prints an `EngineResult`).
pub fn error_for(args: &[String], e: EngineError) -> Outcome {
    if args.first().map(String::as_str) == Some("run") {
        from_run(error_outcome(e, None, None, &JobClock::start()))
    } else {
        error_outcome_doc(e, None)
    }
}

fn parse_params_object(text: &str) -> Result<Map<String, Value>, EngineError> {
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(m)) => Ok(m),
        Ok(_) => Err(EngineError::invalid_input(
            "params",
            "--params must be a JSON object",
        )),
        Err(e) => Err(EngineError::invalid_input(
            "params",
            format!("--params is not JSON: {e}"),
        )),
    }
}

fn describe<T>(params: Option<String>, params_file: Option<PathBuf>, sdk_version: &str) -> Outcome
where
    T: Strategy,
    T::Params: StrategyParams,
{
    let results = match (params, params_file) {
        (None, None) => Vec::new(),
        (Some(text), _) => {
            let obj = match parse_params_object(&text) {
                Ok(o) => o,
                Err(e) => return error_outcome_doc(e, None),
            };
            // With --params, invalid params exit 2 with an error document.
            if let Err(errs) = evaluate::<T>(&obj) {
                let msg = errs
                    .iter()
                    .map(|e| format!("{} {}", e.path, e.message).trim().to_string())
                    .collect::<Vec<_>>()
                    .join("; ");
                let e = EngineError::invalid_input(
                    "params",
                    crate::error::one_line(&format!("invalid params: {msg}"), MESSAGE_MAX_CHARS),
                );
                return error_outcome_doc(e, Some(&errs));
            }
            vec![result_entry::<T>(&obj).1]
        }
        (None, Some(path)) => {
            let bytes = match read_document_file(&path, "--params-file") {
                Ok(b) => b,
                Err(e) => return error_outcome_doc(e, None),
            };
            let items = match serde_json::from_slice::<Value>(&bytes) {
                Ok(Value::Array(items)) => items,
                Ok(_) => {
                    return error_outcome_doc(
                        EngineError::invalid_input(
                            "params",
                            "--params-file must hold a JSON array",
                        ),
                        None,
                    )
                }
                Err(e) => {
                    return error_outcome_doc(
                        EngineError::invalid_input(
                            "params",
                            format!("--params-file is not JSON: {e}"),
                        ),
                        None,
                    )
                }
            };
            // Per-element errors are reported in `results`, exit 0.
            items
                .iter()
                .map(|item| match item {
                    Value::Object(obj) => result_entry::<T>(obj).1,
                    _ => json!({
                        "ok": false,
                        "errors": [ParamError::new("", "a params element must be a JSON object").to_json()],
                    }),
                })
                .collect()
        }
    };
    Outcome {
        document: describe_doc::<T>(sdk_version, results).to_string(),
        exit_code: 0,
        reason: None,
    }
}

/// [`dispatch`] inside a catch boundary (20 G1, G7, §4): a panic outside
/// the job thread (`describe`, `schema`, the selftest goldens, params code,
/// reading the job) still prints exactly one document (an `EngineResult`
/// for `run`), exits 8 with `engine_fault: panic` and ends stderr with the
/// one-line reason, instead of exit 101 with a backtrace as the last line.
pub fn dispatch_caught<T, B>(
    args: &[String],
    stdin: &mut dyn Read,
    backend: &B,
    sdk_version: &str,
) -> Outcome
where
    T: Strategy,
    T::Params: StrategyParams,
    B: Backend<T>,
{
    match crate::panic::catch(|| dispatch::<T, B>(args, stdin, backend, sdk_version)) {
        Ok(o) => o,
        Err(p) => error_for(
            args,
            EngineError::engine_fault("panic", p.message).with_detail(ErrorDetail {
                location: p.location,
                ..ErrorDetail::default()
            }),
        ),
    }
}

/// Runs one invocation: parse, dispatch, produce the one document.
pub fn dispatch<T, B>(
    args: &[String],
    stdin: &mut dyn Read,
    backend: &B,
    sdk_version: &str,
) -> Outcome
where
    T: Strategy,
    T::Params: StrategyParams,
    B: Backend<T>,
{
    let cmd = match parse(args) {
        Ok(c) => c,
        Err(e) => return error_for(args, e),
    };
    match cmd {
        Command::Describe {
            params,
            params_file,
        } => describe::<T>(params, params_file, sdk_version),
        Command::Schema => Outcome {
            document: schema_doc::<T>().to_string(),
            exit_code: 0,
            reason: None,
        },
        Command::Selftest => {
            let (doc, ok) = selftest::<T, B>(backend, DEFAULT_STACK_MB << 20);
            let failed: Vec<String> = doc["checks"]
                .as_array()
                .map(|cs| {
                    cs.iter()
                        .filter(|c| c["ok"] != Value::Bool(true))
                        .map(|c| {
                            format!(
                                "{} ({})",
                                c["name"].as_str().unwrap_or("?"),
                                c["detail"].as_str().unwrap_or("")
                            )
                        })
                        .collect()
                })
                .unwrap_or_default();
            Outcome {
                document: doc.to_string(),
                exit_code: if ok { 0 } else { 8 },
                reason: (!ok).then(|| {
                    crate::error::one_line(
                        &format!(
                            "engine_fault: selftest: failed checks: {}",
                            failed.join("; ")
                        ),
                        MESSAGE_MAX_CHARS,
                    )
                }),
            }
        }
        Command::Run(run) => {
            let clock = JobClock::start();
            let bytes = match &run.job {
                JobSource::Stdin => read_capped(stdin, DOCUMENT_CAP_BYTES, "stdin job"),
                JobSource::File(p) => read_document_file(p, "--job"),
            };
            let bytes = match bytes {
                Ok(b) => b,
                Err(e) => return from_run(error_outcome(e, None, None, &clock)),
            };
            let overrides = run.overrides.clone();
            let result = on_job_thread(run.stack_mb << 20, || {
                run_job_bytes::<T, B>(&bytes, &overrides, backend, &clock)
            });
            match result {
                Ok(o) => from_run(o),
                Err(e) => from_run(error_outcome(e, None, None, &clock)),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_every_subcommand() {
        // spec: 20 §5.1–§5.4 command lines
        assert_eq!(parse(&a(&["schema"])).unwrap(), Command::Schema);
        assert_eq!(parse(&a(&["selftest"])).unwrap(), Command::Selftest);
        assert_eq!(
            parse(&a(&["describe", "--params", "{\"a\":1}"])).unwrap(),
            Command::Describe {
                params: Some("{\"a\":1}".into()),
                params_file: None
            }
        );
        let r = parse(&a(&[
            "run",
            "--job",
            "-",
            "--trace=/tmp/t.jsonl.gz",
            "--trace-level",
            "feeds",
            "--stack-mb",
            "16",
            "--tape-dir",
            "/tapes",
        ]))
        .unwrap();
        assert_eq!(
            r,
            Command::Run(RunArgs {
                job: JobSource::Stdin,
                overrides: OutputOverrides {
                    trace_path: Some("/tmp/t.jsonl.gz".into()),
                    trace_level: Some(TraceLevel::Feeds),
                },
                stack_mb: 16,
                tape_dir: Some(PathBuf::from("/tapes")),
            })
        );
        match parse(&a(&["run", "--job", "/j.json"])).unwrap() {
            Command::Run(r) => {
                assert_eq!(r.job, JobSource::File("/j.json".into()));
                assert_eq!(r.stack_mb, DEFAULT_STACK_MB);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn refuses_bad_command_lines_with_exit_2() {
        // spec: 20 §4 (bad CLI args → invalid_input), R14, 20 G3
        let cases: &[(&[&str], &str)] = &[
            (&[], "args"),
            (&["frobnicate"], "args"),
            (&["run-group", "--job", "-"], "args"),
            (&["serve", "--threads", "2"], "args"),
            (&["paper"], "args"),
            (&["live"], "args"),
            (&["schema", "--x"], "args"),
            (&["run"], "args"),
            (&["run", "--job", "-", "--bogus", "1"], "args"),
            (&["run", "--job", "-", "--job", "-"], "args"),
            (&["run", "--job"], "args"),
            (&["run", "--job", "jobs/x.json"], "path"),
            (&["run", "--job", "r2://bucket/job.json"], "path"),
            (&["run", "--job", "-", "--trace", "out.jsonl"], "path"),
            (&["run", "--job", "-", "--trace-level", "all"], "args"),
            (&["run", "--job", "-", "--stack-mb", "0"], "args"),
            (&["run", "--job", "-", "--ledger", "/l.jsonl.gz"], "flag"),
            (&["run", "--job", "-", "--sim-trace", "/d"], "flag"),
            (
                &["describe", "--params", "{}", "--params-file", "/p.json"],
                "args",
            ),
            (&["describe", "--params-file", "p.json"], "path"),
            (&["describe", "stray"], "args"),
        ];
        for (args, cause) in cases {
            let e = parse(&a(args)).unwrap_err();
            assert_eq!(e.exit_code(), 2, "{args:?}");
            assert_eq!(e.cause, *cause, "{args:?}: {}", e.message);
        }
        let e = parse(&a(&["run-group"])).unwrap_err();
        assert!(e.message.contains("M4"));
        let e = parse(&a(&["serve"])).unwrap_err();
        assert!(e.message.contains("M5a"));
        let e = parse(&a(&["paper"])).unwrap_err();
        assert!(e.message.contains("M8"));
    }

    #[test]
    fn error_document_shape() {
        // spec: 20 G1 (one JSON document on failure), 21 §10 ErrorInfo
        let e = EngineError::invalid_input("args", "bad\nthing");
        let v: Value = serde_json::from_str(&error_document(&e, None)).unwrap();
        assert_eq!(v["type"], "error");
        assert_eq!(v["protocolVersion"], 2);
        assert_eq!(v["error"]["class"], "invalid_input");
        assert_eq!(v["error"]["cause"], "args");
        assert_eq!(v["error"]["message"], "bad thing");
        assert!(v.get("errors").is_none());
    }
}
