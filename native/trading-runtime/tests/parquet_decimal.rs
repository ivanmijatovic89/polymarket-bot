use parquet::basic::ConvertedType;
use parquet::basic::Type as PhysicalType;
use parquet::data_type::ByteArray;
use parquet::data_type::Decimal;
use parquet::record::Field;
use parquet::schema::types::ColumnDescriptor;
use parquet::schema::types::{ColumnPath, Type};
use polymarket_runtime::parquet_decimal::*;
use std::sync::Arc;
fn descriptor(physical: PhysicalType, precision: i32, scale: i32, width: i32) -> ColumnDescriptor {
    let primitive = Type::primitive_type_builder("x", physical)
        .with_converted_type(ConvertedType::DECIMAL)
        .with_precision(precision)
        .with_scale(scale)
        .with_length(width)
        .build()
        .unwrap();
    ColumnDescriptor::new(Arc::new(primitive), 0, 0, ColumnPath::new(vec!["x".into()]))
}
fn numeric(x: &[i64]) -> Vec<u8> {
    x.iter().flat_map(|x| x.to_le_bytes()).collect()
}
fn numbers(result: &PlainDecoded) -> Vec<f64> {
    result
        .values
        .iter()
        .map(|v| match v {
            DecimalValue::Number(x) => *x,
            _ => panic!(),
        })
        .collect()
}
#[test]
fn scalar_preserves_integer_round_then_scale() {
    for scale in 0..=18 {
        let d = descriptor(PhysicalType::INT64, 18, scale, -1);
        for value in [
            0,
            -1,
            1,
            9_007_199_254_740_991,
            9_007_199_254_740_993,
            i64::MIN,
            i64::MAX,
        ] {
            let field = Field::Decimal(Decimal::from_i64(value, 18, scale));
            assert_eq!(
                decode(&field, &d).unwrap().unwrap().to_bits(),
                ((value as f64)
                    / (format!("1{}", "0".repeat(scale as usize))
                        .parse::<f64>()
                        .unwrap()))
                .to_bits()
            );
        }
    }
    let d = descriptor(PhysicalType::INT32, 9, 2, -1);
    assert_eq!(
        decode(&Field::Decimal(Decimal::from_i32(-1234, 9, 2)), &d).unwrap(),
        Some(-12.34)
    );
}
#[test]
fn width_mismatch_uses_contiguous_halfwords() {
    let d = descriptor(PhysicalType::INT64, 4, 2, -1);
    assert!(decode(&Field::Decimal(Decimal::from_i64(1200, 4, 2)), &d)
        .unwrap_err()
        .contains("raw PLAIN"));
    let raw = numeric(&[1200, -1200, 12300]);
    let r = decode_plain(&raw, 3, &d, 0, Some(raw.len()), PlainLimits::default()).unwrap();
    assert_eq!(numbers(&r), vec![12., 0., -12.]);
    assert_eq!(r.offset, 12);
    let r = decode_plain(&raw, 6, &d, 0, Some(raw.len()), PlainLimits::default()).unwrap();
    assert_eq!(numbers(&r), vec![12., 0., -12., -0.01, 123., 0.]);
}
#[test]
fn cursor_guard_and_error_offsets_match_buffer_reads() {
    let d = descriptor(PhysicalType::INT64, 12, 2, -1);
    let raw = numeric(&[1200]);
    let r = decode_plain(&raw, 3, &d, 0, Some(8), PlainLimits::default()).unwrap();
    assert_eq!(numbers(&r), vec![12.]);
    assert_eq!(r.offset, 8);
    for size in [None, Some(0), Some(9)] {
        let e = decode_plain(&raw, 2, &d, 0, size, PlainLimits::default()).unwrap_err();
        assert_eq!((e.kind, e.offset), (PlainErrorKind::RangeError, 8));
    }
    let e = decode_plain(&raw[..7], 1, &d, 0, Some(7), PlainLimits::default()).unwrap_err();
    assert_eq!((e.kind, e.offset), (PlainErrorKind::RangeError, 0));
    assert!(
        decode_plain(&raw, 10, &d, 8, Some(8), PlainLimits::default())
            .unwrap()
            .values
            .is_empty()
    );
    let r = decode_plain(&raw, 1, &d, 0, Some(1), PlainLimits::default()).unwrap();
    assert_eq!(numbers(&r), vec![12.]);
}
#[test]
fn buffers_do_not_become_decimal_numbers_and_truncate_like_subarray() {
    let d = descriptor(PhysicalType::BYTE_ARRAY, 20, 2, -1);
    let field = Field::Decimal(Decimal::from_bytes(
        ByteArray::from(vec![0xff, 0xfe]),
        20,
        2,
    ));
    assert_eq!(decode(&field, &d).unwrap(), None);
    assert_eq!(
        decode_value(&field, &d).unwrap(),
        Some(DecimalValue::Buffer(vec![0xff, 0xfe]))
    );
    let raw = [5, 0, 0, 0, 0xaa, 0xbb];
    let r = decode_plain(&raw, 1, &d, 0, Some(1), PlainLimits::default()).unwrap();
    assert_eq!(r.values, vec![DecimalValue::Buffer(vec![0xaa, 0xbb])]);
    assert_eq!(r.offset, 9);
    let e = decode_plain(&raw, 2, &d, 0, Some(1), PlainLimits::default()).unwrap_err();
    assert_eq!(e.offset, 9);
    let fixed = descriptor(PhysicalType::FIXED_LEN_BYTE_ARRAY, 20, 2, 9);
    let r = decode_plain(&[1, 2], 3, &fixed, 0, Some(1), PlainLimits::default()).unwrap();
    assert_eq!(
        r.values,
        vec![
            DecimalValue::Buffer(vec![1, 2]),
            DecimalValue::Buffer(vec![]),
            DecimalValue::Buffer(vec![])
        ]
    );
    assert_eq!(r.offset, 27);
}
#[test]
fn initial_offsets_and_dictionary_payloads() {
    let d = descriptor(PhysicalType::INT64, 18, 0, -1);
    let mut raw = vec![0xab, 0xcd];
    raw.extend(numeric(&[i64::MAX, i64::MIN]));
    let r = decode_plain(&raw, 2, &d, 2, Some(raw.len()), PlainLimits::default()).unwrap();
    assert_eq!(numbers(&r), vec![i64::MAX as f64, i64::MIN as f64]);
    assert_eq!(r.offset, 18);
}
#[test]
fn null_wrong_field_and_explicit_resource_bounds() {
    let d = descriptor(PhysicalType::INT64, 18, 0, -1);
    assert_eq!(decode(&Field::Null, &d).unwrap(), None);
    assert!(decode(&Field::Long(12), &d).is_err());
    assert!(decode(&Field::Decimal(Decimal::from_i64(12, 18, 1)), &d).is_err());
    let limits = PlainLimits {
        max_values: 1,
        max_buffer_bytes: 1,
    };
    assert_eq!(
        decode_plain(&numeric(&[1, 2]), 2, &d, 0, None, limits)
            .unwrap_err()
            .kind,
        PlainErrorKind::ResourceBound
    );
    let fixed = descriptor(PhysicalType::FIXED_LEN_BYTE_ARRAY, 4, 0, 2);
    assert_eq!(
        decode_plain(&[1, 2], 1, &fixed, 0, None, limits)
            .unwrap_err()
            .kind,
        PlainErrorKind::ResourceBound
    );
    let ordinary = ColumnDescriptor::new(
        Arc::new(
            Type::primitive_type_builder("x", PhysicalType::INT64)
                .build()
                .unwrap(),
        ),
        0,
        0,
        ColumnPath::new(vec!["x".into()]),
    );
    assert_eq!(decode(&Field::Long(12), &ordinary).unwrap(), None);
}

