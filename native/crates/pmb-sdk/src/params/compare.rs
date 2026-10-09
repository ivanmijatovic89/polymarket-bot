//! Comparison of normalized params (30 §9 rule 10): objects by key set and
//! values recursively, arrays item by item, numbers by exact decimal value
//! (`20` equals `20.0`, `1e-4` equals `0.0001`). A plain `serde_json::Value`
//! equality is not enough: it treats an integer and a float as different
//! numbers and rounds decimals through `f64`.

use super::input::Input;
use super::{ParamError, ParamErrorKind};

/// Compares two params JSON texts by rule 10. Numbers are compared from
/// their exact text; there is deliberately no variant over decoded
/// `serde_json::Value`s, which hold decimals as `f64` and would call
/// `0.1` and `0.10000000000000001` equal.
///
/// ```
/// use pmb_sdk::params::normalized_eq;
///
/// assert!(normalized_eq(r#"{"a":20,"b":1e-4}"#, r#"{"b":0.0001,"a":20.0}"#).unwrap());
/// assert!(!normalized_eq(r#"{"a":1}"#, r#"{"a":"1"}"#).unwrap());
/// ```
pub fn normalized_eq(a: &str, b: &str) -> Result<bool, ParamError> {
    let parse = |t: &str| {
        Input::from_json_text(t).map_err(|e| {
            ParamError::single(
                String::new(),
                ParamErrorKind::Syntax,
                format!("params are not valid JSON: {e}"),
            )
        })
    };
    Ok(input_eq(&parse(a)?, &parse(b)?))
}

fn input_eq(a: &Input, b: &Input) -> bool {
    match (a, b) {
        (Input::Null, Input::Null) => true,
        (Input::Bool(x), Input::Bool(y)) => x == y,
        (Input::String(x), Input::String(y)) => x == y,
        (Input::Number(x), Input::Number(y)) => match (decimal_key(x), decimal_key(y)) {
            (Some(a), Some(b)) => a == b,
            // An exponent beyond i64: only the identical text is equal.
            _ => x == y,
        },
        (Input::Array(x), Input::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| input_eq(p, q))
        }
        (Input::Object(x), Input::Object(y)) => {
            if x.len() != y.len() {
                return false;
            }
            let mut xs: Vec<&(String, Input)> = x.iter().collect();
            let mut ys: Vec<&(String, Input)> = y.iter().collect();
            xs.sort_by(|p, q| p.0.cmp(&q.0));
            ys.sort_by(|p, q| p.0.cmp(&q.0));
            xs.iter()
                .zip(&ys)
                .all(|(p, q)| p.0 == q.0 && input_eq(&p.1, &q.1))
        }
        _ => false,
    }
}

/// Canonical form of a JSON number: (negative, significant digits without
/// leading or trailing zeros, decimal exponent of the last digit). Zero is
/// `(false, "", 0)`. `None` when the exponent does not fit an `i64`.
fn decimal_key(text: &str) -> Option<(bool, String, i64)> {
    let (neg, rest) = match text.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, text),
    };
    let (mant, exp) = match rest.find(['e', 'E']) {
        Some(i) => (&rest[..i], rest[i + 1..].parse::<i64>().ok()?),
        None => (rest, 0),
    };
    let (int, frac) = mant.split_once('.').unwrap_or((mant, ""));
    let digits: String = int.chars().chain(frac.chars()).collect();
    let trimmed_end = digits.trim_end_matches('0');
    let exp = exp
        .checked_sub(frac.len() as i64)?
        .checked_add((digits.len() - trimmed_end.len()) as i64)?;
    let sig = trimmed_end.trim_start_matches('0');
    if sig.is_empty() {
        return Some((false, String::new(), 0));
    }
    Some((neg, sig.to_owned(), exp))
}

#[cfg(test)]
mod tests {
    use super::*;

    // spec: 30 §9 rule 10
    #[test]
    fn numbers_compare_by_exact_value() {
        let eq = |a: &str, b: &str| normalized_eq(a, b).unwrap();
        assert!(eq("20", "20.0"));
        assert!(eq("20", "2e1"));
        assert!(eq("1e-4", "0.0001"));
        assert!(eq("-0", "0"));
        assert!(eq("0.10", "1E-1"));
        assert!(eq("123.4500", "1.2345e2"));
        assert!(!eq("0.1", "0.10000000000000001"));
        assert!(!eq("1", "-1"));
        assert!(!eq("1", "\"1\""));
        assert!(eq(
            r#"{"a":[1,{"b":null}],"c":true}"#,
            r#"{"c":true,"a":[1.0,{"b":null}]}"#
        ));
        assert!(!eq(r#"{"a":1}"#, r#"{"a":1,"b":2}"#));
        assert!(!eq(r#"{"a":1}"#, r#"{"b":1}"#));
        assert!(!eq("[1,2]", "[2,1]"));
        assert!(normalized_eq("{", "{}").is_err());
        // Exponents beyond i64 compare by text only.
        assert!(!eq("1e99999999999999999999", "1e0"));
        assert!(eq("1e99999999999999999999", "1e99999999999999999999"));
        assert!(!eq("0.1", "0.10000000000000000001"));
        assert!(!eq("12345678901.123457", "12345678901.123455"));
    }
}
