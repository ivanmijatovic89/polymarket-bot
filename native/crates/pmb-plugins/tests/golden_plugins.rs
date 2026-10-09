//! Plugin goldens from the TS oracle (14 §13 V-5, V-6 (b); 60 §7.2 "Plugin
//! math": integers exact, floats relative 1e-9). Fixtures:
//! `native/fixtures/golden/plugins/{plugins,ta}_golden.json`, written by
//! `native/fixtures/gen/plugins_gen.ts` running the real TS plugins.

use pmb_core::{PerOutcome, Price, TsMs};
use pmb_plugins::ts_shape::{plugin_json, plugins_json};
use pmb_plugins::{
    BidOrAsk, BookTop, Candle, CandleInterval, DwellGateConfig, PluginId, PluginMarket,
    PluginRequest, PluginSet, PluginTick, TaInput, TaOutput, TaUnavailable, TimeWindowGateConfig,
    TimeWindowVolatilityConfig, VolPrice,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::PathBuf;

/// Relative float tolerance of 60 §7.2.
const REL_TOL: f64 = 1e-9;

fn golden(name: &str) -> Value {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/golden/plugins")
        .join(name);
    let text = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()));
    let v: Value = serde_json::from_str(&text).unwrap();
    // spec: 60 §7.1 GF-2 (header)
    let h = &v["header"];
    assert_eq!(h["generator"], "native/fixtures/gen/plugins_gen.ts");
    // The golden was produced by the committed generator (stale-golden guard).
    let gen = std::fs::read(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/gen/plugins_gen.ts"),
    )
    .expect("generator source");
    let sha: String = Sha256::digest(&gen)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    assert_eq!(
        h["generatorSha256"].as_str(),
        Some(sha.as_str()),
        "{name}: regenerate the golden"
    );
    assert_eq!(h["contentPin"].as_str().map(str::len), Some(40));
    v
}

/// Largest relative float difference seen (reported, must stay <= REL_TOL).
struct Cmp {
    max_rel: f64,
    floats: usize,
}

impl Cmp {
    fn new() -> Cmp {
        Cmp {
            max_rel: 0.0,
            floats: 0,
        }
    }

    fn check(&mut self, path: &str, got: &Value, want: &Value) {
        match (got, want) {
            (Value::Number(a), Value::Number(b)) => {
                if let (Some(x), Some(y), false, false) =
                    (a.as_i64(), b.as_i64(), a.is_f64(), b.is_f64())
                {
                    assert_eq!(x, y, "{path}: integer mismatch");
                    return;
                }
                let (x, y) = (a.as_f64().unwrap(), b.as_f64().unwrap());
                self.floats += 1;
                if x != y {
                    let rel = (x - y).abs() / x.abs().max(y.abs());
                    self.max_rel = self.max_rel.max(rel);
                    assert!(rel <= REL_TOL, "{path}: got {x}, want {y} (rel {rel:e})");
                }
            }
            (Value::Object(a), Value::Object(b)) => {
                let ka: Vec<_> = a.keys().collect();
                let kb: Vec<_> = b.keys().collect();
                assert_eq!(ka, kb, "{path}: keys differ");
                for (k, v) in b {
                    self.check(&format!("{path}.{k}"), &a[k], v);
                }
            }
            (Value::Array(a), Value::Array(b)) => {
                assert_eq!(a.len(), b.len(), "{path}: length differs");
                for (i, (x, y)) in a.iter().zip(b).enumerate() {
                    self.check(&format!("{path}[{i}]"), x, y);
                }
            }
            _ => assert_eq!(got, want, "{path}"),
        }
    }
}

