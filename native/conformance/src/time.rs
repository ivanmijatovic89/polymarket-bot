//! Civil UTC date → epoch milliseconds, for checking the dated tables of
//! 11 §5.3 and §6.2 against their ISO labels. Proleptic Gregorian, no leap
//! seconds (Unix time).

/// Days from 1970-01-01 to `y-m-d` (Howard Hinnant's `days_from_civil`).
pub fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Epoch milliseconds of `y-m-dTh:mi:sZ`.
pub fn epoch_ms(y: i64, m: u32, d: u32, h: u32, mi: u32, s: u32) -> i64 {
    (days_from_civil(y, m, d) * 86_400 + h as i64 * 3_600 + mi as i64 * 60 + s as i64) * 1_000
}

/// Parses `YYYY-MM-DDTHH:MM:SSZ` or `YYYY-MM-DD` (midnight UTC).
pub fn parse_iso_utc(s: &str) -> i64 {
    let (date, time) = match s.split_once('T') {
        Some((d, t)) => (d, t.trim_end_matches('Z')),
        None => (s, "00:00:00"),
    };
    let mut dp = date.split('-').map(|p| p.parse::<i64>().expect("date part"));
    let (y, m, d) = (dp.next().unwrap(), dp.next().unwrap() as u32, dp.next().unwrap() as u32);
    let mut tp = time.split(':').map(|p| p.parse::<u32>().expect("time part"));
    let (h, mi, sec) = (tp.next().unwrap(), tp.next().unwrap_or(0), tp.next().unwrap_or(0));
    epoch_ms(y, m, d, h, mi, sec)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_epochs() {
        assert_eq!(parse_iso_utc("1970-01-01T00:00:00Z"), 0);
        assert_eq!(parse_iso_utc("2026-01-01"), 1_767_225_600_000);
        assert_eq!(parse_iso_utc("2026-06-01T00:00:00Z"), 1_780_272_000_000);
    }
}
