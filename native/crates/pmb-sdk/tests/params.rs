//! `#[derive(Params)]` / `#[derive(ParamEnum)]` behavior (30 §9).

use pmb_sdk::params::ParamErrorKind;
use pmb_sdk::prelude::*;

/// Entry style.
#[derive(ParamEnum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Leg {
    Maker,
    #[param(rename = "taker")]
    Taker,
}

/// Depth cap shared by several strategy versions.
#[derive(Params, Clone, Debug, PartialEq)]
pub struct DepthParams {
    /// Fraction of visible ask depth an order may take; 0 disables the cap.
    #[param(default = 1, min = 0, max = 5)]
    pub depth_frac: f64,
}

/// Example lag strategy params.
#[derive(Params, Clone, Debug, PartialEq)]
pub struct LagParams {
    /// Shares per entry order.
    #[param(default = 5)]
    pub size: Qty,
    /// Highest entry price.
    #[param(default = 0.60, min = 0.01, max = 0.99)]
    pub max_price: Price,
    /// Stake per entry in USDC.
    #[param(default = 30, exclusive_min = 0)]
    pub stake_usd: Usdc,
    /// Smaller stake at the minimum edge; defaults to stakeUsd.
    #[param(exclusive_min = 0)]
    pub stake_min_usd: Option<f64>,
    /// Entries per market.
    #[param(default = 3, min = 1)]
    pub max_trades: u32,
    /// Pause after an entry.
    #[param(default = 5000)]
    pub cooldown: DurMs,
    /// Per-sqrt-second log volatility.
    #[param(default = 1e-4, exclusive_min = 0)]
    pub sigma: f64,
    #[param(default = "Maker")]
    pub leg: Leg,
    #[param(default = false)]
    pub dry: bool,
    #[param(default = "lag")]
    pub label: String,
    /// Extra asset ids.
    #[param(default)]
    pub ids: Vec<String>,
    #[param(rename = "fee_rate", default = 0.07)]
    pub fee: Rate,
    #[param(flatten)]
    pub depth: DepthParams,
}

/// A time window inside the market.
#[derive(Params, Clone, Debug, PartialEq)]
#[param(validate)]
pub struct WindowParams {
    pub from_sec: i64,
    pub to_sec: i64,
}

impl Params for WindowParams {
    fn validate(&self) -> Result<(), ParamError> {
        if self.from_sec >= self.to_sec {
            return Err(ParamError::new(
                "toSec",
                "toSec must be greater than fromSec",
            ));
        }
        Ok(())
    }
}

#[derive(Params, Clone, Debug, PartialEq)]
pub struct NestedParams {
    pub window: WindowParams,
    pub windows: Vec<WindowParams>,
    pub mode: Option<Leg>,
    #[param(rename = "a/b~c")]
    pub odd_key: Option<bool>,
}

#[derive(Params, Clone, Debug, PartialEq)]
pub struct NoParams;

fn kinds(e: &ParamError) -> Vec<(String, ParamErrorKind)> {
    e.issues()
        .iter()
        .map(|i| (i.path().to_owned(), i.kind()))
        .collect()
}

fn one_issue(e: &ParamError) -> (&str, ParamErrorKind, &str) {
    assert_eq!(e.len(), 1, "{e}");
    let i = &e.issues()[0];
    (i.path(), i.kind(), i.message())
}

/// normalize(normalize(p)) == normalize(p) through both input forms.
fn assert_idempotent(p: &LagParams) {
    let n = p.normalized_json();
    let again = LagParams::from_json_str(&n).unwrap();
    assert_eq!(&again, p);
    assert_eq!(again.normalized_json(), n);
    let value: serde_json::Value = serde_json::from_str(&n).unwrap();
    assert_eq!(
        LagParams::from_json_value(&value)
            .unwrap()
            .normalized_json(),
        n
    );
}

