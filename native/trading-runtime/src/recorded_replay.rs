//! Recorded WS replay body: ordered pop, timing, filtering, the selected-frame
//! JSON boundary, sequential awaited ticks, then refill. Local Parquet admission
//! uses the existing reader; remote opening and complete row-type conversion
//! remain required before advertising this input mode to production clients.
use crate::{
    frame_cursor::{CursorStep, FrameCursor, FrameInput},
    js_async::js_await,
    market::{decode_frame, MarketEngine, MarketError, MarketTick},
    market_json::{JsString, JsValue},
    metadata::{MetadataError, MetadataGraph},
    parquet_decimal::DecimalValue,
    parquet_input::{column, ColumnValue, InputError, MergedParquetInput, ReplayInputRow},
    source::SourceHandle,
};
use num_bigint::BigInt;
use num_traits::ToPrimitive;
use parquet::record::Field;
use std::rc::Rc;

#[derive(Debug)]
pub enum ReplayError<E> {
    Input(InputError),
    Market(MarketError),
    Metadata(MetadataError),
    Callback(E),
}
/// The input owns file handles. Drop closes local files on success, stop or
/// failure. pop/advance separation prevents prefetch across callback boundaries.
pub trait RecordedInput {
    fn pop(&mut self) -> Result<Option<ReplayInputRow>, InputError>;
    fn advance(&mut self) -> Result<(), InputError>;
}
impl RecordedInput for MergedParquetInput {
    fn pop(&mut self) -> Result<Option<ReplayInputRow>, InputError> {
        MergedParquetInput::pop(self)
    }
    fn advance(&mut self) -> Result<(), InputError> {
        MergedParquetInput::advance(self)
    }
}

/// The body owns its market engine. Callback errors are returned unchanged;
/// their SDK object identity may be retained in E by the native session owner.
pub async fn replay_recorded<I, E, Stop, Sleep, Snapshot>(
    mut input: I,
    graph: &MetadataGraph,
    time_driven: bool,
    mut should_stop: Stop,
    mut sleep: Sleep,
    mut on_snapshot: Snapshot,
) -> Result<(), ReplayError<E>>
where
    I: RecordedInput,
    Stop: FnMut() -> bool,
    Sleep: AsyncFnMut(u64),
    Snapshot: AsyncFnMut(Rc<MarketTick>, JsString) -> Result<(), E>,
{
    let mut engine = MarketEngine::new(None, 10.0).map_err(ReplayError::Market)?;
    let mut active_market: Option<JsValue> = None;
    let mut previous_time: Option<BigInt> = None;
    loop {
        if should_stop() {
            return Ok(());
        }
        let Some(item) = input.pop().map_err(ReplayError::Input)? else {
            return Ok(());
        };
        if time_driven {
            if let Some(previous) = &previous_time {
                if &item.ordering_timestamp >= previous {
                    let delta = &item.ordering_timestamp - previous;
                    let milliseconds = delta.min(BigInt::from(10_000)).to_u64().unwrap();
                    // Includes zero delays, as does the reference sleep(0).
                    sleep(milliseconds).await;
                }
            }
            previous_time = Some(item.ordering_timestamp.clone());
        }
        let event_type = string_column(column(&item.row, "event_type"));
        // This conversion is before the fast-path skip in the reference.
        let raw_json =
            raw_json_column(column(&item.row, "raw_json")).map_err(ReplayError::Input)?;
        let local_time = item.local_time_ms();
        let skip = event_type.as_ref().is_some_and(|event| {
            !event.is_empty()
                && ![
                    "book",
                    "price_change",
                    "tick_size_change",
                    "last_trade_price",
                ]
                .iter()
                .any(|allowed| event.matches(allowed))
        });
        if !skip {
            let source = SourceHandle::parquet(
                graph,
                item.file_path
                    .to_str()
                    .ok_or_else(|| {
                        ReplayError::Input(InputError(
                            "file path requires lossless UTF-8 ingress".into(),
                        ))
                    })?
                    .into(),
                item.ingest_sequence,
                local_time,
            )
            .map_err(ReplayError::Metadata)?;
            let messages = decode_original_frame(&raw_json);
            if active_market.as_ref().is_none_or(JsValue::is_null) {
                active_market = messages
                    .first()
                    .and_then(|message| message.get("market"))
                    .cloned();
            }
            let selected = messages
                .into_iter()
                .filter(|message| {
                    strict_optional_equal(message.get("market"), active_market.as_ref())
                })
                .collect::<Vec<_>>();
            if !selected.is_empty() {
                // Do not dispatch the first decoded values directly. This
                // round-trip creates fresh identities, emits nonfinite as null
                // and normalizes negative zero before the shared engine.
                let selected_json = JsValue::array(selected).to_json_string();
                let frame_result = js_await(async {
                    let mut frame = FrameCursor::new(FrameInput::raw(selected_json, source, false))
                        .map_err(ReplayError::Market)?;
                    while let CursorStep::Tick(tick) =
                        frame.next(&mut engine).map_err(ReplayError::Market)?
                    {
                        let callback_result = js_await(on_snapshot(tick, raw_json.clone())).await;
                        // The TS onTick wrapper is always async. Even a ready
                        // callback yields before the next child is applied.
                        callback_result.map_err(ReplayError::Callback)?;
                    }
                    Ok(())
                })
                .await;
                // handleRaw returns a Promise even for metadata-only frames
                // and synchronous application failures. Refill follows await.
                frame_result?;
            }
        }
        input.advance().map_err(ReplayError::Input)?;
    }
}

