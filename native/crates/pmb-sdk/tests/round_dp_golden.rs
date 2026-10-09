//! `toolkit::round_dp` against TS `Number(x.toFixed(k))`, bit for bit, on
//! 12,800 inputs × k in 1..=4 (60 §6.4 LS-1(a), 30 §14). The TS outputs are
//! the digests of `fixtures/round_dp_golden.json`, written by
//! `fixtures/round_dp_gen.ts`; this test rebuilds the same inputs with the
//! same arithmetic (see the generator's header).

use pmb_sdk::toolkit::round_dp;
use sha2::{Digest, Sha256};

const GOLDEN: &str = include_str!("fixtures/round_dp_golden.json");

fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

fn ties() -> Vec<f64> {
    let mut out = Vec::new();
    for q in 2..=5 {
        for n in (1..=399).step_by(2) {
            let t = n as f64 / f64::from(1u32 << q);
            for v in [
                t,
                f64::from_bits(t.to_bits() + 1),
                f64::from_bits(t.to_bits() - 1),
            ] {
                out.extend([v, -v]);
            }
        }
    }
    out
}

fn decimal() -> Vec<f64> {
    let mut out = Vec::new();
    for d in 1..=4u32 {
        let scale = 10u64.pow(d + 1);
        for i in 0..500u64 {
            let m = 10 * i + 5;
            let text = format!(
                "{}.{:0width$}",
                m / scale,
                m % scale,
                width = d as usize + 1
            );
            let v: f64 = text.parse().unwrap();
            out.extend([v, -v]);
        }
    }
    out
}

fn random() -> Vec<f64> {
    let mut state = 0x5eed_0001_u64;
    let mut out = Vec::new();
    for _ in 0..2000 {
        let u = (splitmix64(&mut state) >> 11) as f64 / 2f64.powi(53);
        out.push((u * 2.0 - 1.0) * 1000.0);
    }
    for _ in 0..2000 {
        let b = splitmix64(&mut state);
        let sign = b >> 63;
        let exp = 1000 + ((b >> 52) & 0x7ff) % 91;
        let mant = b & ((1 << 52) - 1);
        out.push(f64::from_bits((sign << 63) | (exp << 52) | mant));
    }
    out
}

fn digest(inputs: &[f64]) -> String {
    let mut h = Sha256::new();
    for &x in inputs {
        for k in 1..=4 {
            h.update(format!(
                "{:016x} {k} {:016x}\n",
                x.to_bits(),
                round_dp(x, k).to_bits()
            ));
        }
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

// spec: 60 §6.4 LS-1(a), 30 §14: round_dp == Number(x.toFixed(k)) bit for
// bit on at least 10,000 inputs for k in 1..=4, ties and neighbors included
#[test]
fn round_dp_matches_ts_to_fixed() {
    let golden: serde_json::Value = serde_json::from_str(GOLDEN).unwrap();
    let sections = [
        ("decimal", decimal()),
        ("random", random()),
        ("ties", ties()),
    ];
    let inputs: usize = sections.iter().map(|(_, xs)| xs.len()).sum();
    assert_eq!(golden["inputs"], inputs as u64);
    assert_eq!(golden["cases"], 4 * inputs as u64);
    assert!(inputs >= 10_000);
    for (name, xs) in &sections {
        assert_eq!(
            golden["digests"][name].as_str(),
            Some(digest(xs).as_str()),
            "round_dp differs from TS toFixed in section {name}"
        );
    }
    // The named ties (0.25 at k = 1, ±0.125 at k = 2) and their neighbors.
    let named = golden["named"].as_array().unwrap();
    assert_eq!(named.len(), 9);
    for line in named {
        let parts: Vec<&str> = line.as_str().unwrap().split(' ').collect();
        let x = f64::from_bits(u64::from_str_radix(parts[0], 16).unwrap());
        let k: u32 = parts[1].parse().unwrap();
        let want = u64::from_str_radix(parts[2], 16).unwrap();
        assert_eq!(round_dp(x, k).to_bits(), want, "round_dp({x:?}, {k})");
    }
}
