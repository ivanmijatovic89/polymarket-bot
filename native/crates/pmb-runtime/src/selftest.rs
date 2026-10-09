//! `selftest` (20 §5.3): fixtures embedded at build time, inside the engine
//! source set (31 §5.3): fixed-point rounding goldens (10 §4), the seed
//! vectors (10 §6.1 RNG-7), the ts-compat fee curve (11 §5.2, 13 TC-E7),
//! the compiled contract bundle, and one embedded job run twice through
//! the `run` path with byte-identical deterministic sections.

use pmb_contract::num::OutDec2;
use pmb_core::rules::FeeCurve;
use pmb_core::seed::{
    feed_stream_seed, market_seed, mix64, stream_seed, Entity, EntityKind, EntityRng,
    FeedStreamTag, RunSeed, StreamTag,
};
use pmb_core::{LevelUpdate, Outcome, Price, PriceSize, Qty, QuoteSide, Rounding, TsMs, Usdc};
use pmb_engine::Strategy;
use serde_json::{json, Value};

use crate::backend::Backend;
use crate::describe::evaluate;
use crate::inputs::{build_static_inputs, StaticEvent, StaticTape};
use crate::job::{parse_job, OutputOverrides};
use crate::params::StrategyParams;
use crate::run::{deterministic_json, on_job_thread, run_job, JobClock, RunOutcome};

/// The embedded job (20 §5.3).
pub const SELFTEST_JOB: &str = include_str!("../fixtures/selftest-job.json");

/// One check of the `selftest` document.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Check {
    /// Name.
    pub name: &'static str,
    /// Passed.
    pub ok: bool,
    /// Why it failed, or a note.
    pub detail: Option<String>,
}

impl Check {
    fn new(name: &'static str, failures: Vec<String>) -> Check {
        Check {
            name,
            ok: failures.is_empty(),
            detail: (!failures.is_empty()).then(|| failures.join("; ")),
        }
    }

    fn to_json(&self) -> Value {
        let mut v = json!({ "name": self.name, "ok": self.ok });
        if let Some(d) = &self.detail {
            v["detail"] = Value::String(d.clone());
        }
        v
    }
}

/// 10 §4 Q3 table: exact value → 2 dp, half away from zero.
pub fn check_rounding() -> Check {
    let rows: [(i64, i64); 8] = [
        (-1_005_000, -101),
        (-125_000, -13),
        (1_005_000, 101),
        (1_015_000, 102),
        (285_000, 29),
        (-2_675_000, -268),
        (-4_999, 0),
        (5_000, 1),
    ];
    let mut f = Vec::new();
    for (micros, units) in rows {
        let out = OutDec2::from_micros_half_away(micros).units();
        if out != units {
            f.push(format!("OutDec2({micros}) = {out}, want {units}"));
        }
        match Usdc::from_micros(micros).round_dp(2, Rounding::HalfAwayFromZero) {
            Ok(r) if r.micros() == units * 10_000 => {}
            other => f.push(format!("Usdc::round_dp({micros}) = {other:?}")),
        }
    }
    Check::new("fixed_point_rounding", f)
}

