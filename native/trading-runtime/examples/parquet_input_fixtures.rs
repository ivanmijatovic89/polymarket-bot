use parquet::record::Field;
use polymarket_runtime::parquet_input::{column, MergedParquetInput, ReplayOrder};
use serde_json::{json, Value};
use std::io::Read;
use std::path::PathBuf;

fn text(value: Option<polymarket_runtime::parquet_input::ColumnValue<'_>>) -> Option<Vec<u16>> {
    use polymarket_runtime::market_json::JsValue;
    use polymarket_runtime::parquet_input::ColumnValue;
    match value {
        Some(ColumnValue::Physical(Field::Str(value))) => Some(value.encode_utf16().collect()),
        Some(ColumnValue::Json(JsValue::String(value))) => Some(value.units()),
        _ => None,
    }
}
fn number_bits(
    value: Option<polymarket_runtime::parquet_input::ColumnValue<'_>>,
) -> Option<String> {
    use polymarket_runtime::market_json::JsValue;
    use polymarket_runtime::parquet_decimal::DecimalValue;
    use polymarket_runtime::parquet_input::ColumnValue;
    let value = match value {
        Some(ColumnValue::Decimal(DecimalValue::Number(value))) => *value,
        Some(ColumnValue::Json(JsValue::Number(value))) => *value,
        Some(ColumnValue::Physical(Field::Double(value))) => *value,
        Some(ColumnValue::Physical(Field::Float(value))) => f64::from(*value),
        Some(ColumnValue::Physical(Field::Int(value) | Field::TimeMillis(value))) => {
            f64::from(*value)
        }
        Some(ColumnValue::Physical(Field::UInt(value))) => f64::from(*value as i32),
        _ => return None,
    };
    Some(format!("{:016x}", value.to_bits()))
}
fn buffer_hex(value: Option<polymarket_runtime::parquet_input::ColumnValue<'_>>) -> Option<String> {
    use polymarket_runtime::parquet_decimal::DecimalValue;
    use polymarket_runtime::parquet_input::ColumnValue;
    let bytes = match value {
        Some(ColumnValue::Decimal(DecimalValue::Buffer(value))) => value.as_slice(),
        Some(ColumnValue::Physical(Field::Bytes(value))) => value.data(),
        _ => return None,
    };
    Some(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn main() {
    let mut raw = String::new();
    std::io::stdin().read_to_string(&mut raw).unwrap();
    let request: Value = serde_json::from_str(&raw).unwrap();
    let mut results = Vec::new();
    for case in request["cases"].as_array().unwrap() {
        let paths = case["filePaths"]
            .as_array()
            .unwrap()
            .iter()
            .map(|path| PathBuf::from(path.as_str().unwrap()))
            .collect();
        let order = if case["order"] == "exchange_time" {
            ReplayOrder::ExchangeTime
        } else {
            ReplayOrder::Recorded
        };
        let mut rows = Vec::new();
        let result = (|| {
            let mut input = MergedParquetInput::open(paths, order)?;
            while let Some(row) = input.pop()? {
                // Demonstrate that a caller cannot advance admission accidentally
                // while holding the current frame's callback boundary.
                assert!(input.pop().is_err());
                rows.push(json!({"fileIndex":row.file_index,"rowIndex":row.row_index,
                    "ingestSeq":row.ingest_sequence.to_string(),"keyTs":row.ordering_timestamp.to_string(),
                    "localTimeMsBits":row.local_time_ms().map(|n|format!("{:016x}",n.to_bits())),
                    "ingestNumberBits":number_bits(column(&row.row,"ingest_seq")),
                    "localNumberBits":number_bits(column(&row.row,"ts_local_ms")),
                    "exchangeNumberBits":number_bits(column(&row.row,"ts_exchange_ms")),
                    "ingestBufferHex":buffer_hex(column(&row.row,"ingest_seq")),
                    "localBufferHex":buffer_hex(column(&row.row,"ts_local_ms")),
                    "exchangeBufferHex":buffer_hex(column(&row.row,"ts_exchange_ms")),
                    "rawJsonUtf16":text(column(&row.row,"raw_json")),"eventTypeUtf16":text(column(&row.row,"event_type"))}));
                input.advance()?;
            }
            Ok::<_, polymarket_runtime::parquet_input::InputError>(())
        })();
        results.push(match result {
            Ok(()) => json!({"name":case["name"],"rows":rows,"error":false}),
            Err(_) => json!({"name":case["name"],"rows":rows,"error":true}),
        });
    }
    println!("{}", json!({"results":results}));
}
