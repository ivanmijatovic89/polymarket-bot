//! Derived native tape of telonex-delta files (16 §7.5, D46).
//!
//! A tape is an engine-owned, lossless re-encoding of the typed rows that the
//! telonex-delta reader consumes (NT-2): column-wise little-endian arrays,
//! delta-coded clocks, one checksummed zstd frame per column per ~64 k-row
//! block, and a header naming the v1 file it was built from (NT-1, NT-3).
//! Only the `pmb-tape` tool writes tapes (NT-4); readers use a tape when it
//! is valid for the exact v1 file and silently fall back to v1 otherwise
//! (NT-5). The canonical v1 files are never changed.

pub mod codec;
pub mod compare;
pub mod m19;
pub mod manifest;
pub mod replay;
pub mod store;
pub mod typed;
pub mod v1;

#[cfg(test)]
mod tests;

pub use codec::{Decoder, EncodeOptions, TapeError, TapeHeader, V1Identity};
pub use replay::{replay, ReplayStream, Replayer, RowKind};
pub use store::{
    convert_one, load_tape, read_tape_stream, tape_path, ConvertOptions, ConvertOutcome, Fallback,
    MarketKey,
};
pub use typed::{TypedRows, Unconvertible};

use pmb_core::TimedMarketEvent;
use pmb_replay::telonex::TelonexDiagnostics;
use pmb_replay::{read_telonex_delta, InputError, InputFile, TelonexInput, TelonexTape};
use std::path::Path;

/// A decoded market from either input path; both yield the same events.
pub enum MarketStream {
    Tape(ReplayStream),
    V1(TelonexTape),
}

impl MarketStream {
    pub fn len(&self) -> usize {
        match self {
            MarketStream::Tape(s) => s.len(),
            MarketStream::V1(t) => t.len(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    #[inline]
    pub fn event(&self, i: usize) -> TimedMarketEvent<'_> {
        match self {
            MarketStream::Tape(s) => s.event(i),
            MarketStream::V1(t) => t.event(i),
        }
    }

    pub fn events(&self) -> impl Iterator<Item = TimedMarketEvent<'_>> + '_ {
        (0..self.len()).map(move |i| self.event(i))
    }

    pub fn diagnostics(&self) -> &TelonexDiagnostics {
        match self {
            MarketStream::Tape(s) => &s.diagnostics,
            MarketStream::V1(t) => t.diagnostics(),
        }
    }

    pub fn market(&self) -> &str {
        match self {
            MarketStream::Tape(s) => &s.market,
            MarketStream::V1(t) => &t.meta.market,
        }
    }
}

/// Which input a market was read from (diagnostics only, 16 DP-5).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InputPath {
    Tape,
    V1(Fallback),
}

/// Reads a telonex-delta market, from its tape when one is valid for this
/// exact v1 file and job (NT-5), else from v1. A bad or stale tape is never
/// an error; errors are the v1 reader's own (15 §9), raised identically on
/// both paths: a job whose input facts the v1 reader would refuse (format,
/// size, sha256) always takes the v1 path, so v1 raises the error.
pub fn read_market(
    file: &InputFile<'_>,
    tape: Option<&Path>,
    input: &TelonexInput<'_>,
    decoder: &mut Decoder,
) -> Result<(MarketStream, InputPath), InputError> {
    let v1 = file.path;
    let fallback = match tape {
        // Relative or missing v1 paths are the v1 reader's errors (I-3).
        Some(_) if !v1.is_absolute() => Fallback::Io("v1 path is not absolute".into()),
        Some(t) => match store::check_job(file) {
            Err(f) => f,
            Ok(sha) => match store::read_tape_stream(decoder, t, v1, sha.as_ref(), input) {
                Ok(stream) => return stream.map(|s| (MarketStream::Tape(s), InputPath::Tape)),
                Err(f) => f,
            },
        },
        None => Fallback::Missing,
    };
    read_telonex_delta(file, *input).map(|t| (MarketStream::V1(t), InputPath::V1(fallback)))
}
