//! Typed Telonex replay bodies. Paired books apply atomically before one
//! awaited callback; rows retain physical cursor order and stop precedes read.
//! This development interface still uses the typed market fixture engine;
//! production admission must use the authoritative shared SDK graph bridge.
use crate::{
    frame_cursor::{CursorStep, FrameCursor, FrameInput},
    js_async::js_await,
    market::{MarketEngine, MarketTick},
    market_json::{JsString, JsValue},
    math::js_number_string,
    metadata::MetadataGraph,
    parquet_decimal::DecimalValue,
    parquet_input::{column, integer_key, ColumnValue, InputError, ParquetInputData, ParquetRows},
    recorded_replay::ReplayError,
    source::SourceHandle,
};
use num_bigint::BigInt;
use num_traits::ToPrimitive;
use parquet::record::Field;
use std::{future::Future, path::Path, rc::Rc};

#[derive(Clone, Copy, Debug)]
pub enum TelonexMode {
    Paired,
    Delta,
}
/// Unlike the merged recorded input, opening a single cursor does not prime
/// its first row. Read failures occur only after the initial stop check.
pub trait TelonexInput {
    fn next_row(&mut self) -> Result<Option<ParquetInputData>, InputError>;
    fn close(&mut self) -> impl Future<Output = Result<(), InputError>>;
}
pub struct LocalTelonexInput {
    reader: Option<ParquetRows>,
}
impl LocalTelonexInput {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, InputError> {
        Ok(Self {
            reader: Some(ParquetRows::open(path.as_ref().to_path_buf())?),
        })
    }
}
impl TelonexInput for LocalTelonexInput {
    fn next_row(&mut self) -> Result<Option<ParquetInputData>, InputError> {
        self.reader
            .as_mut()
            .ok_or_else(|| InputError("Telonex reader is closed".into()))?
            .next_row()
    }
    async fn close(&mut self) -> Result<(), InputError> {
        self.reader.take();
        Ok(())
    }
}

pub async fn replay_telonex<I, E, Stop, Snapshot>(
    mut input: I,
    file_path: JsString,
    graph: &MetadataGraph,
    mode: TelonexMode,
    mut should_stop: Stop,
    mut on_snapshot: Snapshot,
) -> Result<(), ReplayError<E>>
where
    I: TelonexInput,
    Stop: FnMut() -> bool,
    Snapshot: AsyncFnMut(Rc<MarketTick>) -> Result<(), E>,
{
    let mut engine = MarketEngine::new(None, 10.0).map_err(ReplayError::Market)?;
    let result = async {
        loop {
            if should_stop() {
                return Ok(());
            }
            let Some(row) = js_await(async { input.next_row() })
                .await
                .map_err(ReplayError::Input)?
            else {
                return Ok(());
            };
            let messages = match mode {
                TelonexMode::Paired => paired_messages(&row),
                TelonexMode::Delta => delta_message(&row).map(|msg| msg.into_iter().collect()),
            }
            .map_err(ReplayError::Input)?;
            if messages.is_empty() {
                continue;
            }
            let zero = BigInt::from(0);
            let base_sequence = integer_key(column(&row, "ingest_seq"), &zero);
            let sequence = match mode {
                TelonexMode::Paired => base_sequence * 2 + 2,
                TelonexMode::Delta => base_sequence,
            };
            let clock = bigint_number(&integer_key(column(&row, "ts_local_ms"), &zero));
            let source = SourceHandle::parquet(
                graph,
                file_path.clone(),
                sequence,
                (clock > 0.0).then_some(clock),
            )
            .map_err(ReplayError::Metadata)?;
            let message = messages.last().expect("nonempty messages").clone();
            // Bootstrap suppresses MarketEngine's per-book callbacks. The
            // constructed changes already have empty hashes, so no hash
            // normalization or selected-message JSON round-trip occurs.
            let mut cursor = FrameCursor::new(FrameInput::decoded(messages, source.clone(), true))
                .map_err(ReplayError::Market)?;
            while let CursorStep::Tick(_) = cursor.next(&mut engine).map_err(ReplayError::Market)? {
            }
            let tick = Rc::new(MarketTick {
                source,
                msg: message,
                snapshot: engine.snapshot().map_err(ReplayError::Market)?,
            });
            js_await(on_snapshot(tick))
                .await
                .map_err(ReplayError::Callback)?;
        }
    }
    .await;
    // The reference finally waits for close but suppresses its rejection.
    // The original replay/callback failure must survive a close failure.
    let _ = js_await(input.close()).await;
    result
}

