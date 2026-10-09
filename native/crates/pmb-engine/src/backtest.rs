//! Backtest market driver: one market's recorded tape through the driver
//! and every candidate's `Session<S, Simulator, T>` (12 §2.1, §5.1, §14
//! P6; 13 §3), then end of stream and finalize (12 §5.1, §9.5).
//!
//! Supported input: `telonex-delta` under the ts-compat rules (12 §4.1
//! row 1). Realistic Telonex needs the receipt-time synthesis of 12 §4.3
//! (M3b, D57); `recorder-v4` envelopes come from the V4 reader. Both are
//! rejected here instead of being approximated (R14).

use pmb_contract::vocab::InputMode;
use pmb_core::{FinalOutcome, TimedMarketEvent};

use crate::config::{ConfigError, EngineConfig};
use crate::core_rules::CoreRules;
use crate::envelope::{Envelope, Payload, Source};
use crate::exec::sim::Simulator;
use crate::session::{drive, Session, SessionFault, SessionOutput};
use crate::shared::SharedMarket;
use crate::strategy::Strategy;
use crate::trace::TraceSink;

/// Envelopes handed to the driver per batch; the buffer is reused.
const BATCH: usize = 256;

/// The envelope of one telonex-delta row under ts-compat (12 §4.1): `at` is
/// the row exchange ts `E`, which is also the TS tick timestamp (15 I-6d);
/// the Telonex local time travels as `recv_wall` (14 F-7).
#[inline]
pub fn telonex_envelope<'a>(seq: u64, ev: &TimedMarketEvent<'a>) -> Envelope<'a> {
    Envelope {
        seq,
        at: ev.exchange_ts,
        exchange_ts: Some(ev.exchange_ts),
        recv_wall: ev.local_ts,
        recv_mono: None,
        source: Source::MarketWs,
        payload: Payload::Market(ev.event),
    }
}

/// One candidate slot, in candidate order (41 §7.3: a candidate failure
/// keeps its index).
#[derive(Clone, Debug)]
enum Slot {
    /// Index into the running sessions.
    Running(usize),
    /// `Strategy::new` or `interests` panicked: `strategy_fault: panic` for
    /// this candidate only (12 §11).
    Failed(SessionFault),
}

/// One market of a backtest: the shared market state and the candidates'
/// sessions (12 §2.1, 41).
pub struct BacktestMarket<S: Strategy, T: TraceSink> {
    market: SharedMarket,
    /// Running sessions, contiguous for `drive`.
    sessions: Vec<Session<S, Simulator, T>>,
    slots: Vec<Slot>,
    next_seq: u64,
}

impl<S: Strategy, T: TraceSink> BacktestMarket<S, T> {
    /// A market before its first envelope.
    pub fn new(market: SharedMarket) -> Self {
        BacktestMarket {
            market,
            sessions: Vec::new(),
            slots: Vec::new(),
            next_seq: 0,
        }
    }

    /// Adds a candidate with its own config, simulator and trace sink and
    /// returns its index (12 §2.1, 13 §7.3). A configuration this driver or
    /// the simulator cannot run is an error of the job (`invalid_input`,
    /// R14); a panic in `Strategy::new` fails only this candidate, which
    /// keeps its index and reports the fault from [`BacktestMarket::finish`].
    pub fn add_candidate(
        &mut self,
        params: &S::Params,
        config: EngineConfig,
        trace: T,
    ) -> Result<usize, ConfigError> {
        if config.core_rules != CoreRules::TsCompat || config.input_mode != InputMode::TelonexDelta
        {
            return Err(ConfigError {
                message: format!(
                    "the backtest driver runs telonex-delta under ts-compat only; got {:?} on \
                     {:?} (realistic Telonex receipt times are M3b, 12 §4.3)",
                    config.core_rules, config.input_mode
                ),
            });
        }
        let sim = Simulator::new(&config)?;
        let slot = match Session::new(params, &self.market, config, sim, trace) {
            Ok(s) => {
                self.sessions.push(s);
                Slot::Running(self.sessions.len() - 1)
            }
            Err(f) => Slot::Failed(f),
        };
        self.slots.push(slot);
        Ok(self.slots.len() - 1)
    }

    /// The shared market state.
    pub fn market(&self) -> &SharedMarket {
        &self.market
    }

    /// The running sessions (candidates whose `new` succeeded), in
    /// candidate order.
    pub fn sessions(&self) -> &[Session<S, Simulator, T>] {
        &self.sessions
    }

    /// Replays telonex-delta rows in file order (15 I-15): each row is one
    /// envelope applied by the driver and stepped by every live session
    /// (12 §5.1).
    pub fn run_telonex<'e, I>(&mut self, events: I)
    where
        I: IntoIterator<Item = TimedMarketEvent<'e>>,
    {
        let mut batch: Vec<Envelope<'e>> = Vec::with_capacity(BATCH);
        for ev in events {
            batch.push(telonex_envelope(self.next_seq, &ev));
            self.next_seq += 1;
            if batch.len() == BATCH {
                drive(&mut self.market, &mut self.sessions, &batch);
                batch.clear();
            }
        }
        if !batch.is_empty() {
            drive(&mut self.market, &mut self.sessions, &batch);
        }
    }

