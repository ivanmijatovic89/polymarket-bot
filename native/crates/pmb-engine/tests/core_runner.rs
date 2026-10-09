//! `src/trading/StrategyRunner.{serial,clock,syntheticTicks}.test.ts` and
//! `src/trading/runnerConfig.test.ts` converted to Rust fixture tests
//! (60 §7.3): serial order, the TS event clock, synthetic-tick rules, the
//! cascade budget and the global open-order capacity. The TS `queued`
//! intent mode and env-driven budgets have no Rust counterpart (R7).
//!
//! The suite runs on both execution adapters (M1 step 4): `mock::` on the
//! compat-like `MockExec` of `core_support`, `sim::` on the real ts-compat
//! `Simulator` (13 §5). Assertions on mock internals run only on the mock.
//! Mock-only: two tests script adapter events at exact times
//! (`MockExec::timed`); one also runs the realistic rules (M3b for the
//! simulator).

mod core_support;

/// On the compat-like mock adapter.
mod mock {
    use super::core_support::{MockExec, Script, H};

    type HB = H<MockExec>;

    #[allow(dead_code)]
    fn mk(cfg: pmb_engine::EngineConfig, exec: MockExec, script: Script) -> HB {
        H::new(cfg, exec, script)
    }

    #[allow(dead_code)]
    fn mk_ts(exec: MockExec) -> HB {
        H::ts_compat(exec)
    }

    #[allow(unused_macros)]
    macro_rules! mock_only {
        ($($i:item)*) => { $($i)* };
    }

    include!("suites/runner.rs");
}

/// On the real ts-compat simulator, with the mock's compat delay.
#[allow(dead_code, unused_imports)]
mod sim {
    use super::core_support::{MockExec, Script, H};
    use pmb_engine::Simulator;

    type HB = H<Simulator>;

    fn mk(cfg: pmb_engine::EngineConfig, exec: MockExec, script: Script) -> HB {
        H::sim(cfg, exec, script)
    }

    fn mk_ts(exec: MockExec) -> HB {
        H::sim(
            super::core_support::config(pmb_engine::CoreRules::TsCompat),
            exec,
            Script::default(),
        )
    }

    #[allow(unused_macros)]
    macro_rules! mock_only {
        ($($i:item)*) => {};
    }

    include!("suites/runner.rs");
}
