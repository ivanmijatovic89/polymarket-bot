//! stderr logging (20 G1, G2): NDJSON lines `{level, tsMs, jobId?, msg}`.
//!
//! `PMB_LOG` is the only verbosity knob and, with `RUST_BACKTRACE`, the only
//! environment variable the binary reads (20 G2). It never changes a result.
//! `tsMs` is the host wall clock: logs are diagnostics, outside every
//! deterministic section (21 §10).

use std::io::Write;
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::EngineError;

/// Log level, ordered by verbosity.
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Level {
    /// Nothing.
    Off = 0,
    /// Errors.
    Error = 1,
    /// Warnings (default).
    Warn = 2,
    /// Progress.
    Info = 3,
    /// Debugging.
    Debug = 4,
    /// Everything.
    Trace = 5,
}

impl Level {
    /// Wire name.
    pub const fn as_str(self) -> &'static str {
        match self {
            Level::Off => "off",
            Level::Error => "error",
            Level::Warn => "warn",
            Level::Info => "info",
            Level::Debug => "debug",
            Level::Trace => "trace",
        }
    }

    /// Parses a `PMB_LOG` value.
    pub fn parse(s: &str) -> Option<Level> {
        Some(match s {
            "off" => Level::Off,
            "error" => Level::Error,
            "warn" => Level::Warn,
            "info" => Level::Info,
            "debug" => Level::Debug,
            "trace" => Level::Trace,
            _ => return None,
        })
    }

    fn from_u8(v: u8) -> Level {
        match v {
            0 => Level::Off,
            1 => Level::Error,
            2 => Level::Warn,
            3 => Level::Info,
            4 => Level::Debug,
            _ => Level::Trace,
        }
    }
}

/// Default engine log level when `PMB_LOG` is unset.
pub const DEFAULT_LEVEL: Level = Level::Warn;

static LEVEL: AtomicU8 = AtomicU8::new(DEFAULT_LEVEL as u8);

/// Reads `PMB_LOG` (20 G2). An unknown value is refused (R14).
pub fn level_from_env() -> Result<Level, EngineError> {
    match std::env::var("PMB_LOG") {
        Err(std::env::VarError::NotPresent) => Ok(DEFAULT_LEVEL),
        Err(std::env::VarError::NotUnicode(_)) => Err(EngineError::invalid_input(
            "args",
            "PMB_LOG is not valid UTF-8",
        )),
        Ok(v) => Level::parse(&v).ok_or_else(|| {
            EngineError::invalid_input(
                "args",
                format!("PMB_LOG={v:?} is not one of off|error|warn|info|debug|trace"),
            )
        }),
    }
}

/// Sets the process log level.
pub fn set_level(level: Level) {
    LEVEL.store(level as u8, Ordering::Relaxed);
}

/// The process log level.
pub fn level() -> Level {
    Level::from_u8(LEVEL.load(Ordering::Relaxed))
}

/// Whether `l` is enabled (one branch when disabled).
#[inline]
pub fn enabled(l: Level) -> bool {
    l != Level::Off && l <= level()
}

/// One NDJSON log line (20 G1).
pub fn format_line(level: Level, ts_ms: u64, job_id: Option<&str>, msg: &str) -> String {
    let mut s = String::with_capacity(64 + msg.len());
    s.push_str("{\"level\":\"");
    s.push_str(level.as_str());
    s.push_str("\",\"tsMs\":");
    s.push_str(&ts_ms.to_string());
    if let Some(j) = job_id {
        s.push_str(",\"jobId\":");
        s.push_str(&serde_json::to_string(j).expect("string serializes"));
    }
    s.push_str(",\"msg\":");
    s.push_str(&serde_json::to_string(msg).expect("string serializes"));
    s.push('}');
    s
}

/// Wall-clock milliseconds since the epoch (diagnostics only).
pub fn wall_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// Logs one line to stderr when `l` is enabled. Write errors are ignored:
/// a closed stderr never changes a result.
pub fn log(l: Level, job_id: Option<&str>, msg: &str) {
    if !enabled(l) {
        return;
    }
    let line = format_line(l, wall_ms(), job_id, msg);
    let stderr = std::io::stderr();
    let mut lock = stderr.lock();
    let _ = lock.write_all(line.as_bytes());
    let _ = lock.write_all(b"\n");
}

/// Writes the plain one-line reason as the last stderr line of a non-zero
/// exit (20 §4).
pub fn reason_line(reason: &str) {
    let stderr = std::io::stderr();
    let mut lock = stderr.lock();
    let _ = lock.write_all(reason.as_bytes());
    let _ = lock.write_all(b"\n");
    let _ = lock.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_line_is_compact_ndjson() {
        // spec: 20 G1 (stderr NDJSON {level, tsMs, jobId?, msg})
        let l = format_line(Level::Warn, 12, None, "a \"b\"\n");
        let v: serde_json::Value = serde_json::from_str(&l).unwrap();
        assert_eq!(v["level"], "warn");
        assert_eq!(v["tsMs"], 12);
        assert_eq!(v["msg"], "a \"b\"\n");
        assert!(v.get("jobId").is_none());
        assert!(!l.contains('\n'));
        let l = format_line(Level::Info, 1, Some("j1"), "m");
        assert_eq!(l, r#"{"level":"info","tsMs":1,"jobId":"j1","msg":"m"}"#);
    }

    #[test]
    fn levels_parse_and_order() {
        assert_eq!(Level::parse("debug"), Some(Level::Debug));
        assert_eq!(Level::parse("DEBUG"), None);
        assert!(Level::Error < Level::Warn);
        for l in [
            Level::Off,
            Level::Error,
            Level::Warn,
            Level::Info,
            Level::Debug,
            Level::Trace,
        ] {
            assert_eq!(Level::from_u8(l as u8), l);
            assert_eq!(Level::parse(l.as_str()), Some(l));
        }
    }
}
