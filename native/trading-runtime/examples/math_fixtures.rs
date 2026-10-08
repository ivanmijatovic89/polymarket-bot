use polymarket_runtime::math::*;
use serde_json::{json, Value};
use std::io::{self, Read};

fn num(row: &Value, key: &str) -> f64 {
    f64::from_bits(
        u64::from_str_radix(row[key].as_str().expect("hex IEEE input"), 16)
            .expect("valid IEEE bits"),
    )
}
fn encoded(value: f64) -> Value {
    if value.is_nan() {
        json!({"kind":"nan"})
    } else {
        json!({"kind":"number","bits":format!("{:016x}", value.to_bits())})
    }
}
fn main() {
    let mut text = String::new();
    io::stdin().read_to_string(&mut text).unwrap();
    let cases: Vec<Value> = serde_json::from_str(&text).unwrap();
    let result: Vec<Value> = cases.iter().map(|row| {
        let value = num(row,"value");
        let price = num(row,"price");
        let size = num(row,"size");
        let rate = row.get("rate").filter(|value| !value.is_null()).map(|_| num(row,"rate"));
        let post_only = row["postOnly"].as_bool().unwrap_or(false);
        let buy = row["buy"].as_bool().unwrap();
        let taker = row["taker"].as_bool().unwrap();
        let capital = validate_starting_capital(value);
        json!({"round":encoded(js_round(value)),"round8":encoded(round8(value)),"round2":encoded(round2(value)),
            "fee":encoded(compute_taker_fee(rate.unwrap_or(f64::NAN),price,size)),"commitment":encoded(buy_commitment(price,size,post_only)),
            "cashDelta":encoded(fill_cash_delta(price,size,buy,taker,rate)),"numberString":js_number_string(value),
            "capital":match capital {Ok(number)=>json!({"valid":true,"value":encoded(number)}),Err(error)=>json!({"valid":false,"error":error})}})
    }).collect();
    println!("{}", serde_json::to_string(&result).unwrap());
}
