//! A no-op strategy binary on the production path, for the process-level
//! tests of `pmb-runtime` (exit codes, stdout document, stderr reason).
//! It is not an artifact and is never published.

use pmb_core::MarketInfo;
use pmb_engine::strategy::{Ctx, Intents, Requirements, StrategyResult};
use pmb_engine::Strategy;

/// Never trades.
struct Idle;

impl Strategy for Idle {
    type Params = ();
    const ID: &'static str = "runtime-fixture-idle.v1";

    fn requirements(_p: &()) -> Requirements {
        Requirements::new()
    }

    fn new(_p: &(), _market: &MarketInfo) -> Self {
        Idle
    }

    fn on_tick(&mut self, _ctx: &Ctx, _out: &mut Intents) -> StrategyResult {
        Ok(())
    }
}

pmb_runtime::strategy_main!(Idle, sdk_version = "0.0.0-fixture");