/// 10 §6.1 RNG-7 golden vectors (slug `btc-updown-15m-1780272000`).
pub fn check_seed_vectors() -> Check {
    const SLUG: &str = "btc-updown-15m-1780272000";
    let mut f = Vec::new();
    fn eq(f: &mut Vec<String>, name: &str, got: u64, want: u64) {
        if got != want {
            f.push(format!("{name}: {got:#018x}, want {want:#018x}"));
        }
    }
    const G: u64 = 0x9E37_79B9_7F4A_7C15;
    eq(&mut f, "splitmix64[0]", mix64(G), 0xe220_a839_7b1d_cdaf);
    eq(
        &mut f,
        "splitmix64[1]",
        mix64(G.wrapping_mul(2)),
        0x6e78_9e6a_a1b9_65f4,
    );
    let run0 = RunSeed::ZERO;
    let ms0 = market_seed(run0, SLUG);
    eq(&mut f, "market_seed(0)", ms0.0, 0xeb30_0da7_cf82_ecde);
    let seeds = [
        (123u64, 0x735c_f00e_aa5d_23b2u64),
        ((1 << 53) - 1, 0x2b93_662d_0e90_152f),
    ];
    for (run, want) in seeds {
        match RunSeed::new(run) {
            Ok(r) => eq(&mut f, "market_seed", market_seed(r, SLUG).0, want),
            Err(e) => f.push(format!("run seed {run}: {e:?}")),
        }
    }
    let place = stream_seed(ms0, StreamTag::Place);
    eq(&mut f, "stream_seed(place)", place.0, 0xffc2_7cae_89ae_3033);
    let jitter = stream_seed(ms0, StreamTag::CompatJitter);
    eq(
        &mut f,
        "stream_seed(compat_jitter)",
        jitter.0,
        0x0162_432c_20a5_94c5,
    );
    let k0 = EntityRng::new(place, Entity::packed(EntityKind::OrderKey, 0));
    eq(
        &mut f,
        "place OrderKey(0) draw(0)",
        k0.draw(0),
        0x7ac8_3cc0_5148_2e69,
    );
    eq(
        &mut f,
        "place OrderKey(0) draw(1)",
        k0.draw(1),
        0x6af3_3a65_33ac_1ffa,
    );
    let k1 = EntityRng::new(place, Entity::packed(EntityKind::OrderKey, 1));
    eq(
        &mut f,
        "place OrderKey(1) draw(0)",
        k1.draw(0),
        0x610a_f8c6_b7bb_80bd,
    );
    let md = EntityRng::new(
        stream_seed(ms0, StreamTag::MdRow),
        Entity::packed(EntityKind::InputRow, 0),
    );
    eq(
        &mut f,
        "md_row row 0 draw(0)",
        md.draw(0),
        0xbe88_5d47_0957_411b,
    );
    let binance = feed_stream_seed(run0, FeedStreamTag::Binance);
    eq(
        &mut f,
        "feed_stream_seed(feed.binance)",
        binance.0,
        0x9416_e0f7_dd99_bfb2,
    );
    eq(
        &mut f,
        "feed.binance agg 3e9 draw(0)",
        EntityRng::new(binance, Entity::raw(3_000_000_000)).draw(0),
        0x3d20_83a3_f2c7_d945,
    );
    let row = Entity::chainlink_row(1_780_272_000_000_000, 1_780_272_001_012_345);
    eq(
        &mut f,
        "feed.chainlink row entity",
        row.0,
        0x21f0_f8ef_cd0a_5519,
    );
    eq(
        &mut f,
        "feed.chainlink row draw(0)",
        EntityRng::new(feed_stream_seed(run0, FeedStreamTag::Chainlink), row).draw(0),
        0x4469_676c_00a0_2960,
    );
    eq(
        &mut f,
        "feed.priceToBeat entity 0 draw(0)",
        EntityRng::new(stream_seed(ms0, StreamTag::FeedPriceToBeat), Entity::raw(0)).draw(0),
        0xf00c_88f6_376b_1577,
    );
    let u = k0.unit_open(0);
    if u != 0.479_617_878_868_595_6 {
        f.push(format!(
            "place OrderKey(0) unit_open = {u}, want 0.4796178788685956"
        ));
    }
    for (cmd, want) in [(0u32, -34i64), (1, -78), (2, -52)] {
        let got =
            EntityRng::new(jitter, Entity::packed(EntityKind::ExecCommand, cmd)).int_in(-100, 100);
        if got != want {
            f.push(format!("compat_jitter command {cmd}: {got}, want {want}"));
        }
    }
    Check::new("seed_vectors", f)
}

