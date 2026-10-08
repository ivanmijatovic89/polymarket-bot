//! Session Object.prototype foundation. Further primitive/function/array
//! intrinsics are required separately; this module does not claim a JS VM.
use crate::metadata::*;
fn proto_get(frame: &CallFrame) -> Result<MetadataValue, JsException> {
    let MetadataValue::Reference(receiver) = &frame.receiver else {
        return Err(MetadataError::WrongKind.into());
    };
    Ok(receiver
        .prototype()?
        .map(MetadataValue::Reference)
        .unwrap_or(MetadataValue::Null))
}
fn proto_set(frame: &CallFrame) -> Result<MetadataValue, JsException> {
    let MetadataValue::Reference(receiver) = &frame.receiver else {
        return Ok(MetadataValue::Missing);
    };
    match frame.arguments.first().unwrap_or(&MetadataValue::Missing) {
        MetadataValue::Reference(prototype) => receiver.set_prototype(Some(prototype))?,
        MetadataValue::Null => receiver.set_prototype(None)?,
        _ => (),
    }
    Ok(MetadataValue::Missing)
}
fn object_to_string(frame: &CallFrame) -> Result<MetadataValue, JsException> {
    let tag = match &frame.receiver {
        MetadataValue::Missing => "Undefined",
        MetadataValue::Null => "Null",
        MetadataValue::Bool(_) => "Boolean",
        MetadataValue::Number(_) => "Number",
        MetadataValue::BigInt(_) => "BigInt",
        MetadataValue::String(_) => "String",
        MetadataValue::Reference(handle) => {
            if handle.is_callable() {
                "Function"
            } else if handle.is_array() {
                "Array"
            } else {
                "Object"
            }
        }
    };
    Ok(MetadataValue::String(format!("[object {tag}]").into()))
}
fn object_value_of(frame: &CallFrame) -> Result<MetadataValue, JsException> {
    match &frame.receiver {
        MetadataValue::Reference(_) => Ok(frame.receiver.clone()),
        _ => Err(MetadataError::WrongKind.into()),
    }
}
/// Initialize before Portfolio/engine/strategy factories allocate SDK objects.
/// The single intrinsic root persists across market rotation in this session.
pub fn ensure_object_prototype(graph: &MetadataGraph) -> Result<MetadataHandle, MetadataError> {
    if let Some(prototype) = graph.default_object_prototype()? {
        return Ok(prototype);
    }
    let prototype = graph.object()?;
    prototype.make_prototype_immutable()?;
    let getter = graph.function(proto_get, vec![])?;
    let setter = graph.function(proto_set, vec![])?;
    getter.set_prototype(Some(&prototype))?;
    setter.set_prototype(Some(&prototype))?;
    prototype.define_accessor_property(
        "__proto__",
        AccessorPropertyDefinition {
            get: Some(Some(getter)),
            set: Some(Some(setter)),
            enumerable: Some(false),
            configurable: Some(true),
        },
    )?;
    for (name, callback) in [
        ("toString", object_to_string as NativeCallback),
        ("valueOf", object_value_of as NativeCallback),
    ] {
        let function = graph.function(callback, vec![])?;
        function.set_prototype(Some(&prototype))?;
        prototype.define_data_property(
            name,
            DataPropertyDefinition {
                value: Some(function.into()),
                writable: Some(true),
                enumerable: Some(false),
                configurable: Some(true),
            },
        )?;
    }
    graph.install_object_prototype(&prototype)?;
    Ok(prototype)
}
