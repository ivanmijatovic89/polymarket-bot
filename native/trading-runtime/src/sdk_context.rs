//! Ordered, mutable shared StrategyContext wrappers. Presence follows the pinned
//! runner's JavaScript truthiness checks; nested graph identities stay shared.
use crate::metadata::{JsException, MetadataError, MetadataGraph, MetadataHandle, MetadataValue};
#[derive(Debug, Clone)]
pub struct ContextParts {
    pub plugins: MetadataValue,
    pub market: MetadataValue,
    pub metrics: MetadataValue,
    pub balance: MetadataValue,
    pub warmup: MetadataValue,
}
impl Default for ContextParts {
    fn default() -> Self {
        Self {
            plugins: MetadataValue::Missing,
            market: MetadataValue::Missing,
            metrics: MetadataValue::Missing,
            balance: MetadataValue::Missing,
            warmup: MetadataValue::Missing,
        }
    }
}
#[derive(Debug, Clone, Eq, PartialEq)]
pub struct ContextHandle(MetadataHandle);
impl ContextHandle {
    pub fn from_handle(
        graph: &MetadataGraph,
        handle: MetadataHandle,
    ) -> Result<Self, MetadataError> {
        if !graph.owns(&handle) {
            return Err(MetadataError::WrongGraph);
        }
        Ok(Self(handle))
    }
    pub fn as_handle(&self) -> &MetadataHandle {
        &self.0
    }
    pub fn value(&self) -> MetadataValue {
        self.0.clone().into()
    }
    pub fn get(
        &self,
        key: impl Into<crate::market_json::JsString>,
    ) -> Result<MetadataValue, JsException> {
        self.0.get_property(key)
    }
    pub fn base(
        graph: &MetadataGraph,
        parts: &ContextParts,
    ) -> Result<Option<Self>, MetadataError> {
        Self::build(graph, parts, false)
    }
    pub fn full(
        graph: &MetadataGraph,
        parts: &ContextParts,
    ) -> Result<Option<Self>, MetadataError> {
        Self::build(graph, parts, true)
    }
    fn build(
        graph: &MetadataGraph,
        parts: &ContextParts,
        include_plugins: bool,
    ) -> Result<Option<Self>, MetadataError> {
        let fields = [
            ("plugins", &parts.plugins),
            ("market", &parts.market),
            ("metrics", &parts.metrics),
            ("balance", &parts.balance),
            ("warmup", &parts.warmup),
        ];
        let fields = &fields[usize::from(!include_plugins)..];
        if !fields.iter().any(|(_, value)| value.is_truthy()) {
            return Ok(None);
        }
        let root = graph.object()?;
        for (key, value) in fields {
            if value.is_truthy() {
                root.set(*key, (*value).clone())?;
            }
        }
        Ok(Some(Self(root)))
    }
}
