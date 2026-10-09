//! ts-compat execution goldens (13 §11 "compat goldens"; 60 §7.1): the
//! scenarios of `golden/compat_scenarios.txt` run through the Rust simulator
//! must render exactly `golden/compat_expected.txt`, which `compat_gen.ts`
//! generates by running the TS oracle `BacktestExecution` in isolation on
//! the same synthetic books. Covered: FOK kill and fill, GTC partial fill
//! and rest, the free remainder fill (13 §5.3), worst-queue trade-through
//! and expiry precedence (TC-E5), post-only (11 §4), batch liquidity
//! without depletion (TC-E3), latency queue order (TC-E1), delayed cancel
//! binding and `cancel_market` resolved at execution (TC-C5, TC-C10),
//! synchronous split/merge (TC-E9).

use pmb_core::order::{OrderType, Side};

use super::{dec, outcome, req, Harness};
use crate::exec::CancelScope;

const SCENARIOS: &str = include_str!("golden/compat_scenarios.txt");
const EXPECTED: &str = include_str!("golden/compat_expected.txt");

fn levels(spec: &str) -> Vec<(i64, i64)> {
    if spec.is_empty() {
        return Vec::new();
    }
    spec.split(',')
        .map(|pair| {
            let (p, s) = pair.split_once(':').expect("p:s");
            (dec(p), dec(s))
        })
        .collect()
}

fn side(s: &str) -> Side {
    match s {
        "BUY" => Side::Buy,
        "SELL" => Side::Sell,
        _ => panic!("bad side {s}"),
    }
}

fn order_type(s: &str) -> OrderType {
    match s {
        "GTC" => OrderType::Gtc,
        "GTD" => OrderType::Gtd,
        "FOK" => OrderType::Fok,
        _ => panic!("bad order type {s}"),
    }
}

/// Runs one command line against the harness; returns the rendered events.
fn step(h: &mut Harness, line: &str) -> Vec<String> {
    let w: Vec<&str> = line.split_whitespace().collect();
    let t = || w[1].parse::<i64>().expect("time");
    match w[0] {
        "book" => {
            let bids = w[2].strip_prefix("bids=").expect("bids=");
            let asks = w[3].strip_prefix("asks=").expect("asks=");
            h.book(outcome(w[1]), &levels(bids), &levels(asks));
        }
        "position" => h.position(outcome(w[1]), dec(w[2])),
        "place" => {
            let t = t();
            let rest = line.splitn(3, ' ').nth(2).expect("orders");
            let mut keys = Vec::new();
            for part in rest.split('|') {
                let p: Vec<&str> = part.split_whitespace().collect();
                let mut r = req(
                    outcome(p[1]),
                    side(p[2]),
                    dec(p[3]),
                    dec(p[4]),
                    order_type(p[5]),
                );
                for flag in &p[6..] {
                    if *flag == "post" {
                        r.post_only = true;
                    } else if let Some(e) = flag.strip_prefix("exp=") {
                        r.expire_at_ms = Some(pmb_core::TsMs(e.parse().expect("exp")));
                    } else {
                        panic!("bad flag {flag}");
                    }
                }
                keys.push(h.record(p[0], r, t));
            }
            h.place(t, &keys);
        }
        "cancel" => {
            let k = h.key_of(w[2]);
            h.cancel(t(), &[k]);
        }
        "cancel_market" => {
            let scope = match w.get(2) {
                Some(o) => CancelScope::Outcome(outcome(o)),
                None => CancelScope::Market,
            };
            h.cancel_scope(t(), scope);
        }
        "cancel_all" => h.cancel_all(t()),
        "split" => {
            let op = h.op();
            h.submit(
                t(),
                crate::exec::ExecCommand::Split {
                    op,
                    size: pmb_core::Qty::from_micros(dec(w[2])),
                },
            );
        }
        "merge" => {
            let op = h.op();
            h.submit(
                t(),
                crate::exec::ExecCommand::Merge {
                    op,
                    size: pmb_core::Qty::from_micros(dec(w[2])),
                },
            );
        }
        "tick" => h.tick(t()),
        other => panic!("unknown command {other}"),
    }
    h.take_rendered()
}

/// Runs the whole scenario file; returns the rendered text without comments.
fn run_all(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut h: Option<Harness> = None;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(name) = line.strip_prefix("scenario ") {
            out.push(format!("== {name}"));
            h = Some(Harness::compat(0));
            continue;
        }
        out.push(format!("> {line}"));
        let hh = h.as_mut().expect("command before scenario");
        if let Some(d) = line.strip_prefix("delay ") {
            *hh = Harness::compat(d.parse().expect("delay"));
            continue;
        }
        out.extend(step(hh, line));
    }
    out
}

#[test]
fn compat_execution_matches_ts_oracle_goldens() {
    // spec: 13 §11 (compat goldens from TS BacktestExecution in isolation), 13 §5.1–§5.3, 11 §4
    let got = run_all(SCENARIOS);
    let want: Vec<&str> = EXPECTED
        .lines()
        .filter(|l| !l.starts_with('#') && !l.is_empty())
        .collect();
    for (i, (g, w)) in got.iter().zip(want.iter()).enumerate() {
        assert_eq!(g, w, "first difference at golden line {i}");
    }
    assert_eq!(got.len(), want.len(), "golden length");
}

#[test]
fn goldens_are_deterministic_across_runs() {
    // spec: 13 §10 (pure function of inputs and ModelConfig), R7
    assert_eq!(run_all(SCENARIOS), run_all(SCENARIOS));
}
