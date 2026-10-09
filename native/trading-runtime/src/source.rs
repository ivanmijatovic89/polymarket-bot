//! Source records share the strategy session graph. BigInt ordinals and clock
//! Numbers are authoritative slots; diagnostic strings/nulls are output only.
use crate::{
    market_json::{JsString, JsValue},
    metadata::{MetadataError, MetadataGraph, MetadataHandle, MetadataValue},
    record::{FieldId, RecordHandle, RecordSchema},
};
use num_bigint::BigInt;
use serde_json::Value;
use std::fmt;

pub static SOURCE_SCHEMA: RecordSchema = RecordSchema::new(
    "EngineSource",
    &[
        "kind",
        "attempt",
        "filePath",
        "ingestSeq",
        "frameIndex",
        "tsLocalMs",
    ],
);
pub const KIND: FieldId = SOURCE_SCHEMA.field(0);
pub const ATTEMPT: FieldId = SOURCE_SCHEMA.field(1);
pub const FILE_PATH: FieldId = SOURCE_SCHEMA.field(2);
pub const INGEST_SEQ: FieldId = SOURCE_SCHEMA.field(3);
pub const FRAME_INDEX: FieldId = SOURCE_SCHEMA.field(4);
pub const LOCAL_TIME_MS: FieldId = SOURCE_SCHEMA.field(5);

#[derive(Debug)]
pub enum SourceError {
    Metadata(MetadataError),
    InvalidDiagnostic(&'static str),
}
impl fmt::Display for SourceError {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Metadata(error) => error.fmt(out),
            Self::InvalidDiagnostic(message) => out.write_str(message),
        }
    }
}
impl std::error::Error for SourceError {}
impl From<MetadataError> for SourceError {
    fn from(error: MetadataError) -> Self {
        Self::Metadata(error)
    }
}

/// A rooted, mutable source identity. Clones retain the same source object.
/// Own data properties are implemented here; inherited properties, accessors
/// and descriptors remain a shared SDK acceptance requirement.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceHandle(RecordHandle);
impl SourceHandle {
    pub fn new_in_graph(
        graph: &MetadataGraph,
        properties: Vec<(JsString, MetadataValue)>,
    ) -> Result<Self, MetadataError> {
        graph.record(&SOURCE_SCHEMA, properties).map(Self)
    }
    pub fn from_record_in_graph(
        graph: &MetadataGraph,
        record: RecordHandle,
    ) -> Result<Self, MetadataError> {
        if !graph.owns(record.as_handle()) {
            return Err(MetadataError::WrongGraph);
        }
        if !std::ptr::eq(record.schema(), &SOURCE_SCHEMA) {
            return Err(MetadataError::WrongField);
        }
        Ok(Self(record))
    }
    pub fn record(&self) -> &RecordHandle {
        &self.0
    }
    pub fn live(
        graph: &MetadataGraph,
        attempt: f64,
        receipt: Option<(BigInt, f64)>,
    ) -> Result<Self, MetadataError> {
        let mut properties = vec![
            ("kind".into(), "live".into()),
            ("attempt".into(), attempt.into()),
        ];
        if let Some((sequence, local_time)) = receipt {
            properties.push(("ingestSeq".into(), MetadataValue::BigInt(sequence)));
            properties.push(("tsLocalMs".into(), local_time.into()));
        }
        Self::new_in_graph(graph, properties)
    }
    pub fn parquet(
        graph: &MetadataGraph,
        file_path: JsString,
        sequence: BigInt,
        local_time_ms: Option<f64>,
    ) -> Result<Self, MetadataError> {
        let mut properties = vec![
            ("kind".into(), "parquet".into()),
            ("filePath".into(), MetadataValue::String(file_path)),
            ("ingestSeq".into(), MetadataValue::BigInt(sequence)),
        ];
        if let Some(time) = local_time_ms {
            properties.push(("tsLocalMs".into(), time.into()));
        }
        Self::new_in_graph(graph, properties)
    }
    pub fn get(&self, field: FieldId) -> Result<MetadataValue, MetadataError> {
        self.0.get_field(field)
    }
    pub fn set(&self, field: FieldId, value: MetadataValue) -> Result<(), MetadataError> {
        self.0.set_field(field, value)
    }
    pub fn has(&self, field: FieldId) -> Result<bool, MetadataError> {
        self.0.has_field(field)
    }
    pub fn delete(&self, field: FieldId) -> Result<bool, MetadataError> {
        self.0.delete_field(field)
    }
    pub fn number(&self, field: FieldId) -> Result<Option<f64>, MetadataError> {
        self.0.number(field)
    }
    pub fn sequence(&self) -> Result<Option<BigInt>, MetadataError> {
        Ok(match self.get(INGEST_SEQ)? {
            MetadataValue::BigInt(value) => Some(value),
            _ => None,
        })
    }
    /// Implements the engine's source spread at child dispatch time. Nested
    /// references are shared; the original source record is never overwritten.
    pub fn for_frame_child(&self, index: usize, length: usize) -> Result<Self, MetadataError> {
        if length <= 1 || !self.has(INGEST_SEQ)? {
            return Ok(self.clone());
        }
        let handle = self.0.as_handle();
        let mut properties = Vec::new();
        for key in handle.keys()? {
            properties.push((key.clone(), handle.get(key)?));
        }
        let source = Self::new_in_graph(&handle.graph(), properties)?;
        source.set(FRAME_INDEX, MetadataValue::Number(index as f64))?;
        Ok(source)
    }

