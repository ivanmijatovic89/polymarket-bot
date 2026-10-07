use polymarket_runtime::{decode_and_execute, protocol::Status};
use serde_json::{json, Value};
use std::io::Write;
use std::process::{Command, Stdio};

fn envelope(operation: &str, input: Value) -> Value {
    json!({"protocolVersion":1,"requestId":"test-1","operation":operation,"input":input})
}

#[test]
fn describes_only_implemented_capabilities() {
    let response =
        decode_and_execute(&serde_json::to_vec(&envelope("describe_runtime", json!({}))).unwrap());
    assert_eq!(response.status, Status::Success);
    let result = response.result.unwrap();
    assert_eq!(
        result["operations"],
        json!(["describe_runtime", "aggregate"])
    );
    assert_eq!(result["strategies"], json!([]));
    assert_eq!(result["liveTrading"], false);
}

#[test]
fn malformed_and_unknown_envelopes_fail_without_advertising_success() {
    for bytes in [b"{bad".to_vec(), serde_json::to_vec(&json!({"protocolVersion":1,"requestId":"kept","operation":"describe_runtime","input":{},"extra":true})).unwrap()] {
        let response = decode_and_execute(&bytes);
        assert_eq!(response.status, Status::Failed);
        assert!(response.result.is_none());
        assert_eq!(response.error.unwrap().code, "invalid_request");
    }
    let response =
        decode_and_execute(&serde_json::to_vec(&envelope("replay_market", json!({}))).unwrap());
    assert_eq!(response.error.unwrap().code, "unsupported_operation");
}

#[test]
fn validates_versions_ids_and_operation_inputs() {
    let mut request = envelope("describe_runtime", json!({}));
    request["protocolVersion"] = json!(2);
    let response = decode_and_execute(&serde_json::to_vec(&request).unwrap());
    assert_eq!(response.request_id.as_deref(), Some("test-1"));
    assert_eq!(response.error.unwrap().code, "unsupported_protocol");
    request["protocolVersion"] = json!(1);
    for id in ["", "  ", "bad\nID"] {
        request["requestId"] = json!(id);
        let response = decode_and_execute(&serde_json::to_vec(&request).unwrap());
        assert!(response.request_id.is_none());
        assert_eq!(response.error.unwrap().code, "invalid_request");
    }
    let response = decode_and_execute(
        &serde_json::to_vec(&envelope("describe_runtime", json!({"unexpected":true}))).unwrap(),
    );
    assert_eq!(response.error.unwrap().code, "invalid_request");
}

#[test]
fn process_correlates_lines_and_recovers_after_bad_request() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_polymarket-runtime"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let requests = [
        envelope("describe_runtime", json!({})),
        envelope("not_implemented", json!({})),
        json!({"protocolVersion":1,"requestId":"last","operation":"describe_runtime","input":{}}),
    ];
    let mut stdin = child.stdin.take().unwrap();
    for request in requests {
        writeln!(stdin, "{request}").unwrap();
    }
    drop(stdin);
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let text = String::from_utf8(output.stdout).unwrap();
    let responses: Vec<Value> = text
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(responses.len(), 3);
    assert_eq!(responses[0]["status"], "success");
    assert_eq!(responses[1]["error"]["code"], "unsupported_operation");
    assert_eq!(responses[2]["requestId"], "last");
    assert_eq!(responses[2]["status"], "success");
}

#[test]
fn input_nesting_limit_is_correlated_and_deterministic() {
    for (containers, expected_code) in [(124, "unsupported_operation"), (125, "invalid_request")] {
        let mut input = json!(null);
        for _ in 0..containers {
            input = json!({"nested":input});
        }
        let response =
            decode_and_execute(&serde_json::to_vec(&envelope("unknown", input)).unwrap());
        assert_eq!(response.request_id.as_deref(), Some("test-1"));
        assert_eq!(response.error.unwrap().code, expected_code);
    }
}

#[test]
fn unicode_identifiers_follow_scalar_control_and_whitespace_rules() {
    for name in [" ", "\u{0085}", "bad\u{009f}name"] {
        let response = decode_and_execute(&serde_json::to_vec(&envelope(name, json!({}))).unwrap());
        assert_eq!(response.error.unwrap().code, "invalid_request");
    }
    let response =
        decode_and_execute(&serde_json::to_vec(&envelope("\u{feff}", json!({}))).unwrap());
    assert_eq!(response.error.unwrap().code, "unsupported_operation");
}
