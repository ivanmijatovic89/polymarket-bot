//! Value macros `price!`, `qty!`, `usdc!`, `cid!`, `meta!` (30 §3, §6,
//! §7.2). The compile-time rejections are `compile_fail` doctests in
//! `src/lib.rs`.

use pmb_sdk::json::Value;
use pmb_sdk::prelude::*;
use pmb_sdk::MetaValue;

// spec: 30 §6: literal macros are const-evaluable fixed-point values
const ENTRY: Price = price!(0.53);
const LOT: Qty = qty!(5);
const FEE: Usdc = usdc!(-1.25);

// spec: 30 §6, 10 §2 (exact decimal literals to 1e-6 units, never via f64)
#[test]
fn fixed_point_literals() {
    assert_eq!(ENTRY, Price::from_micros(530_000));
    assert_eq!(LOT, Qty::from_micros(5_000_000));
    assert_eq!(FEE, Usdc::from_micros(-1_250_000));
    // Range edges of Price (0..=1).
    assert_eq!(price!(0), Price::ZERO);
    assert_eq!(price!(1), Price::ONE);
    assert_eq!(price!(1.0), Price::ONE);
    assert_eq!(price!(0.000001), Price::from_micros(1));
    assert_eq!(price!(0.999999), Price::from_micros(999_999));
    // Trailing zeros are not extra precision, however many there are.
    assert_eq!(price!(0.5300000), Price::from_micros(530_000));
    assert_eq!(
        price!(0.1000000000000000000000000000000000000000000),
        Price::from_micros(100_000)
    );
    // Exponents and underscores of Rust literals.
    assert_eq!(usdc!(1e3), Usdc::from_micros(1_000_000_000));
    assert_eq!(usdc!(1.5e-5), Usdc::from_micros(15));
    assert_eq!(usdc!(2.5E+2), Usdc::from_micros(250_000_000));
    assert_eq!(usdc!(1_000.25), Usdc::from_micros(1_000_250_000));
    assert_eq!(qty!(2.), Qty::from_micros(2_000_000));
    // Max precision and the full i64 micro range of Qty and Usdc.
    assert_eq!(qty!(9223372036854.775807), Qty::MAX);
    assert_eq!(qty!(-9223372036854.775808), Qty::MIN);
    assert_eq!(usdc!(-0.000001), Usdc::from_micros(-1));
    assert_eq!(usdc!(-0), Usdc::ZERO);
    // A value no f64 holds exactly is still exact.
    assert_eq!(usdc!(0.1), Usdc::from_micros(100_000));
    assert_eq!(
        usdc!(4503599627.370497),
        Usdc::from_micros(4_503_599_627_370_497)
    );
}

macro_rules! forward_price {
    ($l:literal) => {
        price!($l)
    };
}

macro_rules! forward_usdc {
    ($l:literal) => {
        usdc!($l)
    };
}

// spec: 30 §6 (literals forwarded through macro_rules! stay exact)
#[test]
fn forwarded_literals() {
    assert_eq!(forward_price!(0.25), Price::from_micros(250_000));
    assert_eq!(forward_usdc!(-1.5), Usdc::from_micros(-1_500_000));
}

// spec: 30 §6, 10 §6 (cid! checked at compile time: 1..=256 bytes of printable ASCII)
#[test]
fn cid_literals() {
    assert_eq!(cid!("entry").as_str(), "entry");
    assert_eq!(cid!(" ~").as_str(), " ~");
    assert_eq!(cid!(r"a\b").as_str(), "a\\b");
    let long = cid!(
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\
         0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\
         0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\
         0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );
    assert_eq!(long.as_str().len(), 256);
    assert_eq!(cid!("x1"), ClientOrderId::new("x1").unwrap());
}

