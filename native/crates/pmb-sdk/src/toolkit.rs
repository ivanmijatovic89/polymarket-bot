//! Pure strategy helpers with golden tests (30 §14). Helpers that need the
//! engine context (tick snapping against rules, window and book helpers)
//! are added with the context.

/// `x` rounded to `k` decimals: the exact decimal expansion of `x` is
/// rounded `HalfAwayFromZero` (10 §3) and parsed back to the nearest `f64`.
///
/// This is the contract of TS `Number(x.toFixed(k))`, common in strategy
/// meta (30 §14, 60 §6.2 LP-3). `format!("{:.k$}")` (ties to even) and
/// `(x * 10^k).round()` (inexact product) do not meet it: `1.005` is
/// `1.00499999999999989…` exactly, so it rounds to `1.0`, while the exact
/// tie `0.125` rounds to `0.13`. Non-finite values are returned unchanged;
/// `-0.0` gives `+0.0`, while a negative value that rounds to zero gives
/// `-0.0`, both as in JS.
///
/// ```
/// use pmb_sdk::toolkit::round_dp;
///
/// assert_eq!(round_dp(1.005, 2), 1.0);
/// assert_eq!(round_dp(0.125, 2), 0.13);
/// assert_eq!(round_dp(-2.5, 0), -3.0);
/// assert_eq!(round_dp(0.031415926, 4), 0.0314);
/// ```
pub fn round_dp(x: f64, k: u32) -> f64 {
    if !x.is_finite() {
        return x;
    }
    // x = m × 2^q with m odd: the exact expansion has max(0, -q) fractional
    // digits, so formatting with that precision is exact (no rounding).
    let bits = x.to_bits();
    let exp_field = ((bits >> 52) & 0x7ff) as i32;
    let frac = bits & ((1u64 << 52) - 1);
    let (m, mut q) = if exp_field == 0 {
        (frac, -1074)
    } else {
        (frac | (1u64 << 52), exp_field - 1075)
    };
    if m == 0 {
        // JS `(-0).toFixed(k)` is "0.00…" (`-0 < 0` is false), so the
        // result is +0.
        return 0.0;
    }
    q += m.trailing_zeros() as i32;
    let digits = (-q).max(0) as usize;
    let k = k as usize;
    if k >= digits {
        return x;
    }
    let exact = format!("{:.*}", digits, x.abs());
    let (int, frac_digits) = exact.split_once('.').unwrap_or((&exact, ""));
    // Kept digits (integer part and k decimals) as one digit string.
    let mut kept: Vec<u8> = int.bytes().chain(frac_digits.bytes().take(k)).collect();
    // The remainder is at least half a unit of the last kept digit exactly
    // when the next digit is 5 or more: round away from zero.
    if frac_digits.as_bytes()[k] >= b'5' {
        let mut i = kept.len();
        loop {
            if i == 0 {
                kept.insert(0, b'1');
                break;
            }
            i -= 1;
            if kept[i] == b'9' {
                kept[i] = b'0';
            } else {
                kept[i] += 1;
                break;
            }
        }
    }
    let split = kept.len() - k;
    let mut text = String::with_capacity(kept.len() + 2);
    if x < 0.0 {
        text.push('-');
    }
    text.extend(kept[..split].iter().map(|&b| b as char));
    if k > 0 {
        text.push('.');
        text.extend(kept[split..].iter().map(|&b| b as char));
    }
    // Correctly rounded decimal to f64 conversion.
    text.parse().unwrap_or(x)
}

#[cfg(test)]
mod tests {
    use super::*;

