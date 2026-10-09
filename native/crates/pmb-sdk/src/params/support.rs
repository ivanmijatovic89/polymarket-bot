//! Runtime targets of `#[derive(Params)]` and `#[derive(ParamEnum)]`
//! (reached through `pmb_sdk::__private`; not part of the author API).

use super::input::Input;
use super::text::write_json_str;
use super::value::{number_value, BoundView, ParamValue};
use super::{ParamEnum, ParamError, ParamErrorKind, Params};
use crate::json::Value;
use std::any::TypeId;

/// The keys of one params struct: its own keys, and the trees of the
/// structs flattened into it (30 §9 rule 5). `collisions[i]` is the compile
/// error text shown when `own[i]` collides.
pub struct KeyTree {
    pub own: &'static [&'static str],
    pub collisions: &'static [&'static str],
    pub flattened: &'static [&'static KeyTree],
}

/// Machinery of a params struct, emitted by `#[derive(Params)]`.
pub trait ParamsFields: Sized + 'static {
    const KEY_TREE: KeyTree;
    const NAME: &'static str;
    const DOC: &'static str;
    /// Whether some field (or a field of a flattened struct) is required:
    /// no default and not an `Option`. Such a struct needs
    /// `#[param(selftest = "..")]` (20 §5.3).
    const HAS_REQUIRED: bool;

    /// Parses this struct's fields (and flattened structs) from `obj`,
    /// marking consumed entries in `used`.
    fn __parse_fields(
        obj: &[(String, Input)],
        path: &str,
        used: &mut [bool],
        errs: &mut ParamError,
    ) -> Option<Self>;

    /// Appends `(key, normalized JSON)` of every present field.
    fn __write_fields(&self, out: &mut Vec<(&'static str, String)>);

    /// Appends the schema of every field and the required keys; nested
    /// params structs are registered in `defs`.
    fn __schema_fields(
        props: &mut Vec<(&'static str, Value)>,
        required: &mut Vec<&'static str>,
        defs: &mut SchemaDefs,
    );

    /// `Params::validate`.
    fn __validate(&self) -> Result<(), ParamError>;
}

const fn str_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut i = 0;
    while i < a.len() {
        if a[i] != b[i] {
            return false;
        }
        i += 1;
    }
    true
}

const fn count_key(t: &KeyTree, k: &str) -> usize {
    let mut n = 0;
    let mut i = 0;
    while i < t.own.len() {
        if str_eq(t.own[i], k) {
            n += 1;
        }
        i += 1;
    }
    let mut j = 0;
    while j < t.flattened.len() {
        n += count_key(t.flattened[j], k);
        j += 1;
    }
    n
}

const fn first_collision(t: &KeyTree, root: &KeyTree) -> Option<&'static str> {
    let mut i = 0;
    while i < t.own.len() {
        if count_key(root, t.own[i]) > 1 {
            return Some(t.collisions[i]);
        }
        i += 1;
    }
    let mut j = 0;
    while j < t.flattened.len() {
        if let Some(m) = first_collision(t.flattened[j], root) {
            return Some(m);
        }
        j += 1;
    }
    None
}

/// The message of the first key that appears twice in a params object
/// assembled through `#[param(flatten)]`. The derive evaluates it in a
/// `const`, so a collision fails compilation (30 §9 rule 5).
pub const fn key_collision(root: &KeyTree) -> Option<&'static str> {
    first_collision(root, root)
}

/// True when `name` is one of `names` (const, for enum defaults).
pub const fn has_name(names: &[&str], name: &str) -> bool {
    let mut i = 0;
    while i < names.len() {
        if str_eq(names[i], name) {
            return true;
        }
        i += 1;
    }
    false
}

/// Every key of a tree, sorted.
pub(crate) fn all_keys(t: &KeyTree) -> Vec<&'static str> {
    fn walk(t: &KeyTree, out: &mut Vec<&'static str>) {
        out.extend_from_slice(t.own);
        for f in t.flattened {
            walk(f, out);
        }
    }
    let mut out = Vec::new();
    walk(t, &mut out);
    out.sort_unstable();
    out.dedup();
    out
}

/// JSON pointer of `key` inside the object at `base` (RFC 6901 escaping).
pub(crate) fn child_path(base: &str, key: &str) -> String {
    let mut s = String::with_capacity(base.len() + key.len() + 1);
    s.push_str(base);
    s.push('/');
    for c in key.chars() {
        match c {
            '~' => s.push_str("~0"),
            '/' => s.push_str("~1"),
            c => s.push(c),
        }
    }
    s
}

pub(crate) fn child_index(base: &str, i: usize) -> String {
    format!("{base}/{i}")
}

