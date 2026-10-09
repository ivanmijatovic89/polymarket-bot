//! TS<->Rust contract: EngineJob, ModelConfig, EngineResult, closed
//! vocabularies, JSON Schema export (21-job-and-output-contract.md).
//!
//! No engine dependencies (21 §3). Every struct is closed
//! (`deny_unknown_fields`); every vocabulary is an exhaustive enum. Money in
//! jobs is an exact decimal string ([`num::Decimal`]); money in outputs is an
//! exact fixed-point JSON number ([`num::OutDec`]). Neither touches `f64`.

pub mod canonical;
pub mod job;
pub mod model_config;
pub mod num;
pub mod result;
pub mod rules;
pub mod schema;
pub mod support;
pub mod vocab;

pub use canonical::{canonical_json, canonical_json_escaped, CanonicalError};
pub use job::{EngineJob, JOB_SCHEMA_VERSION};
pub use model_config::{ModelConfig, MODEL_CONFIG_VERSION};
pub use num::{Decimal, FiniteF64, OutDec, OutDec2, OutDec4, OutDec6, SafeI64, SafeU64, Sha256Hex};
pub use result::{
    EngineMarketOutput, EngineMarketStats, EngineResult, ErrorInfo, OUTPUT_SCHEMA_VERSION,
};
pub use rules::MarketRules;
pub use support::{ContractError, Version};
