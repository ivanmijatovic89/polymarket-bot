//! Canonical JSON (21 §6.1): keys sorted bytewise at every level, array order
//! kept, no whitespace, only strings, booleans, safe integers, null, objects
//! and arrays. Used for `modelConfigSha256` and `contractSha256` (21 §3).

use std::fmt;

use serde_json::Value;

use crate::num::MAX_SAFE_INTEGER;
use crate::support::is_plain_ascii;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CanonicalError(pub String);

impl fmt::Display for CanonicalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "not canonicalizable: {}", self.0)
    }
}

impl std::error::Error for CanonicalError {}

/// Strict canonical form for ModelConfig: strings and keys MUST be printable
/// ASCII without `"` or `\`, so no escaping can differ between serializers.
pub fn canonical_json(value: &Value) -> Result<String, CanonicalError> {
    let mut out = String::new();
    write_value(value, true, &mut out)?;
    Ok(out)
}

/// Canonical form for documents whose strings may need escaping (the JSON
/// Schema bundle): strings are escaped as `serde_json` (and `JSON.stringify`)
/// do; strings and keys MUST still be ASCII so the bytes agree everywhere.
pub fn canonical_json_escaped(value: &Value) -> Result<String, CanonicalError> {
    let mut out = String::new();
    write_value(value, false, &mut out)?;
    Ok(out)
}

fn write_str(s: &str, strict: bool, out: &mut String) -> Result<(), CanonicalError> {
    if strict {
        if !is_plain_ascii(s) {
            return Err(CanonicalError(format!(
                "string {s:?} is not printable ASCII without quote or backslash"
            )));
        }
        out.push('"');
        out.push_str(s);
        out.push('"');
    } else {
        if !s.is_ascii() {
            return Err(CanonicalError(format!("string {s:?} is not ASCII")));
        }
        out.push_str(&serde_json::to_string(s).map_err(|e| CanonicalError(e.to_string()))?);
    }
    Ok(())
}

fn write_value(value: &Value, strict: bool, out: &mut String) -> Result<(), CanonicalError> {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            if let Some(u) = n.as_u64() {
                if u > MAX_SAFE_INTEGER {
                    return Err(CanonicalError(format!("integer {u} above 2^53-1")));
                }
                out.push_str(&u.to_string());
            } else if let Some(i) = n.as_i64() {
                if i.unsigned_abs() > MAX_SAFE_INTEGER {
                    return Err(CanonicalError(format!("integer {i} below -(2^53-1)")));
                }
                out.push_str(&i.to_string());
            } else {
                return Err(CanonicalError(format!("float {n} (no floats, 21 §6.1)")));
            }
        }
        Value::String(s) => write_str(s, strict, out)?,
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_value(item, strict, out)?;
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
            out.push('{');
            for (i, k) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_str(k, strict, out)?;
                out.push(':');
                write_value(&map[k], strict, out)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sorts_keys_and_strips_whitespace() {
        let v = json!({"b": [3, {"z": 1, "a": "x"}], "a": true, "B": null});
        assert_eq!(
            canonical_json(&v).unwrap(),
            r#"{"B":null,"a":true,"b":[3,{"a":"x","z":1}]}"#
        );
    }

    #[test]
    fn rejects_floats_unsafe_ints_and_escapes() {
        assert!(canonical_json(&json!({"a": 1.5})).is_err());
        assert!(canonical_json(&json!({"a": 9007199254740992_u64})).is_err());
        assert!(canonical_json(&json!({"a": "q\"q"})).is_err());
        assert!(canonical_json(&json!({"a": "é"})).is_err());
        assert_eq!(
            canonical_json_escaped(&json!({"a": "q\"q\n"})).unwrap(),
            r#"{"a":"q\"q\n"}"#
        );
        assert!(canonical_json_escaped(&json!({"a": "é"})).is_err());
    }
}
