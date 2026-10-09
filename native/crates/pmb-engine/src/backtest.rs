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

/// Why a candidate could not be set up.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SetupError {
    /// The configuration is not runnable by this driver or the simulator
    /// (`invalid_input`, 20 §4.1 `model_config` / `input_mode`).
    Config(ConfigError),
    /// `Strategy::new` or `interests` panicked: `strategy_fault: panic`
    /// for this candidate only (12 §11).
    Strategy(SessionFault),
}

/// One market of a backtest: the shared market state and the candidates'
/// sessions (12 §2.1, 41).
pub struct BacktestMarket<S: Strategy, T: TraceSink> {
    market: SharedMarket,
    sessions: Vec<Session<S, Simulator, T>>,
    next_seq: u64,
}

impl<S: Strategy, T: TraceSink> BacktestMarket<S, T> {
    /// A market before its first envelope.
    pub fn new(market: SharedMarket) -> Self {
        BacktestMarket {
            market,
            sessions: Vec::new(),
            next_seq: 0,
        }
    }

    /// Adds a candidate with its own config, simulator and trace sink and
    /// returns its index (12 §2.1, 13 §7.3).
    pub fn add_candidate(
        &mut self,
        params: &S::Params,
        config: EngineConfig,
        trace: T,
    ) -> Result<usize, SetupError> {
        if config.core_rules != CoreRules::TsCompat || config.input_mode != InputMode::TelonexDelta
        {
            return Err(SetupError::Config(ConfigError {
                message: format!(
                    "the backtest driver runs telonex-delta under ts-compat only; got {:?} on \
                     {:?} (realistic Telonex receipt times are M3b, 12 §4.3)",
                    config.core_rules, config.input_mode
                ),
            }));
        }
        let sim = Simulator::new(&config).map_err(SetupError::Config)?;
        let s =
            Session::new(params, &self.market, config, sim, trace).map_err(SetupError::Strategy)?;
        self.sessions.push(s);
        Ok(self.sessions.len() - 1)
    }

    /// The shared market state.
    pub fn market(&self) -> &SharedMarket {
        &self.market
    }

    /// The candidates' sessions in index order.
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
        mut self,
        outcome: FinalOutcome,
    ) -> (SharedMarket, Vec<Result<SessionOutput, SessionFault>>) {
        let market = &self.market;
        let results = self
            .sessions
            .drain(..)
            .map(|mut s| {
                s.end_of_stream(market)?;
                s.finalize(market, outcome)
            })
            .collect();
        (self.market, results)
    }
}
