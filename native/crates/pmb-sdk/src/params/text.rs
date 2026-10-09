//! JSON text writing for normalized params and meta (30 §9 rule 6, §7.2).

use std::fmt::Write;

/// Writes `s` as a JSON string: `"` and `\` escaped, control characters as
/// `\n`, `\r`, `\t`, `\b`, `\f` or `\u00XX`, everything else verbatim.
pub fn write_json_str(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// Writes a finite `f64` as its shortest round-trip decimal, without
/// exponent and with `-0` as `0` (30 §9 table). A non-finite value cannot
/// come from parsing; it is written as `null` so the text stays JSON.
pub fn write_f64(out: &mut String, v: f64) {
    if !v.is_finite() {
        out.push_str("null");
    } else if v == 0.0 {
        out.push('0');
    } else {
        let _ = write!(out, "{v}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_strings() {
        let mut s = String::new();
        write_json_str(&mut s, "a\"b\\c\n\u{1}é");
        assert_eq!(s, r#""a\"b\\c\n\u0001é""#);
        let back: String = serde_json::from_str(&s).unwrap();
        assert_eq!(back, "a\"b\\c\n\u{1}é");
    }

    // spec: 30 §9 table (f64: shortest round-trip, -0 -> 0, integral without fraction)
    #[test]
    fn f64_text() {
        let w = |v: f64| {
            let mut s = String::new();
            write_f64(&mut s, v);
            s
        };
        assert_eq!(w(20.0), "20");
        assert_eq!(w(-0.0), "0");
        assert_eq!(w(0.1), "0.1");
        assert_eq!(w(1e-7), "0.0000001");
        assert_eq!(w(1e21), "1000000000000000000000");
        assert_eq!(w(-2.5), "-2.5");
        assert_eq!(w(f64::NAN), "null");
        for v in [0.1, 1e-7, 123.456, 1e21, 5e-324, f64::MAX] {
            assert_eq!(w(v).parse::<f64>().unwrap(), v);
        }
    }
}