#[test]
fn actual_footer_null_differs_from_manually_omitted_schema_length() {
    let d = descriptor(PhysicalType::BYTE_ARRAY, 4, 2, -1);
    let raw = [
        4, 0, 0, 0, 0xb0, 4, 0, 0, 4, 0, 0, 0, 0x50, 0xfb, 0xff, 0xff,
    ];
    let data = decode_plain(&raw, 2, &d, 0, Some(raw.len()), PlainLimits::default()).unwrap();
    assert_eq!(
        data.values,
        vec![
            DecimalValue::Buffer(vec![0xb0, 4, 0, 0]),
            DecimalValue::Buffer(vec![0x50, 0xfb, 0xff, 0xff])
        ]
    );
    let dictionary = decode_schema_plain(
        &raw,
        2,
        &d,
        SchemaTypeLength::Undefined,
        0,
        Some(raw.len()),
        PlainLimits::default(),
    )
    .unwrap();
    assert_eq!(numbers(&dictionary), vec![0.04, 12.0]);
    assert_eq!(dictionary.offset, 8);
    let error = decode_schema_plain(
        &[0xff],
        1,
        &d,
        SchemaTypeLength::Undefined,
        0,
        None,
        PlainLimits::default(),
    )
    .unwrap_err();
    assert_eq!((error.kind, error.offset), (PlainErrorKind::RangeError, 0));
    for count in [0, 1, 2] {
        let actual =
            decode_dictionary_plain(&raw, count, &d, 0, Some(raw.len()), PlainLimits::default())
                .unwrap_err();
        assert_eq!(actual.kind, PlainErrorKind::CodecError);
        assert_eq!(actual.offset, 0);
        assert_eq!(
            actual.message,
            "missing option: typeLength (required for FIXED_LEN_BYTE_ARRAY)"
        );
    }
    let fixed = descriptor(PhysicalType::FIXED_LEN_BYTE_ARRAY, 4, 2, 2);
    assert_eq!(
        decode_dictionary_plain(&raw[..4], 2, &fixed, 0, None, PlainLimits::default())
            .unwrap()
            .values,
        vec![
            DecimalValue::Buffer(vec![4, 0]),
            DecimalValue::Buffer(vec![0, 0])
        ]
    );
}

