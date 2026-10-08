//! Typed strategy decisions. Value-based decoding is a fixture/control seam;
//! production metadata must use shared identity handles supplied by the SDK.
use crate::market_json::normalize_control_value;
use crate::portfolio::{CapitalSnapshot, OrderType, PortfolioSnapshot, Side};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

/// Preserve missing fields separately from present null/wrong-type input.
#[derive(Clone, Debug, PartialEq)]
pub enum InputField<T> {
    Absent,
    Valid(T),
    Invalid(Box<Value>),
}
impl<T> Default for InputField<T> {
    fn default() -> Self {
        Self::Absent
    }
}
impl<T> InputField<T> {
    pub fn is_absent(&self) -> bool {
        matches!(self, Self::Absent)
    }
    pub fn valid(&self) -> Option<&T> {
        if let Self::Valid(v) = self {
            Some(v)
        } else {
            None
        }
    }
}
impl<T: Serialize> Serialize for InputField<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Absent => serializer.serialize_unit(),
            Self::Valid(v) => v.serialize(serializer),
            Self::Invalid(v) => v.serialize(serializer),
        }
    }
}
impl<'de, T: serde::de::DeserializeOwned> Deserialize<'de> for InputField<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = normalize_control_value(Value::deserialize(deserializer)?);
        Ok(match serde_json::from_value(value.clone()) {
            Ok(v) => Self::Valid(v),
            Err(_) => Self::Invalid(Box::new(value)),
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    bound(deserialize = "M: serde::de::DeserializeOwned")
)]
pub struct PlaceOrder<M = Value> {
    pub client_order_id: String,
    pub asset_id: String,
    pub side: Side,
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub price: InputField<f64>,
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub size: InputField<f64>,
    pub order_type: OrderType,
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub post_only: InputField<bool>,
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub meta: InputField<M>,
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub expire_at_ms: InputField<f64>,
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub reason: InputField<String>,
    #[serde(default, flatten)]
    pub extensions: serde_json::Map<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    bound(deserialize = "M: serde::de::DeserializeOwned")
)]
pub struct PlaceBatch<M = Value> {
    pub orders: Vec<PlaceOrder<M>>,
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub reason: InputField<String>,
    #[serde(default, flatten)]
    pub extensions: serde_json::Map<String, Value>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "ReferenceObject")]
