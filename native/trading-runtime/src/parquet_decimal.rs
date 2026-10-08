//! Compatibility decoder for @dsnp/parquetjs 1.8.7 DECIMAL PLAIN values.
//! Numeric width is selected by precision, even when it differs from physical width.
//! The actual page/dictionary bytes are necessary in that case; a materialized row
//! cannot reconstruct the library's cross-row halfword behavior.
use parquet::basic::{ConvertedType, Type as PhysicalType};
use parquet::data_type::Decimal;
use parquet::record::Field;
use parquet::schema::types::ColumnDescriptor;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum DecimalPlan {
    Number {
        physical_width: usize,
        value_width: usize,
        divisor: f64,
    },
    ByteArray,
    FixedArray {
        width: usize,
    },
}
#[derive(Clone, Debug, PartialEq)]
pub enum DecimalValue {
    Number(f64),
    Buffer(Vec<u8>),
}
#[derive(Clone, Copy, Debug)]
pub struct PlainLimits {
    pub max_values: usize,
    pub max_buffer_bytes: usize,
}
impl Default for PlainLimits {
    fn default() -> Self {
        Self {
            max_values: 1_000_000,
            max_buffer_bytes: 64 * 1024 * 1024,
        }
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct PlainDecoded {
    pub values: Vec<DecimalValue>,
    pub offset: usize,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlainErrorKind {
    RangeError,
    CodecError,
    InvalidDescriptor,
    ResourceBound,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlainError {
    pub kind: PlainErrorKind,
    pub offset: usize,
    pub message: String,
}

// Each power is exactly representable as binary64 in the valid numeric DECIMAL
// descriptor domain. Keep integer->binary64 conversion before this division.
const POW10: [f64; 19] = [
    1.,
    10.,
    100.,
    1_000.,
    10_000.,
    100_000.,
    1_000_000.,
    10_000_000.,
    100_000_000.,
    1_000_000_000.,
    10_000_000_000.,
    100_000_000_000.,
    1_000_000_000_000.,
    10_000_000_000_000.,
    100_000_000_000_000.,
    1_000_000_000_000_000.,
    10_000_000_000_000_000.,
    100_000_000_000_000_000.,
    1_000_000_000_000_000_000.,
];

/// Actual raw-footer DECIMAL annotation. Physical Parquet schema validation
/// must not reject annotation combinations accepted by the pinned reader.
#[derive(Clone, Copy, Debug)]
pub struct RawDecimalDescriptor {
    pub physical_type: PhysicalType,
    pub precision: i32,
    pub scale: i32,
    pub type_length: Option<i32>,
}

// Generated from Node v20.19.6 Math.pow(10, integer_scale), not native powi.
// The differential oracle independently calls the pinned installed JS codec
// for every scale; this table is bound with the compiled source fingerprints.
const JS_POW10_BITS: [u64; 309] = [
    0x3ff0000000000000,
    0x4024000000000000,
    0x4059000000000000,
    0x408f400000000000,
    0x40c3880000000000,
    0x40f86a0000000000,
    0x412e848000000000,
    0x416312d000000000,
    0x4197d78400000000,
    0x41cdcd6500000000,
    0x4202a05f20000000,
    0x42374876e8000000,
    0x426d1a94a2000000,
    0x42a2309ce5400000,
    0x42d6bcc41e900000,
    0x430c6bf526340000,
    0x4341c37937e08000,
    0x4376345785d8a000,
    0x43abc16d674ec800,
    0x43e158e460913d00,
    0x4415af1d78b58c40,
    0x444b1ae4d6e2ef50,
    0x4480f0cf064dd592,
    0x44b52d02c7e14af6,
    0x44ea784379d99db4,
    0x45208b2a2c280291,
    0x4554adf4b7320334,
    0x4589d971e4fe8402,
    0x45c027e72f1f1281,
    0x45f431e0fae6d722,
    0x46293e5939a08cea,
    0x465f8def8808b024,
    0x4693b8b5b5056e17,
    0x46c8a6e32246c99c,
    0x46fed09bead87c04,
    0x4733426172c74d82,
    0x476812f9cf7920e2,
    0x479e17b84357691b,
    0x47d2ced32a16a1b1,
    0x48078287f49c4a1e,
    0x483d6329f1c35ca5,
    0x48725dfa371a19e7,
    0x48a6f578c4e0a060,
    0x48dcb2d6f618c879,
    0x4911efc659cf7d4c,
    0x49466bb7f0435c9e,
    0x497c06a5ec5433c6,
    0x49b18427b3b4a05c,
    0x49e5e531a0a1c873,
    0x4a1b5e7e08ca3a90,
    0x4a511b0ec57e649a,
    0x4a8561d276ddfdc0,
    0x4ababa4714957d30,
    0x4af0b46c6cdd6e3e,
    0x4b24e1878814c9ce,
    0x4b5a19e96a19fc41,
    0x4b905031e2503da9,
    0x4bc4643e5ae44d13,
    0x4bf97d4df19d6058,
    0x4c2fdca16e04b86d,
    0x4c63e9e4e4c2f344,
    0x4c98e45e1df3b016,
    0x4ccf1d75a5709c1b,
    0x4d03726987666191,
    0x4d384f03e93ff9f5,
    0x4d6e62c4e38ff872,
    0x4da2fdbb0e39fb47,
    0x4dd7bd29d1c87a19,
    0x4e0dac74463a989f,
    0x4e428bc8abe49f64,
    0x4e772ebad6ddc73c,
    0x4eacfa698c95390c,
    0x4ee21c81f7dd43a7,
    0x4f16a3a275d49491,
    0x4f4c4c8b1349b9b5,
    0x4f81afd6ec0e1411,
    0x4fb61bcca7119916,
    0x4feba2bfd0d5ff5b,
    0x502145b7e285bf99,
    0x50559725db272f7f,
    0x508afcef51f0fb5f,
    0x50c0de1593369d1b,
    0x50f5159af8044462,
    0x512a5b01b605557b,
    0x516078e111c3556d,
    0x5194971956342ac8,
    0x51c9bcdfabc1357a,
    0x5200160bcb58c16c,
    0x52341b8ebe2ef1c7,
    0x526922726dbaae39,
    0x529f6b0f092959c7,
    0x52d3a2e965b9d81d,
    0x53088ba3bf284e24,
    0x533eae8caef261ad,
    0x53732d17ed577d0c,
    0x53a7f85de8ad5c4e,
    0x53ddf67562d8b362,
    0x5412ba095dc7701e,
    0x5447688bb5394c25,
    0x547d42aea2879f2e,
    0x54b249ad2594c37d,
    0x54e6dc186ef9f45c,
    0x551c931e8ab87173,
    0x5551dbf316b346e8,
    0x558652efdc6018a2,
    0x55bbe7abd3781eca,
    0x55f170cb642b133f,
    0x5625ccfe3d35d80e,
    0x565b403dcc834e12,
    0x569108269fd210cb,
    0x56c54a3047c694fe,
    0x56fa9cbc59b83a3e,
    0x5730a1f5b8132466,
    0x5764ca732617ed80,
    0x5799fd0fef9de8e0,
    0x57d03e29f5c2b18c,
    0x58044db473335def,
    0x583961219000356b,
    0x586fb969f40042c5,
    0x58a3d3e2388029bb,
    0x58d8c8dac6a0342a,
    0x590efb1178484135,
    0x59435ceaeb2d28c1,
    0x59783425a5f872f1,
    0x59ae412f0f768fad,
    0x59e2e8bd69aa19cc,
    0x5a17a2ecc414a040,
    0x5a4d8ba7f519c84f,
    0x5a827748f9301d32,
    0x5ab7151b377c247e,
    0x5aecda62055b2d9e,
    0x5b22087d4358fc82,
    0x5b568a9c942f3ba3,
    0x5b8c2d43b93b0a8c,
    0x5bc19c4a53c4e697,
    0x5bf6035ce8b6203d,
    0x5c2b843422e3a84c,
    0x5c6132a095ce4930,
    0x5c957f48bb41db7c,
    0x5ccadf1aea12525b,
    0x5d00cb70d24b7379,
    0x5d34fe4d06de5057,
    0x5d6a3de04895e46c,
    0x5da066ac2d5daec4,
    0x5dd4805738b51a75,
    0x5e09a06d06e26112,
    0x5e400444244d7cab,
    0x5e7405552d60dbd6,
    0x5ea906aa78b912cc,
    0x5edf485516e7577f,
    0x5f138d352e5096af,
    0x5f48708279e4bc5b,
    0x5f7e8ca3185deb72,
    0x5fb317e5ef3ab327,
    0x5fe7dddf6b095ff1,
    0x601dd55745cbb7ed,
    0x6052a5568b9f52f4,
    0x60874eac2e8727b1,
    0x60bd22573a28f19d,
    0x60f2357684599702,
    0x6126c2d4256ffcc3,
    0x615c73892ecbfbf4,
    0x6191c835bd3f7d78,
    0x61c63a432c8f5cd6,
    0x61fbc8d3f7b3340c,
    0x62315d847ad00088,
    0x6265b4e5998400aa,
    0x629b221effe500d4,
    0x62d0f5535fef2084,
    0x630532a837eae8a6,
    0x633a7f5245e5a2cf,
    0x63708f936baf85c1,
    0x63a4b378469b6732,
    0x63d9e056584240fe,
    0x64102c35f729689f,
    0x6444374374f3c2c6,
    0x647945145230b378,
    0x64af965966bce056,
    0x64e3bdf7e0360c36,
    0x6518ad75d8438f43,
    0x654ed8d34e547314,
    0x6583478410f4c7ec,
    0x65b819651531f9e8,
    0x65ee1fbe5a7e7861,
    0x6622d3d6f88f0b3d,
    0x665788ccb6b2ce0c,
    0x668d6affe45f818f,
    0x66c262dfeebbb0fa,
    0x66f6fb97ea6a9d38,
    0x672cba7de5054486,
    0x6761f48eaf234ad4,
    0x679671b25aec1d88,
    0x67cc0e1ef1a724eb,
    0x680188d357087713,
    0x6835eb082cca94d7,
    0x686b65ca37fd3a0d,
    0x68a11f9e62fe4448,
    0x68d56785fbbdd55a,
    0x690ac1677aad4ab1,
    0x6940b8e0acac4eaf,
    0x6974e718d7d7625a,
    0x69aa20df0dcd3af1,
    0x69e0548b68a044d6,
    0x6a1469ae42c8560c,
    0x6a498419d37a6b8f,
    0x6a7fe52048590673,
    0x6ab3ef342d37a408,
    0x6ae8eb0138858d0a,
    0x6b1f25c186a6f04c,
    0x6b537798f4285630,
    0x6b88557f31326bbc,
    0x6bbe6adefd7f06aa,
    0x6bf302cb5e6f642a,
    0x6c27c37e360b3d35,
    0x6c5db45dc38e0c82,
    0x6c9290ba9a38c7d2,
    0x6cc734e940c6f9c6,
    0x6cfd022390f8b837,
    0x6d3221563a9b7323,
    0x6d66a9abc9424feb,
    0x6d9c5416bb92e3e6,
    0x6dd1b48e353bce70,
    0x6e0621b1c28ac20c,
    0x6e3baa1e332d728f,
    0x6e714a52dffc6799,
    0x6ea59ce797fb8180,
    0x6edb04217dfa61df,
    0x6f10e294eebc7d2c,
    0x6f451b3a2a6b9c76,
    0x6f7a6208b5068394,
    0x6fb07d457124123d,
    0x6fe49c96cd6d16cc,
    0x7019c3bc80c85c7e,
    0x70501a55d07d39cf,
    0x708420eb449c8843,
    0x70b9292615c3aa54,
    0x70ef736f9b3494e9,
    0x7123a825c100dd11,
    0x7158922f31411456,
    0x718eb6bafd91596b,
    0x71c33234de7ad7e3,
    0x71f7fec216198ddc,
    0x722dfe729b9ff152,
    0x7262bf07a143f6d4,
    0x72976ec98994f488,
    0x72cd4a7bebfa31ab,
    0x73024e8d737c5f0b,
    0x7336e230d05b76cd,
    0x736c9abd04725481,
    0x73a1e0b622c774d0,
    0x73d658e3ab795204,
    0x740bef1c9657a686,
    0x74417571ddf6c814,
    0x7475d2ce55747a18,
    0x74ab4781ead1989e,
    0x74e10cb132c2ff63,
    0x75154fdd7f73bf3c,
    0x754aa3d4df50af0b,
    0x7580a6650b926d67,
    0x75b4cffe4e7708c0,
    0x75ea03fde214caf0,
    0x7620427ead4cfed6,
    0x7654531e58a03e8c,
    0x768967e5eec84e2f,
    0x76bfc1df6a7a61bb,
    0x76f3d92ba28c7d15,
    0x7728cf768b2f9c5a,
    0x775f03542dfb8370,
    0x779362149cbd3226,
    0x77c83a99c3ec7eb0,
    0x77fe494034e79e5c,
    0x7832edc82110c2f9,
    0x7867a93a2954f3b8,
    0x789d9388b3aa30a6,
    0x78d27c35704a5e68,
    0x79071b42cc5cf602,
    0x793ce2137f743382,
    0x79720d4c2fa8a031,
    0x79a6909f3b92c83d,
    0x79dc34c70a777a4c,
    0x7a11a0fc668aac70,
    0x7a46093b802d578c,
    0x7a7b8b8a6038ad6f,
    0x7ab137367c236c65,
    0x7ae585041b2c477e,
    0x7b1ae64521f7595e,
    0x7b50cfeb353a97db,
    0x7b8503e602893dd2,
    0x7bba44df832b8d46,
    0x7bf06b0bb1fb384c,
    0x7c2485ce9e7a065e,
    0x7c59a742461887f6,
    0x7c9008896bcf54fa,
    0x7cc40aabc6c32a38,
    0x7cf90d56b873f4c6,
    0x7d2f50ac6690f1f8,
    0x7d63926bc01a973b,
    0x7d987706b0213d0a,
    0x7dce94c85c298c4c,
    0x7e031cfd3999f7b0,
    0x7e37e43c8800759c,
    0x7e6ddd4baa009303,
    0x7ea2aa4f4a405be2,
    0x7ed754e31cd072da,
    0x7f0d2a1be4048f90,
    0x7f423a516e82d9ba,
    0x7f76c8e5ca239029,
    0x7fac7b1f3cac7433,
    0x7fe1ccf385ebc8a0,
];
fn raw_divisor(scale: i32) -> f64 {
    JS_POW10_BITS
        .get(scale as usize)
        .copied()
        .map(f64::from_bits)
        .unwrap_or(f64::INFINITY)
}
fn validate_raw(descriptor: &RawDecimalDescriptor) -> Result<(), String> {
    if descriptor.precision <= 0 || descriptor.scale < 0 || descriptor.scale > descriptor.precision
    {
        return Err("Invalid DECIMAL precision/scale descriptor".into());
    }
    Ok(())
}
pub fn raw_plan(descriptor: &RawDecimalDescriptor) -> Result<DecimalPlan, String> {
    validate_raw(descriptor)?;
    match descriptor.physical_type {
        PhysicalType::INT32 | PhysicalType::INT64 => Ok(DecimalPlan::Number {
            physical_width: if descriptor.physical_type == PhysicalType::INT32 {
                4
            } else {
                8
            },
            value_width: if descriptor.precision > 9 { 8 } else { 4 },
            divisor: raw_divisor(descriptor.scale),
        }),
        PhysicalType::BYTE_ARRAY => Ok(DecimalPlan::ByteArray),
        PhysicalType::FIXED_LEN_BYTE_ARRAY => {
            let width = descriptor
                .type_length
                .and_then(|value| usize::try_from(value).ok())
                .filter(|value| *value > 0)
                .ok_or(MISSING_TYPE_LENGTH)?;
            Ok(DecimalPlan::FixedArray { width })
        }
        _ => Err("Unsupported raw DECIMAL physical type".into()),
    }
}
pub fn decode_raw_plain(
    bytes: &[u8],
    count: usize,
    descriptor: &RawDecimalDescriptor,
    initial_offset: usize,
    size: Option<usize>,
    limits: PlainLimits,
) -> Result<PlainDecoded, PlainError> {
    decode_plan(
        bytes,
        count,
        raw_plan(descriptor).map(Some),
        initial_offset,
        size,
        limits,
    )
}
pub fn decode_raw_dictionary_plain(
    bytes: &[u8],
    count: usize,
    descriptor: &RawDecimalDescriptor,
    initial_offset: usize,
    size: Option<usize>,
    limits: PlainLimits,
) -> Result<PlainDecoded, PlainError> {
    let plan = validate_raw(descriptor).and_then(|()| {
        let width = descriptor
            .type_length
            .and_then(|value| usize::try_from(value).ok())
            .filter(|value| *value > 0)
            .ok_or(MISSING_TYPE_LENGTH)?;
        Ok(Some(DecimalPlan::FixedArray { width }))
    });
    decode_plan(bytes, count, plan, initial_offset, size, limits)
}

pub fn plan(descriptor: &ColumnDescriptor) -> Result<Option<DecimalPlan>, String> {
    if descriptor.converted_type() != ConvertedType::DECIMAL {
        return Ok(None);
    }
    let precision = descriptor.type_precision();
    let scale = descriptor.type_scale();
    if precision <= 0 || scale < 0 || scale > precision {
        return Err("Invalid DECIMAL precision/scale descriptor".into());
    }
    match descriptor.physical_type() {
        PhysicalType::INT32 | PhysicalType::INT64 => {
            let physical_width = if descriptor.physical_type() == PhysicalType::INT32 {
                4
            } else {
                8
            };
            let max_precision = if physical_width == 4 { 9 } else { 18 };
            if precision > max_precision {
                return Err("Invalid numeric DECIMAL precision".into());
            }
            Ok(Some(DecimalPlan::Number {
                physical_width,
                value_width: if precision > 9 { 8 } else { 4 },
                divisor: POW10[scale as usize],
            }))
        }
        PhysicalType::BYTE_ARRAY => Ok(Some(DecimalPlan::ByteArray)),
        PhysicalType::FIXED_LEN_BYTE_ARRAY => {
            let width = usize::try_from(descriptor.type_length())
                .ok()
                .filter(|x| *x > 0)
                .ok_or("Invalid fixed DECIMAL typeLength")?;
            Ok(Some(DecimalPlan::FixedArray { width }))
        }
        _ => Err("Unsupported DECIMAL physical type".into()),
    }
}

/// Raw footer decoding supplies null for an absent Thrift type_length.
/// A manually authored schema can instead omit typeLength (undefined); these
/// inputs select different primitive codecs in parquetjs and are never merged.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SchemaTypeLength {
    Undefined,
    Null,
    Value(i32),
}
const MISSING_TYPE_LENGTH: &str = "missing option: typeLength (required for FIXED_LEN_BYTE_ARRAY)";

/// Reconstructed schema selection with explicit property presence. This is
/// codec selection, not statistics validation: statistics bypass any BYTE_ARRAY
/// codec entirely, including fixed/null, and retain their original Buffer bytes.
pub fn schema_plan(
    descriptor: &ColumnDescriptor,
    type_length: SchemaTypeLength,
) -> Result<Option<DecimalPlan>, String> {
    if plan(descriptor)?.is_none() {
        return Ok(None);
    }
    match type_length {
        SchemaTypeLength::Null | SchemaTypeLength::Value(0) => Err(MISSING_TYPE_LENGTH.into()),
        SchemaTypeLength::Value(value) => {
            let width = usize::try_from(value).map_err(|_| {
                "Negative raw-schema typeLength is outside this decoder's cursor domain"
            })?;
            Ok(Some(DecimalPlan::FixedArray { width }))
        }
        SchemaTypeLength::Undefined => {
            let precision = descriptor.type_precision();
            if precision > 18 {
                return Ok(Some(DecimalPlan::ByteArray));
            }
            Ok(Some(DecimalPlan::Number {
                physical_width: 8,
                value_width: if precision > 9 { 8 } else { 4 },
                divisor: POW10[descriptor.type_scale() as usize],
            }))
        }
    }
}

/// ACTUAL read-footer dictionary context: absent length becomes null in Thrift,
/// selecting fixed/null and raising the reference codec's missing-option error.
pub fn dictionary_plan(descriptor: &ColumnDescriptor) -> Result<Option<DecimalPlan>, String> {
    let type_length = if descriptor.type_length() > 0 {
        SchemaTypeLength::Value(descriptor.type_length())
    } else {
        SchemaTypeLength::Null
    };
    schema_plan(descriptor, type_length)
}

/// Scalar fast path only when physical and parquetjs-selected widths agree.
/// Buffers remain Buffers; callers must preserve their own TypeScript coercion.
pub fn decode_value(
    field: &Field,
    descriptor: &ColumnDescriptor,
) -> Result<Option<DecimalValue>, String> {
    let Some(plan) = plan(descriptor)? else {
        return Ok(None);
    };
    if matches!(field, Field::Null) {
        return Ok(None);
    }
    let Field::Decimal(decimal) = field else {
        return Err("DECIMAL field is not a materialized Decimal".into());
    };
    if decimal.precision() != descriptor.type_precision()
        || decimal.scale() != descriptor.type_scale()
    {
        return Err("DECIMAL value and descriptor disagree".into());
    }
    match plan {
        DecimalPlan::Number {
            physical_width,
            value_width,
            divisor,
        } => {
            if physical_width != value_width {
                return Err(
                    "DECIMAL precision-selected width requires raw PLAIN page decoding".into(),
                );
            }
            let integer = match (physical_width, decimal) {
                (4, Decimal::Int32 { value, .. }) => i32::from_be_bytes(*value) as f64,
                (8, Decimal::Int64 { value, .. }) => i64::from_be_bytes(*value) as f64,
                _ => return Err("DECIMAL value has the wrong physical representation".into()),
            };
            Ok(Some(DecimalValue::Number(integer / divisor)))
        }
        DecimalPlan::ByteArray | DecimalPlan::FixedArray { .. } => match decimal {
            Decimal::Bytes { .. } => Ok(Some(DecimalValue::Buffer(decimal.data().to_vec()))),
            _ => Err("DECIMAL Buffer value has the wrong physical representation".into()),
        },
    }
}

/// Compatible numeric scalar conversion. None also denotes Buffer-valued DECIMAL;
/// callers needing that distinction should use decode_value/plan instead.
pub fn decode(field: &Field, descriptor: &ColumnDescriptor) -> Result<Option<f64>, String> {
    Ok(match decode_value(field, descriptor)? {
        Some(DecimalValue::Number(x)) => Some(x),
        _ => None,
    })
}

/// Decode an uncompressed PLAIN page or dictionary payload using the installed
/// TypeScript codec's cursor semantics. `size=None` and `Some(0)` disable the
/// numeric EOF guard; other sizes may exceed the actual buffer and then reads fail.
/// ResourceBound is an explicit caller budget outcome, not a TypeScript codec error.
pub fn decode_plain(
    bytes: &[u8],
    count: usize,
    descriptor: &ColumnDescriptor,
    initial_offset: usize,
    size: Option<usize>,
    limits: PlainLimits,
) -> Result<PlainDecoded, PlainError> {
    decode_plan(bytes, count, plan(descriptor), initial_offset, size, limits)
}

/// Dictionary PLAIN decoding uses the actual raw-footer schema context.
/// Statistics are not codec calls and must not use this function.
pub fn decode_dictionary_plain(
    bytes: &[u8],
    count: usize,
    descriptor: &ColumnDescriptor,
    initial_offset: usize,
    size: Option<usize>,
    limits: PlainLimits,
) -> Result<PlainDecoded, PlainError> {
    decode_plan(
        bytes,
        count,
        dictionary_plan(descriptor),
        initial_offset,
        size,
        limits,
    )
}

/// Explicit schema context, including separately authored undefined length.
/// This does not claim that manually authored schemas match a read footer.
pub fn decode_schema_plain(
    bytes: &[u8],
    count: usize,
    descriptor: &ColumnDescriptor,
    type_length: SchemaTypeLength,
    initial_offset: usize,
    size: Option<usize>,
    limits: PlainLimits,
) -> Result<PlainDecoded, PlainError> {
    decode_plan(
        bytes,
        count,
        schema_plan(descriptor, type_length),
        initial_offset,
        size,
        limits,
    )
}

fn decode_plan(
    bytes: &[u8],
    count: usize,
    plan: Result<Option<DecimalPlan>, String>,
    initial_offset: usize,
    size: Option<usize>,
    limits: PlainLimits,
) -> Result<PlainDecoded, PlainError> {
    let fail = |kind, offset, message: &str| PlainError {
        kind,
        offset,
        message: message.into(),
    };
    let plan = plan
        .map_err(|message| PlainError {
            kind: if message == MISSING_TYPE_LENGTH {
                PlainErrorKind::CodecError
            } else {
                PlainErrorKind::InvalidDescriptor
            },
            offset: initial_offset,
            message,
        })?
        .ok_or_else(|| {
            fail(
                PlainErrorKind::InvalidDescriptor,
                initial_offset,
                "Expected DECIMAL descriptor",
            )
        })?;
    if count > limits.max_values {
        return Err(fail(
            PlainErrorKind::ResourceBound,
            initial_offset,
            "DECIMAL value budget exceeded",
        ));
    }
    let mut values = Vec::new();
    values.try_reserve(count).map_err(|_| {
        fail(
            PlainErrorKind::ResourceBound,
            initial_offset,
            "DECIMAL allocation failed",
        )
    })?;
    let mut offset = initial_offset;
    let mut copied = 0usize;
    for _ in 0..count {
        match plan {
            DecimalPlan::Number {
                value_width,
                divisor,
                ..
            } => {
                if size.is_some_and(|s| s != 0 && offset >= s) {
                    break;
                }
                let end = offset.checked_add(value_width).ok_or_else(|| {
                    fail(
                        PlainErrorKind::RangeError,
                        offset,
                        "DECIMAL read offset out of range",
                    )
                })?;
                let raw = bytes.get(offset..end).ok_or_else(|| {
                    fail(
                        PlainErrorKind::RangeError,
                        offset,
                        "DECIMAL read outside buffer bounds",
                    )
                })?;
                let integer = if value_width == 4 {
                    i32::from_le_bytes(raw.try_into().unwrap()) as f64
                } else {
                    i64::from_le_bytes(raw.try_into().unwrap()) as f64
                };
                values.push(DecimalValue::Number(integer / divisor));
                offset = end;
            }
            DecimalPlan::ByteArray | DecimalPlan::FixedArray { .. } => {
                let width = match plan {
                    DecimalPlan::ByteArray => {
                        let end = offset.checked_add(4).ok_or_else(|| {
                            fail(
                                PlainErrorKind::RangeError,
                                offset,
                                "DECIMAL Buffer header offset out of range",
                            )
                        })?;
                        let raw = bytes.get(offset..end).ok_or_else(|| {
                            fail(
                                PlainErrorKind::RangeError,
                                offset,
                                "DECIMAL Buffer header outside buffer bounds",
                            )
                        })?;
                        let width = u32::from_le_bytes(raw.try_into().unwrap()) as usize;
                        offset = end;
                        width
                    }
                    DecimalPlan::FixedArray { width } => width,
                    _ => unreachable!(),
                };
                let end = offset.checked_add(width).ok_or_else(|| {
                    fail(
                        PlainErrorKind::ResourceBound,
                        offset,
                        "DECIMAL Buffer offset overflow",
                    )
                })?;
                // Buffer.subarray truncates rather than rejecting a short payload.
                let raw = &bytes[offset.min(bytes.len())..end.min(bytes.len())];
                copied = copied.checked_add(raw.len()).ok_or_else(|| {
                    fail(
                        PlainErrorKind::ResourceBound,
                        offset,
                        "DECIMAL Buffer budget overflow",
                    )
                })?;
                if copied > limits.max_buffer_bytes {
                    return Err(fail(
                        PlainErrorKind::ResourceBound,
                        offset,
                        "DECIMAL Buffer budget exceeded",
                    ));
                }
                values.push(DecimalValue::Buffer(raw.to_vec()));
                offset = end;
            }
        }
    }
    Ok(PlainDecoded { values, offset })
}
