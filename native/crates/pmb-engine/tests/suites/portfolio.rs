// The portfolio suite body, included by `tests/core_portfolio.rs` once per
// execution adapter (see there).
use super::core_support::*;
use pmb_core::fill::Liquidity;
use pmb_core::{FinalOutcome, Outcome};
use pmb_engine::strategy::PortfolioView;
use pmb_engine::CoreRules;

#[test]
fn taker_fees_are_charged_in_usdc_buy_into_basis_sell_from_proceeds() {
    // spec: 12 §9.5 (fees: fill.fee only; BUY basis += notional + fee; SELL
    // realized = proceeds − fee − removed), 21 §11 feesPaid/pnl
    // (Portfolio.test.ts:131)
    let mut h = mk_ts(MockExec::sync());
    h.send(
        vec![Cmd::Place(Ord::buy("b", 100.0, 0.5))],
        1000,
        &[(0.4, 100.0)],
        &[(0.5, 100.0)],
    )
    .unwrap();
    let pos = h.ledger().position(Outcome::Up);
    assert_eq!(pos.qty, q(100.0));
    assert_eq!(pos.cost_basis, u(51.75));
    let view = PortfolioView::new(h.ledger(), h.s.cids());
    assert_eq!(view.avg_entry(Outcome::Up), Some(p(0.5175)));
    h.send(
        vec![Cmd::Place(Ord::sell("s", 100.0, 0.6))],
        2000,
        &[(0.6, 100.0)],
        &[(0.7, 100.0)],
    )
    .unwrap();
    assert_eq!(h.ledger().position(Outcome::Up).qty, q(0.0));
    assert_eq!(h.ledger().position(Outcome::Up).cost_basis, u(0.0));
    assert_eq!(h.ledger().realized_pnl(), u(6.57));
    let m = h.market.clone();
    let out = h.s.finalize(&m, FinalOutcome::new(Outcome::Up)).unwrap();
    assert_eq!(out.stats.fees_paid, u(3.43));
    assert_eq!(out.stats.pnl, u(6.57));
    assert_eq!(out.stats.trade_count, 2);
    assert_eq!(out.stats.trade_as_taker, 2);
}

#[test]
fn maker_fills_pay_exactly_zero() {
    // spec: 12 §9.5, 13 TC-E5/TC-E7 (MAKER fills pay 0) (Portfolio.test.ts:183)
    let mut h = mk_ts(MockExec::sync());
    h.send(
        vec![Cmd::Place(Ord::buy("m", 100.0, 0.4))],
        1000,
        &[(0.3, 100.0)],
        &[(0.45, 100.0)],
    )
    .unwrap();
    h.tick(2000, &[(0.3, 100.0)], &[(0.39, 100.0)]).unwrap();
    let f = h.ledger().fills()[0];
    assert_eq!(f.liquidity, Liquidity::Maker);
    assert_eq!(f.fee, u(0.0));
    let pos = h.ledger().position(Outcome::Up);
    assert_eq!(pos.qty, q(100.0));
    assert_eq!(pos.cost_basis, u(40.0));
    let view = PortfolioView::new(h.ledger(), h.s.cids());
    assert_eq!(view.avg_entry(Outcome::Up), Some(p(0.4)));
}

#[test]
fn a_full_fill_leaves_open_orders_but_stays_in_history() {
    // spec: 12 §9.2 (the order leaves the open orders when filled reaches its
    // size), §9.7 (orders(), fills()) (Portfolio.test.ts:96)
    let mut h = mk_ts(MockExec::sync());
    h.send(
        vec![Cmd::Place(Ord::buy("cid-a", 10.0, 0.42))],
        1000,
        &[(0.3, 100.0)],
        &[(0.45, 100.0)],
    )
    .unwrap();
    assert_eq!(h.open_cids(), vec!["cid-a"]);
    h.tick(2000, &[(0.3, 100.0)], &[(0.41, 100.0)]).unwrap();
    assert_eq!(h.ledger().position(Outcome::Up).qty, q(10.0));
    assert!(h.open_cids().is_empty());
    assert_eq!(h.ledger().orders().len(), 1);
    assert_eq!(h.ledger().fills().len(), 1);
}

#[test]
fn merge_realizes_pnl_and_removes_basis() {
    // spec: 12 §9.5 merge: cash += size; basis removed at average cost;
    // realized += size − removed(Up) − removed(Down). TS credits the cash but
    // realizes nothing and keeps the basis (`Portfolio.ts:553-586`): a TS bug
    // classified in PARITY.md (13 §5.4); the spec value is asserted here.
    let mut h = mk_ts(MockExec::sync());
    h.send(
        vec![Cmd::Place(Ord::buy("up", 10.0, 0.4))],
        1000,
        &[(0.3, 100.0)],
        &[(0.4, 100.0)],
    )
    .unwrap();
    h.book(1100, Outcome::Down, &[(0.5, 100.0)], &[(0.55, 100.0)])
        .unwrap();
    h.script.outbox.lock().unwrap().push_back(vec![Cmd::Place(
        Ord::buy("down", 10.0, 0.55).outcome(Outcome::Down),
    )]);
    h.book(1200, Outcome::Down, &[(0.5, 100.0)], &[(0.55, 100.0)])
        .unwrap();
    let basis_up = h.ledger().position(Outcome::Up).cost_basis;
    let basis_down = h.ledger().position(Outcome::Down).cost_basis;
    // 4 + 0.168 fee; 5.5 + 0.17325 → 0.1733 at 4 dp.
    assert_eq!(basis_up, u(4.168));
    assert_eq!(basis_down, u(5.6733));
    let cash_before = h.ledger().capital().cash;
    h.send(
        vec![Cmd::Merge(q(6.0))],
        1300,
        &[(0.3, 100.0)],
        &[(0.4, 100.0)],
    )
    .unwrap();
    let up = h.ledger().position(Outcome::Up);
    let down = h.ledger().position(Outcome::Down);
    assert_eq!((up.qty, down.qty), (q(4.0), q(4.0)));
    // Removed at average cost: 4.168 × 0.6 = 2.5008; 5.6733 × 0.6 = 3.40398.
    assert_eq!(up.cost_basis, u(4.168 - 2.5008));
    assert_eq!(down.cost_basis, u(5.6733 - 3.40398));
    assert_eq!(h.ledger().capital().cash, cash_before + u(6.0));
    assert_eq!(h.ledger().realized_pnl(), u(6.0 - 2.5008 - 3.40398));
    for w in Outcome::ALL {
        assert!(h.ledger().identity_holds(FinalOutcome::new(w)));
    }
    let _ = CoreRules::TsCompat;
}
