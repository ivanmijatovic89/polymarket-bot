//! Actual PluginSet state lives in the session graph. Private TS fields remain
//! observable ordinary properties; callbacks read current descriptors/identities.
use crate::{
    market_json::JsString,
    metadata::*,
    sdk_context::ContextHandle,
    sdk_intrinsics::ensure_object_prototype,
    sdk_snapshot::TickHandle,
    sdk_value::{to_property_key, JsMapKey},
};
#[derive(Debug, Clone, Eq, PartialEq)]
pub struct PluginSet(MetadataHandle);
fn get(value: &MetadataValue, key: &str) -> Result<MetadataValue, JsException> {
    match value {
        MetadataValue::Reference(handle) => handle.get_property(key),
        MetadataValue::Null | MetadataValue::Missing => Err(MetadataError::WrongKind.into()),
        _ => Ok(MetadataValue::Missing),
    }
}
fn call(
    method: MetadataValue,
    receiver: MetadataValue,
    args: Vec<MetadataValue>,
) -> Result<MetadataValue, JsException> {
    let MetadataValue::Reference(function) = method else {
        return Err(MetadataError::NotCallable.into());
    };
    function.call(receiver, args)
}
fn callable(value: &MetadataValue) -> bool {
    matches!(value,MetadataValue::Reference(function) if function.is_callable())
}
impl PluginSet {
    pub fn new(graph: &MetadataGraph) -> Result<Self, MetadataError> {
        ensure_object_prototype(graph)?;
        let root = graph.object()?;
        root.set("plugins", graph.array()?.into())?;
        root.set("cached", graph.object()?.into())?;
        Ok(Self(root))
    }
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
    fn plugins(&self) -> Result<MetadataHandle, JsException> {
        let MetadataValue::Reference(array) = self.0.get_property("plugins")? else {
            return Err(MetadataError::WrongKind.into());
        };
        if !array.is_array() {
            return Err(MetadataError::WrongKind.into());
        }
        Ok(array)
    }
    pub fn register(&self, plugin: MetadataValue) -> Result<(), JsException> {
        self.plugins()?.push(plugin)?;
        Ok(())
    }
    pub fn list(&self) -> Result<MetadataHandle, JsException> {
        let plugins = self.plugins()?;
        let length = plugins.length()?;
        let copy = self.0.graph().array()?;
        copy.set_length(length)?;
        for index in 0..length {
            let key = JsString::from(index.to_string());
            if plugins.has_property(key.clone())? {
                copy.set_index(index, plugins.get_property(key)?)?
            }
        }
        Ok(copy)
    }
    pub fn list_ids(&self) -> Result<Vec<MetadataValue>, JsException> {
        let plugins = self.plugins()?;
        let mut index = 0;
        let mut out = vec![];
        let mut seen = vec![];
        while index < plugins.length()? {
            let plugin = plugins.get_property(JsString::from(index.to_string()))?;
            index += 1;
            if matches!(plugin, MetadataValue::Missing | MetadataValue::Null) {
                continue;
            }
            if !get(&plugin, "id")?.is_truthy() {
                continue;
            }
            if seen.contains(&JsMapKey::from_value(&get(&plugin, "id")?)) {
                continue;
            }
            seen.push(JsMapKey::from_value(&get(&plugin, "id")?));
            out.push(get(&plugin, "id")?);
        }
        Ok(out)
    }
    fn optional_hook(&self, name: &str, args: Vec<MetadataValue>) -> Result<(), JsException> {
        let plugins = self.plugins()?;
        let mut index = 0;
        while index < plugins.length()? {
            let plugin = plugins.get_property(JsString::from(index.to_string()))?;
            index += 1;
            let hook = get(&plugin, name)?;
            if !matches!(hook, MetadataValue::Missing | MetadataValue::Null) {
                call(hook, plugin, args.clone())?;
            }
        }
        Ok(())
    }
    pub fn reset(&self) -> Result<(), JsException> {
        self.optional_hook("reset", vec![])?;
        self.0
            .set_property("cached", self.0.graph().object()?.into())?;
        Ok(())
    }
    pub fn capture_market_tick(&self, tick: &TickHandle) -> Result<(), JsException> {
        self.optional_hook("captureMarketTick", vec![tick.value()])
    }
    pub fn on_market_tick(
        &self,
        tick: &TickHandle,
        ctx: Option<&ContextHandle>,
    ) -> Result<(), JsException> {
        let message = tick.msg()?;
        let synthetic = matches!(get(&message,"event_type")?,MetadataValue::String(ref value) if value.matches("binance_agg_trade"))
            || matches!(get(&message,"event_type")?,MetadataValue::String(ref value) if value.matches("chainlink_round"));
        let plugins = self.plugins()?;
        let mut index = 0;
        while index < plugins.length()? {
            let plugin = plugins.get_property(JsString::from(index.to_string()))?;
            index += 1;
            if synthetic
                && !matches!(
                    get(&plugin, "handlesSyntheticTicks")?,
                    MetadataValue::Bool(true)
                )
            {
                continue;
            }
            let method = get(&plugin, "onMarketTick")?;
            call(
                method,
                plugin,
                vec![
                    tick.value(),
                    ctx.map(ContextHandle::value)
                        .unwrap_or(MetadataValue::Missing),
                ],
            )?;
        }
        self.0.set_property("cached", self.build_snapshot()?)?;
        Ok(())
    }
    pub fn snapshot(&self) -> Result<MetadataValue, JsException> {
        self.0.get_property("cached")
    }
    pub fn refresh_snapshot(&self) -> Result<MetadataValue, JsException> {
        self.0.set_property("cached", self.build_snapshot()?)?;
        self.snapshot()
    }
    fn build_snapshot(&self) -> Result<MetadataValue, JsException> {
        let snap = self.0.graph().object()?;
        let plugins = self.plugins()?;
        let mut index = 0;
        while index < plugins.length()? {
            let plugin = plugins.get_property(JsString::from(index.to_string()))?;
            index += 1;
            if matches!(plugin, MetadataValue::Missing | MetadataValue::Null) {
                continue;
            }
            if !get(&plugin, "id")?.is_truthy() {
                continue;
            }
            if !callable(&get(&plugin, "snapshot")?) {
                continue;
            }
            let value = call(get(&plugin, "snapshot")?, plugin.clone(), vec![])?;
            if matches!(value, MetadataValue::Missing) {
                continue;
            }
            snap.set_property(to_property_key(get(&plugin, "id")?)?, value)?;
        }
        Ok(snap.into())
    }
}
