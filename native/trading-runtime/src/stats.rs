//! Authoritative batch and UTC segment calculations.
//!
//! Differential reference: production commit
//! 07245602d6ff9bca0dcdf772134cba3dd227526c, batchStats.ts,
//! backtestSegments.ts and wallClock.ts. Input order determines batch streaks;
//! segment streaks use a stable chronological view. Zero-PnL rows intentionally
//! do not reset the active win/loss streak, matching the reference.
use crate::protocol::ProtocolError;
use serde_json::{json, Value};
use std::collections::HashMap;

fn n(value: &Value, key: &str) -> f64 {
    value.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}
fn s<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}
// Math.round ties toward positive infinity. Adding 0.5 before floor is not
// equivalent for the floating-point predecessor of 0.5.
fn js_round(value: f64) -> f64 {
    let lower = value.floor();
    if value - lower < 0.5 {
        lower
    } else {
        lower + 1.0
    }
}
fn round(value: f64, places: u32) -> f64 {
    let factor = 10_f64.powi(places as i32);
    js_round(value * factor) / factor
}
fn finite(value: &Value, key: &str, path: &str) -> Result<f64, ProtocolError> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .filter(|n| n.is_finite())
        .ok_or_else(|| {
            ProtocolError::invalid_request(format!("{path}.{key} must be a finite number"))
        })
}
const DAY_MS: i64 = 86_400_000;
const DATE_LIMIT_MS: i64 = 8_640_000_000_000_000;

