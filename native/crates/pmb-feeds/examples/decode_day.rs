//! Measures one Binance and one Chainlink full-day decode (14 PF-1, 16 §6.1)
//! and the per-tick feed advance over one 15m window (14 PF-4).
//!
//! Usage: cargo run --release -p pmb-feeds --example decode_day -- \
//!   <BTCUSDT day.parquet> <btcusd crypto_prices day.parquet> <15m slug of that day>

use pmb_core::TsMs;
use pmb_feeds::binance::build_binance_series;
use pmb_feeds::chainlink::build_chainlink_series;
use pmb_feeds::{
    BinanceDay, BinanceFeed, ChainlinkDay, ChainlinkFeed, FeedProfile, FeedState, MarketFeeds,
    UtcDay,
};
use std::sync::Arc;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [b, c, slug] = args.as_slice() else {
        eprintln!("usage: decode_day <binance.parquet> <crypto_prices.parquet> <slug>");
        std::process::exit(2);
    };
    let window = pmb_core::parse_slug(slug).expect("slug").window;
    let day = UtcDay::of_ms(window.start_ms.0);
    let (mut bd, mut cd) = (None, None);
    for _ in 0..3 {
        let t = Instant::now();
        let d = BinanceDay::decode(b.as_ref(), day).expect("binance decode");
        let bt = t.elapsed();
        let t = Instant::now();
        let c = ChainlinkDay::decode(c.as_ref(), day, "btcusd").expect("chainlink decode");
        let ct = t.elapsed();
        println!(
            "decode: binance rows={} monotone={} {:.1} ms | chainlink rows={} {:.1} ms",
            d.len(),
            d.ts_monotone(),
            bt.as_secs_f64() * 1e3,
            c.len(),
            ct.as_secs_f64() * 1e3
        );
        bd = Some(Arc::new(d));
        cd = Some(Arc::new(c));
    }
    let (bd, cd) = (bd.unwrap(), cd.unwrap());
    let t = Instant::now();
    let bs = build_binance_series("BTCUSDT", &[bd], window, 110, FeedProfile::TsCompat)
        .expect("series")
        .series;
    let cs = build_chainlink_series("btcusd", &[cd], window, 320, 300_000).expect("series");
    println!(
        "series: binance {} (zero-copy {}) chainlink {} in {:.3} ms",
        bs.len(),
        bs.is_zero_copy(),
        cs.len(),
        t.elapsed().as_secs_f64() * 1e3
    );
    let feeds = MarketFeeds::from_parts(
        window,
        Some(BinanceFeed {
            symbol: "btcusdt",
            series: bs,
            tick_on_update: true,
        }),
        Some(ChainlinkFeed {
            symbol: "btc/usd",
            asset_id: "btcusd",
            series: cs,
            tick_on_update: true,
        }),
        None,
    );
    println!("schedule: {} entries", feeds.schedule().len());
    let t = Instant::now();
    let mut st = FeedState::new();
    let mut acc = 0u64;
    let n = window.end_ms.0 - window.start_ms.0;
    for ms in window.start_ms.0..window.end_ms.0 {
        acc = acc.wrapping_add(
            st.advance(&feeds, TsMs(ms))
                .generation(pmb_core::FeedKind::BinanceSpot),
        );
    }
    let el = t.elapsed();
    println!(
        "advance: {n} ticks (1 ms apart) {:.2} ms, {:.1} ns/tick (checksum {acc})",
        el.as_secs_f64() * 1e3,
        el.as_secs_f64() * 1e9 / n as f64
    );
}
