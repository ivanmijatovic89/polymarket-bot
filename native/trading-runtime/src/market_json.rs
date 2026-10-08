//! JSON values with JavaScript's binary64 number domain, including overflow.
//! This parser is local to raw market frames. It does not enable Serde's
//! arbitrary_precision magic map keys or alter the external request protocol.
use serde_json::Value;
use std::ops::Index;

/// UTF-8 is the common path; UTF-16 retains JavaScript's lone code units.
#[derive(Clone, Debug)]
pub enum JsString {
    Utf8(String),
    Utf16(Vec<u16>),
}
impl JsString {
    pub fn from_units(units: Vec<u16>) -> Self {
        match String::from_utf16(&units) {
            Ok(text) => Self::Utf8(text),
            Err(_) => Self::Utf16(units),
        }
    }
    pub fn units(&self) -> Vec<u16> {
        match self {
            Self::Utf8(text) => text.encode_utf16().collect(),
            Self::Utf16(units) => units.clone(),
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::Utf8(text) => Some(text),
            Self::Utf16(_) => None,
        }
    }
    pub fn is_empty(&self) -> bool {
        match self {
            Self::Utf8(text) => text.is_empty(),
            Self::Utf16(units) => units.is_empty(),
        }
    }
    pub fn matches(&self, text: &str) -> bool {
        match self {
            Self::Utf8(value) => value == text,
            Self::Utf16(units) => units.iter().copied().eq(text.encode_utf16()),
        }
    }
    pub fn array_index(&self) -> Option<u32> {
        let text = self.as_str()?;
        if text.is_empty()
            || (text.len() > 1 && text.starts_with('0'))
            || !text.bytes().all(|byte| byte.is_ascii_digit())
        {
            return None;
        }
        text.parse::<u32>().ok().filter(|index| *index < u32::MAX)
    }
    pub fn join(parts: impl IntoIterator<Item = JsString>, separator: &str) -> Self {
        let mut units = Vec::new();
        let mut first = true;
        for part in parts {
            if !first {
                units.extend(separator.encode_utf16());
            }
            first = false;
            units.extend(part.units());
        }
        Self::from_units(units)
    }
    pub fn format(template: &str, args: &[JsString]) -> Self {
        let mut units = Vec::new();
        let mut parts = template.split("{}");
        units.extend(parts.next().unwrap_or_default().encode_utf16());
        for (part, arg) in parts.zip(args) {
            units.extend(arg.units());
            units.extend(part.encode_utf16());
        }
        Self::from_units(units)
    }
    fn write_json(&self, out: &mut String) {
        // Match JSON.stringify text as well as decoded string equality: only
        // unpaired code units use Unicode escapes; ordinary text remains text.
        match self {
            Self::Utf8(text) => {
                out.push_str(&serde_json::to_string(text).expect("String serialization"))
            }
            Self::Utf16(units) => {
                out.push('"');
                let mut text = String::new();
                for item in std::char::decode_utf16(units.iter().copied()) {
                    match item {
                        Ok(character) => text.push(character),
                        Err(error) => {
                            let escaped =
                                serde_json::to_string(&text).expect("UTF-8 string serialization");
                            out.push_str(&escaped[1..escaped.len() - 1]);
                            text.clear();
                            out.push_str(&format!("\\u{:04x}", error.unpaired_surrogate()));
                        }
                    }
                }
                let escaped = serde_json::to_string(&text).expect("UTF-8 string serialization");
                out.push_str(&escaped[1..escaped.len() - 1]);
                out.push('"');
            }
        }
    }
    pub fn json(&self) -> String {
        let mut out = String::new();
        self.write_json(&mut out);
        out
    }
}
impl From<String> for JsString {
    fn from(value: String) -> Self {
        Self::Utf8(value)
    }
}
impl From<&str> for JsString {
    fn from(value: &str) -> Self {
        Self::Utf8(value.into())
    }
}
impl PartialEq for JsString {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Utf8(a), Self::Utf8(b)) => a == b,
            _ => self.units() == other.units(),
        }
    }
}
impl Eq for JsString {}

