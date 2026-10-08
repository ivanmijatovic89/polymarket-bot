use polymarket_runtime::metrics::*;
use serde_json::{json, Value};
use std::io::{self, Read};
fn num(value: &Value) -> f64 {
    f64::from_bits(u64::from_str_radix(value.as_str().unwrap(), 16).unwrap())
}
fn encode(value: f64) -> Value {
    if value.is_nan() {
        json!({"kind":"nan"})
    } else {
        json!({"kind":"number","bits":format!("{:016x}",value.to_bits())})
    }
}
fn main() {
    let mut text = String::new();
    io::stdin().read_to_string(&mut text).unwrap();
    let cases: Vec<Value> = serde_json::from_str(&text).unwrap();
    let results:Vec<Value>=cases.iter().map(|row| {
        let position=compute_position_metrics(row["upId"].as_str(),row["downId"].as_str(),|id| row["positions"].get(id).map(|v|PositionAmounts {qty:num(&v["qty"]),cost_basis:num(&v["costBasis"])}));
        let up_bids:Vec<f64>=row["upBook"]["bids"].as_array().unwrap().iter().map(num).collect();
        let up_asks:Vec<f64>=row["upBook"]["asks"].as_array().unwrap().iter().map(num).collect();
        let down_bids:Vec<f64>=row["downBook"]["bids"].as_array().unwrap().iter().map(num).collect();
        let down_asks:Vec<f64>=row["downBook"]["asks"].as_array().unwrap().iter().map(num).collect();
        let book=compute_orderbook_metrics(BookDepthView {depth_levels:num(&row["upBook"]["depth"]),bids:&up_bids,asks:&up_asks},BookDepthView {depth_levels:num(&row["downBook"]["depth"]),bids:&down_bids,asks:&down_asks});
        json!({"position":position.map(|p|json!({"shares_mergeable":encode(p.shares_mergeable),"pair_avg":p.pair_avg.map(encode),"total_cost":encode(p.total_cost),"pnl_merge":encode(p.pnl_merge),"pnl_if_up_wins":encode(p.pnl_if_up_wins),"pnl_if_down_wins":encode(p.pnl_if_down_wins),"imbalance":encode(p.imbalance)})),"book":{"depthLevels":book.depth_levels,"weakBidSideByLevel":book.weak_bid_side_by_level,"weakBidRatioByLevel":book.weak_bid_ratio_by_level.into_iter().map(encode).collect::<Vec<_>>(),"weakAskSideByLevel":book.weak_ask_side_by_level,"weakAskRatioByLevel":book.weak_ask_ratio_by_level.into_iter().map(encode).collect::<Vec<_>>()}})
    }).collect();
    println!("{}", serde_json::to_string(&results).unwrap());
}
