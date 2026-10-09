//! `src/trading/cancellation.test.ts` (backtest cases) converted to Rust
//! fixture tests (60 §7.3): cancel reference resolution, generations,
//! dedupe and cid release, scope resolution at execution, and the TS risk
//! pass. Live-adapter cases (`:257-326`, `:433-453`, `:626-653`) are M9.
//!
//! Coverage (by `cancellation.test.ts` line, backtest runtime): converted
//! :143, :175, :198, :209, :327, :362, :373, :385, :405, :540, :604, :653,
//! :665, :806, plus the TS-view scenarios reproduced with a TS probe (cancel
//! from the completing fill's callback, cancel of a re-placed cid before its
//! submission is delivered, both-reference conflicts). Not converted: the
//! live runtime halves and live-only cases (:236 invalid live scope, :257,
//! :285, :299, :433 dry-run adapter, :453, :508, :626, :688 explicit pairs
//! without a portfolio snapshot, :721-:984 live WS/REST generation and
//! reconciliation cases, M9); :417 (TS `queued` mode and
//! `cancelLatency=false`, no Rust counterpart); :560 (multi-market runner
//! switch, replaced by per-session isolation, 12 §10); :707 (delayed
//! placement across a market switch, 12 §10). TS-recorded event-sequence
//! fixtures (60 §7.3) are a cross-stream item.
//!
//! The suite runs on both execution adapters (M1 step 4): `mock::` on the
//! compat-like `MockExec` of `core_support`, `sim::` on the real ts-compat
//! `Simulator` (13 §5). Assertions on mock internals run only on the mock.

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

    include!("suites/cancellation.rs");
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

    include!("suites/cancellation.rs");
}
