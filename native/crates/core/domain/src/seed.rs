//! Seeds and random draws (10-domain-model.md §6.1, RNG-1…RNG-7).
//!
//! Every draw is a pure function of (stream seed, entity, draw index): no
//! state, no call-order dependence, no allocation, no synchronization (P5).
//! Changing any constant, tag or mapping here is an engine-semantics change.

#![allow(clippy::excessive_precision)]

use crate::fixed::{Rate, SCALE};
use sha2::{Digest, Sha256};
use std::fmt;

/// Largest valid run seed: `2^53 − 1` (RNG-1).
pub const RUN_SEED_MAX: u64 = (1u64 << 53) - 1;

/// Run seed outside `[0, 2^53 − 1]` or not decimal digits.
#[derive(Copy, Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum SeedError {
    #[error("run seed must be decimal digits")]
    Syntax,
    #[error("run seed outside [0, 2^53 - 1]")]
    Range,
}

/// Run seed chosen by the producer (RNG-1). The binary never chooses one.
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RunSeed(u64);

impl RunSeed {
    pub const ZERO: RunSeed = RunSeed(0);

    pub const fn new(v: u64) -> Result<Self, SeedError> {
        if v > RUN_SEED_MAX {
            Err(SeedError::Range)
        } else {
            Ok(RunSeed(v))
        }
    }

    /// Parses `--seed` text: decimal digits only.
    pub fn parse(s: &str) -> Result<Self, SeedError> {
        if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
            return Err(SeedError::Syntax);
        }
        let v: u64 = s.parse().map_err(|_| SeedError::Range)?;
        Self::new(v)
    }

    #[inline]
    pub const fn get(self) -> u64 {
        self.0
    }
}

/// Per-market seed (RNG-2).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct MarketSeed(pub u64);

/// Seed of one stream (RNG-3).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct StreamSeed(pub u64);

fn sha_le64(parts: &[&[u8]]) -> u64 {
    let mut h = Sha256::new();
    for p in parts {
        h.update(p);
    }
    let d = h.finalize();
    let mut b = [0u8; 8];
    b.copy_from_slice(&d[..8]);
    u64::from_le_bytes(b)
}

/// `LE64(SHA-256("pmb-seed/v1" ‖ LE64(run_seed) ‖ UTF-8(slug))[0..8])`.
pub fn market_seed(run: RunSeed, slug: &str) -> MarketSeed {
    MarketSeed(sha_le64(&[
        b"pmb-seed/v1",
        &run.0.to_le_bytes(),
        slug.as_bytes(),
    ]))
}

/// Per-market stream tags (RNG-3 (a)); owned by 13 §6.8 and 14 F-51.
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum StreamTag {
    Place,
    Cancel,
    Ack,
    CancelAck,
    FillReport,
    Mined,
    Confirmed,
    Failed,
    ChainSplit,
    ChainMerge,
    MdCmd,
    MdRow,
    SettlementFailure,
    ChainFailure,
    CompatJitter,
    FeedPriceToBeat,
}

impl StreamTag {
    pub const ALL: [StreamTag; 16] = [
        StreamTag::Place,
        StreamTag::Cancel,
        StreamTag::Ack,
        StreamTag::CancelAck,
        StreamTag::FillReport,
        StreamTag::Mined,
        StreamTag::Confirmed,
        StreamTag::Failed,
        StreamTag::ChainSplit,
        StreamTag::ChainMerge,
        StreamTag::MdCmd,
        StreamTag::MdRow,
        StreamTag::SettlementFailure,
        StreamTag::ChainFailure,
        StreamTag::CompatJitter,
        StreamTag::FeedPriceToBeat,
    ];

    /// The fixed ASCII tag.
    pub const fn as_str(self) -> &'static str {
        match self {
            StreamTag::Place => "place",
            StreamTag::Cancel => "cancel",
            StreamTag::Ack => "ack",
            StreamTag::CancelAck => "cancelAck",
            StreamTag::FillReport => "fillReport",
            StreamTag::Mined => "mined",
            StreamTag::Confirmed => "confirmed",
            StreamTag::Failed => "failed",
            StreamTag::ChainSplit => "chainSplit",
            StreamTag::ChainMerge => "chainMerge",
            StreamTag::MdCmd => "md_cmd",
            StreamTag::MdRow => "md_row",
            StreamTag::SettlementFailure => "settlement_failure",
            StreamTag::ChainFailure => "chain_failure",
            StreamTag::CompatJitter => "compat_jitter",
            StreamTag::FeedPriceToBeat => "feed.priceToBeat",
        }
    }
}

