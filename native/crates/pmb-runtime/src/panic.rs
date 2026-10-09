//! Panic capture at the runtime's catch boundaries (20 G7, 12 §11, 30 §12).
//!
//! Inside [`catch`] the hook records the message and location of the panic
//! on the current thread and suppresses the default stderr print; outside it
//! the previous hook runs unchanged (so test failures still print).

use std::any::Any;
use std::cell::{Cell, RefCell};
use std::panic::{self, AssertUnwindSafe};
use std::sync::Once;

/// A caught panic.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CaughtPanic {
    /// The panic message (payload text, or a typed payload's name).
    pub message: String,
    /// `file:line` of the panic, when known.
    pub location: Option<String>,
}

thread_local! {
    static DEPTH: Cell<u32> = const { Cell::new(0) };
    static LAST: RefCell<Option<CaughtPanic>> = const { RefCell::new(None) };
}

static INSTALL: Once = Once::new();

/// Installs the capturing hook once per process, chaining the previous one.
pub fn install_hook() {
    INSTALL.call_once(|| {
        let previous = panic::take_hook();
        panic::set_hook(Box::new(move |info| {
            if DEPTH.with(Cell::get) > 0 {
                let message = payload_text(info.payload());
                let location = info
                    .location()
                    .map(|l| format!("{}:{}", l.file(), l.line()));
                LAST.with(|c| *c.borrow_mut() = Some(CaughtPanic { message, location }));
            } else {
                previous(info);
            }
        }));
    });
}

/// Text of a panic payload. Fixed-point overflow panics carry a typed
/// `pmb_core::Overflow` payload (10 T3).
pub fn payload_text(p: &(dyn Any + Send)) -> String {
    if let Some(s) = p.downcast_ref::<&'static str>() {
        (*s).to_string()
    } else if let Some(s) = p.downcast_ref::<String>() {
        s.clone()
    } else if let Some(o) = p.downcast_ref::<pmb_core::Overflow>() {
        o.to_string()
    } else {
        "panic with a non-string payload".to_string()
    }
}

/// Runs `f` inside `catch_unwind`, capturing the panic message and location.
pub fn catch<R>(f: impl FnOnce() -> R) -> Result<R, CaughtPanic> {
    install_hook();
    DEPTH.with(|d| d.set(d.get() + 1));
    LAST.with(|c| *c.borrow_mut() = None);
    let r = panic::catch_unwind(AssertUnwindSafe(f));
    DEPTH.with(|d| d.set(d.get() - 1));
    r.map_err(|payload| {
        LAST.with(|c| c.borrow_mut().take())
            .unwrap_or_else(|| CaughtPanic {
                message: payload_text(payload.as_ref()),
                location: None,
            })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catches_message_and_location() {
        // spec: 30 §12 (hook records message and location, suppresses the print)
        let e = catch(|| -> u32 { panic!("boom {}", 7) }).unwrap_err();
        assert_eq!(e.message, "boom 7");
        assert!(e.location.unwrap().contains("panic.rs"));
        assert_eq!(catch(|| 5).unwrap(), 5);
    }

    #[test]
    fn nested_catch_and_overflow_payload() {
        let outer = catch(|| {
            let inner = catch(|| std::panic::panic_any(pmb_core::Overflow::Range));
            assert_eq!(inner.unwrap_err().message, "fixed-point overflow");
            1
        });
        assert_eq!(outer.unwrap(), 1);
    }
}
