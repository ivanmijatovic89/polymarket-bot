//! Typed record schemas and direct slots in the shared session graph.
//! Schema fields bind an index to one static schema; own order comes from ingress.
use crate::{
    market_json::JsString,
    metadata::{MetadataError, MetadataHandle, MetadataValue},
};
use std::{
    collections::BTreeMap,
    ops::Bound::{Excluded, Unbounded},
};

#[derive(Debug)]
pub struct RecordSchema {
    name: &'static str,
    fields: &'static [&'static str],
}
impl RecordSchema {
    pub const fn new(name: &'static str, fields: &'static [&'static str]) -> Self {
        Self { name, fields }
    }
    pub const fn field(&'static self, index: usize) -> FieldId {
        assert!(index < self.fields.len());
        FieldId {
            schema: self,
            index,
        }
    }
    pub fn name(&self) -> &'static str {
        self.name
    }
    pub fn fields(&self) -> &'static [&'static str] {
        self.fields
    }
    pub(crate) fn validate(&self) -> Result<(), MetadataError> {
        for (i, field) in self.fields.iter().enumerate() {
            if self.fields[..i].contains(field) {
                return Err(MetadataError::InvalidRecordSchema);
            }
        }
        Ok(())
    }
    fn index(&self, key: &JsString) -> Option<usize> {
        let units = key.units();
        self.fields
            .iter()
            .position(|field| field.encode_utf16().eq(units.iter().copied()))
    }
}
#[derive(Clone, Copy, Debug)]
pub struct FieldId {
    schema: &'static RecordSchema,
    index: usize,
}
impl FieldId {
    pub fn schema(self) -> &'static RecordSchema {
        self.schema
    }
    pub fn index(self) -> usize {
        self.index
    }
    pub fn name(self) -> &'static str {
        self.schema.fields[self.index]
    }
}

/// One rooted record identity; its scalar slots and extension edges live in the arena.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecordHandle(MetadataHandle);
impl RecordHandle {
    pub fn try_from_handle(handle: MetadataHandle) -> Result<Self, MetadataError> {
        handle.record_schema()?;
        Ok(Self(handle))
    }
    pub fn schema(&self) -> &'static RecordSchema {
        self.0.record_schema().expect("rooted record")
    }
    pub fn as_handle(&self) -> &MetadataHandle {
        &self.0
    }
    pub fn into_handle(self) -> MetadataHandle {
        self.0
    }
    pub fn get_field(&self, field: FieldId) -> Result<MetadataValue, MetadataError> {
        self.0.record_get(field)
    }
    pub fn set_field(&self, field: FieldId, value: MetadataValue) -> Result<(), MetadataError> {
        self.0.record_set(field, value)
    }
    pub fn delete_field(&self, field: FieldId) -> Result<bool, MetadataError> {
        self.0.record_delete(field)
    }
    pub fn has_field(&self, field: FieldId) -> Result<bool, MetadataError> {
        self.0.record_has(field)
    }
    /// Reads only a Number slot; absence and other JavaScript types return None.
    /// Callers implement the exact domain coercion instead of applying a default here.
    pub fn number(&self, field: FieldId) -> Result<Option<f64>, MetadataError> {
        self.0.record_number(field)
    }
}
impl From<RecordHandle> for MetadataValue {
    fn from(handle: RecordHandle) -> Self {
        MetadataValue::Reference(handle.into_handle())
    }
}