    /// Fixture-only import. BigInt decimal DTOs are converted once at ingress.
    /// Production readers construct slots directly with new_in_graph/parquet.
    pub fn from_diagnostic(graph: &MetadataGraph, value: Value) -> Result<Self, SourceError> {
        Self::from_diagnostic_js(graph, diagnostic_control_tree(value))
    }
    /// Lossless fixture import accepts UTF-16 keys/strings and nonfinite clocks.
    pub fn from_diagnostic_js(
        graph: &MetadataGraph,
        mut value: JsValue,
    ) -> Result<Self, SourceError> {
        let JsValue::Object(values) = &mut value else {
            return Err(SourceError::InvalidDiagnostic("source must be an object"));
        };
        let source = Self::new_in_graph(graph, Vec::new())?;
        let mut tasks = Vec::new();
        for (key, value) in std::mem::take(&mut values.values).into_iter().rev() {
            if key.matches("ingestSeq") {
                let Some(raw) = value.as_str() else {
                    return Err(SourceError::InvalidDiagnostic(
                        "ingestSeq must be a decimal string",
                    ));
                };
                let raw = raw.trim_matches(js_whitespace);
                let digits = raw
                    .strip_prefix('-')
                    .or_else(|| raw.strip_prefix('+'))
                    .unwrap_or(raw);
                if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
                    return Err(SourceError::InvalidDiagnostic(
                        "ingestSeq must be a decimal string",
                    ));
                }
                let sequence =
                    BigInt::parse_bytes(raw.strip_prefix('+').unwrap_or(raw).as_bytes(), 10)
                        .ok_or(SourceError::InvalidDiagnostic(
                            "ingestSeq must be a decimal string",
                        ))?;
                tasks.push((
                    source.0.as_handle().clone(),
                    key,
                    DiagnosticInput::Scalar(MetadataValue::BigInt(sequence)),
                ));
            } else {
                tasks.push((
                    source.0.as_handle().clone(),
                    key,
                    DiagnosticInput::Json(value),
                ));
            }
        }
        while let Some((parent, key, input)) = tasks.pop() {
            let value = match input {
                DiagnosticInput::Scalar(value) => value,
                DiagnosticInput::Json(mut value) => match &mut value {
                    JsValue::Null => MetadataValue::Null,
                    JsValue::Bool(value) => MetadataValue::Bool(*value),
                    JsValue::Number(value) => MetadataValue::Number(*value),
                    JsValue::String(value) => MetadataValue::String(value.clone()),
                    JsValue::Object(values) => {
                        let handle = graph.object()?;
                        for (key, value) in std::mem::take(&mut values.values).into_iter().rev() {
                            tasks.push((handle.clone(), key, DiagnosticInput::Json(value)));
                        }
                        MetadataValue::Reference(handle)
                    }
                    JsValue::Array(values) => {
                        let handle = graph.array()?;
                        handle.set_length(values.values.len() as u32)?;
                        for (index, value) in std::mem::take(&mut values.values)
                            .into_iter()
                            .enumerate()
                            .rev()
                        {
                            tasks.push((
                                handle.clone(),
                                index.to_string().into(),
                                DiagnosticInput::Json(value),
                            ));
                        }
                        MetadataValue::Reference(handle)
                    }
                },
            };
            if parent.is_array() {
                parent.set_index(
                    key.array_index().ok_or(MetadataError::InvalidArrayIndex)?,
                    value,
                )?;
            } else {
                parent.set(key, value)?;
            }
        }
        Ok(source)
    }
    /// Neutral diagnostic projection only. BigInts become decimal strings and
    /// nonfinite Numbers remain typed until the diagnostic JSON writer emits null.
    pub fn diagnostic_value(&self) -> Result<JsValue, MetadataError> {
        diagnostic_value(MetadataValue::Reference(self.0.as_handle().clone()))
    }
}
// Consume diagnostic control trees iteratively so deep source extensions do
// not add a Rust call-stack limit to the typed graph's acceptance domain.
fn diagnostic_control_tree(root: Value) -> JsValue {
    enum Task {
        Value(Value),
        Object(Vec<JsString>),
        Array(usize),
    }
    let mut tasks = vec![Task::Value(root)];
    let mut output = Vec::new();
    while let Some(task) = tasks.pop() {
        match task {
            Task::Value(value) => match value {
                Value::Null => output.push(JsValue::Null),
                Value::Bool(value) => output.push(JsValue::Bool(value)),
                Value::Number(value) => {
                    output.push(JsValue::Number(value.as_f64().expect("finite JSON Number")))
                }
                Value::String(value) => output.push(JsValue::String(value.into())),
                Value::Object(values) => {
                    let entries = values.into_iter().collect::<Vec<_>>();
                    tasks.push(Task::Object(
                        entries.iter().map(|(key, _)| key.clone().into()).collect(),
                    ));
                    tasks.extend(
                        entries
                            .into_iter()
                            .rev()
                            .map(|(_, value)| Task::Value(value)),
                    );
                }
                Value::Array(values) => {
                    tasks.push(Task::Array(values.len()));
                    tasks.extend(values.into_iter().rev().map(Task::Value));
                }
            },
            Task::Object(keys) => {
                let values = output.split_off(output.len() - keys.len());
                output.push(JsValue::object(keys.into_iter().zip(values).collect()));
            }
            Task::Array(count) => {
                let values = output.split_off(output.len() - count);
                output.push(JsValue::array(values));
            }
        }
    }
    output.pop().expect("one diagnostic root")
}

