//! JavaScript equality domains for authoritative SDK values and Map keys.
use crate::{
    market_json::JsString,
    metadata::{MetadataHandle, MetadataValue},
};
use num_bigint::BigInt;
use num_traits::Zero;

/// Map/Set keys use SameValueZero. Objects stay rooted while present in a Map;
/// weak capture keys use the arena's ephemeron API instead of this strong key.
#[derive(Clone, Debug, Eq, PartialEq, Hash)]
enum KeyValue {
    Undefined,
    Null,
    Bool(bool),
    Number(u64),
    BigInt(BigInt),
    String(Vec<u16>),
    Reference(MetadataHandle),
}
#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub struct JsMapKey(KeyValue);
impl JsMapKey {
    pub fn from_value(value: &MetadataValue) -> Self {
        Self(match value {
            MetadataValue::Missing => KeyValue::Undefined,
            MetadataValue::Null => KeyValue::Null,
            MetadataValue::Bool(value) => KeyValue::Bool(*value),
            MetadataValue::Number(value) => KeyValue::Number(if value.is_nan() {
                f64::NAN.to_bits()
            } else if *value == 0.0 {
                0
            } else {
                value.to_bits()
            }),
            MetadataValue::BigInt(value) => KeyValue::BigInt(value.clone()),
            MetadataValue::String(value) => KeyValue::String(value.units()),
            MetadataValue::Reference(value) => KeyValue::Reference(value.clone()),
        })
    }
    pub fn value(&self) -> MetadataValue {
        match &self.0 {
            KeyValue::Undefined => MetadataValue::Missing,
            KeyValue::Null => MetadataValue::Null,
            KeyValue::Bool(value) => MetadataValue::Bool(*value),
            KeyValue::Number(bits) => MetadataValue::Number(f64::from_bits(*bits)),
            KeyValue::BigInt(value) => MetadataValue::BigInt(value.clone()),
            KeyValue::String(value) => MetadataValue::String(JsString::from_units(value.clone())),
            KeyValue::Reference(value) => MetadataValue::Reference(value.clone()),
        }
    }
    pub fn is_truthy(&self) -> bool {
        match &self.0 {
            KeyValue::Undefined | KeyValue::Null => false,
            KeyValue::Bool(value) => *value,
            KeyValue::Number(bits) => {
                let value = f64::from_bits(*bits);
                value != 0.0 && !value.is_nan()
            }
            KeyValue::BigInt(value) => !value.is_zero(),
            KeyValue::String(value) => !value.is_empty(),
            KeyValue::Reference(_) => true,
        }
    }
}

pub fn strict_equal(a: &MetadataValue, b: &MetadataValue) -> bool {
    match (a, b) {
        (MetadataValue::Number(a), MetadataValue::Number(b)) => a == b,
        (MetadataValue::Missing, MetadataValue::Missing)
        | (MetadataValue::Null, MetadataValue::Null) => true,
        (MetadataValue::Bool(a), MetadataValue::Bool(b)) => a == b,
        (MetadataValue::BigInt(a), MetadataValue::BigInt(b)) => a == b,
        (MetadataValue::String(a), MetadataValue::String(b)) => a == b,
        (MetadataValue::Reference(a), MetadataValue::Reference(b)) => a == b,
        _ => false,
    }
}
/// Object.is/SameValue is also required by nonwritable property redefinition.
pub fn same_value(a: &MetadataValue, b: &MetadataValue) -> bool {
    match (a, b) {
        (MetadataValue::Number(a), MetadataValue::Number(b)) => {
            (a.is_nan() && b.is_nan()) || a.to_bits() == b.to_bits()
        }
        _ => strict_equal(a, b),
    }
}

/// Ordinary ToPropertyKey with a string hint. Symbol primitives are a separate
/// required SDK extension; all existing MetadataValue primitives stay lossless.
pub fn to_property_key(
    value: crate::metadata::MetadataValue,
) -> Result<crate::market_json::JsString, crate::metadata::JsException> {
    use crate::metadata::{MetadataError, MetadataValue as V};
    let value = if let V::Reference(handle) = &value {
        let mut result = None;
        for name in ["toString", "valueOf"] {
            let method = handle.get_property(name)?;
            if let V::Reference(callback) = method {
                if callback.is_callable() {
                    let candidate = callback.call(value.clone(), vec![])?;
                    if !matches!(candidate, V::Reference(_)) {
                        result = Some(candidate);
                        break;
                    }
                }
            }
        }
        result.ok_or(MetadataError::WrongKind)?
    } else {
        value
    };
    Ok(match value {
        V::Missing => "undefined".into(),
        V::Null => "null".into(),
        V::Bool(value) => {
            if value {
                "true".into()
            } else {
                "false".into()
            }
        }
        V::Number(value) => crate::math::js_number_string(value).into(),
        V::BigInt(value) => value.to_string().into(),
        V::String(value) => value,
        V::Reference(_) => return Err(MetadataError::WrongKind.into()),
    })
}