// spec: 30 §9 rules 1, 6 (defaults applied, keys sorted bytewise, None omitted)
#[test]
fn defaults_and_normalized_form() {
    let p = LagParams::from_cli([]).unwrap();
    assert_eq!(p.size, qty!(5));
    assert_eq!(p.max_price, price!(0.6));
    assert_eq!(p.stake_usd, usdc!(30));
    assert_eq!(p.stake_min_usd, None);
    assert_eq!(p.max_trades, 3);
    assert_eq!(p.cooldown, DurMs(5000));
    assert_eq!(p.sigma, 0.0001);
    assert_eq!(p.leg, Leg::Maker);
    assert!(!p.dry);
    assert_eq!(p.label, "lag");
    assert!(p.ids.is_empty());
    assert_eq!(p.fee, Rate::from_micros(70_000));
    assert_eq!(p.depth.depth_frac, 1.0);
    assert_eq!(
        p.normalized_json(),
        r#"{"cooldown":5000,"depthFrac":1,"dry":false,"fee_rate":0.07,"ids":[],"label":"lag","leg":"Maker","maxPrice":0.6,"maxTrades":3,"sigma":0.0001,"size":5,"stakeUsd":30}"#
    );
    assert_idempotent(&p);
}

// spec: 30 §9 table (CLI strings), rule 4 (camelCase keys, rename), rule 5 (flatten)
#[test]
fn cli_strings() {
    let p = LagParams::from_cli([
        "size=2.5",
        "maxPrice=0.55",
        "stakeUsd=12.000001",
        "stakeMinUsd=7.5",
        "maxTrades=+4",
        "cooldown=250",
        "sigma=3e-5",
        "leg=taker",
        "dry=true",
        "label=a=b",
        r#"ids=["x","y"]"#,
        "fee_rate=0.05",
        "depthFrac=0.5",
    ])
    .unwrap();
    assert_eq!(p.size, Qty::from_micros(2_500_000));
    assert_eq!(p.max_price, price!(0.55));
    assert_eq!(p.stake_usd, Usdc::from_micros(12_000_001));
    assert_eq!(p.stake_min_usd, Some(7.5));
    assert_eq!(p.max_trades, 4);
    assert_eq!(p.cooldown, DurMs(250));
    assert_eq!(p.sigma, 3e-5);
    assert_eq!(p.leg, Leg::Taker);
    assert!(p.dry);
    assert_eq!(p.label, "a=b");
    assert_eq!(p.ids, vec!["x".to_owned(), "y".to_owned()]);
    assert_eq!(p.fee, Rate::from_micros(50_000));
    assert_eq!(p.depth.depth_frac, 0.5);
    assert_eq!(
        p.normalized_json(),
        r#"{"cooldown":250,"depthFrac":0.5,"dry":true,"fee_rate":0.05,"ids":["x","y"],"label":"a=b","leg":"taker","maxPrice":0.55,"maxTrades":4,"sigma":0.00003,"size":2.5,"stakeMinUsd":7.5,"stakeUsd":12.000001}"#
    );
    assert_idempotent(&p);
}

// spec: 30 §9 table (typed JSON, decimal strings), 20 §5.1 (mixed CLI strings and typed JSON)
#[test]
fn typed_json_and_mixed() {
    let typed = LagParams::from_json_str(
        r#"{"size":2.5,"maxPrice":"0.55","stakeMinUsd":7.5,"maxTrades":4,"cooldown":250,
            "sigma":3e-5,"leg":"taker","dry":true,"ids":["x","y"],"fee_rate":0.05,
            "depthFrac":"0.5","stakeUsd":"12.000001"}"#,
    )
    .unwrap();
    let cli = LagParams::from_cli([
        "size=2.5",
        "maxPrice=0.55",
        "stakeMinUsd=7.5",
        "maxTrades=4",
        "cooldown=250",
        "sigma=0.00003",
        "leg=taker",
        "dry=true",
        r#"ids=["x","y"]"#,
        "fee_rate=0.05",
        "depthFrac=0.5",
        "stakeUsd=12.000001",
    ])
    .unwrap();
    assert_eq!(typed, cli);
    assert_eq!(typed.normalized_json(), cli.normalized_json());
    // Integral JSON numbers are integers by exact value (rule 10).
    let p = LagParams::from_json_str(r#"{"maxTrades":20.0,"cooldown":2e3}"#).unwrap();
    assert_eq!((p.max_trades, p.cooldown), (20, DurMs(2000)));
}