#[derive(Clone, Copy)]
struct CivilDate {
    year: i64,
    month: i64,
    day: i64,
    sunday_weekday: i64,
}
// March-based 400-year Gregorian eras keep division correct before year zero.
// Days are counted from 1970-01-01, without Chrono's narrower year limit.
fn civil_from_days(days: i64) -> CivilDate {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let march_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * march_month + 2) / 5 + 1;
    let month = march_month + if march_month < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    CivilDate {
        year,
        month,
        day,
        sunday_weekday: (days + 4).rem_euclid(7),
    }
}
fn days_from_civil(mut year: i64, month: i64, day: i64) -> i64 {
    year -= i64::from(month <= 2);
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let march_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * march_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}
fn clipped_date(ms: i64) -> Option<CivilDate> {
    (ms.abs() <= DATE_LIMIT_MS).then(|| civil_from_days(ms.div_euclid(DAY_MS)))
}
fn date(ms: f64) -> Result<CivilDate, ProtocolError> {
    if !ms.is_finite() || ms.abs() > DATE_LIMIT_MS as f64 {
        return Err(ProtocolError::invalid_request(
            "marketStartMs is outside the JavaScript Date range",
        ));
    }
    Ok(civil_from_days((ms.trunc() as i64).div_euclid(DAY_MS)))
}
fn validate(input: &Value) -> Result<(&[Value], f64), ProtocolError> {
    if !input.is_object() {
        return Err(ProtocolError::invalid_request(
            "aggregate input must be an object",
        ));
    }
    let initial = finite(input, "initialCapital", "input")?;
    let markets = input
        .get("markets")
        .and_then(Value::as_array)
        .ok_or_else(|| ProtocolError::invalid_request("input.markets must be an array"))?;
    for (index, market) in markets.iter().enumerate() {
        let path = format!("input.markets[{index}]");
        if !market.is_object() {
            return Err(ProtocolError::invalid_request(format!(
                "{path} must be an object"
            )));
        }
        for key in [
            "pnl",
            "feesPaid",
            "tradeCount",
            "tradeAsMaker",
            "tradeAsTaker",
        ] {
            let number = finite(market, key, &path)?;
            if key.starts_with("trade")
                && (number < 0.0 || number.fract() != 0.0 || number > 9_007_199_254_740_991.0)
            {
                return Err(ProtocolError::invalid_request(format!(
                    "{path}.{key} must be a nonnegative safe integer"
                )));
            }
        }
        date(finite(market, "marketStartMs", &path)?)?;
        if let Some(execution) = market.get("execution").filter(|value| !value.is_null()) {
            if !execution.is_object() {
                return Err(ProtocolError::invalid_request(format!(
                    "{path}.execution must be an object or null"
                )));
            }
            if execution.get("durationMs").is_some_and(|v| !v.is_null()) {
                for key in ["durationMs", "startedAtMs", "finishedAtMs"] {
                    finite(execution, key, &format!("{path}.execution"))?;
                }
            }
        }
    }
    Ok((markets, initial))
}
fn quality(pnls: &[f64]) -> Option<f64> {
    if pnls.is_empty() {
        return None;
    }
    let avg = pnls.iter().sum::<f64>() / pnls.len() as f64;
    let var = pnls.iter().map(|p| (p - avg).powi(2)).sum::<f64>() / pnls.len() as f64;
    let std = var.sqrt();
    let q = avg / std;
    if !std.is_finite() || std == 0.0 || !q.is_finite() || q.abs() > 99999999.0 {
        None
    } else {
        Some(round(q, 4))
    }
}
fn batch(results: &[&Value], initial: f64) -> Value {
    let (mut pnl, mut fees, mut trades, mut maker, mut taker) = (0.0, 0.0, 0.0, 0.0, 0.0);
    let (mut skipped, mut no_activity, mut flat, mut won, mut lost) = (0, 0, 0, 0, 0);
    let (mut winsum, mut losesum, mut maxwin, mut maxlose): (f64, f64, f64, f64) =
        (0.0, 0.0, 0.0, 0.0);
    let (mut win_streak, mut lose_streak, mut skip_streak, mut max_ws, mut max_ls, mut max_ss) =
        (0, 0, 0, 0, 0, 0);
    let (mut win_sp, mut lose_sp, mut max_wp, mut max_lp) = (0.0, 0.0, 0.0, 0.0);
    let mut duration = 0.0;
    let mut samples = 0;
    let mut intervals = Vec::new();
    let mut pnls = Vec::new();
    let mut played_pnls = Vec::new();
    for result in results {
        let p = n(result, "pnl");
        pnl += p;
        pnls.push(p);
        fees += n(result, "feesPaid");
        trades += n(result, "tradeCount");
        maker += n(result, "tradeAsMaker");
        taker += n(result, "tradeAsTaker");
        if result["execution"]["durationMs"].as_f64().is_some() {
            duration += n(&result["execution"], "durationMs");
            samples += 1;
            let start = n(&result["execution"], "startedAtMs");
            let end = n(&result["execution"], "finishedAtMs");
            if end > start {
                intervals.push((start, end));
            }
        }
        if p > 0.0 {
            won += 1;
            played_pnls.push(p);
            winsum += p;
            maxwin = maxwin.max(p);
            win_streak += 1;
            win_sp += p;
            if win_streak > max_ws {
                max_ws = win_streak;
                max_wp = win_sp;
            }
            lose_streak = 0;
            lose_sp = 0.0;
            skip_streak = 0;
        } else if p < 0.0 {
            lost += 1;
            played_pnls.push(p);
            losesum += p;
            maxlose = maxlose.min(p);
            lose_streak += 1;
            lose_sp += p;
            if lose_streak > max_ls {
                max_ls = lose_streak;
                max_lp = lose_sp;
            }
            win_streak = 0;
            win_sp = 0.0;
            skip_streak = 0;
        } else {
            skipped += 1;
            if n(result, "tradeCount") > 0.0 {
                flat += 1;
            }
            if s(result, "skipReason") == "no_in_window_activity" {
                no_activity += 1;
            }
            skip_streak += 1;
            max_ss = max_ss.max(skip_streak);
        }
    }
    intervals.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut busy = 0.0;
    let mut current: Option<(f64, f64)> = None;
    for (start, end) in intervals {
        match current {
            None => current = Some((start, end)),
            Some((cs, ce)) if start <= ce => current = Some((cs, ce.max(end))),
            Some((cs, ce)) => {
                busy += ce - cs;
                current = Some((start, end));
            }
        }
    }
    if let Some((s, e)) = current {
        busy += e - s;
    }
    let played = won + lost;
    let wr = if played > 0 {
        won as f64 / played as f64
    } else {
        0.0
    };
    json!({"capitalInitial":initial,"capitalFinal":round(initial+pnl,2),"pnlTotal":round(pnl,2),"totalFeesPaid":round(fees,2),"qualitySystem":quality(&pnls),"qualityTrade":quality(&played_pnls),"evPerMarketPlayed":round(if played>0{pnl/played as f64}else{0.0},2),"evPerMarketTotal":round(if !results.is_empty(){pnl/results.len() as f64}else{0.0},2),"marketsTotal":results.len(),"marketsSkipped":skipped,"marketsNoInWindowActivity":no_activity,"marketsFlatWithTrades":flat,"marketsPlayed":played,"marketsWon":won,"marketsLost":lost,"winRate":round(wr,4),"winRatePct":round(wr*100.0,2),"tradesTotal":trades,"tradesMaker":maker,"tradesTaker":taker,"pnlAvgWin":round(if won>0{winsum/won as f64}else{0.0},2),"pnlAvgLose":round(if lost>0{losesum/lost as f64}else{0.0},2),"pnlMaxWin":round(maxwin,2),"pnlMaxLose":round(maxlose,2),"streakMaxWin":max_ws,"streakMaxLose":max_ls,"streakMaxWinPnl":round(max_wp,2),"streakMaxLosePnl":round(max_lp,2),"streakMaxSkipped":max_ss,"durationTotalMs":duration,"durationAvgMs":round(if samples>0{duration/samples as f64}else{0.0},2),"durationWallClockMs":round(busy,0)})
}

