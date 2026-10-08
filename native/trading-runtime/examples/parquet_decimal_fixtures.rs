//! Test-only decoder adapter. It does not execute a strategy or a replay.
use parquet::basic::{ConvertedType, Type as PhysicalType};
use parquet::schema::types::{ColumnDescriptor, ColumnPath, Type};
use polymarket_runtime::parquet_decimal::{
    decode_dictionary_plain, decode_plain, decode_raw_dictionary_plain, decode_raw_plain,
    decode_schema_plain, DecimalValue, PlainErrorKind, PlainLimits, RawDecimalDescriptor,
    SchemaTypeLength,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::Read;
use std::sync::Arc;

#[derive(Deserialize)]
struct Fixture {
    name: String,
    #[serde(default)]
    raw_descriptor: bool,
    #[serde(default)]
    dictionary: bool,
    #[serde(default)]
    schema_undefined: bool,
    physical: String,
    precision: i32,
    scale: i32,
    length: i32,
    bytes: String,
    count: usize,
    offset: usize,
    size: Option<usize>,
}
fn run(case: Fixture) -> Result<Value, Box<dyn std::error::Error>> {
    let physical = match case.physical.as_str() {
        "INT32" => PhysicalType::INT32,
        "INT64" => PhysicalType::INT64,
        "BYTE_ARRAY" => PhysicalType::BYTE_ARRAY,
        "FIXED_LEN_BYTE_ARRAY" => PhysicalType::FIXED_LEN_BYTE_ARRAY,
        _ => return Err("Invalid fixture physical type".into()),
    };
    let descriptor = if case.raw_descriptor {
        None
    } else {
        let primitive = Type::primitive_type_builder("x", physical)
            .with_converted_type(ConvertedType::DECIMAL)
            .with_precision(case.precision)
            .with_scale(case.scale)
            .with_length(case.length)
            .build()?;
        Some(ColumnDescriptor::new(
            Arc::new(primitive),
            0,
            0,
            ColumnPath::new(vec!["x".into()]),
        ))
    };
    let raw_descriptor = RawDecimalDescriptor {
        physical_type: physical,
        precision: case.precision,
        scale: case.scale,
        type_length: (case.length >= 0).then_some(case.length),
    };
    if case.bytes.len() % 2 != 0 || !case.bytes.is_ascii() {
        return Err("Invalid fixture hex".into());
    }
    let bytes = (0..case.bytes.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&case.bytes[index..index + 2], 16))
        .collect::<Result<Vec<_>, _>>()?;
    let decoded = if case.raw_descriptor {
        if case.dictionary {
            decode_raw_dictionary_plain(
                &bytes,
                case.count,
                &raw_descriptor,
                case.offset,
                case.size,
                PlainLimits::default(),
            )
        } else {
            decode_raw_plain(
                &bytes,
                case.count,
                &raw_descriptor,
                case.offset,
                case.size,
                PlainLimits::default(),
            )
        }
    } else if case.schema_undefined {
        decode_schema_plain(
            &bytes,
            case.count,
            descriptor.as_ref().unwrap(),
            SchemaTypeLength::Undefined,
            case.offset,
            case.size,
            PlainLimits::default(),
        )
    } else if case.dictionary {
        decode_dictionary_plain(
            &bytes,
            case.count,
            descriptor.as_ref().unwrap(),
            case.offset,
            case.size,
            PlainLimits::default(),
        )
    } else {
        decode_plain(
            &bytes,
            case.count,
            descriptor.as_ref().unwrap(),
            case.offset,
            case.size,
            PlainLimits::default(),
        )
    };
    Ok(match decoded {
        Ok(result) => {
            json!({"name":case.name,"offset":result.offset,"values":result.values.iter().map(|value|match value {
            DecimalValue::Number(x)=>json!({"kind":"Number","bits":format!("{:016x}",x.to_bits())}),
            DecimalValue::Buffer(bytes)=>json!({"kind":"Buffer","hex":bytes.iter().map(|x|format!("{x:02x}")).collect::<String>()}),
        }).collect::<Vec<_>>()})
        }
        Err(error) => json!({"name":case.name,"offset":error.offset,"error":match error.kind {
            PlainErrorKind::RangeError=>"RangeError",
            PlainErrorKind::CodecError=>"Error",
            PlainErrorKind::ResourceBound=>"ResourceBound",
            PlainErrorKind::InvalidDescriptor=>"InvalidDescriptor",
        }}),
    })
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let cases: Vec<Fixture> = serde_json::from_str(&input)?;
    let output = cases.into_iter().map(run).collect::<Result<Vec<_>, _>>()?;
    println!("{}", serde_json::to_string(&output)?);
    Ok(())
}