enum DiagnosticInput {
    Json(JsValue),
    Scalar(MetadataValue),
}
fn js_whitespace(character: char) -> bool {
    matches!(character, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' |
        '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

fn diagnostic_value(root: MetadataValue) -> Result<JsValue, MetadataError> {
    enum Task {
        Value(MetadataValue),
        Object(MetadataHandle, Vec<JsString>, usize),
        Array(MetadataHandle, usize),
    }
    let mut tasks = vec![Task::Value(root)];
    let mut output = Vec::new();
    let mut active = Vec::new();
    while let Some(task) = tasks.pop() {
        match task {
            Task::Value(value) => match value {
                MetadataValue::Missing | MetadataValue::Null => output.push(JsValue::Null),
                MetadataValue::Bool(value) => output.push(JsValue::Bool(value)),
                MetadataValue::Number(value) => output.push(JsValue::Number(value)),
                MetadataValue::BigInt(value) => {
                    output.push(JsValue::String(value.to_string().into()))
                }
                MetadataValue::String(value) => output.push(JsValue::String(value)),
                MetadataValue::Reference(handle) => {
                    if active.contains(&handle) {
                        return Err(MetadataError::CircularReference);
                    }
                    active.push(handle.clone());
                    if handle.is_array() {
                        let length = handle.length()? as usize;
                        tasks.push(Task::Array(handle.clone(), length));
                        for index in (0..length).rev() {
                            tasks.push(Task::Value(handle.get_index(index as u32)?));
                        }
                    } else {
                        let mut keys = Vec::new();
                        let mut values = Vec::new();
                        for key in handle.keys()? {
                            let value = handle.get(key.clone())?;
                            if !matches!(value, MetadataValue::Missing) {
                                keys.push(key);
                                values.push(value);
                            }
                        }
                        tasks.push(Task::Object(handle, keys, values.len()));
                        for value in values.into_iter().rev() {
                            tasks.push(Task::Value(value));
                        }
                    }
                }
            },
            Task::Object(handle, keys, count) => {
                let values = output.split_off(output.len() - count);
                output.push(JsValue::object(keys.into_iter().zip(values).collect()));
                debug_assert_eq!(active.pop(), Some(handle));
            }
            Task::Array(handle, count) => {
                let values = output.split_off(output.len() - count);
                output.push(JsValue::array(values));
                debug_assert_eq!(active.pop(), Some(handle));
            }
        }
    }
    Ok(output.pop().expect("one diagnostic root"))
}