use std::sync::atomic::{AtomicU64, Ordering};
static CONTAINER_ID: AtomicU64 = AtomicU64::new(1);
fn identity() -> u64 {
    CONTAINER_ID.fetch_add(1, Ordering::Relaxed)
}
#[derive(Debug)]
pub struct JsArray {
    pub values: Vec<JsValue>,
    pub identity: u64,
}
impl Default for JsArray {
    fn default() -> Self {
        Self {
            values: vec![],
            identity: identity(),
        }
    }
}
impl std::ops::Deref for JsArray {
    type Target = Vec<JsValue>;
    fn deref(&self) -> &Self::Target {
        &self.values
    }
}
impl std::ops::DerefMut for JsArray {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.values
    }
}
impl IntoIterator for JsArray {
    type Item = JsValue;
    type IntoIter = std::vec::IntoIter<JsValue>;
    fn into_iter(self) -> Self::IntoIter {
        self.values.into_iter()
    }
}
#[derive(Debug)]
pub struct JsObject {
    pub values: Vec<(JsString, JsValue)>,
    pub identity: u64,
}
impl Default for JsObject {
    fn default() -> Self {
        Self {
            values: vec![],
            identity: identity(),
        }
    }
}
impl std::ops::Deref for JsObject {
    type Target = Vec<(JsString, JsValue)>;
    fn deref(&self) -> &Self::Target {
        &self.values
    }
}
impl std::ops::DerefMut for JsObject {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.values
    }
}
impl IntoIterator for JsObject {
    type Item = (JsString, JsValue);
    type IntoIter = std::vec::IntoIter<Self::Item>;
    fn into_iter(self) -> Self::IntoIter {
        self.values.into_iter()
    }
}

