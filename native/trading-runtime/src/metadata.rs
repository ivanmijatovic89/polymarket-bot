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
    hash::{Hash, Hasher},
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
    FrozenProperty,
    NotCallable,
    CyclicPrototype,
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
            Self::FrozenProperty => "Cannot mutate a frozen property",
            Self::NotCallable => "value is not callable",
            Self::CyclicPrototype => "Cyclic prototype value",
        })
    }
}
impl std::error::Error for MetadataError {}
/// A JavaScript throw retains its primitive/reference identity. Internal graph
/// failures are kept distinct until the runtime maps them to native JS errors.
#[derive(Clone, Debug)]
pub enum JsException {
    Native(MetadataError),
    Thrown(MetadataValue),
}
impl From<MetadataError> for JsException {
    fn from(value: MetadataError) -> Self {
        Self::Native(value)
    }
}
impl fmt::Display for JsException {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Native(error) => error.fmt(f),
            Self::Thrown(_) => f.write_str("JavaScript callback threw a value"),
        }
    }
}
impl std::error::Error for JsException {}
/// No rooted closure is stored in the arena. Captures are arena edges and only
/// become temporary roots while a call frame is owned by the invocation.
pub type NativeCallback = fn(&CallFrame) -> Result<MetadataValue, JsException>;
#[derive(Debug)]
pub struct CallFrame {
    pub callee: MetadataHandle,
    pub receiver: MetadataValue,
    pub arguments: Vec<MetadataValue>,
    pub captures: Vec<MetadataValue>,
}
#[derive(Debug)]
struct Callable {
    callback: NativeCallback,
    captures: Vec<Edge>,
}
#[derive(Clone, Copy, Debug)]
enum TraceCursor {
    Prototype,
    Captures(usize),
    Properties(Option<u64>),
    SecondPropertyEdge { after: u64, target: Id },
}
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
    Accessor { get: Option<Id>, set: Option<Id> },
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
    fn next_edge(&self, after: Option<u64>) -> Option<(u64, Option<Id>, Option<Id>)> {
        let id = |x: &Edge| match x {
            Edge::Reference(id) => (Some(*id), None),
            Edge::Accessor { get, set } => match (get, set) {
                (Some(get), set) => (Some(*get), *set),
                (None, set) => (*set, None),
            },
            _ => (None, None),
        };
        match self {
            Self::Object(x) => x
                .entries
                .range((after.map_or(Unbounded, Excluded), Unbounded))
                .next()
                .map(|(k, (_, v))| {
                    let (first, second) = id(v);
                    (*k, first, second)
                }),
            Self::Record(x) => x.next(after).map(|(k, v)| {
                let (first, second) = id(v);
                (k, first, second)
            }),
            Self::Array(x) => x
                .entries
                .range((after.map_or(Unbounded, |n| Excluded(n as u32)), Unbounded))
                .next()
                .map(|(k, v)| {
                    let (first, second) = id(v);
                    (*k as u64, first, second)
                }),
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
    frozen: bool,
    extensible: bool,
    attributes: BTreeMap<Vec<u16>, DataAttributes>,
    prototype: Option<Id>,
    callable: Option<Callable>,
    immutable_prototype: bool,
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
    work: VecDeque<(Id, TraceCursor)>,
    cycles: u64,
    default_object_prototype: Option<Id>,
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
            default_object_prototype: None,
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
                self.work.push_back((id, TraceCursor::Prototype));
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
            frozen: false,
            extensible: true,
            attributes: BTreeMap::new(),
            prototype: self.default_object_prototype,
            callable: None,
            immutable_prototype: false,
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
                    let next = match after {
                        TraceCursor::Prototype => Some((TraceCursor::Captures(0), node.prototype)),
                        TraceCursor::Captures(index) => {
                            match node.callable.as_ref().and_then(|f| f.captures.get(index)) {
                                Some(edge) => Some((
                                    TraceCursor::Captures(index + 1),
                                    if let Edge::Reference(child) = edge {
                                        Some(*child)
                                    } else {
                                        None
                                    },
                                )),
                                None => Some((TraceCursor::Properties(None), None)),
                            }
                        }
                        TraceCursor::Properties(after) => {
                            node.container
                                .next_edge(after)
                                .map(|(order, child, second)| {
                                    (
                                        second.map_or(
                                            TraceCursor::Properties(Some(order)),
                                            |target| TraceCursor::SecondPropertyEdge {
                                                after: order,
                                                target,
                                            },
                                        ),
                                        child,
                                    )
                                })
                        }
                        TraceCursor::SecondPropertyEdge { after, target } => {
                            Some((TraceCursor::Properties(Some(after)), Some(target)))
                        }
                    };
                    if let Some((cursor, child)) = next {
                        self.work.push_back((id, cursor));
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
                        x.prototype = None;
                        if x.callable
                            .as_mut()
                            .is_some_and(|f| f.captures.pop().is_some())
                        {
                            result.work += 1;
                            continue;
                        }
                        x.callable = None;
                        let key = match &x.container {
                            Container::Object(object) => object
                                .entries
                                .last_key_value()
                                .map(|(_, (key, _))| key.units()),
                            Container::Record(record) => record.last_key().map(|key| key.units()),
                            Container::Array(_) => None,
                        };
                        if let Some(key) = key {
                            x.attributes.remove(&key);
                        }
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
    pub fn default_object_prototype(&self) -> Result<Option<MetadataHandle>, MetadataError> {
        let id = self.inner.borrow().default_object_prototype;
        id.map(|id| match self.value(Edge::Reference(id))? {
            MetadataValue::Reference(handle) => Ok(handle),
            _ => unreachable!(),
        })
        .transpose()
    }
    /// A bounded session intrinsic root, stored as an arena ID without an Rc
    /// backedge. Retained objects independently preserve old prototypes.
    pub fn install_object_prototype(
        &self,
        prototype: &MetadataHandle,
    ) -> Result<(), MetadataError> {
        if !self.owns(prototype) {
            return Err(MetadataError::WrongGraph);
        }
        let mut arena = self.inner.borrow_mut();
        if arena.default_object_prototype == Some(prototype.id) {
            return Ok(());
        }
        arena.add_root(prototype.id)?;
        let previous = arena.default_object_prototype.replace(prototype.id);
        if let Some(previous) = previous {
            arena.remove_root(previous)
        }
        Ok(())
    }
    pub fn object(&self) -> Result<MetadataHandle, MetadataError> {
        self.allocate(Container::Object(Object::default()))
    }
    pub fn function(
        &self,
        callback: NativeCallback,
        captures: Vec<MetadataValue>,
    ) -> Result<MetadataHandle, MetadataError> {
        let edges = captures
            .iter()
            .map(|v| self.edge(v))
            .collect::<Result<Vec<_>, _>>()?;
        let function = self.object()?;
        let mut arena = self.inner.borrow_mut();
        for edge in &edges {
            if let Edge::Reference(id) = edge {
                arena.shade(*id)
            }
        }
        arena.node_mut(function.id)?.callable = Some(Callable {
            callback,
            captures: edges,
        });
        Ok(function)
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
        if matches!(edge, Edge::Missing)
            || matches!(&edge,Edge::Reference(id) if self.inner.borrow().node(*id)?.callable.is_some())
        {
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
                    Edge::Accessor { .. } => return Err(MetadataError::WrongKind),
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
                        if arena.node(id)?.callable.is_some() {
                            out.push_str("null");
                            continue;
                        }
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
                                    .filter(|(_, (key, v))| {
                                        !matches!(v, Edge::Missing)
                                            && !matches!(v,Edge::Reference(child) if arena.node(*child).expect("live edge").callable.is_some())
                                            && arena
                                                .node(id)
                                                .expect("root")
                                                .data_attributes(key)
                                                .enumerable
                                    })
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
                                    .filter(|(_, key, v)| {
                                        !matches!(v, Edge::Missing)
                                            && !matches!(v,Edge::Reference(child) if arena.node(*child).expect("live edge").callable.is_some())
                                            && arena
                                                .node(id)
                                                .expect("root")
                                                .data_attributes(key)
                                                .enumerable
                                    })
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
            Edge::Accessor { .. } => return Err(MetadataError::WrongKind),
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
impl Hash for MetadataHandle {
    fn hash<H: Hasher>(&self, state: &mut H) {
        Rc::as_ptr(&self.inner).hash(state);
        self.id.hash(state);
    }
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct DataAttributes {
    writable: bool,
    enumerable: bool,
    configurable: bool,
}
impl Default for DataAttributes {
    fn default() -> Self {
        Self {
            writable: true,
            enumerable: true,
            configurable: true,
        }
    }
}
#[derive(Clone, Debug, Default)]
pub struct DataPropertyDefinition {
    pub value: Option<MetadataValue>,
    pub writable: Option<bool>,
    pub enumerable: Option<bool>,
    pub configurable: Option<bool>,
}
fn same_edge(a: &Edge, b: &Edge) -> bool {
    match (a, b) {
        (Edge::Missing, Edge::Missing) | (Edge::Null, Edge::Null) => true,
        (Edge::Bool(a), Edge::Bool(b)) => a == b,
        (Edge::Number(a), Edge::Number(b)) => {
            (a.is_nan() && b.is_nan()) || a.to_bits() == b.to_bits()
        }
        (Edge::BigInt(a), Edge::BigInt(b)) => a == b,
        (Edge::String(a), Edge::String(b)) => a == b,
        (Edge::Reference(a), Edge::Reference(b)) => a == b,
        (Edge::Accessor { get: a, set: b }, Edge::Accessor { get: c, set: d }) => a == c && b == d,
        _ => false,
    }
}
impl Node {
    fn data_attributes(&self, key: &JsString) -> DataAttributes {
        let mut attrs = self
            .attributes
            .get(&key.units())
            .copied()
            .unwrap_or_default();
        if self.frozen {
            attrs.writable = false;
            attrs.configurable = false;
        }
        attrs
    }
    fn own_data(&self, key: &JsString) -> Result<Option<Edge>, MetadataError> {
        Ok(match &self.container {
            Container::Object(object) => object
                .keys
                .get(&key.units())
                .and_then(|order| object.entries.get(order))
                .map(|(_, value)| value.clone()),
            Container::Record(record) => record.get(key).cloned(),
            Container::Array(_) => return Err(MetadataError::WrongKind),
        })
    }
}

/// Owned observation of one current own data property, never a borrow guard.
#[derive(Clone, Debug)]
pub struct DataPropertyDescriptor {
    pub value: MetadataValue,
    pub writable: bool,
    pub enumerable: bool,
    pub configurable: bool,
}

#[derive(Clone, Debug)]
pub enum OwnPropertyDescriptor {
    Data(DataPropertyDescriptor),
    Accessor {
        get: Option<MetadataHandle>,
        set: Option<MetadataHandle>,
        enumerable: bool,
        configurable: bool,
    },
}
impl OwnPropertyDescriptor {
    pub fn enumerable(&self) -> bool {
        match self {
            Self::Data(data) => data.enumerable,
            Self::Accessor { enumerable, .. } => *enumerable,
        }
    }
    pub fn configurable(&self) -> bool {
        match self {
            Self::Data(data) => data.configurable,
            Self::Accessor { configurable, .. } => *configurable,
        }
    }
}
#[derive(Clone, Debug, Default)]
pub struct AccessorPropertyDefinition {
    pub get: Option<Option<MetadataHandle>>,
    pub set: Option<Option<MetadataHandle>>,
    pub enumerable: Option<bool>,
    pub configurable: Option<bool>,
}
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
    pub fn is_callable(&self) -> bool {
        self.inner
            .borrow()
            .node(self.id)
            .is_ok_and(|n| n.callable.is_some())
    }
    pub fn call(
        &self,
        receiver: MetadataValue,
        arguments: Vec<MetadataValue>,
    ) -> Result<MetadataValue, JsException> {
        let graph = self.graph();
        graph.edge(&receiver)?;
        for argument in &arguments {
            graph.edge(argument)?;
        }
        let (callback, captures) = {
            let arena = self.inner.borrow();
            let callable = arena
                .node(self.id)?
                .callable
                .as_ref()
                .ok_or(MetadataError::NotCallable)?;
            (callable.callback, callable.captures.clone())
        };
        let captures = captures
            .into_iter()
            .map(|v| graph.value(v))
            .collect::<Result<Vec<_>, _>>()?;
        let frame = CallFrame {
            callee: self.clone(),
            receiver,
            arguments,
            captures,
        };
        let result = callback(&frame)?;
        graph.edge(&result)?;
        Ok(result)
    }
    pub fn make_prototype_immutable(&self) -> Result<(), MetadataError> {
        self.inner
            .borrow_mut()
            .node_mut(self.id)?
            .immutable_prototype = true;
        Ok(())
    }
    pub fn prototype(&self) -> Result<Option<MetadataHandle>, MetadataError> {
        let id = self.inner.borrow().node(self.id)?.prototype;
        id.map(|id| match self.graph().value(Edge::Reference(id))? {
            MetadataValue::Reference(h) => Ok(h),
            _ => unreachable!(),
        })
        .transpose()
    }
    pub fn set_prototype(&self, prototype: Option<&MetadataHandle>) -> Result<(), MetadataError> {
        if prototype.is_some_and(|p| !self.graph().owns(p)) {
            return Err(MetadataError::WrongGraph);
        }
        let target = prototype.map(|p| p.id);
        let mut arena = self.inner.borrow_mut();
        let node = arena.node(self.id)?;
        if node.prototype == target {
            return Ok(());
        }
        if !node.extensible || node.immutable_prototype {
            return Err(MetadataError::FrozenProperty);
        }
        let mut cursor = target;
        while let Some(id) = cursor {
            if id == self.id {
                return Err(MetadataError::CyclicPrototype);
            }
            cursor = arena.node(id)?.prototype;
        }
        arena.node_mut(self.id)?.prototype = target;
        if let Some(target) = target {
            arena.shade(target)
        }
        Ok(())
    }
    pub fn own_descriptor(
        &self,
        key: impl Into<JsString>,
    ) -> Result<Option<OwnPropertyDescriptor>, MetadataError> {
        let key = JsString::from_units(key.into().units());
        let accessor = {
            let arena = self.inner.borrow();
            let node = arena.node(self.id)?;
            if matches!(node.container, Container::Array(_)) {
                None
            } else {
                match node.own_data(&key)? {
                    Some(Edge::Accessor { get, set }) => {
                        Some((get, set, node.data_attributes(&key)))
                    }
                    _ => None,
                }
            }
        };
        if let Some((get, set, attrs)) = accessor {
            let owned = |id: Id| match self.graph().value(Edge::Reference(id))? {
                MetadataValue::Reference(h) => Ok(h),
                _ => unreachable!(),
            };
            return Ok(Some(OwnPropertyDescriptor::Accessor {
                get: get.map(owned).transpose()?,
                set: set.map(owned).transpose()?,
                enumerable: attrs.enumerable,
                configurable: attrs.configurable,
            }));
        }
        Ok(self
            .own_property_descriptor(key)?
            .map(OwnPropertyDescriptor::Data))
    }
    pub fn define_accessor_property(
        &self,
        key: impl Into<JsString>,
        definition: AccessorPropertyDefinition,
    ) -> Result<(), MetadataError> {
        let key = JsString::from_units(key.into().units());
        for callback in [definition.get.as_ref(), definition.set.as_ref()]
            .into_iter()
            .flatten()
            .flatten()
        {
            if !self.graph().owns(callback) {
                return Err(MetadataError::WrongGraph);
            }
            if !callback.is_callable() {
                return Err(MetadataError::NotCallable);
            }
        }
        let mut arena = self.inner.borrow_mut();
        let node = arena.node(self.id)?;
        let old = node.own_data(&key)?;
        if old.is_none() && !node.extensible {
            return Err(MetadataError::FrozenProperty);
        }
        let attrs = if old.is_some() {
            node.data_attributes(&key)
        } else {
            DataAttributes {
                writable: false,
                enumerable: false,
                configurable: false,
            }
        };
        let (get, set) = match old {
            Some(Edge::Accessor { get, set }) => (get, set),
            _ => (None, None),
        };
        let next_get = definition
            .get
            .as_ref()
            .map_or(get, |v| v.as_ref().map(|h| h.id));
        let next_set = definition
            .set
            .as_ref()
            .map_or(set, |v| v.as_ref().map(|h| h.id));
        if old.is_some()
            && !attrs.configurable
            && (!matches!(old, Some(Edge::Accessor { .. }))
                || definition.configurable == Some(true)
                || definition.enumerable.is_some_and(|v| v != attrs.enumerable)
                || next_get != get
                || next_set != set)
        {
            return Err(MetadataError::FrozenProperty);
        }
        let node = arena.node_mut(self.id)?;
        match &mut node.container {
            Container::Object(object) => {
                if let Some(order) = object.keys.get(&key.units()) {
                    object.entries.get_mut(order).expect("key").1 = Edge::Accessor {
                        get: next_get,
                        set: next_set,
                    }
                } else {
                    let order = object.next_order;
                    object.next_order = order
                        .checked_add(1)
                        .ok_or(MetadataError::IdentityExhausted)?;
                    object.keys.insert(key.units(), order);
                    object.entries.insert(
                        order,
                        (
                            key.clone(),
                            Edge::Accessor {
                                get: next_get,
                                set: next_set,
                            },
                        ),
                    );
                }
            }
            Container::Record(record) => record.set(
                key.clone(),
                Edge::Accessor {
                    get: next_get,
                    set: next_set,
                },
            )?,
            Container::Array(_) => return Err(MetadataError::WrongKind),
        }
        node.attributes.insert(
            key.units(),
            DataAttributes {
                writable: false,
                enumerable: definition.enumerable.unwrap_or(attrs.enumerable),
                configurable: definition.configurable.unwrap_or(attrs.configurable),
            },
        );
        for id in [next_get, next_set].into_iter().flatten() {
            arena.shade(id)
        }
        Ok(())
    }
    /// Ordinary HasProperty does not invoke accessor getters.
    pub fn has_property(&self, key: impl Into<JsString>) -> Result<bool, MetadataError> {
        let key = JsString::from_units(key.into().units());
        let arena = self.inner.borrow();
        let mut cursor = Some(self.id);
        while let Some(id) = cursor {
            let node = arena.node(id)?;
            let present = match &node.container {
                Container::Array(array) => {
                    key.matches("length")
                        || key
                            .array_index()
                            .is_some_and(|i| array.entries.contains_key(&i))
                }
                _ => node.own_data(&key)?.is_some(),
            };
            if present {
                return Ok(true);
            }
            cursor = node.prototype;
        }
        Ok(false)
    }
    pub fn get_property(&self, key: impl Into<JsString>) -> Result<MetadataValue, JsException> {
        let key = key.into();
        let mut cursor = Some(self.clone());
        while let Some(object) = cursor {
            match object.own_descriptor(key.clone())? {
                Some(OwnPropertyDescriptor::Data(descriptor)) => return Ok(descriptor.value),
                Some(OwnPropertyDescriptor::Accessor { get, .. }) => {
                    return match get {
                        Some(callback) => callback.call(self.clone().into(), vec![]),
                        None => Ok(MetadataValue::Missing),
                    }
                }
                None => cursor = object.prototype()?,
            }
        }
        Ok(MetadataValue::Missing)
    }
    pub fn set_property(
        &self,
        key: impl Into<JsString>,
        value: MetadataValue,
    ) -> Result<(), JsException> {
        self.graph().edge(&value)?;
        let key = key.into();
        let mut cursor = Some(self.clone());
        while let Some(object) = cursor {
            match object.own_descriptor(key.clone())? {
                Some(OwnPropertyDescriptor::Accessor { set, .. }) => {
                    return match set {
                        Some(callback) => {
                            callback.call(self.clone().into(), vec![value])?;
                            Ok(())
                        }
                        None => Err(MetadataError::FrozenProperty.into()),
                    }
                }
                Some(OwnPropertyDescriptor::Data(descriptor)) => {
                    if !descriptor.writable {
                        return Err(MetadataError::FrozenProperty.into());
                    }
                    break;
                }
                None => cursor = object.prototype()?,
            }
        }
        if self.own_descriptor(key.clone())?.is_some() {
            self.define_data_property(
                key,
                DataPropertyDefinition {
                    value: Some(value),
                    ..Default::default()
                },
            )?;
        } else {
            self.set(key, value)?;
        }
        Ok(())
    }
    pub fn delete_property(&self, key: impl Into<JsString>) -> Result<bool, JsException> {
        let key = key.into();
        if self.own_descriptor(key.clone())?.is_none() {
            return Ok(true);
        }
        Ok(self.delete(key)?)
    }
    /// Object.freeze is shallow: this node's own slots become read-only,
    /// while referenced records/membership containers retain their identity.
    pub fn freeze(&self) -> Result<(), MetadataError> {
        let mut arena = self.inner.borrow_mut();
        let node = arena.node_mut(self.id)?;
        node.frozen = true;
        node.extensible = false;
        Ok(())
    }
    pub fn is_frozen(&self) -> Result<bool, MetadataError> {
        let arena = self.inner.borrow();
        let node = arena.node(self.id)?;
        if node.frozen {
            return Ok(true);
        }
        if node.extensible {
            return Ok(false);
        }
        let keys = match &node.container {
            Container::Object(object) => object
                .entries
                .values()
                .map(|(key, _)| key.clone())
                .collect::<Vec<_>>(),
            Container::Record(record) => record.entries().map(|(_, key, _)| key).collect(),
            Container::Array(_) => return Ok(false),
        };
        Ok(keys.iter().all(|key| {
            let attrs = node.data_attributes(key);
            !attrs.writable && !attrs.configurable
        }))
    }
    /// Observe own data descriptors without invoking getters or serialization.
    pub fn own_property_descriptor(
        &self,
        key: impl Into<JsString>,
    ) -> Result<Option<DataPropertyDescriptor>, MetadataError> {
        let key = JsString::from_units(key.into().units());
        let (edge, enumerable, configurable, writable) = {
            let arena = self.inner.borrow();
            let node = arena.node(self.id)?;
            let (value, enumerable, configurable) = match &node.container {
                Container::Object(object) => (
                    object
                        .keys
                        .get(&key.units())
                        .and_then(|order| object.entries.get(order))
                        .map(|(_, value)| value.clone()),
                    true,
                    !node.frozen,
                ),
                Container::Record(record) => (record.get(&key).cloned(), true, !node.frozen),
                Container::Array(array) => {
                    if key.units() == "length".encode_utf16().collect::<Vec<_>>() {
                        (Some(Edge::Number(f64::from(array.length))), false, false)
                    } else {
                        (
                            key.array_index()
                                .and_then(|index| array.entries.get(&index))
                                .cloned(),
                            true,
                            !node.frozen,
                        )
                    }
                }
            };
            let attrs = node.data_attributes(&key);
            let is_array = matches!(node.container, Container::Array(_));
            (
                value,
                if is_array {
                    enumerable
                } else {
                    attrs.enumerable
                },
                if is_array {
                    configurable
                } else {
                    attrs.configurable
                },
                if is_array {
                    !node.frozen
                } else {
                    attrs.writable
                },
            )
        };
        edge.map(|value| {
            Ok(DataPropertyDescriptor {
                value: self.graph().value(value)?,
                writable,
                enumerable,
                configurable,
            })
        })
        .transpose()
    }
    pub fn prevent_extensions(&self) -> Result<(), MetadataError> {
        self.inner.borrow_mut().node_mut(self.id)?.extensible = false;
        Ok(())
    }
    pub fn is_extensible(&self) -> Result<bool, MetadataError> {
        Ok(self.inner.borrow().node(self.id)?.extensible)
    }
    pub fn define_data_property(
        &self,
        key: impl Into<JsString>,
        definition: DataPropertyDefinition,
    ) -> Result<(), MetadataError> {
        let key = JsString::from_units(key.into().units());
        let value = definition
            .value
            .as_ref()
            .map(|value| self.graph().edge(value))
            .transpose()?;
        let mut arena = self.inner.borrow_mut();
        let node = arena.node(self.id)?;
        let old = node.own_data(&key)?;
        if old.is_none() && !node.extensible {
            return Err(MetadataError::FrozenProperty);
        }
        let old_attrs = if old.is_some() {
            node.data_attributes(&key)
        } else {
            DataAttributes {
                writable: false,
                enumerable: false,
                configurable: false,
            }
        };
        if matches!(old, Some(Edge::Accessor { .. }))
            && !old_attrs.configurable
            && (definition.value.is_some() || definition.writable.is_some())
        {
            return Err(MetadataError::FrozenProperty);
        }
        if old.is_some()
            && !old_attrs.configurable
            && (definition.configurable == Some(true)
                || definition
                    .enumerable
                    .is_some_and(|v| v != old_attrs.enumerable)
                || (!old_attrs.writable
                    && (definition.writable == Some(true)
                        || value
                            .as_ref()
                            .is_some_and(|value| !same_edge(value, old.as_ref().unwrap())))))
        {
            return Err(MetadataError::FrozenProperty);
        }
        let attrs = DataAttributes {
            writable: definition.writable.unwrap_or(old_attrs.writable),
            enumerable: definition.enumerable.unwrap_or(old_attrs.enumerable),
            configurable: definition.configurable.unwrap_or(old_attrs.configurable),
        };
        let old = if matches!(old, Some(Edge::Accessor { .. }))
            && (definition.value.is_some() || definition.writable.is_some())
        {
            None
        } else {
            old
        };
        let edge = value.or(old).unwrap_or(Edge::Missing);
        let target = if let Edge::Reference(id) = edge {
            Some(id)
        } else {
            None
        };
        let node = arena.node_mut(self.id)?;
        match &mut node.container {
            Container::Object(object) => {
                if let Some(order) = object.keys.get(&key.units()) {
                    object.entries.get_mut(order).expect("object key").1 = edge;
                } else {
                    let order = object.next_order;
                    object.next_order = order
                        .checked_add(1)
                        .ok_or(MetadataError::IdentityExhausted)?;
                    object.keys.insert(key.units(), order);
                    object.entries.insert(order, (key.clone(), edge));
                }
            }
            Container::Record(record) => record.set(key.clone(), edge)?,
            Container::Array(_) => return Err(MetadataError::WrongKind),
        }
        if attrs == DataAttributes::default() {
            node.attributes.remove(&key.units());
        } else {
            node.attributes.insert(key.units(), attrs);
        }
        if let Some(target) = target {
            arena.shade(target);
        }
        Ok(())
    }
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
        self.define_data_property(
            key,
            DataPropertyDefinition {
                value: Some(value),
                writable: Some(true),
                enumerable: Some(true),
                configurable: Some(true),
            },
        )
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
        let node = arena.node(self.id)?;
        let present = match &node.container {
            Container::Object(object) => object.keys.contains_key(&key.units()),
            Container::Record(record) => record.get(&key).is_some(),
            Container::Array(_) => return Err(MetadataError::WrongKind),
        };
        if present && !node.data_attributes(&key).configurable {
            return Err(MetadataError::FrozenProperty);
        }
        arena.node_mut(self.id)?.attributes.remove(&key.units());
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
    pub fn own_property_keys(&self) -> Result<Vec<JsString>, MetadataError> {
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
            Container::Array(array) => {
                return Ok(array
                    .entries
                    .keys()
                    .map(|index| JsString::from(index.to_string()))
                    .chain(std::iter::once(JsString::from("length")))
                    .collect())
            }
        };
        entries.sort_by_key(|(order, key)| {
            (
                key.array_index().is_none(),
                key.array_index().map(u64::from).unwrap_or(*order),
            )
        });
        Ok(entries.into_iter().map(|(_, key)| key).collect())
    }
    /// Explicit data-controller Object.keys view. Full spread/value helpers
    /// must snapshot own_property_keys and check each current descriptor later.
    pub fn keys(&self) -> Result<Vec<JsString>, MetadataError> {
        if self.is_array() {
            return Err(MetadataError::WrongKind);
        }
        let keys = self.own_property_keys()?;
        let arena = self.inner.borrow();
        let node = arena.node(self.id)?;
        Ok(keys
            .into_iter()
            .filter(|key| node.data_attributes(key).enumerable)
            .collect())
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
        let node = arena.node(self.id)?;
        let Container::Record(record) = &node.container else {
            return Err(MetadataError::WrongKind);
        };
        let present = record.get_field(field)?.is_some();
        let key = JsString::from(field.name());
        if present && !node.data_attributes(&key).configurable {
            return Err(MetadataError::FrozenProperty);
        }
        arena.node_mut(self.id)?.attributes.remove(&key.units());
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
        let node = arena.node(self.id)?;
        let Container::Record(record) = &node.container else {
            return Err(MetadataError::WrongKind);
        };
        let present = record.get_field(field)?.is_some();
        let key = JsString::from(field.name());
        if (present && !node.data_attributes(&key).writable) || (!present && !node.extensible) {
            return Err(MetadataError::FrozenProperty);
        }
        let Container::Record(record) = &mut arena.node_mut(self.id)?.container else {
            unreachable!()
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
        let node = arena.node(self.id)?;
        if !matches!(node.container, Container::Array(_)) {
            return Err(MetadataError::WrongKind);
        }
        if node.frozen {
            return Err(MetadataError::FrozenProperty);
        }
        let Container::Array(array) = &mut arena.node_mut(self.id)?.container else {
            unreachable!()
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
        let node = arena.node(self.id)?;
        let Container::Array(array) = &node.container else {
            return Err(MetadataError::WrongKind);
        };
        if node.frozen && array.entries.contains_key(&index) {
            return Err(MetadataError::FrozenProperty);
        }
        let Container::Array(array) = &mut arena.node_mut(self.id)?.container else {
            return Err(MetadataError::WrongKind);
        };
        Ok(array.entries.remove(&index).is_some())
    }
    pub fn set_length(&self, length: u32) -> Result<(), MetadataError> {
        let mut arena = self.inner.borrow_mut();
        let node = arena.node(self.id)?;
        if !matches!(node.container, Container::Array(_)) {
            return Err(MetadataError::WrongKind);
        }
        if node.frozen {
            return Err(MetadataError::FrozenProperty);
        }
        let Container::Array(array) = &mut arena.node_mut(self.id)?.container else {
            return Err(MetadataError::WrongKind);
        };
        array.entries.split_off(&length);
        array.length = length;
        Ok(())
    }
}
