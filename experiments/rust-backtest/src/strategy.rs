use crate::{feeds::FeedSnapshot, types::*};
use std::collections::VecDeque;

pub struct Decision {
    pub asset: usize,
    pub price: f64,
    pub size: f64,
    pub seq: u32,
}
pub struct Strategy {
    pub pending: bool,
    trades: u32,
    last_trade: f64,
    seq: u32,
    bin: VecDeque<(f64, f64)>,
    mid: VecDeque<(f64, f64)>,
    vol_sec: f64,
    vol_px: f64,
    vol_sum: f64,
    vol_n: f64,
}
fn at(arr: &VecDeque<(f64, f64)>, t: f64) -> Option<f64> {
    arr.iter().rev().find(|v| v.0 <= t).map(|v| v.1)
}
pub fn norm_cdf(x: f64) -> f64 {
    let t = 1.0 / (1.0 + 0.3275911 * x.abs() / std::f64::consts::SQRT_2);
    let y = 1.0
        - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t
            + 0.254829592)
            * t
            * (-(x * x) / 2.0).exp();
    if x >= 0.0 {
        0.5 * (1.0 + y)
    } else {
        0.5 * (1.0 - y)
    }
}
pub fn norm_inv(p: f64) -> f64 {
    let a = [
        -39.69683028665376,
        220.9460984245205,
        -275.9285104469687,
        138.357751867269,
        -30.66479806614716,
        2.506628274631,
    ];
    let b = [
        -54.47609879822406,
        161.5858368580409,
        -155.6989798598866,
        66.80131188771972,
        -13.28068155288572,
    ];
    let c = [
        -0.007784894002430293,
        -0.3223964580411365,
        -2.400758277161838,
        -2.549732539343734,
        4.374664141464968,
        2.938163982698783,
    ];
    let d = [
        0.007784695709041462,
        0.3224671290700398,
        2.445134137142996,
        3.754408661907416,
    ];
    if p < 0.02425 {
        let q = (-2.0 * p.ln()).sqrt();
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
            / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0);
    }
    if p > 1.0 - 0.02425 {
        return -norm_inv(1.0 - p);
    }
    let q = p - 0.5;
    let r = q * q;
    (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
        / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0)
}
impl Strategy {
    pub fn new() -> Self {
        Self {
            pending: false,
            trades: 0,
            last_trade: f64::NEG_INFINITY,
            seq: 0,
            bin: VecDeque::new(),
            mid: VecDeque::new(),
            vol_sec: -1.0,
            vol_px: 0.0,
            vol_sum: 0.0,
            vol_n: 0.0,
        }
    }
    pub fn tick(
        &mut self,
        now: i64,
        books: &[Book; 2],
        f: FeedSnapshot,
        p: &Portfolio,
        c: &Params,
        m: &Market,
    ) -> Option<Decision> {
        let now = now as f64;
        if let Some(b) = f.binance.filter(|v| v.is_finite() && *v > 0.0) {
            if self
                .bin
                .back()
                .is_none_or(|v| v.1 != b || now - v.0 > 500.0)
            {
                self.bin.push_back((now, b));
            }
            let sec = (now / 1000.0).floor();
            if self.vol_sec < 0.0 {
                self.vol_sec = sec;
                self.vol_px = b;
            } else if sec > self.vol_sec {
                let r = (b / self.vol_px).ln();
                self.vol_sum += r * r;
                self.vol_n += sec - self.vol_sec;
                self.vol_sec = sec;
                self.vol_px = b;
            }
        }
        let up = books[0].top();
        let down = books[1].top();
        if let Some((bid, ask)) = up {
            if ask - bid <= c.max_spread {
                let mid = (ask + bid) / 2.0;
                if self.mid.back().is_none_or(|v| v.1 != mid) {
                    self.mid.push_back((now, mid));
                }
            }
        }
        let keep = c.lookback_ms.max(c.trend_ms) + 5000.0;
        while self.bin.len() > 2 && self.bin[1].0 < now - keep {
            self.bin.pop_front();
        }
        while self.mid.len() > 2 && self.mid[1].0 < now - keep {
            self.mid.pop_front();
        }
        if self.pending || self.trades >= 20 || now - self.last_trade < c.cooldown_ms {
            return None;
        }
        if p.starting - p.available()
            >= c.stake_usd.max(c.stake_min_usd.unwrap_or(0.0)) * c.max_trades as f64 - 1.0
        {
            return None;
        }
        let rem = (m.end_ms as f64 - now) / 1000.0;
        if rem > c.max_remaining_sec || rem < c.min_remaining_sec {
            return None;
        }
        let up = up?;
        let down = down?;
        let b = f.binance?;
        let t0 = now - c.lookback_ms;
        let b0 = at(&self.bin, t0)?;
        let m0 = at(&self.mid, t0)?;
        if self.bin[0].0 > t0 || self.mid[0].0 > t0 {
            return None;
        }
        let movement = b - b0;
        let rv = if self.vol_n >= c.min_vol_sec {
            Some((self.vol_sum / self.vol_n).sqrt())
        } else {
            None
        };
        let mut trigger = c.move_usd;
        if c.move_k > 0.0 {
            if let Some(rv) = rv {
                trigger = c.move_usd.min(
                    c.move_min_usd
                        .max(c.move_k * rv * b * (c.lookback_ms / 1000.0).sqrt()),
                );
            }
        }
        if movement.abs() < trigger {
            return None;
        }
        if c.max_rv > 0.0 && rv.is_some_and(|v| v > c.max_rv) {
            return None;
        }
        let sig = match rv {
            Some(rv) if c.sigma_adapt > 0.0 => {
                c.sigma * (1.0 - c.sigma_adapt) + c.sigma_adapt * c.sigma.min(c.sigma_min.max(rv))
            }
            _ => c.sigma,
        };
        let p_up =
            norm_cdf(norm_inv(m0.clamp(0.005, 0.995)) + movement / (sig * b * rem.max(1.0).sqrt()));
        let asset = if movement > 0.0 { 0 } else { 1 };
        let fair = if asset == 0 { p_up } else { 1.0 - p_up };
        let ask = if asset == 0 { up.1 } else { down.1 };
        if ask < c.min_price || ask > c.max_price {
            return None;
        }
        let edge = fair - ask - 0.07 * ask * (1.0 - ask);
        let qs = p.positions[asset].qty;
        let qo = p.positions[1 - asset].qty;
        let need = if qo > qs && c.rev_edge > -1.0 {
            c.rev_edge
        } else if qo <= qs && qs > 0.0 && c.add_edge > -1.0 {
            c.add_edge
        } else {
            c.min_edge
        };
        if edge < need {
            return None;
        }
        let tr = at(&self.bin, now - c.trend_ms)
            .filter(|_| self.bin[0].0 <= now - c.trend_ms)
            .map(|bt| (b - bt) / movement);
        if c.trend_min > -1.0 && tr.is_none_or(|v| v < c.trend_min) {
            return None;
        }
        let (bid, ask) = if asset == 0 { up } else { down };
        let book = &books[asset];
        let bid_sz: f64 = book
            .bids
            .iter()
            .filter(|l| l.price >= bid - c.imb_cents - 1e-9)
            .map(|l| l.size)
            .sum();
        let ask_sz: f64 = book
            .asks
            .iter()
            .filter(|l| l.price <= ask + c.imb_cents + 1e-9)
            .map(|l| l.size)
            .sum();
        let imb = if bid_sz + ask_sz > 0.0 {
            Some(bid_sz / (bid_sz + ask_sz))
        } else {
            None
        };
        if c.min_imb > -1.0 && imb.is_none_or(|v| v < c.min_imb) {
            return None;
        }
        let abs_fair = match (f.price_to_beat, f.chainlink, f.chainlink_received) {
            (Some(ptb), Some(cl), Some(received)) if ptb > 0.0 && cl.is_finite() && cl > 0.0 => {
                let px = cl + at(&self.bin, received).map(|bc| b - bc).unwrap_or(0.0);
                let pu = norm_cdf((px / ptb).ln() / (sig * rem.max(1.0).sqrt()));
                Some(if asset == 0 { pu } else { 1.0 - pu })
            }
            _ => None,
        };
        let abs_edge = abs_fair.map(|v| v - ask - 0.07 * ask * (1.0 - ask));
        if c.abs_edge > -1.0 && abs_edge.is_none_or(|v| v < c.abs_edge) {
            return None;
        }
        let scale = if c.abs_hi > -1.0 && abs_edge.is_none_or(|v| v < c.abs_hi) {
            c.abs_lo_frac
        } else {
            1.0
        };
        let mut limit = round(ask + c.slippage, 2).min(0.99);
        if c.fill_edge > -1.0 {
            let ask_c = round(ask, 2);
            while limit > ask_c + 1e-9 && fair - limit - 0.07 * limit * (1.0 - limit) < c.fill_edge
            {
                limit = round(limit - 0.01, 2);
            }
        }
        let lo = c.stake_min_usd.unwrap_or(c.stake_usd);
        let frac = if c.full_edge > c.min_edge {
            ((edge - c.min_edge) / (c.full_edge - c.min_edge)).clamp(0.0, 1.0)
        } else {
            1.0
        };
        let stake = ((lo + (c.stake_usd - lo) * frac) * scale).min(p.available() * 0.97);
        let mut size = (stake / (limit * (1.0 + 0.07 * (1.0 - limit))) * 100.0).floor() / 100.0;
        if c.depth_frac > 0.0 {
            let depth_px = if c.depth_slip >= 0.0 {
                limit.min(ask + c.depth_slip)
            } else {
                limit
            };
            let depth: f64 = book
                .asks
                .iter()
                .filter(|l| l.price <= depth_px + 1e-9)
                .map(|l| l.size)
                .sum();
            size = size.min((depth * c.depth_frac * 100.0).floor() / 100.0);
        }
        if size < 5.0 {
            return None;
        }
        self.pending = true;
        self.last_trade = now;
        self.trades += 1;
        self.seq += 1;
        Some(Decision {
            asset,
            price: limit,
            size,
            seq: self.seq,
        })
    }
}
