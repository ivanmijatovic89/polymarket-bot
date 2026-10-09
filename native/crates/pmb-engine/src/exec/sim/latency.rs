//! Latency models (13 §4.4 `LatencyModel`): `NextRealTick` compat latency
//! (13 §5.1, TC-E1/TC-E2) and the seam for the realistic seeded components
//! (13 §6.8, M3b).
//!
//! Randomness comes only from the market seed's counter-based streams
//! (13 X8, 10 §6.1): a draw is a pure function of (stream, entity, index),
//! so no RNG state is kept and no call order matters.

use pmb_core::ids::{CancelSeq, OpKey, OrderKey};
use pmb_core::seed::{
    stream_seed, Entity, EntityKind, EntityRng, MarketSeed, StreamSeed, StreamTag,
};
use pmb_core::{DurMs, TsMs};

/// How scheduled actions are released (13 §2.3, §5.1).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum Release {
    /// Exact time: the loop runs each action at its due time (realistic
    /// `latency: exact`, 13 §6.8; M3b).
    ExactTime,
    /// `NextRealTick`: queued actions run only inside `on_market_event` of a
    /// real market event at or after their due time (13 §5.1).
    AtMarketEvent,
}

/// When a command reaches the exchange (13 §4.4 `LatencyModel`).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum Arrival {
    /// Executed inside `submit`: synchronous events (13 X2; ts-compat only,
    /// effective latency 0, TC-E1).
    Now,
    /// Scheduled for this loop time.
    At(TsMs),
}

/// What a command is, for the latency entity of 13 §6.8.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum CommandKind {
    /// `Place`: entity = first `OrderKey` of the command (13 §6.8 `place`).
    Place {
        /// First key of the batch.
        first: OrderKey,
    },
    /// Any cancel: entity = the `CancelSeq` of its `CancelOp`.
    Cancel {
        /// Cancel sequence.
        seq: CancelSeq,
    },
    /// Split or merge: entity = `OpKey` (`chainSplit`, `chainMerge`).
    Chain {
        /// Operation key.
        op: OpKey,
        /// `true` for a merge.
        merge: bool,
    },
}

/// One `submit` call as the latency model sees it.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct CommandRef {
    /// The session's 0-based count of `submit` calls (10 RNG-4 kind 5; the
    /// `compat_jitter` entity, 13 §5.1).
    pub submit_index: u32,
    /// The command.
    pub kind: CommandKind,
}

/// Client-side report components of 13 §6.8.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum ReportComponent {
    /// REST placement response.
    Ack,
    /// REST cancel response.
    CancelAck,
    /// User-WS fill or terminal order message.
    FillReport,
    /// Settlement `Mined`.
    Mined,
    /// Settlement `Confirmed`.
    Confirmed,
    /// Settlement `Failed`.
    Failed,
}

/// Decides when commands reach the exchange and when reports reach the
/// client (13 §4.4).
pub trait LatencyModel {
    /// How scheduled actions are released.
    fn release(&self) -> Release;
    /// Exchange arrival of a command decided at `stamp` (12 §4.2).
    fn command_arrival(&self, stamp: TsMs, cmd: CommandRef) -> Arrival;
    /// Delivery delay of a report component for an entity (10 RNG-4).
    fn report_delay(&self, c: ReportComponent, entity: Entity) -> DurMs;
}

/// `NextRealTick` (`models.latency = compat`; 13 §5.1, TC-E1, TC-E2): one
/// delay `d` for every placement and every cancel kind, jitter `j` only
/// when `d > 0`, `execute_at = max(stamp, stamp + d + jitter)`.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct NextRealTick {
    delay: DurMs,
    jitter_ms: i64,
    jitter_stream: StreamSeed,
    /// ts-compat: `execute_at ≤ stamp` executes inside `submit`. As a
    /// realistic A/B arm there are no synchronous events (13 X2).
    synchronous: bool,
}

impl NextRealTick {
    /// The compat latency of `execution.compatLatency` for one market.
    pub fn new(delay_ms: u32, jitter_ms: u32, market_seed: MarketSeed, synchronous: bool) -> Self {
        NextRealTick {
            delay: DurMs(i64::from(delay_ms)),
            jitter_ms: i64::from(jitter_ms),
            jitter_stream: stream_seed(market_seed, StreamTag::CompatJitter),
            synchronous,
        }
    }

    /// The seeded jitter of the `submit_index`-th command: an integer in
    /// `[−j, j]` from the `compat_jitter` stream, entity kind 5 (13 §5.1,
    /// 10 RNG-4, RNG-6); 0 unless `d > 0` and `j > 0` (TC-E2).
    pub fn jitter(&self, submit_index: u32) -> i64 {
        if self.delay.0 <= 0 || self.jitter_ms <= 0 {
            return 0;
        }
        EntityRng::new(
            self.jitter_stream,
            Entity::packed(EntityKind::ExecCommand, submit_index),
        )
        .int_in(-self.jitter_ms, self.jitter_ms)
    }

