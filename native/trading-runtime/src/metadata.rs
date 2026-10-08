//! Session-owned mutable metadata. Container edges are arena IDs, never roots.
//! Collection is incremental; public methods return owned values, not borrows.
use crate::{
    market_json::JsString,
    math::js_number_string,
    record::{FieldId, RecordHandle, RecordSchema, RecordStorage},
};
use num_bigint::BigInt;
use num_traits::Zero;
use std::{
    cell::RefCell,
    collections::{BTreeMap, HashSet, VecDeque},
    fmt,
    ops::Bound::{Excluded, Unbounded},
    rc::{Rc, Weak},
};

#[derive(Clone, Debug)]
pub enum MetadataValue {
    Missing,
    Null,
    Bool(bool),
    Number(f64),
    BigInt(BigInt),
    String(JsString),
    Reference(MetadataHandle),
}
impl MetadataValue {
    pub fn is_truthy(&self) -> bool {
        match self {
            Self::Missing | Self::Null => false,
            Self::Bool(x) => *x,
            Self::Number(x) => *x != 0.0 && !x.is_nan(),
            Self::BigInt(x) => !x.is_zero(),
            Self::String(x) => !x.is_empty(),
            Self::Reference(_) => true,
        }
    }
}
impl From<&str> for MetadataValue {
    fn from(x: &str) -> Self {
        Self::String(x.into())
    }
}
impl From<f64> for MetadataValue {
    fn from(x: f64) -> Self {
        Self::Number(x)
    }
}
impl From<MetadataHandle> for MetadataValue {
    fn from(x: MetadataHandle) -> Self {
        Self::Reference(x)
    }
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MetadataError {
    WrongGraph,
    StaleHandle,
    WrongKind,
    InvalidArrayIndex,
    CircularReference,
    OutputLimit,
    IdentityExhausted,
    WrongField,
    InvalidRecordSchema,
    BigIntSerialization,
}
impl fmt::Display for MetadataError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::WrongGraph => "metadata belongs to another session",
            Self::StaleHandle => "metadata handle is no longer live",
            Self::WrongKind => "metadata container has the wrong kind",
            Self::InvalidArrayIndex => "invalid JavaScript array index",
            Self::CircularReference => "Converting circular structure to JSON",
            Self::OutputLimit => "metadata JSON output limit exceeded",
            Self::IdentityExhausted => "metadata identity counter exhausted",
            Self::WrongField => "record field belongs to another schema",
            Self::InvalidRecordSchema => "record schema has duplicate fields",
            Self::BigIntSerialization => "Do not know how to serialize a BigInt",
        })
    }
}
impl std::error::Error for MetadataError {}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
struct Id {
    index: usize,
    generation: u64,
}
#[derive(Clone, Debug)]
enum Edge {
    Missing,
    Null,
    Bool(bool),
    Number(f64),
    BigInt(BigInt),
    String(JsString),
    Reference(Id),
}
#[derive(Debug, Default)]
struct Object {
    keys: BTreeMap<Vec<u16>, u64>,
    entries: BTreeMap<u64, (JsString, Edge)>,
    next_order: u64,
}
#[derive(Debug, Default)]
struct Array {
    entries: BTreeMap<u32, Edge>,
    length: u32,
}
#[derive(Debug)]
enum Container {
    Object(Object),
    Array(Array),
    Record(RecordStorage<Edge>),
}
impl Container {
    fn next_edge(&self, after: Option<u64>) -> Option<(u64, Option<Id>)> {
        let id = |x: &Edge| {
            if let Edge::Reference(id) = x {
                Some(*id)
            } else {
                None
            }
        };
        match self {
            Self::Object(x) => x
                .entries
                .range((after.map_or(Unbounded, Excluded), Unbounded))
                .next()
                .map(|(k, (_, v))| (*k, id(v))),
            Self::Record(x) => x.next(after).map(|(k, v)| (k, id(v))),
            Self::Array(x) => x
                .entries
                .range((after.map_or(Unbounded, |n| Excluded(n as u32)), Unbounded))
                .next()
                .map(|(k, v)| (*k as u64, id(v))),
        }
    }
    fn pop_entry(&mut self) -> bool {
        match self {
            Self::Object(x) => {
                if let Some((_, (key, _))) = x.entries.pop_last() {
                    x.keys.remove(&key.units());
                    true
                } else {
                    false
                }
            }
            Self::Array(x) => x.entries.pop_last().is_some(),
            Self::Record(x) => x.pop_entry(),
        }
    }
}
#[derive(Debug)]
struct Node {
    container: Container,
    roots: usize,
    previous_root: Option<Id>,
    next_root: Option<Id>,
    marked: u64,
    retiring: bool,
}
#[derive(Debug)]
struct Slot {
    generation: u64,
    node: Option<Node>,
}
#[derive(Clone, Copy, Debug)]
enum Phase {
    Idle,
    Roots(Option<Id>),
    Sweep(usize),
}
#[derive(Debug)]
struct Arena {
    slots: Vec<Slot>,
    free: Vec<usize>,
    root_head: Option<Id>,
    root_handles: usize,
    live_nodes: usize,
    epoch: u64,
    phase: Phase,
    work: VecDeque<(Id, Option<u64>)>,
    cycles: u64,
}
impl Default for Arena {
    fn default() -> Self {
        Self {
            slots: vec![],
            free: vec![],
            root_head: None,
            root_handles: 0,
            live_nodes: 0,
            epoch: 0,
            phase: Phase::Idle,
            work: VecDeque::new(),
            cycles: 0,
        }
    }
}
impl Arena {
    fn node(&self, id: Id) -> Result<&Node, MetadataError> {
        self.slots
            .get(id.index)
            .filter(|x| x.generation == id.generation)
            .and_then(|x| x.node.as_ref())
            .filter(|x| !x.retiring)
            .ok_or(MetadataError::StaleHandle)
    }
    fn node_mut(&mut self, id: Id) -> Result<&mut Node, MetadataError> {
        self.slots
            .get_mut(id.index)
            .filter(|x| x.generation == id.generation)
            .and_then(|x| x.node.as_mut())
            .filter(|x| !x.retiring)
            .ok_or(MetadataError::StaleHandle)
    }
    fn shade(&mut self, id: Id) {
        if matches!(self.phase, Phase::Idle) {
            return;
        }
        let epoch = self.epoch;
        if let Ok(x) = self.node_mut(id) {
            if x.marked != epoch {
                x.marked = epoch;
                self.work.push_back((id, None));
            }
        }
    }
    fn add_root(&mut self, id: Id) -> Result<(), MetadataError> {
        let first = self.node(id)?.roots == 0;
        let head = self.root_head;
        if first {
            self.node_mut(id)?.next_root = head;
            self.node_mut(id)?.previous_root = None;
            if let Some(old) = head {
                self.node_mut(old)?.previous_root = Some(id)
            }
            self.root_head = Some(id)
        }
        let x = self.node_mut(id)?;
        x.roots = x
            .roots
            .checked_add(1)
            .ok_or(MetadataError::IdentityExhausted)?;
        self.root_handles = self
            .root_handles
            .checked_add(1)
            .ok_or(MetadataError::IdentityExhausted)?;
        self.shade(id);
        Ok(())
    }
    fn remove_root(&mut self, id: Id) {
        let (previous, next, remove) = {
            let x = self.node_mut(id).expect("rooted metadata remains live");
            x.roots -= 1;
            (x.previous_root, x.next_root, x.roots == 0)
        };
        self.root_handles -= 1;
        if remove {
            if let Some(previous) = previous {
                self.node_mut(previous).expect("root list").next_root = next
            } else {
                self.root_head = next
            }
            if let Some(next) = next {
                self.node_mut(next).expect("root list").previous_root = previous
            }
            if matches!(self.phase,Phase::Roots(Some(cursor)) if cursor==id) {
                self.phase = Phase::Roots(next)
            }
            let x = self.node_mut(id).expect("root list");
            x.previous_root = None;
            x.next_root = None;
        }
    }
    fn allocate(&mut self, container: Container) -> Result<Id, MetadataError> {
        let index = if let Some(index) = self.free.pop() {
            index
        } else {
            let index = self.slots.len();
            self.slots.push(Slot {
                generation: 1,
                node: None,
            });
            index
        };
        let id = Id {
            index,
            generation: self.slots[index].generation,
        };
        self.slots[index].node = Some(Node {
            container,
            roots: 0,
            previous_root: None,
            next_root: None,
            marked: 0,
            retiring: false,
        });
        self.live_nodes += 1;
        self.add_root(id)?;
        Ok(id)
    }
    fn start(&mut self) -> Result<(), MetadataError> {
        self.epoch = self
            .epoch
            .checked_add(1)
            .ok_or(MetadataError::IdentityExhausted)?;
        self.phase = Phase::Roots(self.root_head);
        Ok(())
    }
    fn step(&mut self, budget: usize) -> Result<CollectionProgress, MetadataError> {
        let mut result = CollectionProgress::default();
        if budget == 0 {
            return Ok(result);
        }
        if matches!(self.phase, Phase::Idle) {
            self.start()?
        }
        while result.work < budget {
            if let Some((id, after)) = self.work.pop_front() {
                if let Ok(node) = self.node(id) {
                    if let Some((order, child)) = node.container.next_edge(after) {
                        self.work.push_back((id, Some(order)));
                        if let Some(child) = child {
                            self.shade(child)
                        }
                    }
                }
                result.work += 1;
                continue;
            }
            match self.phase {
                Phase::Idle => break,
                Phase::Roots(Some(id)) => {
                    let next = self.node(id)?.next_root;
                    self.phase = Phase::Roots(next);
                    self.shade(id);
                    result.work += 1;
                }
                Phase::Roots(None) => self.phase = Phase::Sweep(0),
                Phase::Sweep(index) => {
                    if index == self.slots.len() {
                        self.phase = Phase::Idle;
                        self.cycles += 1;
                        result.cycle_complete = true;
                        break;
                    }
                    let keep = self.slots[index]
                        .node
                        .as_ref()
                        .is_none_or(|x| x.marked == self.epoch);
                    if keep {
                        self.phase = Phase::Sweep(index + 1)
                    } else {
                        let x = self.slots[index].node.as_mut().expect("occupied slot");
                        debug_assert_eq!(x.roots, 0);
                        x.retiring = true;
                        if !x.container.pop_entry() {
                            self.slots[index].node = None;
                            self.live_nodes -= 1;
                            result.reclaimed += 1;
                            if let Some(generation) = self.slots[index].generation.checked_add(1) {
                                self.slots[index].generation = generation;
                                self.free.push(index)
                            }
                            self.phase = Phase::Sweep(index + 1)
                        }
                    }
                    result.work += 1;
                }
            }
        }
        Ok(result)
    }
}
#[derive(Default, Clone, Debug)]
pub struct MetadataGraph {
    inner: Rc<RefCell<Arena>>,
}
#[derive(Clone, Copy, Default, Debug, Eq, PartialEq)]
pub struct CollectionProgress {
    pub work: usize,
    pub reclaimed: usize,
    pub cycle_complete: bool,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GraphStats {
    pub live_nodes: usize,
    pub allocated_slots: usize,
    pub free_slots: usize,
    pub root_handles: usize,
    pub completed_cycles: u64,
    /// True once root/edge tracing has completed; weak white nodes cannot resurrect.
    pub sweeping: bool,
}
impl MetadataGraph {
    pub fn new() -> Self {
        Self::default()
    }
    /// Check session ownership without reading, mutating or serializing nodes.
    pub fn owns(&self, handle: &MetadataHandle) -> bool {
        Rc::ptr_eq(&self.inner, &handle.inner)
    }
    fn allocate(&self, container: Container) -> Result<MetadataHandle, MetadataError> {
        let id = self.inner.borrow_mut().allocate(container)?;
        Ok(MetadataHandle {
            inner: self.inner.clone(),
            id,
        })
    }
    pub fn object(&self) -> Result<MetadataHandle, MetadataError> {
        self.allocate(Container::Object(Object::default()))
    }
    pub fn array(&self) -> Result<MetadataHandle, MetadataError> {
        self.allocate(Container::Array(Array::default()))
    }
    pub fn record(
        &self,
        schema: &'static RecordSchema,
        properties: Vec<(JsString, MetadataValue)>,
    ) -> Result<RecordHandle, MetadataError> {
        schema.validate()?;
        let mut storage = RecordStorage::new(schema);
        for (key, value) in properties {
            let key = JsString::from_units(key.units());
            storage.set(key, self.edge(&value)?)?;
        }
        // Initial reference targets were rooted by the incoming values while converting.
        // The new root shades itself and all its nonrooted edges during active collection.
        RecordHandle::try_from_handle(self.allocate(Container::Record(storage))?)
    }
    pub fn collect_step(&self, budget: usize) -> Result<CollectionProgress, MetadataError> {
        self.inner.borrow_mut().step(budget)
    }
    /// Finish a pending conservative cycle, then collect from the current roots.
    /// Use collect_step with a fixed budget in the tick loop instead.
    pub fn collect_full(&self) -> Result<usize, MetadataError> {
        let mut reclaimed = 0;
        let active = !matches!(self.inner.borrow().phase, Phase::Idle);
        if active {
            loop {
                let x = self.collect_step(1024)?;
                reclaimed += x.reclaimed;
                if x.cycle_complete {
                    break;
                }
            }
        }
        loop {
            let x = self.collect_step(1024)?;
            reclaimed += x.reclaimed;
            if x.cycle_complete {
                break;
            }
        }
        Ok(reclaimed)
    }
    pub fn stats(&self) -> GraphStats {
        let x = self.inner.borrow();
        GraphStats {
            live_nodes: x.live_nodes,
            allocated_slots: x.slots.len(),
            free_slots: x.free.len(),
            root_handles: x.root_handles,
            completed_cycles: x.cycles,
            sweeping: matches!(x.phase, Phase::Sweep(_)),
        }
    }
    pub fn stringify(&self, value: &MetadataValue) -> Result<Option<String>, MetadataError> {
        self.stringify_with_limit(value, usize::MAX)
    }
    pub fn stringify_with_limit(
        &self,
        value: &MetadataValue,
        limit: usize,
    ) -> Result<Option<String>, MetadataError> {
        let edge = self.edge(value)?;
        if matches!(edge, Edge::Missing) {
            return Ok(None);
        }
        enum Write {
            Value(Edge),
            Text(String),
            Close(Id, char),
        }
        let mut stack = vec![Write::Value(edge)];
        let mut ancestors = HashSet::new();
        let mut out = String::new();
        let arena = self.inner.borrow();
        while let Some(item) = stack.pop() {
            match item {
                Write::Text(text) => out.push_str(&text),
                Write::Close(id, end) => {
                    ancestors.remove(&id);
                    out.push(end)
                }
                Write::Value(value) => match value {
                    Edge::Missing | Edge::Null => out.push_str("null"),
                    Edge::Bool(x) => out.push_str(if x { "true" } else { "false" }),
                    Edge::Number(x) => {
                        if x.is_finite() {
                            out.push_str(&js_number_string(x))
                        } else {
                            out.push_str("null")
                        }
                    }
                    Edge::BigInt(_) => return Err(MetadataError::BigIntSerialization),
                    Edge::String(x) => out.push_str(&x.json()),
                    Edge::Reference(id) => {
                        if !ancestors.insert(id) {
                            return Err(MetadataError::CircularReference);
                        }
                        match &arena.node(id)?.container {
                            Container::Object(object) => {
                                out.push('{');
                                stack.push(Write::Close(id, '}'));
                                let mut entries: Vec<_> = object
                                    .entries
                                    .iter()
                                    .filter(|(_, (_, v))| !matches!(v, Edge::Missing))
                                    .collect();
                                entries.sort_by_key(|(order, (key, _))| {
                                    (
                                        key.array_index().is_none(),
                                        key.array_index().map(u64::from).unwrap_or(**order),
                                    )
                                });
                                for (index, (_, (key, value))) in
                                    entries.into_iter().enumerate().rev()
                                {
                                    stack.push(Write::Value(value.clone()));
                                    stack.push(Write::Text(":".into()));
                                    stack.push(Write::Text(key.json()));
                                    if index != 0 {
                                        stack.push(Write::Text(",".into()))
                                    }
                                }
                            }
                            Container::Record(record) => {
                                out.push('{');
                                stack.push(Write::Close(id, '}'));
                                let mut entries: Vec<_> = record
                                    .entries()
                                    .filter(|(_, _, v)| !matches!(v, Edge::Missing))
                                    .collect();
                                entries.sort_by_key(|(order, key, _)| {
                                    (
                                        key.array_index().is_none(),
                                        key.array_index().map(u64::from).unwrap_or(*order),
                                    )
                                });
                                for (index, (_, key, value)) in
                                    entries.into_iter().enumerate().rev()
                                {
                                    stack.push(Write::Value(value.clone()));
                                    stack.push(Write::Text(":".into()));
                                    stack.push(Write::Text(key.json()));
                                    if index != 0 {
                                        stack.push(Write::Text(",".into()));
                                    }
                                }
                            }
                            Container::Array(array) => {
                                out.push('[');
                                stack.push(Write::Close(id, ']'));
                                // Array holes and undefined entries stringify as null. A caller limit
                                // bounds the scheduled work as well as the produced bytes.
                                if array.length as usize > limit.saturating_sub(out.len()) / 2 {
                                    return Err(MetadataError::OutputLimit);
                                }
                                for index in (0..array.length).rev() {
                                    stack.push(Write::Value(
                                        array.entries.get(&index).cloned().unwrap_or(Edge::Missing),
                                    ));
                                    if index != 0 {
                                        stack.push(Write::Text(",".into()))
                                    }
                                }
                            }
                        }
                    }
                },
            }
            if out.len() > limit {
                return Err(MetadataError::OutputLimit);
            }
        }
        Ok(Some(out))
    }
    fn edge(&self, value: &MetadataValue) -> Result<Edge, MetadataError> {
        Ok(match value {
            MetadataValue::Missing => Edge::Missing,
            MetadataValue::Null => Edge::Null,
            MetadataValue::Bool(x) => Edge::Bool(*x),
            MetadataValue::Number(x) => Edge::Number(*x),
            MetadataValue::BigInt(x) => Edge::BigInt(x.clone()),
            MetadataValue::String(x) => Edge::String(x.clone()),
            MetadataValue::Reference(x) => {
                if !Rc::ptr_eq(&self.inner, &x.inner) {
                    return Err(MetadataError::WrongGraph);
                }
                self.inner.borrow().node(x.id)?;
                Edge::Reference(x.id)
            }
        })
    }
    fn value(&self, value: Edge) -> Result<MetadataValue, MetadataError> {
        Ok(match value {
            Edge::Missing => MetadataValue::Missing,
            Edge::Null => MetadataValue::Null,
            Edge::Bool(x) => MetadataValue::Bool(x),
            Edge::Number(x) => MetadataValue::Number(x),
            Edge::BigInt(x) => MetadataValue::BigInt(x),
            Edge::String(x) => MetadataValue::String(x),
            Edge::Reference(id) => {
                self.inner.borrow_mut().add_root(id)?;
                MetadataValue::Reference(MetadataHandle {
                    inner: self.inner.clone(),
                    id,
                })
            }
        })
    }
}
/// A retained root. Cloning preserves identity; dropping releases only this root.
pub struct MetadataHandle {
    inner: Rc<RefCell<Arena>>,
    id: Id,
}
impl Clone for MetadataHandle {
    fn clone(&self) -> Self {
        self.inner
            .borrow_mut()
            .add_root(self.id)
            .expect("root clone");
        Self {
            inner: self.inner.clone(),
            id: self.id,
        }
    }
}
impl Drop for MetadataHandle {
    fn drop(&mut self) {
        self.inner.borrow_mut().remove_root(self.id)
    }
}
impl fmt::Debug for MetadataHandle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MetadataHandle")
            .field("index", &self.id.index)
            .field("generation", &self.id.generation)
            .finish()
    }
}
impl PartialEq for MetadataHandle {
    fn eq(&self, x: &Self) -> bool {
        Rc::ptr_eq(&self.inner, &x.inner) && self.id == x.id
    }
}
impl Eq for MetadataHandle {}
#[derive(Clone, Debug)]
pub struct WeakMetadataHandle {
    inner: Weak<RefCell<Arena>>,
    id: Id,
}
impl WeakMetadataHandle {
    pub fn upgrade(&self) -> Option<MetadataHandle> {
        let inner = self.inner.upgrade()?;
        {
            let mut arena = inner.borrow_mut();
            let node = arena.node(self.id).ok()?;
            if matches!(arena.phase, Phase::Sweep(_)) && node.marked != arena.epoch {
                return None;
            }
            arena.add_root(self.id).ok()?;
        }
        Some(MetadataHandle { inner, id: self.id })
    }
}
impl MetadataHandle {
    pub fn graph(&self) -> MetadataGraph {
        MetadataGraph {
            inner: self.inner.clone(),
        }
    }
    pub fn downgrade(&self) -> WeakMetadataHandle {
        WeakMetadataHandle {
            inner: Rc::downgrade(&self.inner),
            id: self.id,
        }
    }
    pub fn is_array(&self) -> bool {
        matches!(
            self.inner.borrow().node(self.id).expect("root").container,
            Container::Array(_)
        )
    }
    pub fn stringify(&self) -> Result<Option<String>, MetadataError> {
        self.graph()
            .stringify(&MetadataValue::Reference(self.clone()))
    }
    pub fn set(&self, key: impl Into<JsString>, value: MetadataValue) -> Result<(), MetadataError> {
        let units = key.into().units();
        // Public JsString variants can encode the same logical key differently.
        // Canonicalize valid UTF-16 so numeric-key ordering depends on its value.
        let key = JsString::from_units(units.clone());
        let graph = self.graph();
        let edge = graph.edge(&value)?;
        let target = if let Edge::Reference(id) = edge {
            Some(id)
        } else {
            None
        };
        let mut arena = self.inner.borrow_mut();
        match &mut arena.node_mut(self.id)?.container {
            Container::Object(object) => {
                if let Some(order) = object.keys.get(&units) {
                    object.entries.get_mut(order).expect("object key").1 = edge;
                } else {
                    let order = object.next_order;
                    object.next_order = order
                        .checked_add(1)
                        .ok_or(MetadataError::IdentityExhausted)?;
                    object.keys.insert(units, order);
                    object.entries.insert(order, (key, edge));
                }
            }
            Container::Record(record) => record.set(key, edge)?,
            Container::Array(_) => return Err(MetadataError::WrongKind),
        }
        if let Some(target) = target {
            arena.shade(target)
        }
        Ok(())
    }
    pub fn get(&self, key: impl Into<JsString>) -> Result<MetadataValue, MetadataError> {
        let key = key.into();
        let edge = {
            let arena = self.inner.borrow();
            match &arena.node(self.id)?.container {
                Container::Object(object) => object
                    .keys
                    .get(&key.units())
                    .and_then(|order| object.entries.get(order))
                    .map_or(Edge::Missing, |(_, v)| v.clone()),
                Container::Record(record) => record.get(&key).cloned().unwrap_or(Edge::Missing),
                Container::Array(_) => return Err(MetadataError::WrongKind),
            }
        };
        self.graph().value(edge)
    }
    pub fn delete(&self, key: impl Into<JsString>) -> Result<bool, MetadataError> {
        let key = key.into();
        let mut arena = self.inner.borrow_mut();
        match &mut arena.node_mut(self.id)?.container {
            Container::Object(object) => {
                if let Some(order) = object.keys.remove(&key.units()) {
                    object.entries.remove(&order);
                    Ok(true)
                } else {
                    Ok(false)
                }
            }
            Container::Record(record) => Ok(record.delete(&key)),
            Container::Array(_) => Err(MetadataError::WrongKind),
        }
    }
    pub fn keys(&self) -> Result<Vec<JsString>, MetadataError> {
        let arena = self.inner.borrow();
        let mut entries: Vec<(u64, JsString)> = match &arena.node(self.id)?.container {
            Container::Object(object) => object
                .entries
                .iter()
                .map(|(order, (key, _))| (*order, key.clone()))
                .collect(),
            Container::Record(record) => record
                .entries()
                .map(|(order, key, _)| (order, key))
                .collect(),
            Container::Array(_) => return Err(MetadataError::WrongKind),
        };
        entries.sort_by_key(|(order, key)| {
            (
                key.array_index().is_none(),
                key.array_index().map(u64::from).unwrap_or(*order),
            )
        });
        Ok(entries.into_iter().map(|(_, key)| key).collect())
    }
    pub(crate) fn record_schema(&self) -> Result<&'static RecordSchema, MetadataError> {
        let arena = self.inner.borrow();
        let Container::Record(record) = &arena.node(self.id)?.container else {
            return Err(MetadataError::WrongKind);
        };
        Ok(record.schema)
    }
    pub(crate) fn record_get(&self, field: FieldId) -> Result<MetadataValue, MetadataError> {
        let edge = {
            let arena = self.inner.borrow();
            let Container::Record(record) = &arena.node(self.id)?.container else {
                return Err(MetadataError::WrongKind);
            };
            record.get_field(field)?.cloned().unwrap_or(Edge::Missing)
        };
        self.graph().value(edge)
    }
    pub(crate) fn record_number(&self, field: FieldId) -> Result<Option<f64>, MetadataError> {
        let arena = self.inner.borrow();
        let Container::Record(record) = &arena.node(self.id)?.container else {
            return Err(MetadataError::WrongKind);
        };
        Ok(match record.get_field(field)? {
            Some(Edge::Number(value)) => Some(*value),
            _ => None,
        })
    }
    pub(crate) fn record_has(&self, field: FieldId) -> Result<bool, MetadataError> {
        let arena = self.inner.borrow();
        let Container::Record(record) = &arena.node(self.id)?.container else {
            return Err(MetadataError::WrongKind);
        };
        Ok(record.get_field(field)?.is_some())
    }
    pub(crate) fn record_delete(&self, field: FieldId) -> Result<bool, MetadataError> {
        let mut arena = self.inner.borrow_mut();
        let Container::Record(record) = &mut arena.node_mut(self.id)?.container else {
            return Err(MetadataError::WrongKind);
        };
        record.delete_field(field)
    }
    pub(crate) fn record_set(
        &self,
        field: FieldId,
        value: MetadataValue,
    ) -> Result<(), MetadataError> {
        let edge = self.graph().edge(&value)?;
        let target = if let Edge::Reference(id) = edge {
            Some(id)
        } else {
            None
        };
        let mut arena = self.inner.borrow_mut();
        let Container::Record(record) = &mut arena.node_mut(self.id)?.container else {
            return Err(MetadataError::WrongKind);
        };
        record.set_field(field, edge)?;
        if let Some(target) = target {
            arena.shade(target)
        }
        Ok(())
    }
    pub fn length(&self) -> Result<u32, MetadataError> {
        let arena = self.inner.borrow();
        let Container::Array(array) = &arena.node(self.id)?.container else {
            return Err(MetadataError::WrongKind);
        };
        Ok(array.length)
    }
    pub fn push(&self, value: MetadataValue) -> Result<(), MetadataError> {
        self.set_index(self.length()?, value)
    }
    pub fn set_index(&self, index: u32, value: MetadataValue) -> Result<(), MetadataError> {
        if index == u32::MAX {
            return Err(MetadataError::InvalidArrayIndex);
        }
        let edge = self.graph().edge(&value)?;
        let target = if let Edge::Reference(id) = edge {
            Some(id)
        } else {
            None
        };
        let mut arena = self.inner.borrow_mut();
        let Container::Array(array) = &mut arena.node_mut(self.id)?.container else {
            return Err(MetadataError::WrongKind);
        };
        array.length = array.length.max(index + 1);
        array.entries.insert(index, edge);
        if let Some(target) = target {
            arena.shade(target)
        }
        Ok(())
    }
    /// Own present array indices in numeric order, including own undefined.
    /// Holes are absent even though get_index returns Missing for both cases.
    pub fn index_keys(&self) -> Result<Vec<u32>, MetadataError> {
        let arena = self.inner.borrow();
        let Container::Array(array) = &arena.node(self.id)?.container else {
            return Err(MetadataError::WrongKind);
        };
        Ok(array.entries.keys().copied().collect())
    }
    pub fn get_index(&self, index: u32) -> Result<MetadataValue, MetadataError> {
        let edge = {
            let arena = self.inner.borrow();
            let Container::Array(array) = &arena.node(self.id)?.container else {
                return Err(MetadataError::WrongKind);
            };
            array.entries.get(&index).cloned().unwrap_or(Edge::Missing)
        };
        self.graph().value(edge)
    }
    pub fn delete_index(&self, index: u32) -> Result<bool, MetadataError> {
        let mut arena = self.inner.borrow_mut();
        let Container::Array(array) = &mut arena.node_mut(self.id)?.container else {
            return Err(MetadataError::WrongKind);
        };
        Ok(array.entries.remove(&index).is_some())
    }
    pub fn set_length(&self, length: u32) -> Result<(), MetadataError> {
        let mut arena = self.inner.borrow_mut();
        let Container::Array(array) = &mut arena.node_mut(self.id)?.container else {
            return Err(MetadataError::WrongKind);
        };
        array.entries.split_off(&length);
        array.length = length;
        Ok(())
    }
}