/// Parses one field: the input value of `key`, else the default, else
/// `None` for an `Option`, else a `Missing` issue (30 §9 rule 1).
pub fn field<T, F>(
    obj: &[(String, Input)],
    path: &str,
    key: &'static str,
    used: &mut [bool],
    errs: &mut ParamError,
    default: Option<F>,
) -> Option<T>
where
    T: ParamValue,
    F: FnOnce() -> T,
{
    let mut found = None;
    for (i, (k, v)) in obj.iter().enumerate() {
        if k == key {
            used[i] = true;
            if found.is_none() {
                found = Some(v);
            }
        }
    }
    match found {
        Some(v) => T::parse(v, &child_path(path, key), errs),
        None => match default {
            Some(d) => Some(d()),
            None => match T::absent() {
                Some(v) => Some(v),
                None => {
                    errs.push_kind(
                        child_path(path, key),
                        ParamErrorKind::Missing,
                        format!(
                            "missing required param {key:?}: expected {}; pass it with \
                             --param {key}=<value>",
                            T::expected()
                        ),
                    );
                    None
                }
            },
        },
    }
}

/// `min` / `max` / `exclusive_min` / `exclusive_max` (30 §9 rule 2).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum BoundOp {
    Min,
    Max,
    ExclusiveMin,
    ExclusiveMax,
}

/// Checks a present value against one bound; the message follows 20 §5.1
/// ("expected a number >= 1").
pub fn check_bound<T: BoundView>(
    v: &T,
    bound: &T::Inner,
    op: BoundOp,
    bound_text: &'static str,
    path: &str,
    key: &'static str,
    errs: &mut ParamError,
) {
    let Some(x) = v.bound_view() else { return };
    let (ok, sym) = match op {
        BoundOp::Min => (x >= bound, ">="),
        BoundOp::Max => (x <= bound, "<="),
        BoundOp::ExclusiveMin => (x > bound, ">"),
        BoundOp::ExclusiveMax => (x < bound, "<"),
    };
    if !ok {
        let mut got = String::new();
        x.write_normalized(&mut got);
        errs.push_kind(
            child_path(path, key),
            ParamErrorKind::OutOfRange,
            format!("expected a number {sym} {bound_text}, got {got}"),
        );
    }
}

/// Runs `validate` of a flattened struct; its paths are relative to the
/// shared object.
pub fn merge_validate<T: ParamsFields>(v: &T, path: &str, errs: &mut ParamError) {
    if let Err(e) = v.__validate() {
        errs.extend_prefixed(path, e);
    }
}

/// Parses a params object: duplicate keys, fields, unknown keys
/// (30 §9 rule 3), then `validate` when every field parsed.
// D-PENDING: 30 §9 rule 3 is silent on repeated keys; chose a DuplicateKey
// error (R14) for a key repeated in a JSON object or in --param arguments.
// Unknown keys are one issue at the object's path that lists every unknown
// key and every valid key (rule 3 wording).
pub(crate) fn parse_object<T: ParamsFields>(
    entries: &[(String, Input)],
    path: &str,
    errs: &mut ParamError,
) -> Option<T> {
    let before = errs.len();
    for (i, (k, _)) in entries.iter().enumerate() {
        let first = entries.iter().position(|(o, _)| o == k) == Some(i);
        let repeated = entries[i + 1..].iter().any(|(o, _)| o == k);
        if first && repeated {
            errs.push_kind(
                child_path(path, k),
                ParamErrorKind::DuplicateKey,
                format!("param {k:?} is given more than once; keep one value"),
            );
        }
    }
    let mut used = vec![false; entries.len()];
    let v = T::__parse_fields(entries, path, &mut used, errs);
    let unknown: Vec<String> = entries
        .iter()
        .zip(&used)
        .filter(|(_, u)| !**u)
        .map(|((k, _), _)| super::input::quoted(k))
        .collect();
    if !unknown.is_empty() {
        let valid = all_keys(&T::KEY_TREE);
        let valid = if valid.is_empty() {
            "none (this strategy takes no params)".to_owned()
        } else {
            valid.join(", ")
        };
        errs.push_kind(
            path.to_owned(),
            ParamErrorKind::UnknownKeys,
            format!(
                "unknown params {}; valid params: {valid}",
                unknown.join(", ")
            ),
        );
    }
    let v = v?;
    merge_validate(&v, path, errs);
    (errs.len() == before).then_some(v)
}