/// Run-level feed stream tags (RNG-3 (b), 14 F-51).
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum FeedStreamTag {
    Binance,
    Chainlink,
}

impl FeedStreamTag {
    pub const fn as_str(self) -> &'static str {
        match self {
            FeedStreamTag::Binance => "feed.binance",
            FeedStreamTag::Chainlink => "feed.chainlink",
        }
    }
}

/// `LE64(SHA-256("pmb-stream/v1" ‖ LE64(market_seed) ‖ ASCII(tag))[0..8])`.
pub fn stream_seed(market: MarketSeed, tag: StreamTag) -> StreamSeed {
    StreamSeed(sha_le64(&[
        b"pmb-stream/v1",
        &market.0.to_le_bytes(),
        tag.as_str().as_bytes(),
    ]))
}

/// `LE64(SHA-256("pmb-feed-stream/v1" ‖ LE64(run_seed) ‖ ASCII(tag))[0..8])`.
pub fn feed_stream_seed(run: RunSeed, tag: FeedStreamTag) -> StreamSeed {
    StreamSeed(sha_le64(&[
        b"pmb-feed-stream/v1",
        &run.0.to_le_bytes(),
        tag.as_str().as_bytes(),
    ]))
}

/// Kind of a per-market execution entity (RNG-4).
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum EntityKind {
    OrderKey = 1,
    CancelSeq = 2,
    TradeSeq = 3,
    OpKey = 4,
    /// Execution-command sequence (the session's 0-based `submit` count).
    ExecCommand = 5,
    /// Input row index of the market file (12 §4.3).
    InputRow = 6,
}

/// The entity a draw belongs to (RNG-4).
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Entity(pub u64);

impl Entity {
    /// `(kind << 32) | id` for per-market execution streams.
    #[inline]
    pub const fn packed(kind: EntityKind, id: u32) -> Entity {
        Entity(((kind as u64) << 32) | id as u64)
    }

    /// Unpacked feed entity (Binance `agg_trade_id`, price-to-beat 0).
    #[inline]
    pub const fn raw(v: u64) -> Entity {
        Entity(v)
    }

    /// Chainlink row entity (14 F-51):
    /// `LE64(SHA-256("pmb-feed-entity/v1" ‖ LE64(timestamp_us) ‖ LE64(server_timestamp_us))[0..8])`.
    pub fn chainlink_row(timestamp_us: i64, server_timestamp_us: i64) -> Entity {
        Entity(sha_le64(&[
            b"pmb-feed-entity/v1",
            &timestamp_us.to_le_bytes(),
            &server_timestamp_us.to_le_bytes(),
        ]))
    }
}

const G: u64 = 0x9E37_79B9_7F4A_7C15;

/// SplitMix64 finalizer (RNG-5).
#[inline]
pub const fn mix64(z: u64) -> u64 {
    let z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    let z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Draw `i` of `entity` on `stream`: a pure function (RNG-5).
#[inline]
pub const fn draw(stream: StreamSeed, entity: Entity, i: u64) -> u64 {
    EntityRng::new(stream, entity).draw(i)
}

/// Draws of one (stream, entity): holds only `h` (RNG-5), `Copy`, stateless.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct EntityRng {
    h: u64,
}

impl EntityRng {
    #[inline]
    pub const fn new(stream: StreamSeed, entity: Entity) -> Self {
        EntityRng {
            h: mix64(stream.0 ^ mix64(entity.0.wrapping_add(G))),
        }
    }

    /// `mix64(h + G × (i + 1))`.
    #[inline]
    pub const fn draw(self, i: u64) -> u64 {
        mix64(self.h.wrapping_add(G.wrapping_mul(i.wrapping_add(1))))
    }

    /// Uniform integer in `[0, n)`, `n ≥ 1`, by rejection over draws
    /// `0, 1, …` (RNG-6). Exact and unbiased.
    #[inline]
    pub fn uniform_below(self, n: u64) -> u64 {
        assert!(n >= 1, "uniform_below: n must be >= 1");
        let limit = (n as u128) * ((1u128 << 64) / n as u128);
        let mut i = 0u64;
        loop {
            let u = self.draw(i);
            if (u as u128) < limit {
                return u % n;
            }
            i += 1;
        }
    }