// spec: 10 §2 T6, 30 §9 table: fixed point is parsed from the decimal text, never via f64
#[test]
fn fixed_point_from_exact_text() {
    let p = LagParams::from_json_str(r#"{"stakeUsd":9223372036854.775807,"size":1e-6}"#).unwrap();
    assert_eq!(p.stake_usd, Usdc::from_micros(i64::MAX));
    assert_eq!(p.size, Qty::from_micros(1));
    let p = LagParams::from_json_str(r#"{"size":0.1,"maxPrice":0.30000}"#).unwrap();
    assert_eq!(p.size, Qty::from_micros(100_000));
    assert_eq!(p.max_price, price!(0.3));
    assert_eq!(
        LagParams::from_json_str(r#"{"stakeUsd":-1}"#)
            .unwrap_err()
            .issues()[0]
            .message(),
        "expected a number > 0, got -1"
    );
}

// spec: 30 §9 table (Option), rule 6, rule 9 PG-1 (c): null and "null" normalize to absent
#[test]
fn option_null_is_absent() {
    let absent = LagParams::from_json_str("{}").unwrap();
    let typed_null = LagParams::from_json_str(r#"{"stakeMinUsd":null}"#).unwrap();
    let cli_null = LagParams::from_cli(["stakeMinUsd=null"]).unwrap();
    assert_eq!(typed_null.stake_min_usd, None);
    assert_eq!(cli_null.stake_min_usd, None);
    assert_eq!(typed_null.normalized_json(), absent.normalized_json());
    assert_eq!(cli_null.normalized_json(), absent.normalized_json());
    assert!(!absent.normalized_json().contains("stakeMinUsd"));
    assert_idempotent(&typed_null);
    // PG-1 (b): a set value is kept.
    let set = LagParams::from_json_str(r#"{"stakeMinUsd":12}"#).unwrap();
    assert!(set.normalized_json().contains(r#""stakeMinUsd":12,"#));
    assert_idempotent(&set);
}

// spec: 30 §9 table (f64: shortest round-trip, -0 -> 0, integral without fraction)
#[test]
fn f64_normalization() {
    let n = |s: &str| LagParams::from_cli([s]).unwrap().normalized_json();
    assert!(n("depthFrac=-0").contains(r#""depthFrac":0,"#));
    assert!(n("depthFrac=2.0").contains(r#""depthFrac":2,"#));
    assert!(n("sigma=1E-7").contains(r#""sigma":0.0000001,"#));
    assert!(n("sigma=0.1").contains(r#""sigma":0.1,"#));
    let p = LagParams::from_cli(["depthFrac=-0"]).unwrap();
    assert!(p.depth.depth_frac.is_sign_positive());
}

// spec: 30 §9 rule 7: Rust semantics only, no JS coercions
#[test]
fn rust_semantics_only() {
    let bad = |arg: &str| {
        let e = LagParams::from_cli([arg]).unwrap_err();
        assert_eq!(e.len(), 1, "{arg}: {e}");
        e.issues()[0].kind()
    };
    for arg in [
        "maxTrades=0x10",
        "maxTrades= 5",
        "maxTrades=1_000",
        "maxTrades=1.5",
        "sigma=Infinity",
        "sigma=NaN",
        "sigma=inf",
        "size=1_000",
        "size= 5",
        "size=.5",
        "size=Infinity",
        "dry=1",
        "dry=yes",
        "dry=True",
        "leg=Taker",
        "leg=",
    ] {
        assert_eq!(bad(arg), ParamErrorKind::InvalidValue, "{arg}");
    }
    // "false" is false (Zod z.coerce.boolean would make it true).
    assert!(!LagParams::from_cli(["dry=false"]).unwrap().dry);
}

// spec: 30 §9 rule 3: unknown keys list the unknown and the valid keys
#[test]
fn unknown_keys() {
    let e = LagParams::from_cli(["sise=3", "maxPrize=0.5"]).unwrap_err();
    let (path, kind, msg) = one_issue(&e);
    assert_eq!((path, kind), ("", ParamErrorKind::UnknownKeys));
    assert_eq!(
        msg,
        r#"unknown params "sise", "maxPrize"; valid params: cooldown, depthFrac, dry, fee_rate, ids, label, leg, maxPrice, maxTrades, sigma, size, stakeMinUsd, stakeUsd"#
    );
    let e = NoParams::from_json_str(r#"{"x":1}"#).unwrap_err();
    assert_eq!(
        one_issue(&e).2,
        r#"unknown params "x"; valid params: none (this strategy takes no params)"#
    );
    assert_eq!(NoParams::from_cli([]).unwrap().normalized_json(), "{}");
    assert_eq!(NoParams::keys(), Vec::<&str>::new());
}

// spec: 30 §9 rule 2 (min/max), 20 §5.1 message shape "expected a number >= 1"
#[test]
fn bounds() {
    let check = |arg: &str, msg: &str| {
        let e = LagParams::from_cli([arg]).unwrap_err();
        let (_, kind, m) = one_issue(&e);
        assert_eq!(kind, ParamErrorKind::OutOfRange, "{arg}");
        assert_eq!(m, msg, "{arg}");
    };
    check("maxPrice=0.995", "expected a number <= 0.99, got 0.995");
    check("maxPrice=0", "expected a number >= 0.01, got 0");
    check("maxTrades=0", "expected a number >= 1, got 0");
    check("stakeUsd=0", "expected a number > 0, got 0");
    check("stakeMinUsd=0", "expected a number > 0, got 0");
    check("sigma=0", "expected a number > 0, got 0");
    check("depthFrac=5.5", "expected a number <= 5, got 5.5");
    // Inclusive bounds accept the bound itself.
    let p = LagParams::from_cli(["maxPrice=0.99", "maxTrades=1", "depthFrac=5"]).unwrap();
    assert_eq!(p.max_price, price!(0.99));
    // Type ranges (10 §2): a price is from 0 to 1.
    let e = LagParams::from_cli(["maxPrice=1.5"]).unwrap_err();
    assert_eq!(
        one_issue(&e),
        (
            "/maxPrice",
            ParamErrorKind::OutOfRange,
            "expected a price from 0 to 1 with at most 6 decimal places, got \"1.5\" (a price is from 0 to 1)"
        )
    );
    let e = LagParams::from_cli(["cooldown=-1"]).unwrap_err();
    assert_eq!(one_issue(&e).1, ParamErrorKind::OutOfRange);
    let e = LagParams::from_cli(["maxTrades=-1"]).unwrap_err();
    assert_eq!(one_issue(&e).1, ParamErrorKind::InvalidValue);
}

// spec: 30 §9 table (fixed point: at most 6 dp), 10 §2 T6
#[test]
fn more_than_six_decimals() {
    let e = LagParams::from_json_str(r#"{"size":0.1234567}"#).unwrap_err();
    assert_eq!(
        one_issue(&e),
        (
            "/size",
            ParamErrorKind::InvalidValue,
            "expected a share quantity with at most 6 decimal places, got 0.1234567 (more than 6 decimal places)"
        )
    );
    // Trailing zeros are not extra precision.
    assert_eq!(
        LagParams::from_cli(["size=0.1234560"]).unwrap().size,
        Qty::from_micros(123_456)
    );
}

// spec: 30 §9 rule 3: every error kind, all reported together with JSON-pointer paths
#[test]
fn every_error_kind() {
    let e = LagParams::from_json_str("{").unwrap_err();
    assert_eq!(kinds(&e), [("".into(), ParamErrorKind::Syntax)]);
    let e = LagParams::from_cli(["size"]).unwrap_err();
    assert_eq!(
        one_issue(&e),
        (
            "",
            ParamErrorKind::Syntax,
            "--param \"size\" is not key=value; write it as --param key=value"
        )
    );
    let e = LagParams::from_json_str("[1]").unwrap_err();
    assert_eq!(
        one_issue(&e),
        (
            "",
            ParamErrorKind::NotAnObject,
            "expected a JSON object of params, got an array"
        )
    );
    let e = LagParams::from_json_str(r#"{"size":1,"size":2}"#).unwrap_err();
    assert_eq!(
        one_issue(&e),
        (
            "/size",
            ParamErrorKind::DuplicateKey,
            "param \"size\" is given more than once; keep one value"
        )
    );
    let e = LagParams::from_cli(["dry=1"]).unwrap_err();
    assert_eq!(
        one_issue(&e),
        (
            "/dry",
            ParamErrorKind::InvalidValue,
            "expected true or false, got \"1\""
        )
    );
    let e = LagParams::from_json_str(r#"{"label":5}"#).unwrap_err();
    assert_eq!(one_issue(&e).2, "expected a string, got 5");
    let e = WindowParams::from_cli(["fromSec=5"]).unwrap_err();
    assert_eq!(
        one_issue(&e),
        (
            "/toSec",
            ParamErrorKind::Missing,
            "missing required param \"toSec\": expected an integer (i64); pass it with --param toSec=<value>"
        )
    );
    let e = WindowParams::from_cli(["fromSec=5", "toSec=5"]).unwrap_err();
    assert_eq!(
        one_issue(&e),
        (
            "/toSec",
            ParamErrorKind::Custom,
            "toSec must be greater than fromSec"
        )
    );

    // All together, in field order, then unknown keys.
    let e = LagParams::from_cli([
        "size=x",
        "maxPrice=2",
        "leg=Taker",
        r#"ids=["a",1]"#,
        "zzz=1",
        "size=1",
    ])
    .unwrap_err();
    assert_eq!(
        kinds(&e),
        [
            ("/size".into(), ParamErrorKind::DuplicateKey),
            ("/size".into(), ParamErrorKind::InvalidValue),
            ("/maxPrice".into(), ParamErrorKind::OutOfRange),
            ("/leg".into(), ParamErrorKind::InvalidValue),
            ("/ids/1".into(), ParamErrorKind::InvalidValue),
            ("".into(), ParamErrorKind::UnknownKeys),
        ]
    );
    assert_eq!(
        e.issues()[3].message(),
        "expected one of Maker, taker, got \"Taker\""
    );
    // 20 §5.1 describe error objects.
    let j = e.to_json();
    assert_eq!(j[4]["path"], "/ids/1");
    assert_eq!(j[4]["message"], "expected a string, got 1");
    assert!(e
        .to_string()
        .starts_with("/size: param \"size\" is given more than once"));
}

// spec: 30 §9 table (nested Params as object or JSON object text, Vec, ParamEnum, Option)
#[test]
fn nested_structs_and_paths() {
    let p = NestedParams::from_json_str(
        r#"{"window":{"fromSec":0,"toSec":60},"windows":[{"fromSec":1,"toSec":2}],"mode":"taker"}"#,
    )
    .unwrap();
    assert_eq!(
        p.window,
        WindowParams {
            from_sec: 0,
            to_sec: 60
        }
    );
    assert_eq!(p.mode, Some(Leg::Taker));
    assert_eq!(p.odd_key, None);
    let cli = NestedParams::from_cli([
        r#"window={"fromSec":0,"toSec":60}"#,
        r#"windows=[{"fromSec":1,"toSec":2}]"#,
        "mode=taker",
    ])
    .unwrap();
    assert_eq!(cli, p);
    assert_eq!(
        p.normalized_json(),
        r#"{"mode":"taker","window":{"fromSec":0,"toSec":60},"windows":[{"fromSec":1,"toSec":2}]}"#
    );
    let again = NestedParams::from_json_str(&p.normalized_json()).unwrap();
    assert_eq!(again, p);

    // Errors inside nested objects carry the full pointer; validate runs per object.
    let e = NestedParams::from_json_str(
        r#"{"window":{"fromSec":9,"toSec":3,"x":1},"windows":[{"fromSec":1},"no"],"a/b~c":"maybe"}"#,
    )
    .unwrap_err();
    assert_eq!(
        kinds(&e),
        [
            ("/window".into(), ParamErrorKind::UnknownKeys),
            ("/window/toSec".into(), ParamErrorKind::Custom),
            ("/windows/0/toSec".into(), ParamErrorKind::Missing),
            ("/windows/1".into(), ParamErrorKind::InvalidValue),
            ("/a~1b~0c".into(), ParamErrorKind::InvalidValue),
        ]
    );
    let e = NestedParams::from_cli(["window=[1]", "windows=x"]).unwrap_err();
    assert_eq!(
        kinds(&e),
        [
            ("/window".into(), ParamErrorKind::InvalidValue),
            ("/windows".into(), ParamErrorKind::InvalidValue),
        ]
    );
}

// spec: 30 §9 rule 5 (flatten), keys()
#[test]
fn flatten_and_keys() {
    assert_eq!(
        LagParams::keys(),
        [
            "cooldown",
            "depthFrac",
            "dry",
            "fee_rate",
            "ids",
            "label",
            "leg",
            "maxPrice",
            "maxTrades",
            "sigma",
            "size",
            "stakeMinUsd",
            "stakeUsd"
        ]
    );
    let e = LagParams::from_cli(["depthFrac=9"]).unwrap_err();
    assert_eq!(one_issue(&e).0, "/depthFrac");
}

// spec: 30 §9 (ParamEnum: variant name, rename)
#[test]
fn param_enum() {
    assert_eq!(Leg::VARIANTS, &["Maker", "taker"]);
    assert_eq!(Leg::from_name("taker"), Some(Leg::Taker));
    assert_eq!(Leg::from_name("Taker"), None);
    assert_eq!(Leg::Taker.name(), "taker");
}

// spec: 30 §9 rule 8, 20 §5.1 paramsSchema: JSON Schema 2020-12 snapshot
#[test]
fn schema_snapshot() {
    let got = serde_json::to_string_pretty(&LagParams::params_schema()).unwrap();
    let want = include_str!("snapshots/lag_params.schema.json");
    assert_eq!(got.trim(), want.trim(), "schema changed:\n{got}");
    let nested = NestedParams::params_schema();
    assert_eq!(nested["properties"]["window"]["required"][0], "fromSec");
    assert_eq!(nested["properties"]["mode"]["anyOf"][0]["enum"][1], "taker");
    assert_eq!(nested["required"], serde_json::json!(["window", "windows"]));
}

#[derive(Params, Debug, PartialEq)]
pub struct IntParams {
    #[param(default = -1)]
    pub small: i8,
    #[param(default = 0)]
    pub big: u64,
    #[param(default = 7, max = 9)]
    pub n: usize,
    pub signed: Option<i64>,
}

// spec: 30 §9 table (integers: Rust FromStr for CLI, integral numbers for typed JSON), 21 §18 N2
#[test]
fn integer_fields() {
    let p =
        IntParams::from_cli(["big=18446744073709551615", "signed=-9223372036854775808"]).unwrap();
    assert_eq!(p.big, u64::MAX);
    assert_eq!(p.signed, Some(i64::MIN));
    assert_eq!(
        p.normalized_json(),
        r#"{"big":18446744073709551615,"n":7,"signed":-9223372036854775808,"small":-1}"#
    );
    assert_eq!(IntParams::from_json_str(&p.normalized_json()).unwrap(), p);
    for arg in ["small=200", "big=-1", "n=1.0", "signed=9223372036854775808"] {
        let e = IntParams::from_cli([arg]).unwrap_err();
        assert_eq!(one_issue(&e).1, ParamErrorKind::InvalidValue, "{arg}");
    }
    assert_eq!(
        one_issue(&IntParams::from_json_str(r#"{"n":10}"#).unwrap_err()).2,
        "expected a number <= 9, got 10"
    );
    // Schema type bounds only within ±(2^53 - 1).
    let s = IntParams::params_schema();
    assert_eq!(s["properties"]["small"]["minimum"], -128);
    assert_eq!(s["properties"]["small"]["maximum"], 127);
    assert_eq!(s["properties"]["big"]["minimum"], 0);
    assert!(s["properties"]["big"].get("maximum").is_none());
    assert!(s["properties"]["signed"]["anyOf"][0]
        .get("minimum")
        .is_none());
    assert_eq!(s["required"], serde_json::json!([]));
}

// spec: 30 §9 rules 6, 9, 10: normalized output compares equal to an equivalent TS-style rendering
#[test]
fn normalized_compares_by_value() {
    let p = LagParams::from_cli(["maxTrades=20", "sigma=0.0001"]).unwrap();
    let ts_style = r#"{"stakeUsd":30.0,"size":5,"sigma":1e-4,"maxTrades":20,"maxPrice":0.60,
        "leg":"Maker","label":"lag","ids":[],"fee_rate":0.07,"dry":false,"depthFrac":1,
        "cooldown":5000}"#;
    assert!(pmb_sdk::params::normalized_eq(&p.normalized_json(), ts_style).unwrap());
    assert!(!pmb_sdk::params::normalized_eq(&p.normalized_json(), "{}").unwrap());
}

/// A params tree that contains itself.
#[derive(Params, Debug, PartialEq)]
pub struct Node {
    #[param(default)]
    pub children: Vec<Node>,
    #[param(default = 0)]
    pub weight: i64,
}

// spec: 30 §9 rule 8 (schema of a recursive params struct terminates), table (nested Vec)
#[test]
fn recursive_params() {
    let n = Node::from_json_str(r#"{"children":[{"weight":2,"children":[{}]}]}"#).unwrap();
    assert_eq!(n.children[0].weight, 2);
    assert_eq!(
        n.normalized_json(),
        r#"{"children":[{"children":[{"children":[],"weight":0}],"weight":2}],"weight":0}"#
    );
    let s = Node::params_schema();
    assert_eq!(s["properties"]["children"]["items"]["type"], "object");
}
