//! Market, batch, busy-interval and UTC calendar/tail segment statistics.
use crate::{
    portfolio::{n, s, taker_fee},
    types::round,
};
use chrono::{DateTime, Datelike};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
pub fn market(
    slug: &str,
    market: &str,
    assets: &[String; 2],
    outcome: &str,
    p: &Value,
    trades: &[Value],
    splits: &[Value],
) -> Value {
    let mut sizes = [0.0; 2];
    let mut costs = [0.0; 2];
    let mut fees = 0.0;
    let mut meta = Vec::new();
    let mut seen = HashSet::new();
    for t in trades {
        if s(t, "side") == "BUY" {
            if let Some(i) = assets.iter().position(|a| a == s(t, "assetId")) {
                sizes[i] += n(t, "size");
                costs[i] += n(t, "price") * n(t, "size");
            }
        }
        if s(t, "liquidity") == "TAKER" {
            fees += taker_fee(n(t, "price"), n(t, "size"), n(t, "feeRateBps"));
        }
        if t["intentMeta"].is_object()
            && (s(t, "clientOrderId").is_empty() || seen.insert(s(t, "clientOrderId").to_owned()))
        {
            meta.push(t["intentMeta"].clone());
        }
    }
    let uq = n(&p["positionsByAssetId"][&assets[0]], "qty");
    let dq = n(&p["positionsByAssetId"][&assets[1]], "qty");
    let cost = n(&p["positionsByAssetId"][&assets[0]], "costBasis")
        + n(&p["positionsByAssetId"][&assets[1]], "costBasis");
    let merge = uq.min(dq);
    let redeem = if outcome == "UP" {
        uq - merge
    } else {
        dq - merge
    };
    let split_cost = splits.iter().map(|sp| n(sp, "splitCost")).sum::<f64>();
    json!({"slug":slug,"marketId":market,"finalOutcome":outcome,"pnl":round(n(p,"realizedPnlTotal")+merge+redeem-cost-split_cost,2),"tradeCount":trades.len(),"tradeAsMaker":trades.iter().filter(|t|s(t,"liquidity")=="MAKER").count(),"tradeAsTaker":trades.iter().filter(|t|s(t,"liquidity")=="TAKER").count(),"feesPaid":round(fees,2),"avgEntryPriceUp":if sizes[0]>0.0{Some(round(costs[0]/sizes[0],4))}else{None},"avgEntryPriceDown":if sizes[1]>0.0{Some(round(costs[1]/sizes[1],4))}else{None},"upShares":round(uq,2),"downShares":round(dq,2),"mergableShares":round(merge,2),"cost":round(cost,2),"splitCost":round(split_cost,2),"intentMeta":meta})
}
fn quality(pnls: &[f64]) -> Option<f64> {
    if pnls.is_empty() {
        return None;
    }
    let avg = pnls.iter().sum::<f64>() / pnls.len() as f64;
    let var = pnls.iter().map(|p| (p - avg).powi(2)).sum::<f64>() / pnls.len() as f64;
    let std = var.sqrt();
    let q = avg / std;
    if std == 0.0 || !q.is_finite() || q.abs() > 99999999.0 {
        None
    } else {
        Some(round(q, 4))
    }
}
pub fn batch(results: &[Value], initial: f64) -> Value {
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
pub fn segments(markets: &[Value], initial: f64) -> Vec<Value> {
    if markets.is_empty() {
        return Vec::new();
    }
    let mut sorted = markets.to_vec();
    sorted.sort_by(|a, b| n(a, "marketStartMs").total_cmp(&n(b, "marketStartMs")));
    let build = |kind: &str, key: &str, ord: i64, bucket: &[Value]| json!({"segmentKind":kind,"segmentKey":key,"segmentOrd":ord,"fromMs":bucket.first().unwrap()["marketStartMs"],"toMs":bucket.last().unwrap()["marketStartMs"],"stats":batch(bucket,initial)});
    let mut rows = vec![build("all", "all", 0, &sorted)];
    for count in [500, 1000, 3000, 6000] {
        if sorted.len() >= count {
            rows.push(build(
                "last_n",
                &count.to_string(),
                count as i64,
                &sorted[sorted.len() - count..],
            ));
        }
    }
    for kind in ["daily", "weekly", "monthly"] {
        let mut groups: BTreeMap<i64, (String, Vec<Value>)> = BTreeMap::new();
        for m in &sorted {
            let ms = n(m, "marketStartMs") as i64;
            let dt = DateTime::from_timestamp_millis(ms).expect("valid market timestamp");
            let day = ms.div_euclid(86400000) * 86400000;
            let (key, ord) = match kind {
                "daily" => (dt.format("%Y-%m-%d").to_string(), day),
                "weekly" => {
                    let week = dt.iso_week();
                    (
                        format!("{}-W{:02}", week.year(), week.week()),
                        day - dt.weekday().num_days_from_monday() as i64 * 86400000,
                    )
                }
                _ => {
                    let first = dt
                        .date_naive()
                        .with_day(1)
                        .unwrap()
                        .and_hms_opt(0, 0, 0)
                        .unwrap()
                        .and_utc()
                        .timestamp_millis();
                    (dt.format("%Y-%m").to_string(), first)
                }
            };
            groups
                .entry(ord)
                .or_insert_with(|| (key, Vec::new()))
                .1
                .push(m.clone());
        }
        for (ord, (key, bucket)) in groups {
            rows.push(build(kind, &key, ord, &bucket));
        }
    }
    rows
}