    /// End of input, settlement and the per-candidate result, in candidate
    /// order (12 §5.1, §9.5, §11). A faulted candidate keeps its fault.
    pub fn finish(
        self,
        outcome: FinalOutcome,
    ) -> (SharedMarket, Vec<Result<SessionOutput, SessionFault>>) {
        let market = self.market;
        let mut finished: Vec<Option<Result<SessionOutput, SessionFault>>> = self
            .sessions
            .into_iter()
            .map(|mut s| {
                Some(
                    s.end_of_stream(&market)
                        .and_then(|()| s.finalize(&market, outcome)),
                )
            })
            .collect();
        let results = self
            .slots
            .into_iter()
            .map(|slot| match slot {
                Slot::Running(i) => finished[i].take().expect("each session finishes once"),
                Slot::Failed(f) => Err(f),
            })
            .collect();
        (market, results)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use pmb_contract::model_config::{CompatLatency, ExecutionModels};
    use pmb_core::ids::{ConditionId, Hash32, TokenId};
    use pmb_core::market::MarketVersion;
    use pmb_core::rules::{
        ExchangeRules, FeeEraId, RulesProvenance, RulesSource, RulesTableVersion, RulesTimeline,
    };
    use pmb_core::seed::MarketSeed;
    use pmb_core::{
        MarketEvent, MarketInfo, Outcome, PerOutcome, Price, PriceSize, Qty, TsMs, Usdc,
    };

    use super::*;
    use crate::config::RiskLimits;
    use crate::session::StrategyFaultCause;
    use crate::strategy::{Ctx, Intents, Requirements, StrategyResult};
    use crate::trace::NoTrace;

    /// Panics in `new` when its param is true.
    struct Picky;

    impl Strategy for Picky {
        type Params = bool;
        const ID: &'static str = "picky.v1";
        fn requirements(_p: &bool) -> Requirements {
            Requirements::new()
        }
        fn new(p: &bool, _m: &MarketInfo) -> Self {
            assert!(!*p, "refuses this market");
            Picky
        }
        fn on_tick(&mut self, _ctx: &Ctx, _out: &mut Intents) -> StrategyResult {
            Ok(())
        }
    }

    fn market() -> SharedMarket {
        let info = MarketInfo::new(
            "btc-updown-15m-1780272000",
            ConditionId(Hash32([7; 32])),
            PerOutcome::new(TokenId([1; 32]), TokenId([2; 32])),
            MarketVersion::V2,
            false,
        )
        .unwrap();
        let tl = RulesTimeline::new(
            ExchangeRules::ts_compat(),
            Vec::new(),
            RulesProvenance::all_fallback(RulesTableVersion::V1),
            RulesTableVersion::V1,
            FeeEraId::F0,
        );
        SharedMarket::new(Arc::new(info), Arc::new(tl), RulesSource::Fallback)
    }

    fn config() -> EngineConfig {
        EngineConfig {
            core_rules: CoreRules::TsCompat,
            input_mode: InputMode::TelonexDelta,
            models: ExecutionModels::TS_COMPAT,
            compat_latency: CompatLatency {
                delay_ms: 0,
                jitter_ms: 0,
            },
            market_seed: MarketSeed(0),
            starting_capital: Usdc::from_micros(500_000_000),
            max_events_per_drain: 4_200,
            risk: RiskLimits::TS_DEFAULTS,
        }
    }

    #[test]
    fn a_failed_candidate_keeps_its_index_and_the_others_run() {
        // spec: 12 §11 (panic in new: strategy_fault for this candidate),
        // 41 §7.3 (a candidate failure fails only that candidate)
        let mut m = BacktestMarket::<Picky, NoTrace>::new(market());
        assert_eq!(m.add_candidate(&false, config(), NoTrace), Ok(0));
        assert_eq!(m.add_candidate(&true, config(), NoTrace), Ok(1));
        assert_eq!(m.add_candidate(&false, config(), NoTrace), Ok(2));
        let lv = [PriceSize {
            price: Price::from_micros(450_000),
            size: Qty::from_micros(10_000_000),
        }];
        let ev = pmb_core::TimedMarketEvent {
            row: 0,
            exchange_ts: TsMs(1_780_272_000_500),
            local_ts: None,
            event: MarketEvent::Book {
                outcome: Outcome::Up,
                bids: &lv,
                asks: &[],
            },
        };
        m.run_telonex([ev]);
        assert_eq!(m.sessions().len(), 2);
        let (_, r) = m.finish(FinalOutcome::new(Outcome::Up));
        assert_eq!(r.len(), 3);
        assert!(r[0].is_ok() && r[2].is_ok());
        match &r[1] {
            Err(SessionFault::Strategy {
                cause: StrategyFaultCause::Panic { message },
                callback: "new",
                ..
            }) => assert!(message.contains("refuses"), "{message}"),
            other => panic!("expected a strategy fault, got {other:?}"),
        }
        assert_eq!(r[0].as_ref().unwrap().acc.ticks.events_processed(), 1);
    }

    #[test]
    fn unsupported_configurations_are_loud() {
        // spec: R14; 12 §4.3 (realistic Telonex receipt synthesis is M3b)
        let mut m = BacktestMarket::<Picky, NoTrace>::new(market());
        let mut c = config();
        c.core_rules = CoreRules::Realistic;
        assert!(m.add_candidate(&false, c, NoTrace).is_err());
        let mut c = config();
        c.input_mode = InputMode::RecorderV4;
        assert!(m.add_candidate(&false, c, NoTrace).is_err());
    }

    #[test]
    fn telonex_rows_are_clocked_by_their_exchange_time() {
        // spec: 12 §4.1 row 1 (ts-compat telonex-delta: `at` = row exchange
        // ts E; Telonex local time travels as the receive time, 14 F-7)
        let ev = pmb_core::TimedMarketEvent {
            row: 3,
            exchange_ts: TsMs(100),
            local_ts: Some(TsMs(140)),
            event: MarketEvent::PriceChange { changes: &[] },
        };
        let e = telonex_envelope(9, &ev);
        assert_eq!(
            (e.seq, e.at, e.exchange_ts, e.recv_wall),
            (9, TsMs(100), Some(TsMs(100)), Some(TsMs(140)))
        );
    }
}