    // spec: 30 §14 round_dp = Number(x.toFixed(k)); goldens from Python's
    // exact Decimal(x).quantize(10^-k, ROUND_HALF_UP) (half away from zero).
    #[test]
    fn round_dp_goldens() {
        let cases: &[(u64, u32, u64)] = &[
            (0x3ff0147ae147ae14, 2, 0x3ff0000000000000), // 1.005 -> 1.0
            (0x4005666666666666, 2, 0x40055c28f5c28f5c), // 2.675 -> 2.67
            (0x3ff7333333333333, 1, 0x3ff6666666666666), // 1.45 -> 1.4
            (0x3fe0000000000000, 0, 0x3ff0000000000000), // 0.5 -> 1.0
            (0xbfe0000000000000, 0, 0xbff0000000000000), // -0.5 -> -1.0
            (0x4004000000000000, 0, 0x4008000000000000), // 2.5 -> 3.0
            (0xc004000000000000, 0, 0xc008000000000000), // -2.5 -> -3.0
            (0x3fd0000000000000, 1, 0x3fd3333333333333), // 0.25 -> 0.3
            (0xbfd0000000000000, 1, 0xbfd3333333333333), // -0.25 -> -0.3
            (0x3fcfffffffffffff, 1, 0x3fc999999999999a), // 0.25 - 1ulp -> 0.2
            (0x3fd0000000000001, 1, 0x3fd3333333333333), // 0.25 + 1ulp -> 0.3
            (0x3fc0000000000000, 2, 0x3fc0a3d70a3d70a4), // 0.125 -> 0.13
            (0xbfc0000000000000, 2, 0xbfc0a3d70a3d70a4), // -0.125 -> -0.13
            (0x3fa015bf8d7cb362, 4, 0x3fa013a92a305532), // 0.031415926 -> 0.0314
            (0x3e7ad7f29abcaf48, 4, 0x0000000000000000), // 1e-07 -> 0.0
            (0x40fe240c9fbe76c9, 1, 0x40fe240ccccccccd), // 123456.789 -> 123456.8
            (0x3fd3333333333334, 2, 0x3fd3333333333333), // 0.30000000000000004 -> 0.3
            (0x3fd3333333333333, 15, 0x3fd3333333333333), // 0.3 -> 0.3
            (0x0000000000000001, 1074, 0x0000000000000001), // 5e-324 -> 5e-324
            (0x3ff0000000000001, 15, 0x3ff0000000000000), // 1.0000000000000002 -> 1.0
            (0x4023fd70a3d70a3d, 2, 0x4023fae147ae147b), // 9.995 -> 9.99
            (0xc023fd70a3d70a3d, 2, 0xc023fae147ae147b), // -9.995 -> -9.99
            (0x3fa70a3d70a3d70a, 2, 0x3fa47ae147ae147b), // 0.045 -> 0.04
            (0x3ff2666666666666, 1, 0x3ff199999999999a), // 1.15 -> 1.1
            (0x4020b0a3d70a3d71, 2, 0x4020b33333333333), // 8.345 -> 8.35
            (0xc0760559fd9089e2, 2, 0xc0760547ae147ae1), // -352.3344703336753 -> -352.33
            (0xc06a4b4bd5a88634, 0, 0xc06a400000000000), // -210.35300715365304 -> -210.0
            (0xc08ab904f8457392, 8, 0xc08ab904f844cab5), // -855.1274266649145 -> -855.12742666
            (0xc0895deb59249f48, 0, 0xc089600000000000), // -811.7399161206349 -> -812.0
            (0x40899b43d7b6df18, 3, 0x40899b4395810625), // 819.4081262862046 -> 819.408
            (0xc08ce811c8741b05, 6, 0xc08ce811c8648840), // -925.0086831160303 -> -925.008683
            (0xc06474fb78d12818, 3, 0xc06474fdf3b645a2), // -163.65569725848104 -> -163.656
            (0xc08994977f51e7cf, 6, 0xc08994977f27fe4c), // -818.5739733122699 -> -818.573973
            (0xc08b8e3b5dfa4bb8, 1, 0xc08b8e6666666666), // -881.7789878420217 -> -881.8
            (0x408bf731f95e7a58, 0, 0x408bf80000000000), // 894.8994014149748 -> 895.0
            (0x40634696b5cc54d0, 6, 0x40634696b54e2b06), // 154.20589723499734 -> 154.205897
            (0xc08c26922c1f7d63, 3, 0xc08c26916872b021), // -900.8213732204571 -> -900.821
        ];
        for &(x, k, want) in cases {
            let x = f64::from_bits(x);
            let got = round_dp(x, k);
            assert_eq!(got.to_bits(), want, "round_dp({x:?}, {k}) = {got:?}");
        }
    }

    #[test]
    fn round_dp_edges() {
        assert!(round_dp(f64::NAN, 2).is_nan());
        assert_eq!(round_dp(f64::INFINITY, 2), f64::INFINITY);
        assert_eq!(round_dp(1e300, 2), 1e300);
        assert_eq!(round_dp(0.0, 3), 0.0);
        // JS: (-0).toFixed(2) is "0.00", Number of it is +0.
        assert!(round_dp(-0.0, 2).is_sign_positive());
        assert!(round_dp(-0.0, 0).is_sign_positive());
        assert_eq!(round_dp(9.5, 0), 10.0);
        assert_eq!(round_dp(99.995, 2), 100.0); // 99.99500000000000454… exactly
        assert_eq!(round_dp(0.96, 1), 1.0);
        // JS: (-1e-7).toFixed(4) is "-0.0000", Number of it is -0.
        assert!(round_dp(-1e-7, 4).is_sign_negative());
        assert_eq!(round_dp(-1e-7, 4), 0.0);
    }
}
