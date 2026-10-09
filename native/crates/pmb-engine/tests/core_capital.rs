//! `src/trading/capital.test.ts` converted to Rust fixture tests (60 §7.3):
//! reservation at emission, funding inside cascades, release on
//! authoritative final quantities, split/merge funding and the per-market
//! allowance. Only observable events and the capital view are asserted (R4).
//! Live-adapter cases (`LiveExecution`, REST/WS reconciliation) are M9 and
//! not converted; the TS `queued` intent mode has no Rust counterpart.
//!
//! Coverage of the 20 TS cases (by `capital.test.ts` line): converted
//! :155, :190, :201, :214, :355, :395, :405, :414, :435 (backtest half),
//! :459, :531 and :545 (per-session strategy and allowance). Not converted:
//! :231, :273, :311 (REST cancel acknowledgement and adapter rejections of
//! `LiveExecution`, M9); :259, :331, :366 (duplicate fill ids, fills and
//! acknowledgements matched by exchange id: raw-frame dedupe and id mapping
//! of the live adapter, 10 S5, 50 §8.2.5, M9; the core addresses every
//! event by `OrderKey`, 12 §7.1); :478 (`queued` intent mode, no Rust
//! counterpart); :498 (rotation of undispatched decisions, replaced by the
//! window-end rule of 12 §10). These are hand-transcribed oracle cases;
//! TS-recorded event-sequence fixtures (60 §7.3) are a cross-stream item.
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

    include!("suites/capital.rs");
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

    include!("suites/capital.rs");
}
