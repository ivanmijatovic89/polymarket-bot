//! Historical inputs: the telonex-delta reader and its decoded tape (15-inputs.md).

pub mod error;
pub mod integrity;
mod pq;
pub mod telonex;

pub use error::{ErrorClass, InputError};
pub use integrity::{InputFile, InputFormat};
pub use telonex::{
    read_telonex_delta, EventBatch, TelonexDiagnostics, TelonexInput, TelonexMeta, TelonexReader,
    TelonexTape,
};
