//! Strategy logging (30 §13): `error!(ctx, ..)`, `warn!(ctx, ..)`,
//! `info!(ctx, ..)`, `debug!(ctx, ..)`, `trace!(ctx, ..)`.
//!
//! A disabled level costs one branch; the arguments are then neither
//! evaluated nor formatted. The level is the process log setting (`PMB_LOG`,
//! 20 G2), never a strategy param. Lines go to stderr in the NDJSON format
//! of 20 G1, tagged with the slug and the tick `seq`; logs never affect
//! results.
//!
//! ```
//! use pmb_sdk::prelude::*;
//!
//! fn on_tick(ctx: &Ctx, edge: f64) {
//!     debug!(ctx, "edge {edge:.4}");
//! }
//! ```
// D-PENDING: 30 §13 also tags lines with the strategy id and the candidate
// index and caps them at 1,000 per candidate × market; `Ctx` carries
// neither the id, the index nor a per-candidate counter, so this revision
// tags slug and seq only and does not cap (crossStreamNeeds: a log sink on
// the session).

use pmb_engine::strategy::Ctx;
pub use pmb_runtime::log::Level as LogLevel;

/// Whether `level` is enabled (one branch when disabled).
#[inline]
pub fn log_enabled(level: LogLevel) -> bool {
    pmb_runtime::log::enabled(level)
}

/// Writes one strategy log line (called only when the level is enabled).
#[cold]
pub fn log_line(level: LogLevel, ctx: &Ctx<'_>, args: std::fmt::Arguments<'_>) {
    let msg = format!(
        "strategy {} seq {}: {args}",
        ctx.market().slug,
        ctx.tick().seq
    );
    pmb_runtime::log::log(level, None, &msg);
}

#[doc(hidden)]
#[macro_export]
macro_rules! __pmb_log {
    ($level:ident, $ctx:expr, $($arg:tt)+) => {
        if $crate::__private::log_enabled($crate::__private::LogLevel::$level) {
            $crate::__private::log_line(
                $crate::__private::LogLevel::$level,
                $ctx,
                ::core::format_args!($($arg)+),
            );
        }
    };
}

/// Logs at `error` (30 §13): `error!(ctx, "fmt", args..)`.
#[macro_export]
macro_rules! error {
    ($ctx:expr, $($arg:tt)+) => { $crate::__pmb_log!(Error, $ctx, $($arg)+) };
}

/// Logs at `warn` (30 §13): `warn!(ctx, "fmt", args..)`.
#[macro_export]
macro_rules! warn {
    ($ctx:expr, $($arg:tt)+) => { $crate::__pmb_log!(Warn, $ctx, $($arg)+) };
}

/// Logs at `info` (30 §13): `info!(ctx, "fmt", args..)`.
#[macro_export]
macro_rules! info {
    ($ctx:expr, $($arg:tt)+) => { $crate::__pmb_log!(Info, $ctx, $($arg)+) };
}

/// Logs at `debug` (30 §13): `debug!(ctx, "fmt", args..)`.
#[macro_export]
macro_rules! debug {
    ($ctx:expr, $($arg:tt)+) => { $crate::__pmb_log!(Debug, $ctx, $($arg)+) };
}

/// Logs at `trace` (30 §13): `trace!(ctx, "fmt", args..)`.
#[macro_export]
macro_rules! trace {
    ($ctx:expr, $($arg:tt)+) => { $crate::__pmb_log!(Trace, $ctx, $($arg)+) };
}