/// The ts-compat fee curve (13 TC-E7) at the 11 §5.2 vector points.
pub fn check_fee_curve() -> Check {
    // (shares micros, price micros, fee micros)
    let rows: [(i64, i64, i64); 8] = [
        (100_000_000, 500_000, 1_750_000),
        (10_000_000, 530_000, 174_400),
        (800_000_000, 600_000, 13_440_000),
        (6_000_000, 640_000, 96_800),
        (5_000_000, 10_000, 3_500),
        (5_000_000, 990_000, 3_500),
        (50_000, 10_000, 0),
        (100_000, 10_000, 100),
    ];
    let mut f = Vec::new();
    for (c, p, want) in rows {
        match FeeCurve::TS_COMPAT.taker_fee(Price::from_micros(p), Qty::from_micros(c)) {
            Ok(fee) if fee.micros() == want => {}
            other => f.push(format!("fee({c}, {p}) = {other:?}, want {want}")),
        }
    }
    if FeeCurve::TS_COMPAT.canonical() != "symmetric:0.07:1:4" {
        f.push(format!("canonical {}", FeeCurve::TS_COMPAT.canonical()));
    }
    Check::new("fee_curve_ts_compat", f)
}

/// The contract hash (21 §3): the algorithm reproduces its golden vector,
/// the compiled bundle holds the schemas this binary reads and writes, and
/// it hashes to the value `describe` and `schema` report.
// D-PENDING: 21 §3 compares against the committed bundle's hash; once
// `native/contract/schema/v1` is exported, that value is embedded at build
// time and compared here instead of the recomputation.
pub fn check_contract() -> Check {
    let mut f = Vec::new();
    let (golden, want) = crate::identity::bundle_sha256_golden();
    match crate::identity::bundle_sha256(&golden) {
        Ok(sha) if sha.as_str() == want => {}
        other => f.push(format!("golden vector: {other:?}, want {want}")),
    }
    let bundle = pmb_contract::schema::bundle();
    for stem in ["engineJob", "engineResult", "modelConfig"] {
        if !bundle.iter().any(|(s, _)| *s == stem) {
            f.push(format!("schema {stem} missing from the bundle"));
        }
    }
    match crate::identity::bundle_sha256(&bundle) {
        Ok(sha) if &sha == crate::identity::contract_sha256() => {}
        other => f.push(format!(
            "bundle sha {other:?} differs from the reported {}",
            crate::identity::contract_sha256()
        )),
    }
    Check::new("contract_bundle", f)
}

/// The in-memory market of the embedded job: one pre-window tick, then
/// books and price changes inside the window.
pub fn selftest_tape() -> StaticTape {
    let start = 1_780_272_000_000i64;
    let ps = |p: i64, s: i64| PriceSize {
        price: Price::from_micros(p),
        size: Qty::from_micros(s),
    };
    let mut t = StaticTape::new();
    t.push(
        TsMs(start - 5_000),
        StaticEvent::Book {
            outcome: Outcome::Up,
            bids: vec![ps(480_000, 100_000_000)],
            asks: vec![ps(520_000, 100_000_000)],
        },
    );
    t.push(
        TsMs(start + 1_000),
        StaticEvent::Book {
            outcome: Outcome::Up,
            bids: vec![ps(490_000, 50_000_000), ps(480_000, 75_000_000)],
            asks: vec![ps(510_000, 40_000_000), ps(520_000, 60_000_000)],
        },
    );
    t.push(
        TsMs(start + 1_000),
        StaticEvent::Book {
            outcome: Outcome::Down,
            bids: vec![ps(490_000, 40_000_000)],
            asks: vec![ps(510_000, 50_000_000)],
        },
    );
    for k in 0..20i64 {
        let side = if k % 2 == 0 {
            QuoteSide::Bid
        } else {
            QuoteSide::Ask
        };
        t.push(
            TsMs(start + 2_000 + k * 1_500),
            StaticEvent::PriceChange(vec![
                LevelUpdate {
                    outcome: Outcome::Up,
                    side,
                    price: Price::from_micros(if k % 2 == 0 { 490_000 } else { 510_000 }),
                    size: Qty::from_micros(10_000_000 + k * 1_000_000),
                },
                LevelUpdate {
                    outcome: Outcome::Down,
                    side,
                    price: Price::from_micros(if k % 2 == 0 { 490_000 } else { 510_000 }),
                    size: Qty::from_micros(20_000_000 - k * 500_000),
                },
            ]),
        );
    }
    t
}

