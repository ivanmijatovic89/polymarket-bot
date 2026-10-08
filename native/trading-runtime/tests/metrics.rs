use polymarket_runtime::metrics::*;
#[test]
fn positions_require_both_ids_and_preserve_negative_zero() {
    assert!(compute_position_metrics(None, Some("down"), |_| None).is_none());
    assert!(compute_position_metrics(Some(""), Some("down"), |_| None).is_none());
    let result = compute_position_metrics(Some("up"), Some("down"), |id| {
        Some(PositionAmounts {
            qty: if id == "up" { -0.0 } else { 0.0 },
            cost_basis: 0.0,
        })
    })
    .unwrap();
    assert_eq!(result.shares_mergeable.to_bits(), (-0.0f64).to_bits());
    assert_eq!(result.pair_avg, None);
}
#[test]
fn depth_truncation_and_missing_values_match_context() {
    let result = compute_orderbook_metrics(
        BookDepthView {
            depth_levels: 3.9,
            bids: &[f64::NAN, 2.0, 4.0],
            asks: &[-2.0, 8.0],
        },
        BookDepthView {
            depth_levels: 5.0,
            bids: &[0.0, 4.0, 4.0],
            asks: &[1.0, 2.0],
        },
    );
    assert_eq!(result.depth_levels, 2);
    assert_eq!(
        result.weak_bid_side_by_level,
        vec![WeakSide::NONE, WeakSide::UP]
    );
    assert_eq!(result.weak_bid_ratio_by_level, vec![1.0, 0.5]);
    assert_eq!(
        result.weak_ask_side_by_level,
        vec![WeakSide::UP, WeakSide::DOWN]
    );
    assert_eq!(result.weak_ask_ratio_by_level, vec![0.0, 0.25]);
}

#[test]
fn negative_zero_depth_clamps_to_positive_zero_on_every_target() {
    let up_depth = [-0.0, 1.0, -1.0, 5e-324];
    let down_depth = [1.0, -0.0, 1.0, 1e308];
    let result = compute_orderbook_metrics(
        BookDepthView {
            depth_levels: 4.0,
            bids: &up_depth,
            asks: &down_depth,
        },
        BookDepthView {
            depth_levels: 4.0,
            bids: &down_depth,
            asks: &up_depth,
        },
    );
    for ratio in result
        .weak_bid_ratio_by_level
        .iter()
        .chain(&result.weak_ask_ratio_by_level)
    {
        assert_eq!(ratio.to_bits(), 0.0f64.to_bits());
    }
    assert_eq!(
        result.weak_bid_side_by_level,
        vec![WeakSide::UP, WeakSide::DOWN, WeakSide::UP, WeakSide::UP]
    );
}
