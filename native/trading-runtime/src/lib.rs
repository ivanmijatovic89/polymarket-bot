//! Shared entry points for the standalone native trading runtime.
pub mod cancellation;
pub mod event_dispatch;
pub mod frame_cursor;
pub mod intent;
pub mod js_async;
pub mod market;
pub mod market_json;
pub mod math;
pub mod metadata;
pub mod metrics;
pub mod order_manager;
pub mod parquet_decimal;
pub mod parquet_decimal_column;
pub mod parquet_input;
pub mod plugin_set;
pub mod portfolio;
pub mod portfolio_records;
pub mod protocol;
pub mod record;
pub mod recorded_replay;
pub mod risk;
pub mod runner;
pub mod runner_bindings;
pub mod sdk_context;
pub mod sdk_intrinsics;
pub mod sdk_snapshot;
pub mod sdk_value;
pub mod source;
pub mod stats;
pub mod telonex_replay;

use protocol::{ProtocolError, Request, Response};
use serde_json::{json, Value};

pub fn execute(request: Request) -> Response {
    if let Err(error) = request.validate() {
        let id = protocol::valid_request_id(&request.request_id).then_some(request.request_id);
        return Response::failed(id, error);
    }
    let result = match request.operation.as_str() {
        "describe_runtime" => describe(&request.input),
        "aggregate" => stats::aggregate(&request.input),
        _ => Err(ProtocolError::new(
            "unsupported_operation",
            "Operation is not implemented by this executable",
            false,
        )),
    };
    match result {
        Ok(result) => Response::success(request.request_id, result),
        Err(error) => Response::failed(Some(request.request_id), error),
    }
}

fn describe(input: &Value) -> Result<Value, ProtocolError> {
    if !input.as_object().is_some_and(|fields| fields.is_empty()) {
        return Err(ProtocolError::invalid_request(
            "describe_runtime input must be an empty object",
        ));
    }
    Ok(json!({
        "operations": ["describe_runtime", "aggregate"],
        "inputModes": [],
        "strategies": [],
        "liveTrading": false,
        "maxRequestBytes": protocol::MAX_REQUEST_BYTES,
        "maxInputContainerDepth": protocol::MAX_INPUT_CONTAINER_DEPTH,
        "platform": {"os": std::env::consts::OS, "arch": std::env::consts::ARCH}
    }))
}

pub fn decode_and_execute(bytes: &[u8]) -> Response {
    match serde_json::from_slice::<Request>(bytes) {
        Ok(request) => execute(request),
        Err(_) => {
            let id = serde_json::from_slice::<Value>(bytes)
                .ok()
                .and_then(|value| {
                    value
                        .get("requestId")
                        .and_then(Value::as_str)
                        .filter(|id| protocol::valid_request_id(id))
                        .map(str::to_owned)
                });
            Response::failed(
                id,
                ProtocolError::invalid_request("Invalid request JSON or request envelope"),
            )
        }
    }
}