/// Runs the embedded job once through the `run` path (on a job thread,
/// G11).
pub fn run_embedded<T, B>(backend: &B, stack_bytes: usize) -> Result<RunOutcome, String>
where
    T: Strategy,
    T::Params: StrategyParams,
    B: Backend<T>,
{
    let mut v: Value =
        serde_json::from_str(SELFTEST_JOB).map_err(|e| format!("embedded job: {e}"))?;
    let params = T::Params::selftest_params();
    let normalized = evaluate::<T>(&params)
        .map_err(|errs| {
            format!(
                "selftest params invalid for this strategy: {}",
                errs.iter()
                    .map(|e| format!("{} {}", e.path, e.message))
                    .collect::<Vec<_>>()
                    .join("; ")
            )
        })?
        .normalized;
    v["run"]["strategyId"] = Value::String(T::ID.to_string());
    v["run"]["candidates"][0]["params"] = Value::Object(normalized);
    let bytes = serde_json::to_vec(&v).map_err(|e| e.to_string())?;
    let job = parse_job(&bytes).map_err(|e| e.reason())?;
    let market_text = job.market.condition_id.clone();
    on_job_thread(stack_bytes, || {
        let clock = JobClock::start();
        run_job::<T, B>(job, &OutputOverrides::default(), backend, &clock, |j, t| {
            build_static_inputs(j, t, selftest_tape(), market_text)
        })
    })
    .map_err(|e| e.reason())
}

/// The run-path check: two runs, both `ok`, identical deterministic bytes.
pub fn check_run_path<T, B>(backend: &B, stack_bytes: usize) -> Check
where
    T: Strategy,
    T::Params: StrategyParams,
    B: Backend<T>,
{
    let a = run_embedded::<T, B>(backend, stack_bytes);
    let b = run_embedded::<T, B>(backend, stack_bytes);
    let mut f = Vec::new();
    match (a, b) {
        (Ok(a), Ok(b)) => {
            for (n, o) in [("first", &a), ("second", &b)] {
                if o.exit_code != 0 {
                    f.push(format!(
                        "{n} run failed: {}",
                        o.reason.clone().unwrap_or_default()
                    ));
                }
            }
            if f.is_empty() && deterministic_json(&a.result) != deterministic_json(&b.result) {
                f.push("deterministic sections differ between two runs (20 G5)".into());
            }
        }
        (Err(e), _) | (_, Err(e)) => f.push(e),
    }
    Check::new("run_path", f)
}

/// Every check and the `selftest` document (20 §5.3). Exit 0 when all
/// pass, else 8.
pub fn selftest<T, B>(backend: &B, stack_bytes: usize) -> (Value, bool)
where
    T: Strategy,
    T::Params: StrategyParams,
    B: Backend<T>,
{
    // D-PENDING: 20 §5.3 also runs the job through `serve` with two threads
    // and compares it with the run path. `serve` lands in M5a and is absent
    // from `capabilities.subcommands`; the check is left out until then
    // rather than reported as passed.
    let checks = vec![
        check_rounding(),
        check_seed_vectors(),
        check_fee_curve(),
        check_contract(),
        check_run_path::<T, B>(backend, stack_bytes),
    ];
    let ok = checks.iter().all(|c| c.ok);
    let doc = json!({
        "type": "selftest",
        "ok": ok,
        "checks": checks.iter().map(Check::to_json).collect::<Vec<_>>(),
    });
    (doc, ok)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_goldens_pass() {
        // spec: 10 §4 Q3, 10 §6.1 RNG-7, 11 §5.2, 21 §3 CI item 7
        for c in [
            check_rounding(),
            check_seed_vectors(),
            check_fee_curve(),
            check_contract(),
        ] {
            assert!(c.ok, "{}: {:?}", c.name, c.detail);
        }
    }

    #[test]
    fn embedded_job_parses() {
        let job = parse_job(SELFTEST_JOB.as_bytes()).unwrap();
        assert_eq!(job.market.slug, "btc-updown-15m-1780272000");
        assert!(crate::inputs::MarketTape::Static(selftest_tape()).len() > 3);
    }
}