#[derive(Debug)]
pub enum JsValue {
    Null,
    Bool(bool),
    Number(f64),
    String(JsString),
    Array(JsArray),
    Object(JsObject),
}
impl JsValue {
    pub fn from_value(value: Value) -> Self {
        match value {
            Value::Null => Self::Null,
            Value::Bool(v) => Self::Bool(v),
            Value::Number(v) => Self::Number(v.as_f64().unwrap_or(f64::NAN)),
            Value::String(v) => Self::String(v.into()),
            Value::Array(v) => Self::array(v.into_iter().map(Self::from_value).collect()),
            Value::Object(v) => Self::object(
                v.into_iter()
                    .map(|(key, v)| (key.into(), Self::from_value(v)))
                    .collect(),
            ),
        }
    }
    pub fn object(mut values: Vec<(JsString, JsValue)>) -> Self {
        values.sort_by(|(a, _), (b, _)| match (a.array_index(), b.array_index()) {
            (Some(a), Some(b)) => a.cmp(&b),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            _ => std::cmp::Ordering::Equal,
        });
        Self::Object(JsObject {
            values,
            identity: identity(),
        })
    }
    pub fn array(values: Vec<JsValue>) -> Self {
        Self::Array(JsArray {
            values,
            identity: identity(),
        })
    }
    pub fn same_identity(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Array(a), Self::Array(b)) => a.identity == b.identity,
            (Self::Object(a), Self::Object(b)) => a.identity == b.identity,
            _ => self == other,
        }
    }
    /// Lossless JSON inspection. Numbers outside the finite domain become null
    /// at this boundary only; UTF-16 strings and keys retain their code units.
    pub fn to_json_string(&self) -> String {
        enum Task<'a> {
            Value(&'a JsValue),
            Key(&'a JsString),
            Text(&'static str),
        }
        let mut out = String::new();
        let mut tasks = vec![Task::Value(self)];
        while let Some(task) = tasks.pop() {
            match task {
                Task::Text(text) => out.push_str(text),
                Task::Key(key) => key.write_json(&mut out),
                Task::Value(value) => match value {
                    Self::Null => out.push_str("null"),
                    Self::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
                    Self::Number(value) => {
                        if value.is_finite() {
                            out.push_str(&crate::math::js_number_string(*value));
                        } else {
                            out.push_str("null");
                        }
                    }
                    Self::String(value) => value.write_json(&mut out),
                    Self::Array(values) => {
                        out.push('[');
                        tasks.push(Task::Text("]"));
                        for (index, value) in values.iter().enumerate().rev() {
                            tasks.push(Task::Value(value));
                            if index > 0 {
                                tasks.push(Task::Text(","));
                            }
                        }
                    }
                    Self::Object(values) => {
                        out.push('{');
                        tasks.push(Task::Text("}"));
                        for (index, (key, value)) in values.iter().enumerate().rev() {
                            tasks.push(Task::Value(value));
                            tasks.push(Task::Text(":"));
                            tasks.push(Task::Key(key));
                            if index > 0 {
                                tasks.push(Task::Text(","));
                            }
                        }
                    }
                },
            }
        }
        out
    }
    pub fn get(&self, key: &str) -> Option<&Self> {
        if let Self::Object(values) = self {
            values
                .iter()
                .find(|(name, _)| name.matches(key))
                .map(|(_, value)| value)
        } else {
            None
        }
    }
    pub fn get_mut(&mut self, key: &str) -> Option<&mut Self> {
        if let Self::Object(values) = self {
            values
                .iter_mut()
                .find(|(name, _)| name.matches(key))
                .map(|(_, value)| value)
        } else {
            None
        }
    }
    pub fn insert(&mut self, key: &str, value: Self) {
        if let Self::Object(values) = self {
            if let Some((_, prior)) = values.iter_mut().find(|(name, _)| name.matches(key)) {
                *prior = value;
            } else {
                values.push((key.into(), value));
                values.sort_by(|(a, _), (b, _)| match (a.array_index(), b.array_index()) {
                    (Some(a), Some(b)) => a.cmp(&b),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    _ => std::cmp::Ordering::Equal,
                });
            }
        }
    }
    pub fn insert_key(&mut self, key: JsString, value: Self) {
        if let Self::Object(values) = self {
            if let Some((_, prior)) = values.iter_mut().find(|(name, _)| name == &key) {
                *prior = value;
            } else {
                values.push((key, value));
            }
            values.sort_by(|(a, _), (b, _)| match (a.array_index(), b.array_index()) {
                (Some(a), Some(b)) => a.cmp(&b),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                _ => std::cmp::Ordering::Equal,
            });
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        if let Self::String(v) = self {
            v.as_str()
        } else {
            None
        }
    }
    pub fn as_array(&self) -> Option<&[Self]> {
        if let Self::Array(v) = self {
            Some(v)
        } else {
            None
        }
    }
    pub fn as_array_mut(&mut self) -> Option<&mut Vec<Self>> {
        if let Self::Array(v) = self {
            Some(v)
        } else {
            None
        }
    }
    pub fn as_object(&self) -> Option<&[(JsString, Self)]> {
        if let Self::Object(v) = self {
            Some(v)
        } else {
            None
        }
    }
    pub fn is_string(&self) -> bool {
        matches!(self, Self::String(_))
    }
    pub fn is_object(&self) -> bool {
        matches!(self, Self::Object(_))
    }
    pub fn is_array(&self) -> bool {
        matches!(self, Self::Array(_))
    }
    pub fn is_null(&self) -> bool {
        matches!(self, Self::Null)
    }
}
impl Clone for JsValue {
    fn clone(&self) -> Self {
        enum Task<'a> {
            Value(&'a JsValue),
            Array(usize, u64),
            Object(Vec<JsString>, u64),
        }
        let mut tasks = vec![Task::Value(self)];
        let mut outputs = Vec::new();
        while let Some(task) = tasks.pop() {
            match task {
                Task::Value(value) => match value {
                    Self::Array(values) => {
                        tasks.push(Task::Array(values.len(), values.identity));
                        tasks.extend(values.iter().rev().map(Task::Value));
                    }
                    Self::Object(values) => {
                        tasks.push(Task::Object(
                            values.iter().map(|(key, _)| key.clone()).collect(),
                            values.identity,
                        ));
                        tasks.extend(values.iter().rev().map(|(_, value)| Task::Value(value)));
                    }
                    Self::Null => outputs.push(Self::Null),
                    Self::Bool(value) => outputs.push(Self::Bool(*value)),
                    Self::Number(value) => outputs.push(Self::Number(*value)),
                    Self::String(value) => outputs.push(Self::String(value.clone())),
                },
                Task::Array(length, identity) => {
                    let values = outputs.split_off(outputs.len() - length);
                    outputs.push(Self::Array(JsArray { values, identity }));
                }
                Task::Object(keys, identity) => {
                    let values = outputs.split_off(outputs.len() - keys.len());
                    outputs.push(Self::Object(JsObject {
                        values: keys.into_iter().zip(values).collect(),
                        identity,
                    }));
                }
            }
        }
        outputs.pop().expect("one cloned root")
    }
}
impl PartialEq for JsValue {
    fn eq(&self, other: &Self) -> bool {
        let mut pending = vec![(self, other)];
        while let Some((left, right)) = pending.pop() {
            match (left, right) {
                (Self::Null, Self::Null) => {}
                (Self::Bool(a), Self::Bool(b)) if a == b => {}
                (Self::Number(a), Self::Number(b)) if a == b => {}
                (Self::String(a), Self::String(b)) if a == b => {}
                (Self::Array(a), Self::Array(b)) if a.len() == b.len() => {
                    pending.extend(a.iter().zip(b.iter()))
                }
                (Self::Object(a), Self::Object(b)) if a.len() == b.len() => {
                    for ((ak, av), (bk, bv)) in a.iter().zip(b.iter()) {
                        if ak != bk {
                            return false;
                        }
                        pending.push((av, bv));
                    }
                }
                _ => return false,
            }
        }
        true
    }
}
impl Drop for JsValue {
    fn drop(&mut self) {
        let mut pending = Vec::new();
        match self {
            Self::Array(values) => pending.append(values),
            Self::Object(values) => {
                pending.extend(std::mem::take(values).into_iter().map(|(_, value)| value))
            }
            _ => {}
        }
        while let Some(mut value) = pending.pop() {
            match &mut value {
                Self::Array(values) => pending.append(values),
                Self::Object(values) => {
                    pending.extend(std::mem::take(values).into_iter().map(|(_, value)| value))
                }
                _ => {}
            }
        }
    }
}
static NULL: JsValue = JsValue::Null;
impl Index<&str> for JsValue {
    type Output = Self;
    fn index(&self, key: &str) -> &Self {
        self.get(key).unwrap_or(&NULL)
    }
}
impl Index<usize> for JsValue {
    type Output = Self;
    fn index(&self, key: usize) -> &Self {
        self.as_array()
            .and_then(|values| values.get(key))
            .unwrap_or(&NULL)
    }
}
impl PartialEq<Value> for JsValue {
    fn eq(&self, other: &Value) -> bool {
        self == &Self::from_value(other.clone())
    }
}
impl PartialEq<f64> for JsValue {
    fn eq(&self, other: &f64) -> bool {
        matches!(self,Self::Number(value) if value==other)
    }
}
impl PartialEq<i32> for JsValue {
    fn eq(&self, other: &i32) -> bool {
        self == &(*other as f64)
    }
}
impl PartialEq<bool> for JsValue {
    fn eq(&self, other: &bool) -> bool {
        matches!(self,Self::Bool(value) if value==other)
    }
}
impl PartialEq<&str> for JsValue {
    fn eq(&self, other: &&str) -> bool {
        matches!(self,Self::String(value) if value.matches(other))
    }
}
struct Parser<'a> {
    text: &'a str,
    offset: usize,
}
impl<'a> Parser<'a> {
    fn peek(&self) -> Option<u8> {
        self.text.as_bytes().get(self.offset).copied()
    }
    fn white(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\r' | b'\n')) {
            self.offset += 1;
        }
    }
    fn take(&mut self, expected: u8) -> Result<(), ()> {
        if self.peek() == Some(expected) {
            self.offset += 1;
            Ok(())
        } else {
            Err(())
        }
    }
    fn literal(&mut self, text: &str, value: JsValue) -> Result<JsValue, ()> {
        if self.text[self.offset..].starts_with(text) {
            self.offset += text.len();
            Ok(value)
        } else {
            Err(())
        }
    }
    fn string(&mut self) -> Result<JsString, ()> {
        self.take(b'"')?;
        let mut units = Vec::new();
        loop {
            match self.peek().ok_or(())? {
                b'"' => {
                    self.offset += 1;
                    return Ok(JsString::from_units(units));
                }
                b'\\' => {
                    self.offset += 1;
                    let code = self.peek().ok_or(())?;
                    self.offset += 1;
                    match code {
                        b'"' | b'\\' | b'/' => units.push(code as u16),
                        b'b' => units.push(8),
                        b'f' => units.push(12),
                        b'n' => units.push(10),
                        b'r' => units.push(13),
                        b't' => units.push(9),
                        b'u' => {
                            let mut unit = 0u16;
                            for _ in 0..4 {
                                let digit =
                                    (self.peek().ok_or(())? as char).to_digit(16).ok_or(())?;
                                self.offset += 1;
                                unit = (unit << 4) | digit as u16;
                            }
                            units.push(unit);
                        }
                        _ => return Err(()),
                    }
                }
                0..=31 => return Err(()),
                _ => {
                    let character = self.text[self.offset..].chars().next().ok_or(())?;
                    self.offset += character.len_utf8();
                    let mut encoded = [0; 2];
                    units.extend_from_slice(character.encode_utf16(&mut encoded));
                }
            }
        }
    }
    fn number(&mut self) -> Result<JsValue, ()> {
        let start = self.offset;
        if self.peek() == Some(b'-') {
            self.offset += 1;
        }
        match self.peek() {
            Some(b'0') => self.offset += 1,
            Some(b'1'..=b'9') => {
                while matches!(self.peek(), Some(b'0'..=b'9')) {
                    self.offset += 1;
                }
            }
            _ => return Err(()),
        }
        if self.peek() == Some(b'.') {
            self.offset += 1;
            let digits = self.offset;
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.offset += 1;
            }
            if self.offset == digits {
                return Err(());
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.offset += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.offset += 1;
            }
            let digits = self.offset;
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.offset += 1;
            }
            if self.offset == digits {
                return Err(());
            }
        }
        self.text[start..self.offset]
            .parse::<f64>()
            .map(JsValue::Number)
            .map_err(|_| ())
    }
    fn atom(&mut self) -> Result<JsValue, ()> {
        self.white();
        match self.peek() {
            Some(b'"') => self.string().map(JsValue::String),
            Some(b'n') => self.literal("null", JsValue::Null),
            Some(b't') => self.literal("true", JsValue::Bool(true)),
            Some(b'f') => self.literal("false", JsValue::Bool(false)),
            Some(b'-' | b'0'..=b'9') => self.number(),
            _ => Err(()),
        }
    }
    fn value(&mut self) -> Result<JsValue, ()> {
        enum Container {
            Array(Vec<JsValue>),
            Object(Vec<(JsString, JsValue)>, JsString),
        }
        let mut stack = Vec::new();
        let mut completed = None;
        loop {
            if completed.is_none() {
                self.white();
                match self.peek() {
                    Some(b'[') => {
                        self.offset += 1;
                        self.white();
                        if self.peek() == Some(b']') {
                            self.offset += 1;
                            completed = Some(JsValue::array(vec![]));
                        } else {
                            stack.push(Container::Array(vec![]));
                            continue;
                        }
                    }
                    Some(b'{') => {
                        self.offset += 1;
                        self.white();
                        if self.peek() == Some(b'}') {
                            self.offset += 1;
                            completed = Some(JsValue::object(vec![]));
                        } else {
                            let key = self.string()?;
                            self.white();
                            self.take(b':')?;
                            stack.push(Container::Object(vec![], key));
                            continue;
                        }
                    }
                    _ => completed = Some(self.atom()?),
                }
            }
            let value = completed.take().ok_or(())?;
            let Some(container) = stack.pop() else {
                return Ok(value);
            };
            self.white();
            match container {
                Container::Array(mut values) => {
                    values.push(value);
                    if self.peek() == Some(b']') {
                        self.offset += 1;
                        completed = Some(JsValue::array(values));
                    } else {
                        self.take(b',')?;
                        stack.push(Container::Array(values));
                    }
                }
                Container::Object(mut values, key) => {
                    if let Some((_, prior)) = values.iter_mut().find(|(name, _)| name == &key) {
                        *prior = value;
                    } else {
                        values.push((key, value));
                    }
                    if self.peek() == Some(b'}') {
                        self.offset += 1;
                        completed = Some(JsValue::object(values));
                    } else {
                        self.take(b',')?;
                        self.white();
                        let key = self.string()?;
                        self.white();
                        self.take(b':')?;
                        stack.push(Container::Object(values, key));
                    }
                }
            }
        }
    }
}
/// Parse the strict JSON grammar, with every numeric literal converted to
/// JavaScript binary64. Overflow is retained internally and serialized as null.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct JsonParseError {
    pub offset: usize,
}
pub fn parse(raw: &str) -> Result<JsValue, JsonParseError> {
    let mut parser = Parser {
        text: raw,
        offset: 0,
    };
    let value = parser.value().map_err(|_| JsonParseError {
        offset: parser.offset,
    })?;
    parser.white();
    if parser.offset == raw.len() {
        Ok(value)
    } else {
        Err(JsonParseError {
            offset: parser.offset,
        })
    }
}

