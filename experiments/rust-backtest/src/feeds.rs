use crate::types::*;
use serde::Deserialize;
#[derive(Deserialize, PartialEq, Debug)]
pub struct Feeds {
    pub binance: Vec<[f64; 2]>,
    pub chainlink: Vec<[f64; 3]>,
}
#[derive(Clone, Copy, Default)]
pub struct FeedSnapshot {
    pub binance: Option<f64>,
    pub binance_received: Option<f64>,
    pub chainlink: Option<f64>,
    pub chainlink_received: Option<f64>,
    pub price_to_beat: Option<f64>,
}
pub struct FeedProvider {
    pub feeds: Feeds,
    pub schedule: Vec<(i64, u8)>,
    cursor: usize,
    cl_cursor: usize,
    high_water: i64,
}
impl FeedProvider {
    pub fn new(feeds: Feeds, m: &Market, s: &Settings) -> Self {
        let mut schedule = Vec::new();
        for b in &feeds.binance {
            let t = b[0] as i64 + s.binance_latency_ms;
            if t >= m.start_ms && t <= m.end_ms {
                schedule.push((t, 2));
            }
        }
        for c in &feeds.chainlink {
            let t = c[1] as i64 + s.chainlink_latency_ms;
            if t >= m.start_ms && t <= m.end_ms {
                schedule.push((t, 3));
            }
        }
        schedule.sort_by_key(|v| *v);
        Self {
            feeds,
            schedule,
            cursor: 0,
            cl_cursor: 0,
            high_water: i64::MIN,
        }
    }
    pub fn snapshot(&mut self, clock: i64, m: &Market, s: &Settings) -> FeedSnapshot {
        self.high_water = self.high_water.max(clock);
        let t = self.high_water;
        while self.cursor < self.feeds.binance.len()
            && self.feeds.binance[self.cursor][0] + s.binance_latency_ms as f64 <= t as f64
        {
            self.cursor += 1;
        }
        while self.cl_cursor < self.feeds.chainlink.len()
            && self.feeds.chainlink[self.cl_cursor][1] + s.chainlink_latency_ms as f64 <= t as f64
        {
            self.cl_cursor += 1;
        }
        let b = self.cursor.checked_sub(1).map(|i| self.feeds.binance[i]);
        let c = self
            .cl_cursor
            .checked_sub(1)
            .map(|i| self.feeds.chainlink[i]);
        FeedSnapshot {
            binance: b.map(|v| v[1]),
            binance_received: b.map(|v| v[0] + s.binance_latency_ms as f64),
            chainlink: c.map(|v| v[2]),
            chainlink_received: c.map(|v| v[1] + s.chainlink_latency_ms as f64),
            price_to_beat: if t >= m.start_ms + s.price_to_beat_latency_ms {
                Some(m.price_to_beat)
            } else {
                None
            },
        }
    }
}
