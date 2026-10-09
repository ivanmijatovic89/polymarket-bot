//! Classified errors of the binary (20 §4): one closed class vocabulary, a
//! snake_case cause, a one-line message and the exit code of the class.

use std::fmt;

use pmb_contract::result::{ErrorDetail, ErrorInfo};
use pmb_contract::support::ContractError;
use pmb_contract::vocab::ErrorClass;

/// Longest message and reason line, in characters (20 §4, 21 §10).
pub const MESSAGE_MAX_CHARS: usize = 1000;

/// A classified failure (20 §4, §4.1).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EngineError {
    /// Closed class (20 §4).
    pub class: ErrorClass,
    /// Cause label, `^[a-z][a-z0-9_]{0,47}$` (20 §4.1).
    pub cause: &'static str,
    /// Human message; made one line and capped at output.
    pub message: String,
    /// Optional structured detail (21 §10 `ErrorInfo.detail`), boxed to
    /// keep `Result<_, EngineError>` small.
    pub detail: Option<Box<ErrorDetail>>,
}

impl EngineError {
    /// An error of `class` with `cause`.
    pub fn new(class: ErrorClass, cause: &'static str, message: impl Into<String>) -> EngineError {
        EngineError {
            class,
            cause,
            message: message.into(),
            detail: None,
        }
    }

    /// Attaches a detail object.
    pub fn with_detail(mut self, detail: ErrorDetail) -> EngineError {
        self.detail = Some(Box::new(detail));
        self
    }

    /// `invalid_input` (exit 2).
    pub fn invalid_input(cause: &'static str, message: impl Into<String>) -> EngineError {
        EngineError::new(ErrorClass::InvalidInput, cause, message)
    }

    /// `runtime` (exit 1).
    pub fn runtime(cause: &'static str, message: impl Into<String>) -> EngineError {
        EngineError::new(ErrorClass::Runtime, cause, message)
    }

    /// `data_missing` (exit 3).
    pub fn data_missing(cause: &'static str, message: impl Into<String>) -> EngineError {
        EngineError::new(ErrorClass::DataMissing, cause, message)
    }

    /// `data_defect` (exit 4).
    pub fn data_defect(cause: &'static str, message: impl Into<String>) -> EngineError {
        EngineError::new(ErrorClass::DataDefect, cause, message)
    }

    /// `timeout` (exit 5).
    pub fn timeout(message: impl Into<String>) -> EngineError {
        EngineError::new(ErrorClass::Timeout, "deadline", message)
    }

    /// `invalid_output` (exit 6).
    pub fn invalid_output(cause: &'static str, message: impl Into<String>) -> EngineError {
        EngineError::new(ErrorClass::InvalidOutput, cause, message)
    }

    /// `strategy_fault` (exit 7).
    pub fn strategy_fault(cause: &'static str, message: impl Into<String>) -> EngineError {
        EngineError::new(ErrorClass::StrategyFault, cause, message)
    }

    /// `engine_fault` (exit 8).
    pub fn engine_fault(cause: &'static str, message: impl Into<String>) -> EngineError {
        EngineError::new(ErrorClass::EngineFault, cause, message)
    }

    /// Process exit code of the class (20 §4). `canceled` and `killed` are
    /// never raised by a one-shot command; they map to `runtime`'s code so
    /// a misuse can never look like success.
    pub fn exit_code(&self) -> i32 {
        exit_code_of(self.class)
    }

    /// The `ErrorInfo` of the result document (21 §10): one line, at most
    /// 1,000 characters.
    pub fn info(&self) -> ErrorInfo {
        ErrorInfo {
            class: self.class,
            cause: self.cause.to_string(),
            message: one_line(&self.message, MESSAGE_MAX_CHARS),
            detail: self.detail.as_deref().cloned(),
        }
    }

    /// The reason text of 20 §4.2, `<class>: <cause>: <message>`, one line
    /// of at most 1,000 characters: the last stderr line on a non-zero exit.
    pub fn reason(&self) -> String {
        one_line(
            &format!("{}: {}: {}", self.class, self.cause, self.message),
            MESSAGE_MAX_CHARS,
        )
    }
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.reason())
    }
}

impl std::error::Error for EngineError {}

impl From<ContractError> for EngineError {
    fn from(e: ContractError) -> EngineError {
        EngineError::new(e.class, e.cause, e.message)
    }
}

impl From<pmb_replay::InputError> for EngineError {
    fn from(e: pmb_replay::InputError) -> EngineError {
        let class = match e.class {
            pmb_replay::ErrorClass::InvalidInput => ErrorClass::InvalidInput,
            pmb_replay::ErrorClass::DataMissing => ErrorClass::DataMissing,
            pmb_replay::ErrorClass::DataDefect => ErrorClass::DataDefect,
            pmb_replay::ErrorClass::Runtime => ErrorClass::Runtime,
        };
        EngineError::new(class, e.cause, e.detail)
    }
}

/// Exit code of a class (20 §4).
pub fn exit_code_of(class: ErrorClass) -> i32 {
    class.exit_code().unwrap_or(1)
}

/// Replaces line breaks and other control characters with spaces and caps
/// the text at `max` characters (20 §4: one-line reason).
pub fn one_line(text: &str, max: usize) -> String {
    let mut out = String::with_capacity(text.len().min(max * 4));
    for (n, c) in text.chars().enumerate() {
        if n == max {
            break;
        }
        out.push(if c.is_control() { ' ' } else { c });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_codes_follow_the_class_table() {
        // spec: 20 §4 exit code table
        let cases = [
            (ErrorClass::Runtime, 1),
            (ErrorClass::InvalidInput, 2),
            (ErrorClass::DataMissing, 3),
            (ErrorClass::DataDefect, 4),
            (ErrorClass::Timeout, 5),
            (ErrorClass::InvalidOutput, 6),
            (ErrorClass::StrategyFault, 7),
            (ErrorClass::EngineFault, 8),
            (ErrorClass::Canceled, 1),
            (ErrorClass::Killed, 1),
        ];
        for (class, code) in cases {
            assert_eq!(EngineError::new(class, "x", "m").exit_code(), code);
        }
    }

    #[test]
    fn reason_is_one_line_and_capped() {
        // spec: 20 §4 (one-line reason, at most 1,000 characters), §4.2 format
        let e = EngineError::invalid_input("path", "a\nb\rc");
        assert_eq!(e.reason(), "invalid_input: path: a b c");
        assert_eq!(e.info().message, "a b c");
        let long = EngineError::runtime("io", "é".repeat(5000));
        assert_eq!(long.reason().chars().count(), MESSAGE_MAX_CHARS);
        assert_eq!(long.info().message.chars().count(), MESSAGE_MAX_CHARS);
        assert!(long.info().validate().is_ok());
    }

    #[test]
    fn input_errors_keep_class_and_cause() {
        let e: EngineError = pmb_replay::InputError::new(
            pmb_replay::ErrorClass::DataDefect,
            "foreign_file",
            "asset 9",
        )
        .into();
        assert_eq!(e.class, ErrorClass::DataDefect);
        assert_eq!(e.cause, "foreign_file");
        assert_eq!(e.exit_code(), 4);
    }
}
