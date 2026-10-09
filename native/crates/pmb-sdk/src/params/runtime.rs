//! The bridge from the `Params` derive to the runtime's params seam
//! (`pmb_runtime::StrategyParams`, 30 §9, 20 §5.1). `#[derive(Params)]`
//! implements `StrategyParams` through these functions.
//!
//! The runtime hands over a decoded `serde_json` object. Its numbers were
//! decoded through `f64`; they are re-serialized with the shortest
//! round-trip form, which gives back the decimal text of every value with
//! at most 15 significant digits, so every 6-dp fixed-point value of the
//! normalized params (10 §2 T6) passes unchanged.
// D-PENDING: the runtime seam takes `&Map<String, Value>` (decoded through
// f64) instead of the params text; chose the shortest round-trip
// re-serialization above. A value with more than 15 significant digits can
// change its last digit before parsing; a text-based seam needs a runtime
// change (crossStreamNeeds).

use super::Params;
use crate::json::Value;
use pmb_runtime::params::ParamError as RuntimeParamError;
use serde_json::Map;

/// `StrategyParams::from_json` of a derived params struct.
pub fn runtime_from_json<T: Params>(obj: &Map<String, Value>) -> Result<T, Vec<RuntimeParamError>> {
    let text = match serde_json::to_string(obj) {
        Ok(t) => t,
        Err(e) => return Err(vec![RuntimeParamError::new("", format!("params: {e}"))]),
    };
    T::from_json_str(&text).map_err(|e| {
        e.issues()
            .iter()
            .map(|i| RuntimeParamError::new(i.path(), i.message()))
            .collect()
    })
}

/// `StrategyParams::to_normalized` of a derived params struct (30 §9
/// rule 6): the normalized JSON text as an object.
pub fn runtime_normalized<T: Params>(v: &T) -> Map<String, Value> {
    match serde_json::from_str::<Value>(&v.normalized_json()) {
        Ok(Value::Object(m)) => m,
        other => unreachable!("normalized params are a JSON object: {other:?}"),
    }
}
