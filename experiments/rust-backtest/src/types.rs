use serde::Deserialize;
use sha2::{Digest as ShaDigest, Sha256};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub starting_capital: f64,
    pub delay_ms: i64,
    pub jitter_ms: i64,
    pub binance_latency_ms: i64,
    pub chainlink_latency_ms: i64,
    pub price_to_beat_latency_ms: i64,
    pub seed: u32,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Market {
    pub slug: String,
    pub file_path: String,
    pub feeds: String,
    #[serde(default)]
    pub raw_feeds: Option<crate::raw_feeds::RawFeedFiles>,
    pub start_ms: i64,
    pub end_ms: i64,
    pub market_id: String,
    pub up_id: String,
    pub down_id: String,
    pub outcome: String,
    pub price_to_beat: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format_version: u32,
    pub strategy: String,
    pub artifact_sha256: String,
    pub settings: Settings,
    pub params: Params,
    pub markets: Vec<Market>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Params {
    pub lookback_ms: f64,
    pub move_usd: f64,
    pub min_edge: f64,
    pub sigma: f64,
    pub max_remaining_sec: f64,
    pub min_remaining_sec: f64,
    pub stake_usd: f64,
    pub stake_min_usd: Option<f64>,
    pub full_edge: f64,
    pub max_trades: u32,
    pub cooldown_ms: f64,
    pub min_price: f64,
    pub max_price: f64,
    pub slippage: f64,
    pub max_spread: f64,
    pub depth_frac: f64,
    pub move_k: f64,
    pub move_min_usd: f64,
    pub min_vol_sec: f64,
    pub sigma_adapt: f64,
    pub sigma_min: f64,
    pub max_rv: f64,
    pub abs_edge: f64,
    pub abs_hi: f64,
    pub abs_lo_frac: f64,
    pub fill_edge: f64,
    pub depth_slip: f64,
    pub rev_edge: f64,
    pub add_edge: f64,
    pub trend_ms: f64,
    pub trend_min: f64,
    pub imb_cents: f64,
    pub min_imb: f64,
}
#[derive(Clone, Copy)]
pub struct Level {
    pub price: f64,
    pub size: f64,
}
#[derive(Clone, Default)]
pub struct Book {
    pub exists: bool,
    pub ts: i64,
    pub bids: Vec<Level>,
    pub asks: Vec<Level>,
}
impl Book {
    pub fn change(&mut self, buy: bool, price: f64, size: f64) {
        self.exists = true;
        let side = if buy { &mut self.bids } else { &mut self.asks };
        let at = side.binary_search_by(|l| {
            if buy {
                price.total_cmp(&l.price)
            } else {
                l.price.total_cmp(&price)
            }
        });
        match at {
            Ok(i) => {
                if size <= 0.0 {
                    side.remove(i);
                } else {
                    side[i].size = size;
                }
            }
            Err(i) => {
                if size > 0.0 {
                    side.insert(i, Level { price, size });
                }
            }
        }
    }
}
pub fn js_round(n: f64) -> f64 {
    (n + 0.5).floor()
}
pub fn round(n: f64, places: u32) -> f64 {
    let f = 10_f64.powi(places as i32);
    js_round(n * f) / f
}
pub struct Random {
    state: u32,
}
impl Random {
    pub fn new(seed: u32) -> Self {
        Self { state: seed }
    }
    pub fn next(&mut self) -> f64 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.state = x;
        x as f64 / 4294967296.0
    }
}
pub struct Digest {
    pub value: u32,
    hash: Sha256,
}
impl Digest {
    pub fn new() -> Self {
        Self {
            value: 2166136261,
            hash: Sha256::new(),
        }
    }
    pub fn sha256(&self) -> String {
        format!("{:x}", self.hash.clone().finalize())
    }
    pub fn number(&mut self, v: f64) {
        self.hash.update(v.to_le_bytes());
        for b in v.to_le_bytes() {
            self.value = (self.value ^ (b as u32)).wrapping_mul(16777619);
        }
    }
    pub fn tick(
        &mut self,
        kind: u8,
        ts: i64,
        seq: f64,
        local: Option<i64>,
        books: &[Book; 2],
        depth: usize,
    ) {
        self.number(kind as f64);
        self.number(ts as f64);
        self.number(seq);
        self.number(local.map(|v| v as f64).unwrap_or(f64::NAN));
        for b in books {
            self.number(if b.exists { 1.0 } else { 0.0 });
            if !b.exists {
                continue;
            }
            let bid = b.bids.first().map(|v| v.price);
            let ask = b.asks.first().map(|v| v.price);
            self.number(b.ts as f64);
            self.number(bid.unwrap_or(f64::NAN));
            self.number(ask.unwrap_or(f64::NAN));
            self.number(bid.zip(ask).map(|(b, a)| (b + a) / 2.0).unwrap_or(f64::NAN));
            self.number(bid.zip(ask).map(|(b, a)| a - b).unwrap_or(f64::NAN));
            for side in [&b.bids, &b.asks] {
                self.number(side.len() as f64);
                for l in side {
                    self.number(l.price);
                    self.number(l.size);
                }
            }
            self.number(depth as f64);
            for side in [&b.bids, &b.asks] {
                self.number(side.len().min(depth) as f64);
                let mut sum = 0.0;
                for l in side.iter().take(depth) {
                    sum += l.size;
                    self.number(sum);
                }
            }
        }
    }
}