    /// Integer uniform in `[a, b]`, `a ≤ b` (RNG-6).
    #[inline]
    pub fn int_in(self, a: i64, b: i64) -> i64 {
        assert!(a <= b, "int_in: empty range");
        let span = (b as i128 - a as i128 + 1) as u128;
        if span > u64::MAX as u128 {
            // The full i64 range: every draw is accepted.
            return self.draw(0) as i64;
        }
        (a as i128 + self.uniform_below(span as u64) as i128) as i64
    }

    /// Bernoulli with probability `p` (1e-6 units, RNG-6): integer only.
    #[inline]
    pub fn bernoulli(self, p: Rate) -> bool {
        (self.uniform_below(SCALE as u64) as i64) < p.micros()
    }

    /// Open unit interval from draw `i`: `((draw(i) >> 11) + 0.5) × 2^−53`.
    #[inline]
    pub fn unit_open(self, i: u64) -> f64 {
        unit_open(self.draw(i))
    }
}

/// `((u >> 11) + 0.5) × 2^−53` in IEEE `f64` arithmetic (RNG-6), never 0.
///
/// The `+ 0.5` is exact only below `2^52`; above it the sum rounds to even,
/// and for `u >> 11 = 2^53 − 1` the result would be exactly 1. That single
/// value is mapped to the largest `f64` below 1, so the interval stays open.
#[inline]
pub fn unit_open(u: u64) -> f64 {
    let v = ((u >> 11) as f64 + 0.5) * (1.0 / 9_007_199_254_740_992.0);
    if v >= 1.0 {
        1.0 - f64::EPSILON / 2.0
    } else {
        v
    }
}

// AS241 PPND16 coefficients, verbatim from Wichura (1988), highest degree last.
const AS241_A: [f64; 8] = [
    3.3871328727963666080e0,
    1.3314166789178437745e+2,
    1.9715909503065514427e+3,
    1.3731693765509461125e+4,
    4.5921953931549871457e+4,
    6.7265770927008700853e+4,
    3.3430575583588128105e+4,
    2.5090809287301226727e+3,
];
const AS241_B: [f64; 8] = [
    1.0,
    4.2313330701600911252e+1,
    6.8718700749205790830e+2,
    5.3941960214247511077e+3,
    2.1213794301586595867e+4,
    3.9307895800092710610e+4,
    2.8729085735721942674e+4,
    5.2264952788528545610e+3,
];
const AS241_C: [f64; 8] = [
    1.42343711074968357734e0,
    4.63033784615654529590e0,
    5.76949722146069140550e0,
    3.64784832476320460504e0,
    1.27045825245236838258e0,
    2.41780725177450611770e-1,
    2.27238449892691845833e-2,
    7.74545014278341407640e-4,
];
const AS241_D: [f64; 8] = [
    1.0,
    2.05319162663775882187e0,
    1.67638483018380384940e0,
    6.89767334985100004550e-1,
    1.48103976427480074590e-1,
    1.51986665636164571966e-2,
    5.47593808499534494600e-4,
    1.05075007164441684324e-9,
];
const AS241_E: [f64; 8] = [
    6.65790464350110377720e0,
    5.46378491116411436990e0,
    1.78482653991729133580e0,
    2.96560571828504891230e-1,
    2.65321895265761230930e-2,
    1.24266094738807843860e-3,
    2.71155556874348757815e-5,
    2.01033439929228813265e-7,
];
const AS241_F: [f64; 8] = [
    1.0,
    5.99832206555887937690e-1,
    1.36929880922735805310e-1,
    1.48753612908506148525e-2,
    7.86869131145613259100e-4,
    1.84631831751005468180e-5,
    1.42151175831644588870e-7,
    2.04426310338993978564e-15,
];

#[inline]
fn horner(c: &[f64; 8], x: f64) -> f64 {
    let mut acc = c[7];
    for k in (0..7).rev() {
        acc = acc * x + c[k];
    }
    acc
}

/// Standard normal quantile Φ⁻¹(p) for `p ∈ (0, 1)`: Wichura's AS241
/// (PPND16) on the pure-Rust `libm` (D-2). Returns ±∞ at 0 / 1, NaN outside.
pub fn inv_norm_cdf(p: f64) -> f64 {
    if p.is_nan() || !(0.0..=1.0).contains(&p) {
        return f64::NAN;
    }
    if p == 0.0 {
        return f64::NEG_INFINITY;
    }
    if p == 1.0 {
        return f64::INFINITY;
    }
    let q = p - 0.5;
    if q.abs() <= 0.425 {
        let r = 0.180625 - q * q;
        return q * horner(&AS241_A, r) / horner(&AS241_B, r);
    }
    let r0 = if q < 0.0 { p } else { 1.0 - p };
    let r = libm::sqrt(-libm::log(r0));
    let val = if r <= 5.0 {
        let r = r - 1.6;
        horner(&AS241_C, r) / horner(&AS241_D, r)
    } else {
        let r = r - 5.0;
        horner(&AS241_E, r) / horner(&AS241_F, r)
    };
    if q < 0.0 {
        -val
    } else {
        val
    }
}