fn request(cfg: &Value) -> PluginRequest {
    let mut req = PluginRequest::default();
    for (k, c) in cfg.as_object().unwrap() {
        match k.as_str() {
            "timeWindowVolatility" => {
                let track = match c["trackPrice"].as_str().unwrap() {
                    "bid" => VolPrice::Bid,
                    "ask" => VolPrice::Ask,
                    "mid" => VolPrice::Mid,
                    other => panic!("trackPrice {other}"),
                };
                let windows = c["windows"]
                    .as_object()
                    .unwrap()
                    .iter()
                    .map(|(l, ms)| (l.clone(), ms.as_i64().unwrap()));
                req.time_window_volatility = Some(TimeWindowVolatilityConfig::new(windows, track));
            }
            "dwellGate" => {
                req.dwell_gate = Some(DwellGateConfig {
                    from: Price::from_micros(c["fromMicros"].as_i64().unwrap()),
                    to: Price::from_micros(c["toMicros"].as_i64().unwrap()),
                    required_ms: c["requiredMs"].as_i64().unwrap(),
                    track_price: match c["trackPrice"].as_str().unwrap() {
                        "bid" => BidOrAsk::Bid,
                        "ask" => BidOrAsk::Ask,
                        other => panic!("trackPrice {other}"),
                    },
                });
            }
            "timeWindowGate" => {
                req.time_window_gate = Some(TimeWindowGateConfig {
                    allow_after_ms: c["allowAfterMs"].as_i64().unwrap(),
                    disable_after_ms: c["disableAfterMs"].as_i64().unwrap(),
                });
            }
            other => panic!("unknown plugin {other} in fixture"),
        }
    }
    req
}

fn top(side: &Value) -> BookTop {
    let p = |v: &Value| v.as_i64().map(Price::from_micros);
    BookTop::new(p(&side["bid"]), p(&side["ask"]))
}

// spec: 14 §13 V-5 (plugin sequences equal TS), 14 §12.3, §12.4; V-7 (P-13 generations change iff the visible value changes)
#[test]
fn plugin_sequences_match_typescript() {
    let g = golden("plugins_golden.json");
    let mut cmp = Cmp::new();
    let mut compared = 0;
    let mut gate_dropped = 0;
    for sc in g["scenarios"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap();
        let start = sc["marketStartMs"].as_i64().unwrap();
        let market = PluginMarket::from_slug(&format!("btc-updown-15m-{}", start / 1000)).unwrap();
        let tokens = PerOutcome::new(
            sc["upAsset"].as_str().unwrap(),
            sc["downAsset"].as_str().unwrap(),
        );
        let mut set = PluginSet::new(&request(&sc["plugins"])).unwrap();
        set.start_market(&market, None).unwrap();
        let mut prev: Vec<Option<Value>> = PluginId::ALL
            .iter()
            .map(|&id| plugin_json(set.view(), id, &tokens))
            .collect();
        let mut prev_gen: Vec<Option<u64>> =
            PluginId::ALL.iter().map(|&id| set.generation(id)).collect();
        let mut expected = sc["expected"].as_array().unwrap().iter().peekable();
        for (i, t) in sc["ticks"].as_array().unwrap().iter().enumerate() {
            let Some(ts) = t["ts"].as_i64() else {
                // Non-finite TS timestamps never reach plugins (TS window gate,
                // runSingleMarket.ts:306-313); TsMs cannot represent them.
                assert!(
                    t["nonFinite"].is_string(),
                    "{name}#{i}: null ts without nonFinite"
                );
                assert!(expected
                    .peek()
                    .is_none_or(|e| e["i"].as_u64() != Some(i as u64)));
                gate_dropped += 1;
                continue;
            };
            let tick = PluginTick::new(
                TsMs(ts),
                t["synthetic"].as_bool().unwrap(),
                PerOutcome::new(top(&t["up"]), top(&t["down"])),
            );
            let any = set.on_tick(&tick).unwrap();
            let mut any_json = false;
            for (k, &id) in PluginId::ALL.iter().enumerate() {
                let now = plugin_json(set.view(), id, &tokens);
                let gen = set.generation(id);
                let json_changed = now != prev[k];
                let gen_changed = gen != prev_gen[k];
                assert_eq!(
                    gen_changed,
                    json_changed,
                    "{name}#{i}: {} generation vs snapshot change",
                    id.as_str()
                );
                any_json |= json_changed;
                prev[k] = now;
                prev_gen[k] = gen;
            }
            assert_eq!(any, any_json, "{name}#{i}: combined change flag");
            if let Some(e) = expected.next_if(|e| e["i"].as_u64() == Some(i as u64)) {
                cmp.check(
                    &format!("{name}#{i}"),
                    &plugins_json(set.view(), &tokens),
                    &e["snapshot"],
                );
                compared += 1;
            }
        }
        assert!(
            expected.next().is_none(),
            "{name}: expected entries left over"
        );
    }
    assert!(compared > 400, "compared only {compared} snapshots");
    assert!(gate_dropped > 5);
    assert!(cmp.floats > 10_000);
    eprintln!(
        "plugin goldens: {compared} snapshots, {} floats, max relative diff {:e}",
        cmp.floats, cmp.max_rel
    );
}

