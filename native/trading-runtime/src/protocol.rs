//! Versioned coarse-operation protocol. No trading state crosses into Node.
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const VERSION: u32 = 1;
pub const MAX_REQUEST_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_INPUT_CONTAINER_DEPTH: usize = 124;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub protocol_version: u32,
    pub request_id: String,
    pub operation: String,
    pub input: Value,
}

impl Request {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.protocol_version != VERSION {
            return Err(ProtocolError::new(
                "unsupported_protocol",
                format!("Expected protocol version {VERSION}"),
                false,
            ));
        }
        if !valid_request_id(&self.request_id) {
            return Err(ProtocolError::invalid_request(
                "requestId must contain 1..128 UTF-8 bytes without control characters",
            ));
        }
        if self.operation.trim().is_empty()
            || self.operation.len() > 64
            || self.operation.chars().any(char::is_control)
        {
            return Err(ProtocolError::invalid_request("Invalid operation name"));
        }
        validate_input_depth(&self.input)?;
        Ok(())
    }
}

fn validate_input_depth(input: &Value) -> Result<(), ProtocolError> {
    let mut pending = vec![(input, 0_usize)];
    while let Some((value, parent_depth)) = pending.pop() {
        let depth = parent_depth + 1;
        match value {
            Value::Array(values) => {
                if depth > MAX_INPUT_CONTAINER_DEPTH {
                    return Err(ProtocolError::invalid_request(
                        "Input nesting exceeds protocol limit",
                    ));
                }
                pending.extend(values.iter().map(|value| (value, depth)));
            }
            Value::Object(fields) => {
                if depth > MAX_INPUT_CONTAINER_DEPTH {
                    return Err(ProtocolError::invalid_request(
                        "Input nesting exceeds protocol limit",
                    ));
                }
                pending.extend(fields.values().map(|value| (value, depth)));
            }
            _ => {}
        }
    }
    Ok(())
}

pub fn valid_request_id(id: &str) -> bool {
    !id.trim().is_empty() && id.len() <= 128 && !id.chars().any(char::is_control)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProtocolError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl ProtocolError {
    pub fn new(code: impl Into<String>, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable,
        }
    }

    pub fn invalid_request(message: impl Into<String>) -> Self {
        Self::new("invalid_request", message, false)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeIdentity {
    pub name: &'static str,
    pub version: &'static str,
    pub protocol_version: u32,
}

impl Default for RuntimeIdentity {
    fn default() -> Self {
        Self {
            name: "polymarket-runtime",
            version: env!("CARGO_PKG_VERSION"),
            protocol_version: VERSION,
        }
    }
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Success,
    Failed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub protocol_version: u32,
    pub request_id: Option<String>,
    pub status: Status,
    pub engine: RuntimeIdentity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ProtocolError>,
}

impl Response {
    pub fn success(request_id: String, result: Value) -> Self {
        Self {
            protocol_version: VERSION,
            request_id: Some(request_id),
            status: Status::Success,
            engine: RuntimeIdentity::default(),
            result: Some(result),
            error: None,
        }
    }

    pub fn failed(request_id: Option<String>, error: ProtocolError) -> Self {
        Self {
            protocol_version: VERSION,
            request_id,
            status: Status::Failed,
            engine: RuntimeIdentity::default(),
            result: None,
            error: Some(error),
        }
    }
}