fn object(fields: impl IntoIterator<Item = (&'static str, JsValue)>) -> JsValue {
    JsValue::object(
        fields
            .into_iter()
            .map(|(key, value)| (key.into(), value))
            .collect(),
    )
}
fn text(value: Option<ColumnValue<'_>>) -> Option<JsString> {
    match value {
        Some(ColumnValue::Json(JsValue::String(value))) => Some(value.clone()),
        Some(ColumnValue::Physical(Field::Str(value))) => Some(value.as_str().into()),
        _ => None,
    }
}
fn whitespace(unit: u16) -> bool {
    matches!(unit, 0x0009..=0x000d | 0x0020 | 0x00a0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}
fn nonblank(value: &JsString) -> bool {
    value.units().iter().any(|unit| !whitespace(*unit))
}
fn encoded_levels(value: Option<ColumnValue<'_>>) -> JsValue {
    let Some(value) = text(value) else {
        return JsValue::array(Vec::new());
    };
    let units = value.units();
    JsValue::array(
        units
            .split(|unit| *unit == b';' as u16)
            .filter_map(|part| {
                let at = part.iter().position(|unit| *unit == b'@' as u16)?;
                if at == 0 || at + 1 == part.len() {
                    return None;
                }
                Some(object([
                    (
                        "price",
                        JsValue::String(JsString::from_units(part[..at].to_vec())),
                    ),
                    (
                        "size",
                        JsValue::String(JsString::from_units(part[at + 1..].to_vec())),
                    ),
                ]))
            })
            .collect(),
    )
}
fn paired_messages(row: &ParquetInputData) -> Result<Vec<JsValue>, InputError> {
    if !text(column(row, "event_type")).is_some_and(|value| value.matches("orderbook_pair")) {
        return Ok(Vec::new());
    }
    let Some(market) = text(column(row, "market")).filter(nonblank) else {
        return Ok(Vec::new());
    };
    let timestamp = integer_key(column(row, "ts_exchange_ms"), &BigInt::from(-1));
    if timestamp < BigInt::from(0) {
        return Ok(Vec::new());
    }
    let mut messages = Vec::new();
    for (asset, bids, asks) in [
        ("up_asset_id", "up_bids", "up_asks"),
        ("down_asset_id", "down_bids", "down_asks"),
    ] {
        let Some(asset) = text(column(row, asset)).filter(nonblank) else {
            return Ok(Vec::new());
        };
        messages.push(object([
            ("market", JsValue::String(market.clone())),
            ("asset_id", JsValue::String(asset)),
            ("bids", encoded_levels(column(row, bids))),
            ("asks", encoded_levels(column(row, asks))),
            ("timestamp", JsValue::String(timestamp.to_string().into())),
            ("event_type", JsValue::String("book".into())),
            ("hash", JsValue::String("".into())),
        ]));
    }
    Ok(messages)
}
fn repeated(value: Option<ColumnValue<'_>>) -> Vec<ColumnValue<'_>> {
    match value {
        Some(ColumnValue::Json(JsValue::Array(values))) => {
            values.iter().map(ColumnValue::Json).collect()
        }
        Some(ColumnValue::Physical(Field::ListInternal(values))) => values
            .elements()
            .iter()
            .map(ColumnValue::Physical)
            .collect(),
        _ => Vec::new(),
    }
}
fn bigint_number(value: &BigInt) -> f64 {
    value.to_f64().unwrap_or_else(|| {
        if value < &BigInt::from(0) {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        }
    })
}
/// Primitive coercion at the Parquet row boundary. These immutable data values
/// cannot contain native SDK functions/accessors. Callable SDK coercion belongs
/// to the shared graph; never use this helper on strategy-visible graph roots.
fn string_coercion(value: ColumnValue<'_>, array_member: bool) -> Result<JsString, InputError> {
    let value = match value {
        ColumnValue::Decimal(DecimalValue::Number(value)) => {
            return Ok(js_number_string(*value).into())
        }
        ColumnValue::Decimal(DecimalValue::Buffer(bytes)) => {
            return Ok(String::from_utf8_lossy(bytes).into_owned().into())
        }
        ColumnValue::Json(value) => match value {
            JsValue::Null => if array_member { "" } else { "null" }.into(),
            JsValue::Bool(value) => if *value { "true" } else { "false" }.into(),
            JsValue::Number(value) => js_number_string(*value).into(),
            JsValue::String(value) => value.clone(),
            JsValue::Array(values) => JsString::join(
                values
                    .iter()
                    .map(|value| string_coercion(ColumnValue::Json(value), true))
                    .collect::<Result<Vec<_>, _>>()?,
                ",",
            ),
            JsValue::Object(_) => {
                if value.get("toString").is_some() {
                    return Err(InputError(
                        "Cannot convert object to primitive value".into(),
                    ));
                }
                "[object Object]".into()
            }
        },
        ColumnValue::Physical(value) => match value {
            Field::Null => if array_member { "" } else { "undefined" }.into(),
            Field::Bool(value) => if *value { "true" } else { "false" }.into(),
            Field::Long(value) | Field::TimeMicros(value) => value.to_string().into(),
            Field::ULong(value) => (*value as i64).to_string().into(),
            Field::Byte(value) => js_number_string(*value as f64).into(),
            Field::Short(value) => js_number_string(*value as f64).into(),
            Field::Int(value) | Field::TimeMillis(value) => js_number_string(*value as f64).into(),
            Field::UInt(value) => js_number_string((*value as i32) as f64).into(),
            Field::UByte(value) => js_number_string(*value as f64).into(),
            Field::UShort(value) => js_number_string(*value as f64).into(),
            Field::Float(value) => js_number_string(*value as f64).into(),
            Field::Double(value) => js_number_string(*value).into(),
            Field::Str(value) => value.as_str().into(),
            Field::Bytes(value) => String::from_utf8_lossy(value.data()).into_owned().into(),
            Field::ListInternal(values) => JsString::join(
                values
                    .elements()
                    .iter()
                    .map(|value| string_coercion(ColumnValue::Physical(value), true))
                    .collect::<Result<Vec<_>, _>>()?,
                ",",
            ),
            Field::Group(_) => "[object Object]".into(),
            _ => {
                return Err(InputError(
                    "Telonex physical coercion requires complete row conversion".into(),
                ))
            }
        },
    };
    Ok(value)
}
fn buffer_string(value: ColumnValue<'_>) -> Option<JsString> {
    match value {
        ColumnValue::Decimal(DecimalValue::Buffer(bytes)) => {
            Some(String::from_utf8_lossy(bytes).into_owned().into())
        }
        ColumnValue::Physical(Field::Bytes(bytes)) => {
            Some(String::from_utf8_lossy(bytes.data()).into_owned().into())
        }
        _ => None,
    }
}
fn data_string(value: ColumnValue<'_>) -> Result<JsString, InputError> {
    if let Some(value) = buffer_string(value) {
        return Ok(value);
    }
    string_coercion(value, false)
}
fn number_string(value: &JsString) -> f64 {
    let Some(value) = value.as_str() else {
        return f64::NAN;
    };
    let value = value
        .trim_matches(|character| (character as u32) <= 0xffff && whitespace(character as u16));
    if value.is_empty() {
        return 0.0;
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0b", 2),
        ("0B", 2),
        ("0o", 8),
        ("0O", 8),
    ] {
        if let Some(digits) = value.strip_prefix(prefix) {
            if digits.is_empty() || !digits.chars().all(|character| character.is_digit(radix)) {
                return f64::NAN;
            }
            return BigInt::parse_bytes(digits.as_bytes(), radix)
                .map_or(f64::NAN, |value| bigint_number(&value));
        }
    }
    match value {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    // Rust also accepts inf and infinity; JavaScript Number does not.
    if value
        .bytes()
        .any(|byte| byte.is_ascii_alphabetic() && byte != b'e' && byte != b'E')
    {
        return f64::NAN;
    }
    value.parse().unwrap_or(f64::NAN)
}
fn number(value: Option<ColumnValue<'_>>) -> Result<f64, InputError> {
    Ok(match value {
        None => f64::NAN,
        Some(ColumnValue::Physical(Field::Null)) => 0.0,
        Some(ColumnValue::Json(JsValue::Null)) => 0.0,
        Some(ColumnValue::Json(JsValue::Bool(value)))
        | Some(ColumnValue::Physical(Field::Bool(value))) => {
            if *value {
                1.0
            } else {
                0.0
            }
        }
        Some(ColumnValue::Json(JsValue::Number(value)))
        | Some(ColumnValue::Decimal(DecimalValue::Number(value)))
        | Some(ColumnValue::Physical(Field::Double(value))) => *value,
        Some(ColumnValue::Physical(Field::Long(value) | Field::TimeMicros(value))) => *value as f64,
        Some(ColumnValue::Physical(Field::ULong(value))) => (*value as i64) as f64,
        Some(value) => number_string(&data_string(value)?),
    })
}
fn string_value(value: ColumnValue<'_>) -> Result<Option<JsString>, InputError> {
    let numeric = match value {
        ColumnValue::Json(JsValue::Number(value))
        | ColumnValue::Decimal(DecimalValue::Number(value))
        | ColumnValue::Physical(Field::Double(value)) => Some(*value),
        ColumnValue::Physical(Field::Float(value)) => Some(*value as f64),
        _ => None,
    };
    if numeric.is_some_and(|value| !value.is_finite()) {
        return Ok(None);
    }
    if matches!(
        value,
        ColumnValue::Json(JsValue::Null | JsValue::Bool(_))
            | ColumnValue::Physical(Field::Null | Field::Bool(_))
    ) {
        return Ok(None);
    }
    let string = data_string(value)?;
    // Empty primitive strings are valid; empty object/Buffer/array coercions
    // return null in stringValue and are omitted from a side/change.
    let object_value = matches!(
        value,
        ColumnValue::Json(JsValue::Array(_) | JsValue::Object(_))
            | ColumnValue::Decimal(DecimalValue::Buffer(_))
            | ColumnValue::Physical(Field::Bytes(_) | Field::Group(_) | Field::ListInternal(_))
    );
    Ok((!object_value || !string.is_empty()).then_some(string))
}
fn asset(row: &ParquetInputData, index: f64) -> Option<JsString> {
    let name = if index == 0.0 {
        "asset0_id"
    } else if index == 1.0 {
        "asset1_id"
    } else {
        return None;
    };
    text(column(row, name)).filter(nonblank)
}
fn book_side(
    prices: Option<ColumnValue<'_>>,
    sizes: Option<ColumnValue<'_>>,
) -> Result<JsValue, InputError> {
    let prices = repeated(prices);
    let sizes = repeated(sizes);
    let mut levels = Vec::new();
    for (price, size) in prices.into_iter().zip(sizes) {
        if let (Some(price), Some(size)) = (string_value(price)?, string_value(size)?) {
            levels.push(object([
                ("price", JsValue::String(price)),
                ("size", JsValue::String(size)),
            ]));
        }
    }
    Ok(JsValue::array(levels))
}
fn delta_message(row: &ParquetInputData) -> Result<Option<JsValue>, InputError> {
    let Some(market) = text(column(row, "market")).filter(nonblank) else {
        return Ok(None);
    };
    let timestamp = integer_key(column(row, "ts_exchange_ms"), &BigInt::from(-1));
    if timestamp < BigInt::from(0) {
        return Ok(None);
    }
    let Some(event) = text(column(row, "event_type")) else {
        return Ok(None);
    };
    if event.matches("book") {
        let index = number(column(row, "asset_index"))?;
        let Some(asset) = asset(row, index) else {
            return Ok(None);
        };
        return Ok(Some(object([
            ("event_type", JsValue::String("book".into())),
            ("market", JsValue::String(market)),
            ("asset_id", JsValue::String(asset)),
            (
                "bids",
                book_side(column(row, "bid_prices"), column(row, "bid_sizes"))?,
            ),
            (
                "asks",
                book_side(column(row, "ask_prices"), column(row, "ask_sizes"))?,
            ),
            ("timestamp", JsValue::String(timestamp.to_string().into())),
            ("hash", JsValue::String("".into())),
        ])));
    }
    if !event.matches("price_change") {
        return Ok(None);
    }
    let indexes = repeated(column(row, "change_asset_indexes"));
    let sides = repeated(column(row, "change_side_codes"));
    let prices = repeated(column(row, "change_prices"));
    let sizes = repeated(column(row, "change_sizes"));
    let mut changes = Vec::new();
    for (((index, side), price), size) in indexes.into_iter().zip(sides).zip(prices).zip(sizes) {
        let asset = asset(row, number(Some(index))?);
        let side = match number(Some(side))? {
            0.0 => Some("BUY"),
            1.0 => Some("SELL"),
            _ => None,
        };
        let price = string_value(price)?;
        let size = string_value(size)?;
        if let (Some(asset), Some(side), Some(price), Some(size)) = (asset, side, price, size) {
            changes.push(object([
                ("asset_id", JsValue::String(asset)),
                ("side", JsValue::String(side.into())),
                ("price", JsValue::String(price)),
                ("size", JsValue::String(size)),
                ("hash", JsValue::String("".into())),
                ("best_bid", JsValue::String("".into())),
                ("best_ask", JsValue::String("".into())),
            ]));
        }
    }
    if changes.is_empty() {
        return Ok(None);
    }
    Ok(Some(object([
        ("event_type", JsValue::String("price_change".into())),
        ("market", JsValue::String(market)),
        ("price_changes", JsValue::array(changes)),
        ("timestamp", JsValue::String(timestamp.to_string().into())),
    ])))
}
