use polymarket_runtime::math::*;

#[test]
fn rounds_toward_positive_infinity_and_retains_negative_zero() {
    assert_eq!(js_round(-1.5), -1.0);
    assert_eq!(js_round(1.5), 2.0);
    assert_eq!(js_round(f64::from_bits(0.5_f64.to_bits() - 1)), 0.0);
    assert_eq!(js_round(-0.1).to_bits(), (-0.0_f64).to_bits());
    assert_eq!(js_round(-0.0).to_bits(), (-0.0_f64).to_bits());
    assert_eq!(js_round(f64::INFINITY), f64::INFINITY);
    assert!(js_round(f64::NAN).is_nan());
    assert_eq!(round2(0.123456789), round8(0.123456789));
}

#[test]
fn fee_curve_minimum_and_funding_follow_reference() {
    assert_eq!(compute_taker_fee(CRYPTO_TAKER_FEE_BPS, 0.5, 100.0), 1.75);
    assert_eq!(compute_taker_fee(700.0, 0.5, 0.005), 0.0001);
    assert_eq!(compute_taker_fee(700.0, 0.5, 0.002), 0.0);
    assert_eq!(compute_taker_fee(f64::NAN, 0.5, 100.0), 0.0);
    assert_eq!(buy_commitment(0.6, 800.0, false), 493.44);
    assert_eq!(buy_commitment(0.5, 1000.0, true), 500.0);
    assert_eq!(
        fill_cash_delta(0.6, 800.0, true, true, Some(700.0)),
        -493.44
    );
    assert_eq!(
        validate_starting_capital(-0.0).unwrap().to_bits(),
        (-0.0_f64).to_bits()
    );
    assert!(validate_starting_capital(-1.0).is_err());
    assert!(validate_starting_capital(f64::INFINITY).is_err());
}

#[test]
fn numeric_reasons_use_javascript_notation_boundaries() {
    for (number, text) in [
        (1e-7, "1e-7"),
        (1e-6, "0.000001"),
        (1e20, "100000000000000000000"),
        (1e21, "1e+21"),
        (1000000000000000100.0, "1000000000000000100"),
        (-0.0, "0"),
        (f64::NAN, "NaN"),
    ] {
        assert_eq!(js_number_string(number), text);
    }
}

#[test]
fn fee_scaling_overflow_and_absent_fill_rate_match_reference() {
    assert_eq!(compute_taker_fee(700.0, 0.5, 1e308), f64::INFINITY);
    assert_eq!(fill_cash_delta(0.6, 800.0, true, true, None), -480.0);
    assert_eq!(buy_commitment(0.6, 800.0, false), 493.44);
}
