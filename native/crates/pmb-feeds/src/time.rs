//! UTC calendar days and ISO-8601 rendering for day sets and messages
//! (14 F-12, F-20; TS `src/binance/paths.ts:114-142`). Pure integer
//! arithmetic; no clock is read.

use std::fmt;

pub const DAY_MS: i64 = 86_400_000;

/// A UTC calendar day as days since 1970-01-01.
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct UtcDay(pub i64);

impl UtcDay {
    /// The day containing epoch ms `ms`.
    #[inline]
    pub fn of_ms(ms: i64) -> UtcDay {
        UtcDay(ms.div_euclid(DAY_MS))
    }

    /// Midnight at the start of this day, in epoch ms.
    #[inline]
    pub fn start_ms(self) -> i64 {
        self.0 * DAY_MS
    }

    /// `(year, month, day)` of this day.
    pub fn civil(self) -> (i64, u32, u32) {
        civil_from_days(self.0)
    }

    /// Parses `YYYY-MM-DD` (the `feedFiles[].day` spelling, 21 §5).
    pub fn parse(s: &str) -> Option<UtcDay> {
        let b = s.as_bytes();
        if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
            return None;
        }
        let num = |r: std::ops::Range<usize>| -> Option<i64> {
            let part = &s[r];
            if !part.bytes().all(|c| c.is_ascii_digit()) {
                return None;
            }
            part.parse().ok()
        };
        let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
        if !(1..=12).contains(&m) || d < 1 || d > days_in_month(y, m as u32) as i64 {
            return None;
        }
        Some(UtcDay(days_from_civil(y, m as u32, d as u32)))
    }
}

impl fmt::Display for UtcDay {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (y, m, d) = self.civil();
        write!(f, "{y:04}-{m:02}-{d:02}")
    }
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i64, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if is_leap(y) => 29,
        _ => 28,
    }
}

/// Howard Hinnant's `days_from_civil` (proleptic Gregorian).
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Howard Hinnant's `civil_from_days`.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Every UTC day whose day file can hold data in `[start_ms, end_ms)`: the
/// end day is excluded at exact midnight (14 F-12; TS `utcDatesCovering`).
/// `None` when `end_ms < start_ms`.
pub fn days_covering(start_ms: i64, end_ms: i64) -> Option<Vec<UtcDay>> {
    if end_ms < start_ms {
        return None;
    }
    let mut out = Vec::with_capacity(2);
    let mut day = UtcDay::of_ms(start_ms);
    loop {
        out.push(day);
        day = UtcDay(day.0 + 1);
        if day.start_ms() >= end_ms {
            break;
        }
    }
    Some(out)
}

/// `YYYY-MM-DDTHH:MM:SS.mmmZ` for messages and the TS-shape window strings
/// (14 F-28, §11.2).
pub fn iso_ms(ms: i64) -> String {
    let day = UtcDay::of_ms(ms);
    let tod = ms - day.start_ms();
    format!(
        "{day}T{:02}:{:02}:{:02}.{:03}Z",
        tod / 3_600_000,
        tod / 60_000 % 60,
        tod / 1000 % 60,
        tod % 1000
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const D0916: i64 = 1_789_516_800_000; // 2026-09-16T00:00:00Z

    // spec: 14 F-12 (day set, end day excluded at exact midnight)
    #[test]
    fn day_sets() {
        let d = |s: &str| UtcDay::parse(s).unwrap();
        assert_eq!(UtcDay::of_ms(D0916).to_string(), "2026-09-16");
        assert_eq!(d("2026-09-16").start_ms(), D0916);
        assert_eq!(
            days_covering(D0916 - 300_000, D0916 + 900_000).unwrap(),
            vec![d("2026-09-15"), d("2026-09-16")]
        );
        // A window ending exactly at midnight does not need the next day.
        assert_eq!(
            days_covering(D0916 - 900_000, D0916).unwrap(),
            vec![d("2026-09-15")]
        );
        assert_eq!(days_covering(D0916, D0916).unwrap(), vec![d("2026-09-16")]);
        assert!(days_covering(D0916, D0916 - 1).is_none());
        assert_eq!(UtcDay::parse("2026-02-29"), None);
        assert_eq!(
            UtcDay::parse("2028-02-29").unwrap().to_string(),
            "2028-02-29"
        );
        assert_eq!(UtcDay::parse("2026-9-16"), None);
        assert_eq!(UtcDay::parse("1969-12-31"), Some(UtcDay(-1)));
        assert_eq!(
            UtcDay::parse("2026-04-02").unwrap().start_ms(),
            1_775_088_000_000
        );
    }

    #[test]
    fn iso() {
        assert_eq!(iso_ms(D0916 + 3_723_004), "2026-09-16T01:02:03.004Z");
        assert_eq!(iso_ms(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_ms(-1), "1969-12-31T23:59:59.999Z");
        for day in -800_000..800_000i64 {
            if day % 997 == 0 {
                let (y, m, d) = civil_from_days(day);
                assert_eq!(days_from_civil(y, m, d), day);
            }
        }
    }
}