// spec: 30 §7.2 (meta! of bool, i64, f64, string; Meta::json escape hatch), 21 §16
#[test]
fn meta_values() {
    let m = meta! { "edge" => 0.031, "leg" => "entry", "n" => 3, "ok" => true };
    assert_eq!(m.len(), 4);
    assert_eq!(
        m.to_json_string(),
        r#"{"edge":0.031,"leg":"entry","n":3,"ok":true}"#
    );
    // Trailing comma, runtime expressions, owned strings, fixed point, Option.
    let label = String::from("a\"b\n");
    let stake: Option<f64> = None;
    let m = meta! {
        "label" => &label,
        "owned" => label.clone(),
        "px" => price!(0.53),
        "fill" => qty!(5.994806),
        "pnl" => usdc!(-1.01),
        "stake" => stake,
        "some" => Some(2_i64),
        "safe" => 9_007_199_254_740_991_i64,
        "ratio" => 2.0 * 0.5,
        "count" => 3_usize,
    };
    assert_eq!(
        m.to_json_string(),
        r#"{"label":"a\"b\n","owned":"a\"b\n","px":0.53,"fill":5.994806,"pnl":-1.01,"stake":null,"some":2,"safe":9007199254740991,"ratio":1,"count":3}"#
    );
    // spec: 21 §18 N2: no integer beyond ±(2^53 - 1) in a payload; larger
    // integers are written as the nearest f64, as a JSON reader holds them.
    let m = meta! { "big" => i64::MAX, "neg" => -9_007_199_254_740_993_i64, "u" => u64::MAX };
    assert_eq!(m.get("big"), Some(&MetaValue::Float(9.223372036854776e18)));
    assert_eq!(m.get("neg"), Some(&MetaValue::Float(-9007199254740992.0)));
    assert_eq!(
        m.to_json_string(),
        r#"{"big":9223372036854776000,"neg":-9007199254740992,"u":18446744073709552000}"#
    );
    // Non-finite numbers serialize as null (21 §16).
    let m = meta! { "nan" => f64::NAN, "inf" => f64::INFINITY, "neg0" => -0.0 };
    assert_eq!(m.to_json_string(), r#"{"nan":null,"inf":null,"neg0":0}"#);
    // Empty meta.
    assert!(meta! {}.is_empty());
    assert_eq!(meta! {}.to_json_string(), "{}");
}

// spec: 30 §7.2 (Meta::json), §4 rule 8 (status writes into a reused Meta)
#[test]
fn meta_builder() {
    let mut m = Meta::new();
    m.set("a", 1).set("b", "x");
    m.json(
        "levels",
        serde_json::json!([{"p": 0.5, "s": 10}, {"p": 0.51, "s": 3}]),
    );
    // Setting a key again replaces it (keys stay unique).
    m.set("a", false);
    m.set(String::from("dyn"), 7_u32);
    assert_eq!(
        m.to_json_string(),
        r#"{"a":false,"b":"x","levels":[{"p":0.5,"s":10},{"p":0.51,"s":3}],"dyn":7}"#
    );
    assert_eq!(m.get("dyn"), Some(&7_u32.into()));
    assert!(matches!(
        m.get("levels"),
        Some(MetaValue::Json(Value::Array(_)))
    ));
    let parsed: Value = serde_json::from_str(&m.to_json_string()).unwrap();
    assert_eq!(parsed["levels"][1]["s"], 3);
    m.clear();
    assert!(m.is_empty());
}

// spec: 30 §2 (sdkVersion embedded, SemVer, independent of the engine)
#[test]
fn sdk_version() {
    let parts: Vec<&str> = pmb_sdk::SDK_VERSION.split('.').collect();
    assert_eq!(parts.len(), 3, "{}", pmb_sdk::SDK_VERSION);
    assert!(parts.iter().all(|p| p.parse::<u64>().is_ok()));
    assert!(
        pmb_sdk::SDK_VERSION.starts_with("0."),
        "the SDK stays 0.x before M11 (30 §2)"
    );
}

// spec: 30 §3, §6: the §6 value methods come with the prelude alone
#[test]
fn prelude_value_methods() {
    let now = TsMs(10_000);
    let last = TsMs(10_400); // ts-compat now() stepped back (30 §5.0)
    assert_eq!(now.ms_since(last), -400);
    assert_eq!(now.saturating_since(last), DurMs(0));
    assert_eq!(
        ENTRY.snap(price!(0.05), Rounding::HalfAwayFromZero),
        price!(0.55)
    );
    assert_eq!(Price::clamp_probability(-3.0), 0.0);
    assert_eq!(Outcome::Down.opposite(), Outcome::Up);
    assert_eq!(ClientOrderId::indexed("r", 12), cid!("r12"));
}