/// Normalize an already parsed, finite Unicode-scalar control tree. Raw JSON
/// metadata requiring overflow or lone surrogates must use `parse`/`JsValue`.
pub fn normalize_control_value(value: Value) -> Value {
    enum Task {
        Value(Value),
        Array(usize),
        Object(Vec<String>),
    }
    let mut tasks = vec![Task::Value(value)];
    let mut outputs = Vec::new();
    while let Some(task) = tasks.pop() {
        match task {
            Task::Value(value) => match value {
                Value::Number(number) => outputs.push(Value::Number(
                    serde_json::Number::from_f64(number.as_f64().expect("finite JSON number"))
                        .expect("finite control number"),
                )),
                Value::Array(values) => {
                    tasks.push(Task::Array(values.len()));
                    tasks.extend(values.into_iter().rev().map(Task::Value));
                }
                Value::Object(values) => {
                    let mut entries: Vec<_> = values.into_iter().collect();
                    entries.sort_by(|(a, _), (b, _)| {
                        match (
                            JsString::Utf8(a.clone()).array_index(),
                            JsString::Utf8(b.clone()).array_index(),
                        ) {
                            (Some(a), Some(b)) => a.cmp(&b),
                            (Some(_), None) => std::cmp::Ordering::Less,
                            (None, Some(_)) => std::cmp::Ordering::Greater,
                            _ => std::cmp::Ordering::Equal,
                        }
                    });
                    tasks.push(Task::Object(
                        entries.iter().map(|(key, _)| key.clone()).collect(),
                    ));
                    tasks.extend(
                        entries
                            .into_iter()
                            .rev()
                            .map(|(_, value)| Task::Value(value)),
                    );
                }
                other => outputs.push(other),
            },
            Task::Array(length) => {
                let values = outputs.split_off(outputs.len() - length);
                outputs.push(Value::Array(values));
            }
            Task::Object(keys) => {
                let values = outputs.split_off(outputs.len() - keys.len());
                outputs.push(Value::Object(keys.into_iter().zip(values).collect()));
            }
        }
    }
    outputs.pop().expect("one normalized control root")
}