// Date.UTC interprets years 0..99 as 1900..1999 and TimeClips the
// resulting timestamp. Some valid extreme input dates therefore produce a
// NaN ordinal in the reference; JSON serializes that ordinal as null.
fn js_utc(year: i64, month: i64, day: i64) -> Option<i64> {
    let year = if (0..=99).contains(&year) {
        year + 1900
    } else {
        year
    };
    let milliseconds = days_from_civil(year, month, day) * DAY_MS;
    (milliseconds.abs() <= DATE_LIMIT_MS).then_some(milliseconds)
}
fn iso_prefix(dt: CivilDate, length: usize) -> String {
    let year = dt.year;
    let year = if (0..=9999).contains(&year) {
        format!("{year:04}")
    } else if year < 0 {
        format!("-{:06}", -year)
    } else {
        format!("+{year:06}")
    };
    // Preserve the reference's fixed substring lengths even for signed years.
    let value = format!("{year}-{:02}-{:02}T", dt.month, dt.day);
    value.chars().take(length).collect()
}
fn bucket(ms: f64, kind: &str) -> Result<(String, Option<i64>), ProtocolError> {
    let dt = date(ms)?;
    let day = (ms / DAY_MS as f64).floor() as i64 * DAY_MS;
    match kind {
        "daily" => Ok((iso_prefix(dt, 10), Some(day))),
        "monthly" => Ok((iso_prefix(dt, 7), js_utc(dt.year, dt.month, 1))),
        _ => {
            let day_utc = js_utc(dt.year, dt.month, dt.day);
            let monday = day_utc.map(|day| day - (dt.sunday_weekday + 6) % 7 * DAY_MS);
            let thursday = day_utc.and_then(|day| {
                let dow = clipped_date(day)?.sunday_weekday;
                clipped_date(day + (if dow == 0 { -3 } else { 4 - dow }) * DAY_MS).map(|date| {
                    (
                        date.year,
                        day + (if dow == 0 { -3 } else { 4 - dow }) * DAY_MS,
                    )
                })
            });
            let key = if let Some((iso_year, thursday)) = thursday {
                let week = js_utc(iso_year, 1, 4).map(|jan4| {
                    let dow = civil_from_days(jan4.div_euclid(DAY_MS)).sunday_weekday;
                    let first_monday = jan4 - (dow + 6) % 7 * DAY_MS;
                    (thursday - first_monday).div_euclid(7 * DAY_MS) + 1
                });
                format!(
                    "{iso_year}-W{}",
                    week.map(|week| format!("{week:02}"))
                        .unwrap_or_else(|| "NaN".to_owned())
                )
            } else {
                "NaN-WNaN".to_owned()
            };
            Ok((key, monday))
        }
    }
}
fn segment(
    kind: &str,
    key: &str,
    ord: Option<i64>,
    markets: &[&Value],
    initial: f64,
) -> Result<Value, ProtocolError> {
    let first = markets
        .first()
        .ok_or_else(|| ProtocolError::invalid_request("internal empty statistics bucket"))?;
    let last = markets
        .last()
        .ok_or_else(|| ProtocolError::invalid_request("internal empty statistics bucket"))?;
    Ok(json!({"segmentKind":kind,"segmentKey":key,"segmentOrd":ord,
        "fromMs":first["marketStartMs"],"toMs":last["marketStartMs"],"stats":batch(markets,initial)}))
}
fn segments(markets: &[Value], initial: f64) -> Result<Vec<Value>, ProtocolError> {
    if markets.is_empty() {
        return Ok(Vec::new());
    }
    let mut sorted: Vec<&Value> = markets.iter().collect();
    // slice::sort_by is stable; ties retain the producer's order.
    sorted.sort_by(|a, b| {
        n(a, "marketStartMs")
            .partial_cmp(&n(b, "marketStartMs"))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut rows = vec![segment("all", "all", Some(0), &sorted, initial)?];
    for count in [500, 1000, 3000, 6000] {
        if sorted.len() >= count {
            rows.push(segment(
                "last_n",
                &count.to_string(),
                Some(count as i64),
                &sorted[sorted.len() - count..],
                initial,
            )?);
        }
    }
    for kind in ["daily", "weekly", "monthly"] {
        let mut group_indices: HashMap<String, usize> = HashMap::new();
        let mut groups: Vec<(String, Option<i64>, Vec<&Value>)> = Vec::new();
        for market in &sorted {
            let (key, ord) = bucket(n(market, "marketStartMs"), kind)?;
            if let Some(index) = group_indices.get(&key) {
                groups[*index].2.push(*market);
            } else {
                group_indices.insert(key.clone(), groups.len());
                groups.push((key, ord, vec![*market]));
            }
        }
        let mut calendar = groups
            .into_iter()
            .map(|(key, ord, markets)| segment(kind, &key, ord, &markets, initial))
            .collect::<Result<Vec<_>, _>>()?;
        calendar.sort_by(
            |a, b| match (a["segmentOrd"].as_i64(), b["segmentOrd"].as_i64()) {
                (Some(a), Some(b)) => a.cmp(&b),
                // JS Array.sort treats a NaN comparator result as equality.
                _ => std::cmp::Ordering::Equal,
            },
        );
        rows.extend(calendar);
    }
    Ok(rows)
}

/// Calculate batch fields in input order and UTC segments in stable time order.
/// Additional market metadata is accepted and never interpreted or mutated.
pub fn aggregate(input: &Value) -> Result<Value, ProtocolError> {
    let (markets, initial) = validate(input)?;
    // Prevent JSON nulls masquerading as valid numbers after finite input sums
    // overflow. Degenerate quality ratios are deliberately allowed to be null.
    for key in [
        "pnl",
        "feesPaid",
        "tradeCount",
        "tradeAsMaker",
        "tradeAsTaker",
    ] {
        let total = markets.iter().map(|m| n(m, key)).sum::<f64>();
        if !total.is_finite()
            || (key == "pnl"
                && (!(initial + total).is_finite() || !((initial + total) * 100.0).is_finite()))
            || !(total * 100.0).is_finite()
        {
            return Err(ProtocolError::invalid_request(format!(
                "aggregate {key} overflows numeric range"
            )));
        }
    }
    let duration = markets
        .iter()
        .map(|m| n(&m["execution"], "durationMs"))
        .sum::<f64>();
    if !duration.is_finite() || !(duration * 100.0).is_finite() {
        return Err(ProtocolError::invalid_request(
            "aggregate duration overflows numeric range",
        ));
    }
    let original_order: Vec<&Value> = markets.iter().collect();
    let batch_stats = batch(&original_order, initial);
    let segments = segments(markets, initial)?;
    for stats in
        std::iter::once(&batch_stats).chain(segments.iter().map(|segment| &segment["stats"]))
    {
        if stats.as_object().is_some_and(|fields| {
            fields.iter().any(|(key, value)| {
                value.is_null() && key != "qualitySystem" && key != "qualityTrade"
            })
        }) {
            return Err(ProtocolError::invalid_request(
                "statistics calculation overflows numeric range",
            ));
        }
    }
    Ok(json!({"batchStats":batch_stats,"segments":segments}))
}