pub struct OrderReference {
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub client_order_id: InputField<String>,
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub order_id: InputField<String>,
    #[serde(default, flatten)]
    pub extensions: serde_json::Map<String, Value>,
}
// JSON arrays are not JavaScript objects with named order-reference fields.
#[derive(Deserialize)]
#[serde(transparent)]
struct ReferenceObject(serde_json::Map<String, Value>);
impl From<ReferenceObject> for OrderReference {
    fn from(ReferenceObject(mut object): ReferenceObject) -> Self {
        fn field(value: Option<Value>) -> InputField<String> {
            match value {
                None => InputField::Absent,
                Some(value) => match serde_json::from_value(value.clone()) {
                    Ok(string) => InputField::Valid(string),
                    Err(_) => InputField::Invalid(Box::new(value)),
                },
            }
        }
        Self {
            client_order_id: field(object.remove("clientOrderId")),
            order_id: field(object.remove("orderId")),
            extensions: object,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelOrder {
    #[serde(flatten)]
    pub target: OrderReference,
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub reason: InputField<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelBatch {
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub orders: InputField<Vec<InputField<OrderReference>>>,
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub reason: InputField<String>,
    #[serde(default, flatten)]
    pub extensions: serde_json::Map<String, Value>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelMarket {
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub market: InputField<String>,
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub asset_id: InputField<String>,
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub reason: InputField<String>,
    #[serde(default, flatten)]
    pub extensions: serde_json::Map<String, Value>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelAll {
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub reason: InputField<String>,
    #[serde(default, flatten)]
    pub extensions: serde_json::Map<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergePositions {
    pub asset_id_a: String,
    pub asset_id_b: String,
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub size: InputField<f64>,
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub reason: InputField<String>,
    #[serde(default, flatten)]
    pub extensions: serde_json::Map<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitPositions {
    pub asset_id_a: String,
    pub asset_id_b: String,
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub size: InputField<f64>,
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub cost_per_share: InputField<f64>,
    #[serde(default, skip_serializing_if = "InputField::is_absent")]
    pub reason: InputField<String>,
    #[serde(default, flatten)]
    pub extensions: serde_json::Map<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    bound(deserialize = "M: serde::de::DeserializeOwned")
)]
pub enum Intent<M = Value> {
    PlaceLimit(PlaceOrder<M>),
    PlaceBatch(PlaceBatch<M>),
    CancelOrder(CancelOrder),
    CancelBatch(CancelBatch),
    CancelMarket(CancelMarket),
    CancelAll(CancelAll),
    MergePositions(MergePositions),
    SplitPositions(SplitPositions),
}

/// Capital overlays borrow all maps/history rather than cloning a snapshot.
#[derive(Clone, Copy)]
pub struct PortfolioView<'a> {
    pub snapshot: &'a PortfolioSnapshot,
    pub capital_override: Option<&'a CapitalSnapshot>,
}
impl<'a> From<&'a PortfolioSnapshot> for PortfolioView<'a> {
    fn from(snapshot: &'a PortfolioSnapshot) -> Self {
        Self {
            snapshot,
            capital_override: None,
        }
    }
}
impl<'a> PortfolioView<'a> {
    pub fn capital(&self) -> &'a CapitalSnapshot {
        self.capital_override.unwrap_or(&self.snapshot.capital)
    }
}

/// Original strategy-owned intent object. Cloning retains identity, including
/// opaque nested objects. Properties are read at their actual processing sites.
#[derive(Clone, Debug)]
pub struct ManagedIntent(pub(crate) crate::metadata::MetadataHandle);
impl ManagedIntent {
    pub fn from_handle(
        handle: crate::metadata::MetadataHandle,
    ) -> Result<Self, crate::metadata::MetadataError> {
        if handle.is_array() {
            return Err(crate::metadata::MetadataError::WrongKind);
        }
        Ok(Self(handle))
    }
    pub fn handle(&self) -> &crate::metadata::MetadataHandle {
        &self.0
    }
    pub fn get(
        &self,
        name: &str,
    ) -> Result<crate::metadata::MetadataValue, crate::metadata::JsException> {
        self.0.get_property(name)
    }
    pub fn get_property(
        &self,
        name: &str,
    ) -> Result<crate::metadata::MetadataValue, crate::metadata::JsException> {
        self.get(name)
    }
    pub fn kind_is(&self, name: &str) -> Result<bool, crate::metadata::JsException> {
        Ok(
            matches!(self.get("kind")?, crate::metadata::MetadataValue::String(value) if value.matches(name)),
        )
    }
}
/// Original array identity, with membership read during iteration rather than
/// flattened into a detached Vec before asynchronous adapter calls.
#[derive(Clone, Debug)]
pub struct ManagedIntents(pub(crate) crate::metadata::MetadataHandle);
impl ManagedIntents {
    pub fn from_handle(
        handle: crate::metadata::MetadataHandle,
    ) -> Result<Self, crate::metadata::MetadataError> {
        if !handle.is_array() {
            return Err(crate::metadata::MetadataError::WrongKind);
        }
        Ok(Self(handle))
    }
    pub fn handle(&self) -> &crate::metadata::MetadataHandle {
        &self.0
    }
    pub fn length(&self) -> Result<u32, crate::metadata::MetadataError> {
        self.0.length()
    }
    pub fn at(&self, index: u32) -> Result<ManagedIntent, crate::metadata::JsException> {
        let crate::metadata::MetadataValue::Reference(handle) =
            self.0.get_property(index.to_string())?
        else {
            return Err(crate::metadata::MetadataError::WrongKind.into());
        };
        Ok(ManagedIntent::from_handle(handle)?)
    }
    pub fn new_in_graph(
        graph: &crate::metadata::MetadataGraph,
        values: impl IntoIterator<Item = ManagedIntent>,
    ) -> Result<Self, crate::metadata::MetadataError> {
        let array = graph.array()?;
        for value in values {
            array.push(value.0.into())?;
        }
        Ok(Self(array))
    }
}

/// Direct own-property operations shared by the managed consumer paths. These
/// never serialize a graph or reconstruct authoritative objects from JSON.
pub(crate) mod managed {
    use crate::market_json::JsString;
    use crate::metadata::{
        JsException, MetadataError, MetadataGraph, MetadataHandle, MetadataValue,
    };
    use crate::portfolio_records::ManagedAccountEvent;
    pub fn object(value: MetadataValue) -> Result<MetadataHandle, MetadataError> {
        match value {
            MetadataValue::Reference(h) => Ok(h),
            _ => Err(MetadataError::WrongKind),
        }
    }
    pub fn string(value: MetadataValue) -> Result<JsString, MetadataError> {
        match value {
            MetadataValue::String(s) => Ok(s),
            _ => Err(MetadataError::WrongKind),
        }
    }
    pub fn number(value: MetadataValue) -> Result<f64, MetadataError> {
        match value {
            MetadataValue::Number(n) => Ok(n),
            _ => Err(MetadataError::WrongKind),
        }
    }
    pub fn nullish_number(value: MetadataValue, fallback: f64) -> Result<f64, MetadataError> {
        match value {
            MetadataValue::Missing | MetadataValue::Null => Ok(fallback),
            value => number(value),
        }
    }
    pub fn is_string(value: &MetadataValue, text: &str) -> bool {
        matches!(value,MetadataValue::String(s) if s.matches(text))
    }
    pub fn strict_equal(a: &MetadataValue, b: &MetadataValue) -> bool {
        crate::sdk_value::strict_equal(a, b)
    }
    pub fn primitive_property_key(value: MetadataValue) -> Result<JsString, JsException> {
        crate::sdk_value::to_property_key(value)
    }
    pub fn pairs(
        graph: &MetadataGraph,
        values: impl IntoIterator<Item = (&'static str, MetadataValue)>,
    ) -> Result<MetadataHandle, MetadataError> {
        let h = graph.object()?;
        for (key, value) in values {
            h.set(key, value)?;
        }
        Ok(h)
    }
    pub fn spread(
        graph: &MetadataGraph,
        source: &MetadataHandle,
    ) -> Result<MetadataHandle, JsException> {
        let h = graph.object()?;
        for key in source.own_property_keys()? {
            if source
                .own_descriptor(key.clone())?
                .is_some_and(|d| d.enumerable())
            {
                h.set(key.clone(), source.get_property(key)?)?;
            }
        }
        Ok(h)
    }
    pub fn event(
        graph: &MetadataGraph,
        values: impl IntoIterator<Item = (&'static str, MetadataValue)>,
    ) -> Result<ManagedAccountEvent, MetadataError> {
        Ok(ManagedAccountEvent::from_envelope(pairs(graph, values)?))
    }
    pub fn members(root: &MetadataHandle, name: &str) -> Result<MetadataHandle, JsException> {
        Ok(object(root.get_property(name)?)?)
    }
    pub fn values(map: &MetadataHandle) -> Result<Vec<MetadataHandle>, JsException> {
        let mut out = Vec::new();
        for key in map.own_property_keys()? {
            if map
                .own_descriptor(key.clone())?
                .is_some_and(|d| d.enumerable())
            {
                out.push(object(map.get_property(key)?)?);
            }
        }
        Ok(out)
    }
}
