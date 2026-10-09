//! Historical inputs: the telonex-delta reader and its decoded tape (15-inputs.md).

pub mod error;
mod pq;
pub mod telonex;

pub use error::{ErrorClass, InputError};
pub use telonex::{
    read_telonex_delta, read_telonex_delta_with, InputCheck, TelonexDiagnostics, TelonexInput,
    TelonexTape,
};
