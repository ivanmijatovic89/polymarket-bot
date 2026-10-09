//! The params seam between the runtime and the strategy's typed params
//! (30 §9, 20 §5.1).
//!
//! `Strategy::Params` carries no parsing traits in `pmb-engine`; the
//! `#[derive(Params)]` of `pmb-sdk` will implement [`StrategyParams`]. The
//! runtime needs exactly four things from it: strict parsing of typed JSON
//! or CLI strings with every error reported, the normalized JSON form, the
//! JSON Schema, and the params of the embedded selftest job.

use serde_json::{Map, Value};

/// One param error with a JSON-pointer path (30 §9 rule 3, 20 §5.1).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParamError {
    /// JSON pointer, e.g. `/size`; empty for the whole object.
    pub path: String,
    /// One line.
    pub message: String,
}

impl ParamError {
    /// An error at `path`.
    pub fn new(path: impl Into<String>, message: impl Into<String>) -> ParamError {
        ParamError {
            path: path.into(),
            message: message.into(),
        }
    }

    /// `{path, message}` of the describe document (20 §5.1).
    pub fn to_json(&self) -> Value {
        serde_json::json!({ "path": self.path, "message": self.message })
    }
}

/// Typed strategy params as the runtime uses them (30 §9). Implemented by
/// the `Params` derive of `pmb-sdk`; `()` implements it for strategies
/// without params.
pub trait StrategyParams: Sized + Send + Sync + 'static {
    /// Parses and validates a params object: typed JSON or CLI strings
    /// (30 §9 table). Unknown keys are errors; every error is reported
    /// together (30 §9 rule 3).
    fn from_json(obj: &Map<String, Value>) -> Result<Self, Vec<ParamError>>;

    /// The normalized object (30 §9 rule 6): keys sorted bytewise, defaults
    /// applied, `None` options omitted, canonical numbers.
    fn to_normalized(&self) -> Map<String, Value>;

    /// JSON Schema 2020-12 of the params (30 §9 rule 8; `paramsSchema`).
    fn json_schema() -> Value;

    /// Params of the embedded selftest job (20 §5.3).
    // D-PENDING: 20 §5.3 does not say which params the embedded job uses; a
    // strategy with required params overrides this (the derive can emit its
    // documented example).
    fn selftest_params() -> Map<String, Value> {
        Map::new()
    }
}

impl StrategyParams for () {
    fn from_json(obj: &Map<String, Value>) -> Result<(), Vec<ParamError>> {
        if obj.is_empty() {
            Ok(())
        } else {
            Err(obj
                .keys()
                .map(|k| {
                    ParamError::new(
                        format!("/{}", pointer_escape(k)),
                        format!("unknown param {k:?}; this strategy has no params"),
                    )
                })
                .collect())
        }
    }

    fn to_normalized(&self) -> Map<String, Value> {
        Map::new()
    }

    fn json_schema() -> Value {
        serde_json::json!({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "properties": {},
            "additionalProperties": false
        })
    }
}

/// Escapes a key for a JSON pointer (RFC 6901).
pub fn pointer_escape(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

/// Params comparison of 30 §9 rule 10: objects by key set and values
/// recursively, numbers by exact decimal value (`20` equals `20.0`, `1e-4`
/// equals `0.0001`).
pub fn params_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            match (exact_decimal(&x.to_string()), exact_decimal(&y.to_string())) {
                (Some(dx), Some(dy)) => dx == dy,
                _ => false,
            }
        }
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| params_equal(p, q))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, v)| y.get(k).is_some_and(|w| params_equal(v, w)))
        }
        _ => a == b,
    }
}

/// A JSON number text as an exact decimal `(negative, digits, exponent)`
/// with no leading or trailing zeros in `digits`; zero is `(false, "", 0)`.
fn exact_decimal(text: &str) -> Option<(bool, String, i64)> {
    let (neg, rest) = match text.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, text),
    };
    let (mantissa, exp) = match rest.find(['e', 'E']) {
        Some(i) => (&rest[..i], rest[i + 1..].parse::<i64>().ok()?),
        None => (rest, 0),
    };
    let (int, frac) = match mantissa.split_once('.') {
        Some((i, f)) => (i, f),
        None => (mantissa, ""),
    };
    if int.is_empty() || !int.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if !frac.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let mut digits: String = format!("{int}{frac}");
    let mut exp = exp.checked_sub(frac.len() as i64)?;
    let lead = digits.bytes().take_while(|&b| b == b'0').count();
    digits.drain(..lead);
    while digits.ends_with('0') {
        digits.pop();
        exp += 1;
    }
    if digits.is_empty() {
        return Some((false, String::new(), 0));
    }
    Some((neg, digits, exp))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn unit_params_accept_only_the_empty_object() {
        // spec: 30 §9 rule 3 (unknown keys are errors, all reported)
        assert!(<() as StrategyParams>::from_json(&Map::new()).is_ok());
        let obj = json!({"a": 1, "b/c": 2});
        let errs = <() as StrategyParams>::from_json(obj.as_object().unwrap()).unwrap_err();
        assert_eq!(errs.len(), 2);
        assert_eq!(errs[0].path, "/a");
        assert_eq!(errs[1].path, "/b~1c");
        assert!(<() as StrategyParams>::to_normalized(&()).is_empty());
        assert_eq!(<() as StrategyParams>::json_schema()["type"], "object");
    }

    #[test]
    fn numbers_compare_by_exact_decimal_value() {
        // spec: 30 §9 rule 10 (20 equals 20.0, 1e-4 equals 0.0001)
        let eq = |a: Value, b: Value| params_equal(&a, &b);
        assert!(eq(json!(20), json!(20.0)));
        assert!(eq(json!(1e-4), json!(0.0001)));
        assert!(eq(json!(0), json!(-0.0)));
        assert!(eq(json!(-1.50), json!(-1.5)));
        assert!(!eq(json!(1.5), json!(-1.5)));
        assert!(!eq(json!(0.1), json!(0.01)));
        assert!(eq(json!({"a": [1, 2.0]}), json!({"a": [1.0, 2]})));
        assert!(!eq(json!({"a": 1}), json!({"a": 1, "b": 2})));
        assert!(!eq(json!("1"), json!(1)));
        assert_eq!(exact_decimal("120"), Some((false, "12".into(), 1)));
        assert_eq!(exact_decimal("0.00120"), Some((false, "12".into(), -4)));
        assert_eq!(exact_decimal("1.2e3"), Some((false, "12".into(), 2)));
    }
}