#[derive(Clone, Copy, Debug)]
enum Location {
    Known(usize),
    Extra,
}
/// Generic over the private nonrooted arena edge. No exposed handle is stored here.
#[derive(Debug)]
pub(crate) struct RecordStorage<V> {
    pub(crate) schema: &'static RecordSchema,
    slots: Vec<Option<(u64, V)>>,
    extras: BTreeMap<u64, (JsString, V)>,
    extra_keys: BTreeMap<Vec<u16>, u64>,
    order: BTreeMap<u64, Location>,
    next_order: u64,
}
impl<V> RecordStorage<V> {
    pub(crate) fn new(schema: &'static RecordSchema) -> Self {
        Self {
            schema,
            slots: (0..schema.fields.len()).map(|_| None).collect(),
            extras: BTreeMap::new(),
            extra_keys: BTreeMap::new(),
            order: BTreeMap::new(),
            next_order: 0,
        }
    }
    fn check(&self, field: FieldId) -> Result<usize, MetadataError> {
        if std::ptr::eq(field.schema, self.schema) && field.index < self.slots.len() {
            Ok(field.index)
        } else {
            Err(MetadataError::WrongField)
        }
    }
    fn new_order(&mut self) -> Result<u64, MetadataError> {
        let order = self.next_order;
        self.next_order = order
            .checked_add(1)
            .ok_or(MetadataError::IdentityExhausted)?;
        Ok(order)
    }
    pub(crate) fn get_field(&self, field: FieldId) -> Result<Option<&V>, MetadataError> {
        Ok(self.slots[self.check(field)?].as_ref().map(|(_, v)| v))
    }
    pub(crate) fn set_field(&mut self, field: FieldId, value: V) -> Result<(), MetadataError> {
        let index = self.check(field)?;
        if let Some((_, old)) = &mut self.slots[index] {
            *old = value;
        } else {
            let order = self.new_order()?;
            self.slots[index] = Some((order, value));
            self.order.insert(order, Location::Known(index));
        }
        Ok(())
    }
    pub(crate) fn delete_field(&mut self, field: FieldId) -> Result<bool, MetadataError> {
        let index = self.check(field)?;
        if let Some((order, _)) = self.slots[index].take() {
            self.order.remove(&order);
            Ok(true)
        } else {
            Ok(false)
        }
    }
    pub(crate) fn get(&self, key: &JsString) -> Option<&V> {
        if let Some(index) = self.schema.index(key) {
            self.slots[index].as_ref().map(|(_, v)| v)
        } else {
            self.extra_keys
                .get(&key.units())
                .and_then(|order| self.extras.get(order))
                .map(|(_, v)| v)
        }
    }
    pub(crate) fn set(&mut self, key: JsString, value: V) -> Result<(), MetadataError> {
        if let Some(index) = self.schema.index(&key) {
            return self.set_field(self.schema.field(index), value);
        }
        let units = key.units();
        if let Some(order) = self.extra_keys.get(&units) {
            self.extras.get_mut(order).expect("extra key").1 = value;
        } else {
            let order = self.new_order()?;
            self.extra_keys.insert(units, order);
            self.extras.insert(order, (key, value));
            self.order.insert(order, Location::Extra);
        }
        Ok(())
    }
    pub(crate) fn delete(&mut self, key: &JsString) -> bool {
        if let Some(index) = self.schema.index(key) {
            return self
                .delete_field(self.schema.field(index))
                .expect("own schema");
        }
        if let Some(order) = self.extra_keys.remove(&key.units()) {
            self.extras.remove(&order);
            self.order.remove(&order);
            true
        } else {
            false
        }
    }
    fn entry(&self, order: u64, location: Location) -> (JsString, &V) {
        match location {
            Location::Known(index) => (
                JsString::from(self.schema.fields[index]),
                &self.slots[index].as_ref().expect("known order").1,
            ),
            Location::Extra => {
                let (key, value) = self.extras.get(&order).expect("extra order");
                (key.clone(), value)
            }
        }
    }
    pub(crate) fn entries(&self) -> impl Iterator<Item = (u64, JsString, &V)> {
        self.order.iter().map(|(order, location)| {
            let (key, value) = self.entry(*order, *location);
            (*order, key, value)
        })
    }
    pub(crate) fn next(&self, after: Option<u64>) -> Option<(u64, &V)> {
        self.order
            .range((after.map_or(Unbounded, Excluded), Unbounded))
            .next()
            .map(|(order, location)| (*order, self.entry(*order, *location).1))
    }
    pub(crate) fn pop_entry(&mut self) -> bool {
        if let Some((order, location)) = self.order.pop_last() {
            match location {
                Location::Known(index) => {
                    self.slots[index] = None;
                }
                Location::Extra => {
                    let (key, _) = self.extras.remove(&order).expect("extra order");
                    self.extra_keys.remove(&key.units());
                }
            }
            true
        } else {
            false
        }
    }
}
