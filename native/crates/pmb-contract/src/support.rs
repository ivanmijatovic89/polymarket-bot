//! Small serde/schema helpers shared by the contract types.

use std::borrow::Cow;
use std::fmt;

use schemars::{json_schema, JsonSchema, Schema, SchemaGenerator};
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::vocab::ErrorClass;

/// A fixed schema version field (`jobSchemaVersion`, `outputSchemaVersion`,
/// `modelConfigVersion`, ...): serializes as `N` and rejects any other value.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Version<const N: u32>;

impl<const N: u32> Version<N> {
    pub const VALUE: u32 = N;
}

impl<const N: u32> Serialize for Version<N> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_u32(N)
    }
}

impl<'de, const N: u32> Deserialize<'de> for Version<N> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = u64::deserialize(d)?;
        if v == u64::from(N) {
            Ok(Version)
        } else {
            Err(D::Error::custom(format!(
                "unsupported version {v} (this contract accepts {N})"
            )))
        }
    }
}

impl<const N: u32> JsonSchema for Version<N> {
    fn inline_schema() -> bool {
        true
    }
    fn schema_name() -> Cow<'static, str> {
        format!("Version{N}").into()
    }
    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({ "type": "integer", "const": N })
    }
}

/// `#[serde(with = "tristate")]` for `Option<Option<T>>` fields where an
/// absent key, `null` and a value mean three different things (for example
/// `market.gammaPriceToBeat`, 21 §5.1). Use together with
/// `#[serde(default, skip_serializing_if = "Option::is_none")]`.
pub mod tristate {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<T: Serialize, S: Serializer>(
        v: &Option<Option<T>>,
        s: S,
    ) -> Result<S::Ok, S::Error> {
        match v {
            Some(inner) => inner.serialize(s),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
        d: D,
    ) -> Result<Option<Option<T>>, D::Error> {
        Option::<T>::deserialize(d).map(Some)
    }
}

/// `#[serde(deserialize_with = "crate::support::nullable")]` makes an
/// `Option<T>` field required-but-nullable: the key MUST be present and may
/// be `null` (21 §3 closed objects, §6 "a missing field is
/// `invalid_input`"). Without it serde silently reads a missing `Option`
/// field as `None` (R14).
pub fn nullable<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}

/// A contract validation failure, classified per 20 §4 (class and cause).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContractError {
    pub class: ErrorClass,
    pub cause: &'static str,
    pub message: String,
}

impl ContractError {
    pub fn invalid_input(cause: &'static str, message: impl Into<String>) -> Self {
        ContractError {
            class: ErrorClass::InvalidInput,
            cause,
            message: message.into(),
        }
    }

    /// True for `invalid_input: schema`.
    pub fn is_invalid_input_schema(&self) -> bool {
        self.class == ErrorClass::InvalidInput && self.cause == "schema"
    }

    pub fn invalid_output(cause: &'static str, message: impl Into<String>) -> Self {
        ContractError {
            class: ErrorClass::InvalidOutput,
            cause,
            message: message.into(),
        }
    }
}

impl fmt::Display for ContractError {
    /// The reason text of 20 §4.2: `<class>: <cause>: <message>`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}: {}", self.class, self.cause, self.message)
    }
}

impl std::error::Error for ContractError {}

/// Returns an `invalid_input` error with `cause` unless `cond` holds.
pub(crate) fn ensure(
    cond: bool,
    cause: &'static str,
    msg: impl FnOnce() -> String,
) -> Result<(), ContractError> {
    if cond {
        Ok(())
    } else {
        Err(ContractError::invalid_input(cause, msg()))
    }
}

/// Printable ASCII without `"` or `\` (21 §6.1 string rule).
pub fn is_plain_ascii(s: &str) -> bool {
    s.bytes()
        .all(|b| (0x20..0x7f).contains(&b) && b != b'"' && b != b'\\')
}
