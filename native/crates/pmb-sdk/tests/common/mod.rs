//! Test helpers shared by the params tests.

use pmb_sdk::__private::Input;

/// The params JSON text after TS stored it (30 §9 rule 6): `JSON.parse`
/// reads every number into the nearest `f64` (correctly rounded) and
/// `JSON.stringify` writes it back as its shortest round-trip decimal.
/// (`serde_json` without `float_roundtrip` is not correctly rounded, so it
/// cannot stand in for `JSON.parse`.)
pub fn through_ts_storage(text: &str) -> String {
    fn write(v: &Input, out: &mut String) {
        match v {
            Input::Null => out.push_str("null"),
            Input::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            Input::Number(n) => {
                let f: f64 = n.parse().expect("JSON number");
                assert!(f.is_finite(), "{n} is not a finite JSON number");
                out.push_str(&format!("{f}"));
            }
            Input::String(s) => out.push_str(&serde_json::to_string(s).unwrap()),
            Input::Array(items) => {
                out.push('[');
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    write(item, out);
                }
                out.push(']');
            }
            Input::Object(entries) => {
                out.push('{');
                for (i, (k, item)) in entries.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    out.push_str(&serde_json::to_string(k).unwrap());
                    out.push(':');
                    write(item, out);
                }
                out.push('}');
            }
        }
    }
    let mut out = String::new();
    write(&Input::from_json_text(text).expect("JSON text"), &mut out);
    out
}
