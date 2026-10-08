//! Strategy-facing identity wrappers. The graph root is the sole authority:
//! current properties are read through callback-aware Get, never an Arc/DTO copy.
use crate::metadata::{JsException, MetadataError, MetadataGraph, MetadataHandle, MetadataValue};
use crate::portfolio_records::PortfolioSnapshotRecord;

fn reference(graph: &MetadataGraph, value: MetadataValue) -> Result<MetadataHandle, MetadataError> {
    let MetadataValue::Reference(handle) = value else {
        return Err(MetadataError::WrongKind);
    };
    if !graph.owns(&handle) {
        return Err(MetadataError::WrongGraph);
    }
    Ok(handle)
}
macro_rules! graph_wrapper {
    ($name:ident) => {
        #[derive(Debug, Clone, Eq, PartialEq)]
        pub struct $name(MetadataHandle);
        impl $name {
            pub fn from_handle(
                graph: &MetadataGraph,
                handle: MetadataHandle,
            ) -> Result<Self, MetadataError> {
                Ok(Self(reference(graph, handle.into())?))
            }
            pub fn from_value(
                graph: &MetadataGraph,
                value: MetadataValue,
            ) -> Result<Self, MetadataError> {
                Ok(Self(reference(graph, value)?))
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
        }
    };
}
graph_wrapper!(TickHandle);
graph_wrapper!(MarketSnapshotHandle);
graph_wrapper!(PortfolioSnapshotHandle);
impl TickHandle {
    /// Adapter supplies the already allocated raw message/source/snapshot roots.
    /// Regenerating any of these through a JSON projection would break identity.
    pub fn new(
        graph: &MetadataGraph,
        source: MetadataValue,
        msg: MetadataValue,
        snapshot: MetadataValue,
    ) -> Result<Self, MetadataError> {
        let root = graph.object()?;
        root.set("source", source)?;
        root.set("msg", msg)?;
        root.set("snapshot", snapshot)?;
        Ok(Self(root))
    }
    pub fn source(&self) -> Result<MetadataValue, JsException> {
        self.get("source")
    }
    pub fn msg(&self) -> Result<MetadataValue, JsException> {
        self.get("msg")
    }
    pub fn snapshot_value(&self) -> Result<MetadataValue, JsException> {
        self.get("snapshot")
    }
    pub fn snapshot(&self) -> Result<MarketSnapshotHandle, JsException> {
        Ok(MarketSnapshotHandle::from_value(
            &self.0.graph(),
            self.snapshot_value()?,
        )?)
    }
}
impl MarketSnapshotHandle {
    pub fn new(
        graph: &MetadataGraph,
        market: MetadataValue,
        timestamp: f64,
        by_asset_id: MetadataValue,
    ) -> Result<Self, MetadataError> {
        let root = graph.object()?;
        root.set("market", market)?;
        root.set("timestamp", timestamp.into())?;
        root.set("byAssetId", by_asset_id)?;
        Ok(Self(root))
    }
    pub fn market(&self) -> Result<MetadataValue, JsException> {
        self.get("market")
    }
    pub fn timestamp(&self) -> Result<MetadataValue, JsException> {
        self.get("timestamp")
    }
    pub fn by_asset_id(&self) -> Result<MetadataValue, JsException> {
        self.get("byAssetId")
    }
    pub fn book(
        &self,
        asset_id: impl Into<crate::market_json::JsString>,
    ) -> Result<MetadataValue, JsException> {
        let books = reference(&self.0.graph(), self.by_asset_id()?)?;
        books.get_property(asset_id)
    }
}
impl PortfolioSnapshotHandle {
    /// Preserve the ONE authoritative Portfolio cache root. Pending-capital
    /// spread roots may also be wrapped with from_handle without schema narrowing.
    pub fn from_record(record: &PortfolioSnapshotRecord) -> Self {
        Self(record.handle().as_handle().clone())
    }
    pub fn capital(&self) -> Result<MetadataValue, JsException> {
        self.get("capital")
    }
    pub fn now_ms(&self) -> Result<MetadataValue, JsException> {
        self.get("nowMs")
    }
    pub fn positions(&self) -> Result<MetadataValue, JsException> {
        self.get("positionsByAssetId")
    }
    pub fn open_orders(&self) -> Result<MetadataValue, JsException> {
        self.get("openOrdersByClientId")
    }
    pub fn orders(&self) -> Result<MetadataValue, JsException> {
        self.get("ordersByClientId")
    }
    pub fn ws_open_orders(&self) -> Result<MetadataValue, JsException> {
        self.get("wsOpenOrdersByOrderId")
    }
}
