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
