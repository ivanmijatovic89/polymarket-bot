//! Shared arithmetic matching the pinned TypeScript trading helpers.
//! Preserve operation order, JavaScript tie direction and signed zero.
pub const DEFAULT_STARTING_CAPITAL: f64 = 500.0;
pub const CRYPTO_TAKER_FEE_BPS: f64 = 700.0;

/// ECMAScript Math.max for two numbers, including deterministic zero ties.
pub fn js_max(left: f64, right: f64) -> f64 {
    if left.is_nan() || right.is_nan() {
        f64::NAN
    } else if left == 0.0 && right == 0.0 {
        if left.is_sign_negative() && right.is_sign_negative() {
            -0.0
        } else {
            0.0
        }
    } else if left > right {
        left
    } else {
        right
    }
}

/// ECMAScript Math.min for two numbers, including deterministic zero ties.
pub fn js_min(left: f64, right: f64) -> f64 {
    if left.is_nan() || right.is_nan() {
        f64::NAN
    } else if left == 0.0 && right == 0.0 {
        if left.is_sign_negative() || right.is_sign_negative() {
            -0.0
        } else {
            0.0
        }
    } else if left < right {
        left
    } else {
        right
    }
}

pub fn js_round(value: f64) -> f64 {
    if !value.is_finite() || value == 0.0 {
        return value;
    }
    let lower = value.floor();
    let rounded = if value - lower < 0.5 {
        lower
    } else {
        lower + 1.0
    };
    if rounded == 0.0 {
        rounded.copysign(value)
    } else {
        rounded
    }
}

pub fn round8(value: f64) -> f64 {
    js_round(value * 1e8) / 1e8
}

// Despite its historical name, the TS round2 helper also uses eight places.
pub fn round2(value: f64) -> f64 {
    round8(value)
}

pub fn compute_taker_fee(fee_rate_bps: f64, price: f64, size: f64) -> f64 {
    if !fee_rate_bps.is_finite()
        || fee_rate_bps <= 0.0
        || !price.is_finite()
        || price <= 0.0
        || price >= 1.0
        || !size.is_finite()
        || size <= 0.0
    {
        return 0.0;
    }
    let amount = (fee_rate_bps / 10_000.0) * price * (1.0 - price) * size;
    if !amount.is_finite() || amount <= 0.0 {
        return 0.0;
    }
    let rounded = js_round(amount * 1e4) / 1e4;
    if rounded < 0.0001 {
        0.0
    } else {
        rounded
    }
}

pub fn buy_commitment(price: f64, size: f64, post_only: bool) -> f64 {
    if size <= 0.0 {
        return 0.0;
    }
    round8(
        price * size
            + if post_only {
                0.0
            } else {
                compute_taker_fee(CRYPTO_TAKER_FEE_BPS, price, size)
            },
    )
}

pub fn fill_cash_delta(
    price: f64,
    size: f64,
    buy: bool,
    taker: bool,
    fee_rate_bps: Option<f64>,
) -> f64 {
    let fee = if taker {
        compute_taker_fee(fee_rate_bps.unwrap_or(0.0), price, size)
    } else {
        0.0
    };
    round8((if buy { -1.0 } else { 1.0 }) * price * size - fee)
}

pub fn validate_starting_capital(value: f64) -> Result<f64, &'static str> {
    if !value.is_finite() || value < 0.0 {
        Err("starting capital must be a finite non-negative number of USDC")
    } else {
        Ok(value)
    }
}

/// ECMAScript decimal notation for deterministic numeric error messages.
/// The shortest round-trip coefficient comes from the JSON serializer; only
/// its decimal/exponent notation is adjusted to the JavaScript boundaries.
pub fn js_number_string(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value == f64::INFINITY {
        return "Infinity".to_owned();
    }
    if value == f64::NEG_INFINITY {
        return "-Infinity".to_owned();
    }
    if value == 0.0 {
        return "0".to_owned();
    }
    let negative = value < 0.0;
    let text = serde_json::to_string(&value.abs()).expect("finite f64 serialization cannot fail");
    let (mantissa, exponent) = text
        .split_once('e')
        .map_or((text.as_str(), 0_i32), |(m, e)| {
            (m, e.parse().expect("serialized exponent"))
        });
    let decimal_position = mantissa.find('.').unwrap_or(mantissa.len()) as i32 + exponent;
    let mut digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let leading = digits.bytes().take_while(|c| *c == b'0').count();
    digits.drain(..leading);
    let point = decimal_position - leading as i32;
    while digits.ends_with('0') {
        digits.pop();
    }
    let sign = if negative { "-" } else { "" };
    if point > 0 && point <= 21 {
        let split = point as usize;
        if split >= digits.len() {
            format!("{sign}{digits}{}", "0".repeat(split - digits.len()))
        } else {
            format!("{sign}{}.{}", &digits[..split], &digits[split..])
        }
    } else if point > -6 && point <= 0 {
        format!("{sign}0.{}{digits}", "0".repeat((-point) as usize))
    } else {
        let exponent = point - 1;
        let mantissa = if digits.len() == 1 {
            digits
        } else {
            format!("{}.{}", &digits[..1], &digits[1..])
        };
        format!(
            "{sign}{mantissa}e{}{exponent}",
            if exponent >= 0 { "+" } else { "" }
        )
    }
}