#[test]
fn raw_annotation_precision_is_independent_of_physical_validation() {
    let raw = RawDecimalDescriptor {
        physical_type: PhysicalType::INT64,
        precision: 20,
        scale: 2,
        type_length: None,
    };
    let bytes = numeric(&[1200, -1200]);
    let result = decode_raw_plain(
        &bytes,
        2,
        &raw,
        0,
        Some(bytes.len()),
        PlainLimits::default(),
    )
    .unwrap();
    assert_eq!(numbers(&result), vec![12., -12.]);
    let error =
        decode_raw_dictionary_plain(&[], 0, &raw, 7, None, PlainLimits::default()).unwrap_err();
    assert_eq!(error.kind, PlainErrorKind::CodecError);
    assert_eq!(error.offset, 7);
    assert_eq!(
        error.message,
        "missing option: typeLength (required for FIXED_LEN_BYTE_ARRAY)"
    );
}
#[test]
fn raw_scale_preserves_reference_pow_rounding_and_signed_zero_overflow() {
    let mut raw = RawDecimalDescriptor {
        physical_type: PhysicalType::INT64,
        precision: 309,
        scale: 23,
        type_length: None,
    };
    let plan = raw_plan(&raw).unwrap();
    let DecimalPlan::Number { divisor, .. } = plan else {
        panic!()
    };
    assert_eq!(divisor.to_bits(), 0x44b52d02c7e14af6);
    for scale in [309, 1000000, i32::MAX] {
        raw.precision = scale;
        raw.scale = scale;
        let bytes = numeric(&[-1, 0, 1]);
        let result = decode_raw_plain(
            &bytes,
            3,
            &raw,
            0,
            Some(bytes.len()),
            PlainLimits::default(),
        )
        .unwrap();
        let values = numbers(&result);
        assert_eq!(
            values.iter().map(|x| x.to_bits()).collect::<Vec<_>>(),
            vec![0x8000000000000000, 0, 0]
        );
    }
}

#[test]
fn raw_scale_218_preserves_target_reference_bit_pattern() {
    let raw = RawDecimalDescriptor {
        physical_type: PhysicalType::INT64,
        precision: 218,
        scale: 218,
        type_length: None,
    };
    let expected = match reference_power_profile() {
        Some("darwin-arm64") => (0x6d3221563a9b7323_u64, 0x12ac3d79c9b8fe2d_u64),
        Some("linux-x64") => (0x6d3221563a9b7322_u64, 0x12ac3d79c9b8fe2f_u64),
        _ => {
            assert!(raw_plan(&raw).is_err());
            return;
        }
    };
    let DecimalPlan::Number { divisor, .. } = raw_plan(&raw).unwrap() else {
        panic!()
    };
    assert_eq!(divisor.to_bits(), expected.0);
    let bytes = numeric(&[-1, 0, 1]);
    let result = decode_raw_plain(
        &bytes,
        3,
        &raw,
        0,
        Some(bytes.len()),
        PlainLimits::default(),
    )
    .unwrap();
    assert_eq!(
        numbers(&result)
            .iter()
            .map(|v| v.to_bits())
            .collect::<Vec<_>>(),
        vec![expected.1 | (1_u64 << 63), 0, expected.1]
    );
}

#[test]
fn every_power_matches_reviewed_same_version_target_capture() {
    let darwin: serde_json::Value = serde_json::from_str(include_str!(
        "../../../scripts/rust-migration/fixtures/decimal-pow10-darwin-arm64.json"
    ))
    .unwrap();
    let linux: serde_json::Value = serde_json::from_str(include_str!(
        "../../../scripts/rust-migration/fixtures/decimal-pow10-linux-x64.json"
    ))
    .unwrap();
    assert_eq!(darwin["versions"]["node"], "20.20.2");
    assert_eq!(darwin["versions"]["v8"], linux["versions"]["v8"]);
    assert_eq!(darwin["versions"]["node"], linux["versions"]["node"]);
    for capture in [&darwin, &linux] {
        assert_eq!(capture["coldEqualsHot"], true);
        assert_eq!(capture["cold"], capture["hot"]);
        assert_eq!(capture["cold"].as_array().unwrap().len(), 310);
    }
    assert_eq!(darwin["cold"][218], "6d3221563a9b7323");
    assert_eq!(linux["cold"][218], "6d3221563a9b7322");
    assert_eq!(
        (0..310)
            .filter(|i| darwin["cold"][*i] != linux["cold"][*i])
            .collect::<Vec<_>>(),
        vec![218]
    );
    let capture = match reference_power_profile() {
        Some("darwin-arm64") => darwin,
        Some("linux-x64") => linux,
        _ => return,
    };
    for scale in 0..310 {
        let raw = RawDecimalDescriptor {
            physical_type: PhysicalType::INT64,
            precision: scale.max(20),
            scale,
            type_length: None,
        };
        let DecimalPlan::Number { divisor, .. } = raw_plan(&raw).unwrap() else {
            panic!()
        };
        assert_eq!(
            format!("{:016x}", divisor.to_bits()),
            capture["cold"][scale as usize].as_str().unwrap(),
            "scale{scale}"
        );
    }
}
