//! The generic entry point every native strategy binary runs (20, 30 §4).
//!
//! A strategy package's bin crate ends with `strategy_main!(MyStrategy);`
//! (re-exported by `pmb-sdk`), which expands to a `main` calling
//! [`main::<MyStrategy>()`](main). The runtime is monomorphized over the
//! strategy type and never boxes it (30 §4 rule 1, 12 §14 P6).
//!
//! | Module | Owns |
//! |---|---|
//! | [`cli`] | command line, dispatch, error documents (20 §1, §5, G1) |
//! | [`describe`] | `describe` and `schema` documents, capabilities (20 §3, §5.1–§5.2) |
//! | [`job`] | strict job loading and validation (21 §5, §19) |
//! | [`inputs`] | input integrity and decode seam (21 §9, 15 I-8) |
//! | [`backend`] | the engine seam per candidate × market (12 §2.1, §11) |
//! | [`run`] | the `run` pipeline and `EngineResult` (21 §10–§16) |
//! | [`trace`] | `pmb-parity-trace/2` writer and `ParityTraceSink` (22 §2–§3) |
//! | [`selftest`] | embedded fixture checks (20 §5.3) |
//! | [`params`] | the params seam to the `Params` derive (30 §9) |
//! | [`identity`] | engine identity and `contractSha256` (20 §3, 31 §5.3) |
//! | [`error`], [`io`], [`log`] | error classes, I/O rules, stderr logging (20 §2, §4) |

pub mod backend;
pub mod cli;
pub mod describe;
pub mod error;
pub mod identity;
pub mod inputs;
pub mod io;
pub mod job;
pub mod log;
pub mod panic;
pub mod params;
pub mod run;
pub mod selftest;
pub mod trace;

pub use backend::{Backend, EngineBackend, ExecFactory, UnwiredSimulator};
pub use error::EngineError;
pub use params::{ParamError, StrategyParams};
pub use trace::ParityTraceSink;

use pmb_engine::Strategy;

/// Expands to the `main` of a strategy binary (30 §4 rule 1).
///
/// ```ignore
/// pmb_runtime::strategy_main!(MyStrategy);
/// // pmb-sdk's re-export records its own version (20 §3 `sdkVersion`):
/// pmb_runtime::strategy_main!(MyStrategy, sdk_version = pmb_sdk::SDK_VERSION);
/// ```
#[macro_export]
macro_rules! strategy_main {
    ($strategy:ty) => {
        fn main() {
            $crate::main::<$strategy>()
        }
    };
    ($strategy:ty, sdk_version = $version:expr) => {
        fn main() {
            $crate::main_with::<$strategy>($crate::MainOptions {
                sdk_version: $version,
            })
        }
    };
}

/// Process options of [`main_with`].
#[derive(Clone, Copy, Debug)]
pub struct MainOptions {
    /// `pmb-sdk` version the strategy was built against (20 §3
    /// `sdkVersion`); `pmb-sdk`'s re-export passes its own version.
    pub sdk_version: &'static str,
}

impl Default for MainOptions {
    fn default() -> MainOptions {
        MainOptions {
            sdk_version: identity::UNKNOWN,
        }
    }
}

/// The entry point of a strategy binary: every subcommand of 20 for `T`.
pub fn main<T>() -> !
where
    T: Strategy,
    T::Params: StrategyParams,
{
    main_with::<T>(MainOptions::default())
}

/// [`main`] with explicit process options.
pub fn main_with<T>(opts: MainOptions) -> !
where
    T: Strategy,
    T::Params: StrategyParams,
{
    panic::install_hook();
    let args: Result<Vec<String>, _> = std::env::args_os()
        .skip(1)
        .map(std::ffi::OsString::into_string)
        .collect();
    let outcome = match args {
        Err(bad) => cli::error_for(
            &[],
            EngineError::invalid_input("args", format!("argument {bad:?} is not UTF-8")),
        ),
        Ok(args) => match log::level_from_env() {
            Err(e) => cli::error_for(&args, e),
            Ok(level) => {
                log::set_level(level);
                // TODO(integration): the pmb-engine simulator replaces
                // `UnwiredSimulator` (crossStreamNeeds).
                let backend = EngineBackend::new(UnwiredSimulator);
                let stdin = std::io::stdin();
                let mut lock = stdin.lock();
                cli::dispatch_caught::<T, _>(&args, &mut lock, &backend, opts.sdk_version)
            }
        },
    };
    emit(outcome)
}

/// Prints the document, the reason line, and exits (20 G1, G8, §4).
fn emit(o: cli::Outcome) -> ! {
    // G8: a one-shot command notices a closed stdout when it writes its
    // document (Rust ignores SIGPIPE, so the write fails with EPIPE).
    // D-PENDING: a closed stdout is not polled during a long `run`; the
    // shim's supervision (20 §6.3 S4) covers a parent that disappears.
    if let Err(e) = io::write_stdout_document(&o.document) {
        // EPIPE: the parent is gone; exit at once.
        log::reason_line(&format!("runtime: io: stdout closed: {e}"));
        std::process::exit(if o.exit_code == 0 { 1 } else { o.exit_code });
    }
    if let Some(r) = &o.reason {
        log::reason_line(r);
    }
    std::process::exit(o.exit_code)
}
