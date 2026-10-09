//! Input error classes and causes (20 §4.1, 15 §9).

use std::fmt;

/// Error class of an input failure (20 §4).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum ErrorClass {
    InvalidInput,
    DataMissing,
    DataDefect,
    Runtime,
}

impl ErrorClass {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorClass::InvalidInput => "invalid_input",
            ErrorClass::DataMissing => "data_missing",
            ErrorClass::DataDefect => "data_defect",
            ErrorClass::Runtime => "runtime",
        }
    }
}

/// A typed input error: class, closed cause and free detail text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InputError {
    pub class: ErrorClass,
    pub cause: &'static str,
    pub detail: String,
}

impl InputError {
    pub fn new(class: ErrorClass, cause: &'static str, detail: impl Into<String>) -> Self {
        InputError {
            class,
            cause,
            detail: detail.into(),
        }
    }
}

impl fmt::Display for InputError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}: {}: {}",
            self.class.as_str(),
            self.cause,
            self.detail
        )
    }
}

impl std::error::Error for InputError {}