fn strict_optional_equal(left: Option<&JsValue>, right: Option<&JsValue>) -> bool {
    match (left, right) {
        (None, None) => true,
        (Some(JsValue::Array(_) | JsValue::Object(_)), Some(right)) => {
            left.unwrap().same_identity(right)
        }
        (Some(left), Some(right)) => left == right,
        _ => false,
    }
}
fn string_column(value: Option<ColumnValue<'_>>) -> Option<JsString> {
    match value {
        Some(ColumnValue::Json(JsValue::String(text))) => Some(text.clone()),
        Some(ColumnValue::Physical(Field::Str(text))) => Some(text.as_str().into()),
        _ => None,
    }
}
fn buffer_json(bytes: &[u8]) -> JsString {
    JsValue::object(vec![
        ("type".into(), JsValue::String("Buffer".into())),
        (
            "data".into(),
            JsValue::array(
                bytes
                    .iter()
                    .map(|byte| JsValue::Number(*byte as f64))
                    .collect(),
            ),
        ),
    ])
    .to_json_string()
    .into()
}
fn raw_json_column(value: Option<ColumnValue<'_>>) -> Result<JsString, InputError> {
    if let Some(text) = string_column(value) {
        return Ok(text);
    }
    let value = match value {
        None | Some(ColumnValue::Physical(Field::Null)) => JsValue::Null,
        Some(ColumnValue::Json(value)) => value.clone(),
        Some(ColumnValue::Decimal(DecimalValue::Number(value))) => JsValue::Number(*value),
        Some(ColumnValue::Decimal(DecimalValue::Buffer(value))) => return Ok(buffer_json(value)),
        Some(ColumnValue::Physical(value)) => match value {
            Field::Bool(value) => JsValue::Bool(*value),
            Field::Byte(value) => JsValue::Number(*value as f64),
            Field::Short(value) => JsValue::Number(*value as f64),
            Field::Int(value) | Field::TimeMillis(value) => JsValue::Number(*value as f64),
            Field::UInt(value) => JsValue::Number((*value as i32) as f64),
            Field::UByte(value) => JsValue::Number(*value as f64),
            Field::UShort(value) => JsValue::Number(*value as f64),
            Field::Float(value) => JsValue::Number(*value as f64),
            Field::Double(value) => JsValue::Number(*value),
            Field::Long(_) | Field::ULong(_) | Field::TimeMicros(_) => {
                return Err(InputError("Do not know how to serialize a BigInt".into()));
            }
            Field::Bytes(value) => return Ok(buffer_json(value.data())),
            _ => {
                return Err(InputError(
                    "Native raw_json row conversion is not implemented for this physical type"
                        .into(),
                ))
            }
        },
    };
    Ok(value.to_json_string().into())
}

/// A logical JSON string can contain literal lone UTF-16 code units in its
/// frame text. Escape only those units inside a JSON string; preserve invalid
/// escapes/outside-string units as parse failure. The callback retains the
/// original string, including its code units.
fn decode_original_frame(raw: &JsString) -> Vec<JsValue> {
    if let Some(text) = raw.as_str() {
        return decode_frame(text);
    }
    let mut text = String::new();
    let mut quoted = false;
    let mut escaped = false;
    for character in std::char::decode_utf16(raw.units()) {
        match character {
            Ok(character) => {
                text.push(character);
                if escaped {
                    escaped = false;
                } else if quoted && character == '\\' {
                    escaped = true;
                } else if character == '"' {
                    quoted = !quoted;
                }
            }
            Err(error) if quoted && !escaped => {
                text.push_str(&format!("\\u{:04x}", error.unpaired_surrogate()));
            }
            Err(_) => return Vec::new(),
        }
    }
    decode_frame(&text)
}
