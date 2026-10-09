//! Helpers for the independent spec-conformance tests (60 §10, D45).
//!
//! Everything in this crate is derived from the frozen spec at tag
//! `native-spec-g1` and from nothing else: no engine crate is read or linked
//! (60 CF-2). The helpers deliberately re-implement the small pieces of
//! arithmetic the spec fixes by formula (SHA-256, SplitMix64, the seed
//! derivation of 10 §6.1, exact decimal rounding of 10 §3 and 11 §5), so that
//! the spec tables can be checked by a second, independent implementation
//! before the engine exists.

pub mod decimal;
pub mod rng;
pub mod sha256;
pub mod time;
pub mod vectors;

pub use decimal::Dec;
