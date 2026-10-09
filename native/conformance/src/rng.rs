//! Independent implementation of the seed derivation and draws of
//! 10-domain-model.md §6.1 (RNG-2 … RNG-6), used to check the RNG-7 golden
//! vectors. Every constant and encoding below is transcribed from that
//! section; nothing comes from the engine.

use crate::sha256::sha256;

/// RNG-5: the SplitMix64 increment.
pub const G: u64 = 0x9E3779B97F4A7C15;

/// RNG-5 `mix64`. All arithmetic wrapping on `u64`.
pub fn mix64(mut z: u64) -> u64 {
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
    z ^ (z >> 31)
}

/// `LE64(x)`: 8-byte little-endian encoding (RNG-2).
pub fn le64(x: u64) -> [u8; 8] {
    x.to_le_bytes()
}

/// Reads the first 8 digest bytes back as a little-endian `u64` (RNG-2).
fn first8_le(digest: &[u8; 32]) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&digest[..8]);
    u64::from_le_bytes(b)
}

/// RNG-2: `market_seed = LE64(SHA-256("pmb-seed/v1" ‖ LE64(run_seed) ‖ UTF-8(slug))[0..8])`.
pub fn market_seed(run_seed: u64, slug: &str) -> u64 {
    let mut m = Vec::new();
    m.extend_from_slice(b"pmb-seed/v1");
    m.extend_from_slice(&le64(run_seed));
    m.extend_from_slice(slug.as_bytes());
    first8_le(&sha256(&m))
}

/// RNG-3 (a): per-market stream seed.
pub fn stream_seed(market_seed: u64, tag: &str) -> u64 {
    assert!(tag.is_ascii(), "stream tags are ASCII (RNG-3)");
    let mut m = Vec::new();
    m.extend_from_slice(b"pmb-stream/v1");
    m.extend_from_slice(&le64(market_seed));
    m.extend_from_slice(tag.as_bytes());
    first8_le(&sha256(&m))
}

/// RNG-3 (b): run-level feed stream seed (`feed.binance`, `feed.chainlink`).
pub fn feed_stream_seed(run_seed: u64, tag: &str) -> u64 {
    assert!(tag.is_ascii(), "stream tags are ASCII (RNG-3)");
    let mut m = Vec::new();
    m.extend_from_slice(b"pmb-feed-stream/v1");
    m.extend_from_slice(&le64(run_seed));
    m.extend_from_slice(tag.as_bytes());
    first8_le(&sha256(&m))
}

/// 14 F-51: the Chainlink feed entity,
/// `LE64(SHA-256("pmb-feed-entity/v1" ‖ LE64(timestamp_us) ‖ LE64(server_timestamp_us))[0..8])`.
pub fn chainlink_entity(timestamp_us: u64, server_timestamp_us: u64) -> u64 {
    let mut m = Vec::new();
    m.extend_from_slice(b"pmb-feed-entity/v1");
    m.extend_from_slice(&le64(timestamp_us));
    m.extend_from_slice(&le64(server_timestamp_us));
    first8_le(&sha256(&m))
}

/// RNG-4: per-market execution entity `(kind << 32) | id`.
pub fn entity(kind: u64, id: u64) -> u64 {
    assert!(kind < 256 && id <= u32::MAX as u64);
    (kind << 32) | id
}

/// RNG-5: `h = mix64(stream_seed ^ mix64(entity + G))`.
pub fn state(stream_seed: u64, entity: u64) -> u64 {
    mix64(stream_seed ^ mix64(entity.wrapping_add(G)))
}

/// RNG-5: `draw(i) = mix64(h + G * (i + 1))`.
pub fn draw(stream_seed: u64, entity: u64, i: u64) -> u64 {
    let h = state(stream_seed, entity);
    mix64(h.wrapping_add(G.wrapping_mul(i.wrapping_add(1))))
}

/// RNG-6: uniform integer in `[0, n)` by rejection; returns the value and the
/// draw index that was accepted.
pub fn uniform_below(stream_seed: u64, entity: u64, n: u64) -> (u64, u64) {
    assert!(n >= 1);
    let limit: u128 = (n as u128) * ((1u128 << 64) / n as u128);
    let mut i = 0u64;
    loop {
        let u = draw(stream_seed, entity, i);
        if (u as u128) < limit {
            return (u % n, i);
        }
        i += 1;
    }
}

/// RNG-6: integer uniform in `[a, b]`.
pub fn uniform_in(stream_seed: u64, entity: u64, a: i64, b: i64) -> i64 {
    assert!(a <= b);
    let n = (b - a + 1) as u64;
    let (v, _) = uniform_below(stream_seed, entity, n);
    a + v as i64
}

/// RNG-6: open unit interval `u = ((draw(i) >> 11) + 0.5) × 2^−53`.
pub fn open_unit(draw_value: u64) -> f64 {
    // D68: binary64 evaluation; the single result 1.0 (draw >> 11 == 2^53 - 1)
    // is mapped to 1 - 2^-53 so that u is in (0, 1).
    let u = ((draw_value >> 11) as f64 + 0.5) * 2f64.powi(-53);
    if u >= 1.0 {
        1.0 - 2f64.powi(-53)
    } else {
        u
    }
}

/// RNG-5 reference: SplitMix64 started from state 0 (state += G per output).
pub fn splitmix64_reference(n: usize) -> Vec<u64> {
    let mut s = 0u64;
    (0..n)
        .map(|_| {
            s = s.wrapping_add(G);
            mix64(s)
        })
        .collect()
}