/// Lognormal quantile `exp(mu + sigma × Φ⁻¹(u))` (RNG-6).
#[inline]
pub fn lognormal_quantile(mu: f64, sigma: f64, u: f64) -> f64 {
    libm::exp(mu + sigma * inv_norm_cdf(u))
}

/// Inverse CDF of an equally spaced quantile table (`table[k]` is the
/// quantile at `k / (len − 1)`), by linear interpolation (RNG-6). The 13
/// §7.3 tables have 101 entries. `table` must have at least one entry.
pub fn empirical_quantile(table: &[f64], u: f64) -> f64 {
    assert!(!table.is_empty(), "empirical table is empty");
    if table.len() == 1 {
        return table[0];
    }
    let x = u * (table.len() - 1) as f64;
    let i = (x as usize).min(table.len() - 2);
    let frac = x - i as f64;
    table[i] + frac * (table[i + 1] - table[i])
}

/// Upper clamp of an integer-ms sample: `2^31 − 1` (RNG-6).
pub const SAMPLE_MS_MAX: i64 = (1i64 << 31) - 1;

/// Continuous sample → integer ms: `HalfAwayFromZero` (`f64::round`), clamped
/// to `[0, 2^31 − 1]`. NaN maps to 0 (RNG-6, R16).
#[inline]
pub fn sample_to_ms(x: f64) -> i64 {
    if x.is_nan() {
        return 0;
    }
    let r = x.round();
    if r <= 0.0 {
        0
    } else if r >= SAMPLE_MS_MAX as f64 {
        SAMPLE_MS_MAX
    } else {
        r as i64
    }
}

impl fmt::Display for StreamTag {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SLUG: &str = "btc-updown-15m-1780272000";

    #[test]
    fn splitmix_reference() {
        // SplitMix64 from state 0: the generator adds G before mixing.
        let mut s = 0u64;
        let mut next = || {
            s = s.wrapping_add(G);
            mix64(s)
        };
        assert_eq!(next(), 0xe220a8397b1dcdaf);
        assert_eq!(next(), 0x6e789e6aa1b965f4);
    }

    // spec: 10 RNG-7, 60 DET-13 — every row, exact.
    #[test]
    fn rng7_golden_vectors() {
        let r0 = RunSeed::new(0).unwrap();
        let m0 = market_seed(r0, SLUG);
        assert_eq!(m0.0, 0xeb300da7cf82ecde);
        assert_eq!(
            market_seed(RunSeed::new(123).unwrap(), SLUG).0,
            0x735cf00eaa5d23b2
        );
        assert_eq!(
            market_seed(RunSeed::new(RUN_SEED_MAX).unwrap(), SLUG).0,
            0x2b93662d0e90152f
        );
        let place = stream_seed(m0, StreamTag::Place);
        assert_eq!(place.0, 0xffc27cae89ae3033);
        let jitter = stream_seed(m0, StreamTag::CompatJitter);
        assert_eq!(jitter.0, 0x0162432c20a594c5);

        let ok0 = Entity::packed(EntityKind::OrderKey, 0);
        assert_eq!(ok0.0, 0x0000000100000000);
        let rng = EntityRng::new(place, ok0);
        assert_eq!(rng.draw(0), 0x7ac83cc051482e69);
        assert_eq!(rng.draw(1), 0x6af33a6533ac1ffa);
        assert_eq!(draw(place, ok0, 0), 0x7ac83cc051482e69);
        assert_eq!(rng.unit_open(0), 0.4796178788685956);
        assert_eq!(
            draw(place, Entity::packed(EntityKind::OrderKey, 1), 0),
            0x610af8c6b7bb80bd
        );

        let jit: Vec<i64> = (0..3)
            .map(|c| {
                EntityRng::new(jitter, Entity::packed(EntityKind::ExecCommand, c)).int_in(-100, 100)
            })
            .collect();
        assert_eq!(jit, [-34, -78, -52]);

        let md_row = stream_seed(m0, StreamTag::MdRow);
        assert_eq!(
            draw(md_row, Entity::packed(EntityKind::InputRow, 0), 0),
            0xbe885d470957411b
        );

        let fb = feed_stream_seed(r0, FeedStreamTag::Binance);
        assert_eq!(fb.0, 0x9416e0f7dd99bfb2);
        assert_eq!(draw(fb, Entity::raw(3_000_000_000), 0), 0x3d2083a3f2c7d945);

        let cl_entity = Entity::chainlink_row(1_780_272_000_000_000, 1_780_272_001_012_345);
        assert_eq!(cl_entity.0, 0x21f0f8efcd0a5519);
        let fc = feed_stream_seed(r0, FeedStreamTag::Chainlink);
        assert_eq!(draw(fc, cl_entity, 0), 0x4469676c00a02960);

        let ptb = stream_seed(m0, StreamTag::FeedPriceToBeat);
        assert_eq!(draw(ptb, Entity::raw(0), 0), 0xf00c88f6376b1577);
    }