fn candles(rows: &Value, interval: CandleInterval) -> Vec<Candle> {
    let v: Vec<Candle> = rows
        .as_array()
        .unwrap()
        .iter()
        .map(|r| Candle {
            open_time: TsMs(r[0].as_i64().unwrap()),
            open: r[1].as_f64().unwrap(),
            high: r[2].as_f64().unwrap(),
            low: r[3].as_f64().unwrap(),
            close: r[4].as_f64().unwrap(),
            volume: r[5].as_f64().unwrap(),
            close_time: TsMs(r[6].as_i64().unwrap()),
        })
        .collect();
    assert!(v
        .iter()
        .all(|c| c.close_time.0 == c.open_time.0 + interval.ms() - 1));
    v
}

// spec: 14 §13 V-6 (b) (indicators on identical candles equal TS), P-9, P-11
#[test]
fn technical_indicators_match_typescript() {
    let g = golden("ta_golden.json");
    let mut cmp = Cmp::new();
    let mut ready = 0;
    for sc in g["scenarios"].as_array().unwrap() {
        let name = sc["name"].as_str().unwrap();
        let market = PluginMarket::from_slug(sc["slug"].as_str().unwrap()).unwrap();
        let h1 = candles(&sc["h1"], CandleInterval::H1);
        let m15 = candles(&sc["m15"], CandleInterval::M15);
        let mut set = PluginSet::new(&PluginRequest {
            technical_indicators: Some(Default::default()),
            ..PluginRequest::default()
        })
        .unwrap();
        set.start_market(&market, Some(TaInput { h1: &h1, m15: &m15 }))
            .unwrap();
        // Ticks never change TA (computed before the first callback, P-10).
        let tick = PluginTick::new(
            market.window.start_ms,
            false,
            PerOutcome::new(BookTop::EMPTY, BookTop::EMPTY),
        );
        assert!(!set.on_tick(&tick).unwrap());
        let out = set.view().technical_indicators().unwrap();
        let got = plugin_json(
            set.view(),
            PluginId::TechnicalIndicators,
            &PerOutcome::new("A", "B"),
        );
        let want = &sc["expected"];
        match name {
            "misaligned_15m" => assert!(matches!(
                out,
                TaOutput::Unavailable(TaUnavailable::Misaligned15m { .. })
            )),
            "not_enough_1h" => assert!(matches!(
                out,
                TaOutput::Unavailable(TaUnavailable::NotEnoughCandles {
                    interval: CandleInterval::H1,
                    have: 120,
                    need: 160
                })
            )),
            "five_minute_slug" => assert_eq!(
                out,
                &TaOutput::Unavailable(TaUnavailable::UnsupportedMarket)
            ),
            _ => {}
        }
        if want.is_null() {
            assert!(
                got.is_none(),
                "{name}: TS has no snapshot, Rust has {got:?}"
            );
        } else {
            cmp.check(name, &got.expect("Rust TA unavailable"), want);
            ready += 1;
        }
    }
    assert_eq!(ready, 3);
    eprintln!(
        "TA goldens: {} floats, max relative diff {:e}",
        cmp.floats, cmp.max_rel
    );
}
