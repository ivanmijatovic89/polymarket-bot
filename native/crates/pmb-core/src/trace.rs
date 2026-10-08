//! Optional ordered trace of everything the engine did (for the market
//! simulator UI and parity diffs). The default sink does nothing.

use crate::model::{AccountEvent, Intent, TsMs};

pub trait TraceSink {
    fn tick(&mut self, _seq: u64, _ts_ms: TsMs, _cause: &str) {}
    fn intents(&mut self, _seq: u64, _from_account_event: bool, _intents: &[Intent]) {}
    fn account_event(&mut self, _seq: u64, _event: &AccountEvent) {}
}

#[derive(Default)]
pub struct NoTrace;

impl TraceSink for NoTrace {}