    #[test]
    fn run_seed_range() {
        assert_eq!(RunSeed::new(RUN_SEED_MAX + 1), Err(SeedError::Range));
        assert_eq!(RunSeed::parse("123").unwrap().get(), 123);
        assert_eq!(
            RunSeed::parse("9007199254740991").unwrap().get(),
            RUN_SEED_MAX
        );
        assert_eq!(RunSeed::parse("9007199254740992"), Err(SeedError::Range));
        assert_eq!(
            RunSeed::parse("99999999999999999999999"),
            Err(SeedError::Range)
        );
        for bad in ["", "-1", "+1", "1e3", "1.0", " 1"] {
            assert_eq!(RunSeed::parse(bad), Err(SeedError::Syntax), "{bad:?}");
        }
    }

    #[test]
    fn mappings() {
        let rng = EntityRng::new(StreamSeed(7), Entity::raw(9));
        assert_eq!(rng.uniform_below(1), 0);
        assert!(rng.uniform_below(10) < 10);
        assert!(!rng.bernoulli(Rate::ZERO));
        assert!(rng.bernoulli(Rate::from_micros(1_000_000)));
        assert_eq!(rng.int_in(5, 5), 5);
        assert!(unit_open(0) > 0.0 && unit_open(u64::MAX) < 1.0);
        assert_eq!(sample_to_ms(-3.0), 0);
        assert_eq!(sample_to_ms(2.5), 3);
        assert_eq!(sample_to_ms(1e300), SAMPLE_MS_MAX);
        assert_eq!(sample_to_ms(f64::NAN), 0);
        let t = [0.0, 10.0, 30.0];
        assert_eq!(empirical_quantile(&t, 0.25), 5.0);
        assert_eq!(empirical_quantile(&t, 0.75), 20.0);
        assert_eq!(empirical_quantile(&t, 1.0), 30.0);
    }

    #[test]
    fn as241_values() {
        let cases = [
            (0.5, 0.0),
            (0.975, 1.959_963_984_540_054),
            (0.025, -1.959_963_984_540_054),
            (0.841_344_746_068_542_9, 1.0),
            (1e-10, -6.361_340_902_404_056),
        ];
        for (p, want) in cases {
            let got = inv_norm_cdf(p);
            assert!(
                (got - want).abs() <= 1e-12 * want.abs().max(1.0),
                "p={p}: {got} vs {want}"
            );
        }
        assert!((lognormal_quantile(0.0, 1.0, 0.5) - 1.0).abs() < 1e-15);
    }

    proptest::proptest! {
        #[test]
        fn draws_are_pure(s in proptest::prelude::any::<u64>(), e in proptest::prelude::any::<u64>(), i in 0u64..1000) {
            let a = draw(StreamSeed(s), Entity(e), i);
            // Interleave unrelated draws: the result never depends on call order.
            let _ = draw(StreamSeed(s ^ 1), Entity(e), i + 1);
            let b = EntityRng::new(StreamSeed(s), Entity(e)).draw(i);
            proptest::prop_assert_eq!(a, b);
        }

        #[test]
        fn int_in_stays_in_range(s in proptest::prelude::any::<u64>(), a in -1000i64..1000, w in 0i64..1000) {
            let v = EntityRng::new(StreamSeed(s), Entity(1)).int_in(a, a + w);
            proptest::prop_assert!(v >= a && v <= a + w);
        }
    }
}