/// `ParamValue::parse` of a nested params struct: an object, or JSON object
/// text from the CLI (30 §9 table).
pub fn parse_struct<T: ParamsFields + ParamValue>(
    input: &Input,
    path: &str,
    errs: &mut ParamError,
) -> Option<T> {
    let parsed;
    let input = match input {
        Input::String(text) => match Input::from_json_text(text) {
            Ok(v @ Input::Object(_)) => {
                parsed = v;
                &parsed
            }
            _ => {
                return super::value::invalid::<T>(
                    input,
                    path,
                    errs,
                    ParamErrorKind::InvalidValue,
                    " (pass JSON object text)",
                )
            }
        },
        other => other,
    };
    match input {
        Input::Object(entries) => parse_object::<T>(entries, path, errs),
        other => super::value::invalid::<T>(other, path, errs, ParamErrorKind::InvalidValue, ""),
    }
}

/// Appends `(key, normalized)` unless the value is an absent `Option`.
pub fn write_field<T: ParamValue>(v: &T, key: &'static str, out: &mut Vec<(&'static str, String)>) {
    if v.is_absent() {
        return;
    }
    let mut s = String::new();
    v.write_normalized(&mut s);
    out.push((key, s));
}

/// Normalized object: keys sorted bytewise (30 §9 rule 6).
pub fn write_struct<T: ParamsFields>(v: &T, out: &mut String) {
    let mut fields = Vec::new();
    v.__write_fields(&mut fields);
    fields.sort_unstable_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    out.push('{');
    for (i, (k, val)) in fields.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        write_json_str(out, k);
        out.push(':');
        out.push_str(val);
    }
    out.push('}');
}

pub fn struct_expected<T: ParamsFields>() -> String {
    format!("a JSON object of {} params", T::NAME)
}

// D-PENDING: 30 §9 rule 8 does not say how nested params structs appear in
// the schema; chose `$defs` keyed by the Rust type name (`Name_2`, `Name_3`
// for another type of the same name, in first-use order) with `$ref`, and
// `"#"` for the root.
/// The `$defs` of one generated schema (30 §9 rule 8): every nested params
/// struct is emitted once, under its type name, and referenced with `$ref`,
/// so a recursive struct (`children: Vec<Self>`) gives a finite schema of
/// linear size. The root struct is referenced as `"#"`.
pub struct SchemaDefs {
    root: TypeId,
    /// `(type, unique name, schema)`; the schema is `None` while it is being
    /// built (a recursive reference).
    entries: Vec<(TypeId, String, Option<Value>)>,
}

impl SchemaDefs {
    fn for_root<T: 'static>() -> Self {
        SchemaDefs {
            root: TypeId::of::<T>(),
            entries: Vec::new(),
        }
    }

    /// A `$defs` name for `name` that no other type uses yet.
    fn unique_name(&self, name: &str) -> String {
        let taken = |n: &str| self.entries.iter().any(|(_, e, _)| e == n);
        if !taken(name) {
            return name.to_owned();
        }
        (2..)
            .map(|i| format!("{name}_{i}"))
            .find(|n| !taken(n))
            .unwrap_or_default()
    }
}

fn reference(target: &str) -> Value {
    let mut m = serde_json::Map::new();
    m.insert("$ref".into(), target.into());
    Value::Object(m)
}

/// The schema of a nested params struct: a `$ref` to its `$defs` entry,
/// built on first use (30 §9 rule 8).
pub fn struct_schema<T: ParamsFields>(defs: &mut SchemaDefs) -> Value {
    let id = TypeId::of::<T>();
    if id == defs.root {
        return reference("#");
    }
    if let Some((_, name, _)) = defs.entries.iter().find(|(t, _, _)| *t == id) {
        return reference(&format!("#/$defs/{name}"));
    }
    let name = defs.unique_name(T::NAME);
    defs.entries.push((id, name.clone(), None));
    let body = struct_body::<T>(defs);
    if let Some(e) = defs.entries.iter_mut().find(|(t, _, _)| *t == id) {
        e.2 = Some(body);
    }
    reference(&format!("#/$defs/{name}"))
}

/// The object schema of a params struct's own fields.
fn struct_body<T: ParamsFields>(defs: &mut SchemaDefs) -> Value {
    let mut props = Vec::new();
    let mut required = Vec::new();
    T::__schema_fields(&mut props, &mut required, defs);
    let mut m = serde_json::Map::new();
    m.insert("type".into(), "object".into());
    if !T::DOC.is_empty() {
        m.insert("description".into(), T::DOC.into());
    }
    let mut pm = serde_json::Map::new();
    for (k, s) in props {
        pm.insert(k.to_owned(), s);
    }
    m.insert("properties".into(), Value::Object(pm));
    required.sort_unstable();
    m.insert(
        "required".into(),
        Value::Array(required.into_iter().map(Value::from).collect()),
    );
    m.insert("additionalProperties".into(), false.into());
    Value::Object(m)
}

