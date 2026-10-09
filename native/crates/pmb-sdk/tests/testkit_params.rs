//! The testkit evaluates params and requirements like `describe`/`run`
//! (30 §4 rule 3, §15; 20 §5.1).
#![cfg(feature = "testkit")]

use pmb_sdk::prelude::*;
use pmb_sdk::testkit::{Profile, TestMarket};

#[derive(Params, Clone, Debug)]
struct Bounded {
    /// Highest entry price.
    #[param(default = 0.60, min = 0.01, max = 0.99)]
    max_price: Price,
}

struct Idle;

impl Strategy for Idle {
    type Params = Bounded;
    const ID: &'static str = "testkit-idle";
    fn requirements(_p: &Bounded) -> Requirements {
        Requirements::new()
    }
    fn new(_p: &Bounded, _m: &MarketInfo) -> Self {
        Idle
    }
    fn on_tick(&mut self, _ctx: &Ctx, _out: &mut Intents) -> StrategyResult {
        Ok(())
    }
}

struct PanicsInRequirements;

impl Strategy for PanicsInRequirements {
    type Params = Bounded;
    const ID: &'static str = "testkit-req-panic";
    fn requirements(_p: &Bounded) -> Requirements {
        panic!("requirements refused")
    }
    fn new(_p: &Bounded, _m: &MarketInfo) -> Self {
        PanicsInRequirements
    }
    fn on_tick(&mut self, _ctx: &Ctx, _out: &mut Intents) -> StrategyResult {
        Ok(())
    }
}

fn market() -> TestMarket {
    TestMarket::btc_15m(TsMs(1_760_140_800_000)).profile(Profile::TsCompat)
}

#[test]
fn testkit_runs_valid_params() {
    // spec: 30 §15 (the real path)
    let ok = Bounded::from_json_str(r#"{"maxPrice":0.5}"#).unwrap();
    assert!(market().try_run::<Idle>(&ok).is_ok());
}

#[test]
fn testkit_refuses_params_outside_their_bounds() {
    // spec: 30 §4 rule 3, §9 rule 2, R14
    let typed = Bounded {
        max_price: price!(0.999),
    };
    let err = market().try_run::<Idle>(&typed).unwrap_err();
    assert!(
        err.contains("invalid params") && err.contains("/maxPrice"),
        "{err}"
    );
}

#[test]
fn testkit_evaluates_requirements() {
    // spec: 30 §4 rule 3 (requirements evaluated at job start), §12
    let p = Bounded::from_json_str("{}").unwrap();
    let err = market().try_run::<PanicsInRequirements>(&p).unwrap_err();
    assert!(err.contains("requirements refused"), "{err}");
}
