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