    /// `execute_at = max(stamp, stamp + d + jitter)` (13 §5.1).
    pub fn execute_at(&self, stamp: TsMs, submit_index: u32) -> TsMs {
        let t = stamp.0 + self.delay.0 + self.jitter(submit_index);
        TsMs(t.max(stamp.0))
    }
}

impl LatencyModel for NextRealTick {
    #[inline]
    fn release(&self) -> Release {
        Release::AtMarketEvent
    }

    fn command_arrival(&self, stamp: TsMs, cmd: CommandRef) -> Arrival {
        let at = self.execute_at(stamp, cmd.submit_index);
        if self.synchronous && at <= stamp {
            Arrival::Now
        } else {
            Arrival::At(at)
        }
    }

    /// Ack and fill-report latencies are 0 (13 §5.1). Settlement and chain
    /// latencies of the realistic A/B arm come from `latency.components`,
    /// which land with the realistic profile (M3b, D57).
    #[inline]
    fn report_delay(&self, _c: ReportComponent, _entity: Entity) -> DurMs {
        DurMs(0)
    }
}

/// The latency axis (13 §7.3 `models.latency`), enum-dispatched (13 §4.4).
/// `exact` (13 §6.8) is added with the realistic profile in M3b.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Latency {
    /// `compat`.
    Compat(NextRealTick),
}

impl LatencyModel for Latency {
    #[inline]
    fn release(&self) -> Release {
        match self {
            Latency::Compat(m) => m.release(),
        }
    }
    #[inline]
    fn command_arrival(&self, stamp: TsMs, cmd: CommandRef) -> Arrival {
        match self {
            Latency::Compat(m) => m.command_arrival(stamp, cmd),
        }
    }
    #[inline]
    fn report_delay(&self, c: ReportComponent, entity: Entity) -> DurMs {
        match self {
            Latency::Compat(m) => m.report_delay(c, entity),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pmb_core::seed::{market_seed, RunSeed};

    const SLUG: &str = "btc-updown-15m-1780272000";

    fn cmd(i: u32) -> CommandRef {
        CommandRef {
            submit_index: i,
            kind: CommandKind::Place {
                first: OrderKey::new(i),
            },
        }
    }

    #[test]
    fn compat_jitter_matches_rng7_vectors() {
        // spec: 10 RNG-7 (compat_jitter, j = 100, commands 0, 1, 2 → −34, −78, −52),
        // 13 §5.1 (one draw per submit, entity kind 5)
        let m = NextRealTick::new(1, 100, market_seed(RunSeed::ZERO, SLUG), true);
        assert_eq!([m.jitter(0), m.jitter(1), m.jitter(2)], [-34, -78, -52]);
    }

    #[test]
    fn jitter_only_when_delay_positive() {
        // spec: 13 §5.1, TC-E2 (jitter applies only when d > 0)
        let m = NextRealTick::new(0, 100, market_seed(RunSeed::ZERO, SLUG), true);
        assert_eq!(m.jitter(0), 0);
        assert_eq!(m.command_arrival(TsMs(1_000), cmd(0)), Arrival::Now);
    }

    #[test]
    fn execute_at_is_clamped_at_stamp_and_sync_when_not_later() {
        // spec: 13 §5.1 (execute_at = max(stamp, stamp + d + jitter); ≤ stamp → inside submit)
        let seed = market_seed(RunSeed::ZERO, SLUG);
        // d = 1, jitter(0) = −34 → clamped to the stamp → synchronous.
        let m = NextRealTick::new(1, 100, seed, true);
        assert_eq!(m.execute_at(TsMs(1_000), 0), TsMs(1_000));
        assert_eq!(m.command_arrival(TsMs(1_000), cmd(0)), Arrival::Now);
        // d = 100, jitter(1) = −78 → 1_022.
        let m = NextRealTick::new(100, 100, seed, true);
        assert_eq!(
            m.command_arrival(TsMs(1_000), cmd(1)),
            Arrival::At(TsMs(1_022))
        );
        // Without jitter the delay is exact.
        let m = NextRealTick::new(100, 0, seed, true);
        assert_eq!(
            m.command_arrival(TsMs(1_000), cmd(7)),
            Arrival::At(TsMs(1_100))
        );
        assert_eq!(m.release(), Release::AtMarketEvent);
    }

    #[test]
    fn realistic_arm_never_synchronous() {
        // spec: 13 X2, 13 §5.1 (as a realistic A/B arm: no synchronous events)
        let m = NextRealTick::new(0, 0, MarketSeed(0), false);
        assert_eq!(m.command_arrival(TsMs(5), cmd(0)), Arrival::At(TsMs(5)));
        assert_eq!(
            m.report_delay(
                ReportComponent::FillReport,
                Entity::packed(EntityKind::TradeSeq, 0)
            ),
            DurMs(0)
        );
    }
}