pub(crate) fn root_schema<T: Params>() -> Value {
    let mut defs = SchemaDefs::for_root::<T>();
    let mut s = struct_body::<T>(&mut defs);
    if let Value::Object(m) = &mut s {
        m.insert(
            "$schema".into(),
            "https://json-schema.org/draft/2020-12/schema".into(),
        );
        m.insert("title".into(), T::NAME.into());
        if !defs.entries.is_empty() {
            let mut dm = serde_json::Map::new();
            for (_, name, body) in defs.entries {
                dm.insert(name, body.unwrap_or(Value::Null));
            }
            m.insert("$defs".into(), Value::Object(dm));
        }
    }
    s
}

pub fn schema_describe(s: &mut Value, doc: &str) {
    if doc.is_empty() {
        return;
    }
    if let Value::Object(m) = s {
        m.insert("description".into(), doc.into());
    }
}

/// Adds the normalized default as `default`.
pub fn schema_default<T: ParamValue>(s: &mut Value, v: &T) {
    if v.is_absent() {
        return;
    }
    let mut text = String::new();
    v.write_normalized(&mut text);
    if let Value::Object(m) = s {
        m.insert("default".into(), number_or_json(&text));
    }
}

fn number_or_json(text: &str) -> Value {
    match text.as_bytes().first() {
        Some(b'-' | b'0'..=b'9') => number_value(text),
        _ => serde_json::from_str(text).unwrap_or(Value::Null),
    }
}

/// The variant named by a string default; the derive checks the name in a
/// const assertion first, so this cannot fail.
pub fn enum_default<T: ParamEnum>(name: &str) -> T {
    match T::from_name(name) {
        Some(v) => v,
        None => unreachable!("ParamEnum default {name:?} checked at compile time"),
    }
}

pub fn parse_enum<T: ParamEnum + ParamValue>(
    input: &Input,
    path: &str,
    errs: &mut ParamError,
) -> Option<T> {
    match input {
        Input::String(s) => match T::from_name(s) {
            Some(v) => Some(v),
            None => super::value::invalid::<T>(input, path, errs, ParamErrorKind::InvalidValue, ""),
        },
        _ => super::value::invalid::<T>(input, path, errs, ParamErrorKind::InvalidValue, ""),
    }
}

pub fn enum_schema<T: ParamEnum>(doc: &str, _defs: &mut SchemaDefs) -> Value {
    let mut m = serde_json::Map::new();
    m.insert("type".into(), "string".into());
    m.insert(
        "enum".into(),
        Value::Array(T::VARIANTS.iter().map(|v| Value::from(*v)).collect()),
    );
    if !doc.is_empty() {
        m.insert("description".into(), doc.into());
    }
    Value::Object(m)
}

pub fn enum_expected<T: ParamEnum>() -> String {
    format!("one of {}", T::VARIANTS.join(", "))
}

/// The selftest params of `#[param(selftest = "..")]` (20 §5.3): `text` is a
/// JSON object of the struct's params, checked when the binary's embedded
/// selftest evaluates it like any params object.
#[track_caller]
pub fn selftest_params(name: &str, text: &str) -> serde_json::Map<String, Value> {
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(m)) => m,
        _ => panic!(
            "#[param(selftest = {text:?})] on {name}: the selftest params must be a JSON object \
             of this struct's params, e.g. selftest = r#\"{{\"trade\":false}}\"#"
        ),
    }
}

/// Whether the embedded selftest job (20 §5.3) has params this struct
/// accepts: no required field, or `#[param(selftest = "..")]`. Implemented
/// by the `Params` derive and by `()`.
pub trait SelftestReady {
    const READY: bool;
}

impl SelftestReady for () {
    const READY: bool = true;
}

/// `strategy_main!`'s compile-time check (20 §5.3, R14): a binary whose
/// params have a required field and no selftest params would fail its own
/// `selftest`, which the canonical builder and worker checks run (31 §4.4).
///
/// ```compile_fail
/// #[derive(pmb_sdk::Params, Clone, Debug)]
/// struct P {
///     /// Required, and no `#[param(selftest = "..")]`.
///     trade: bool,
/// }
/// const _: () = pmb_sdk::__private::assert_selftest_ready::<P>();
/// ```
/// ```
/// #[derive(pmb_sdk::Params, Clone, Debug)]
/// #[param(selftest = r#"{"trade":true}"#)]
/// struct P {
///     /// Required.
///     trade: bool,
/// }
/// const _: () = pmb_sdk::__private::assert_selftest_ready::<P>();
/// ```
pub const fn assert_selftest_ready<P: SelftestReady>() {
    assert!(
        P::READY,
        "the strategy's Params has a required param (no default), so the embedded selftest job \
         (20 §5.3) has no valid params: add #[param(selftest = \"<JSON object>\")] with a JSON object \
         of valid params to the params struct"
    );
}
