//! Measures one Binance and one Chainlink full-day decode (14 PF-1, 16 §6.1).
//!
//! Usage: cargo run --release -p pmb-feeds --example decode_day -- <binance.parquet> <crypto_prices.parquet>

use pmb_feeds::{ChainlinkDay, UtcDay};
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [b, c] = args.as_slice() else {
        eprintln!("usage: decode_day <binance.parquet> <crypto_prices.parquet>");
        std::process::exit(2);
    };
    for _ in 0..3 {
        let t = Instant::now();
        let d = pmb_feeds::BinanceDay::decode(b.as_ref(), UtcDay(0)).expect("binance decode");
        let bt = t.elapsed();
        let t = Instant::now();
        let cd = ChainlinkDay::decode(c.as_ref(), UtcDay(0), "btcusd").expect("chainlink decode");
        let ct = t.elapsed();
        println!(
            "binance rows={} monotone={} {:.1} ms | chainlink rows={} {:.1} ms",
            d.len(),
            d.ts_monotone(),
            bt.as_secs_f64() * 1e3,
            cd.len(),
            ct.as_secs_f64() * 1e3
        );
    }
}
