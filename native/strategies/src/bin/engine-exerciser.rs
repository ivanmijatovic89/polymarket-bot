//! Engine exerciser `engine-exerciser.rs` (60 §5.1–§5.7, 30 §18, D20): a
//! deterministic parity-test strategy, not a trading strategy. It drives the
//! engine's intent kinds and order types on real markets so the TS twin
//! (`src/strategies/testing/engine-exerciser.ts`, id `engine-exerciser`) and
//! this strategy can be diffed trace by trace. The schedule itself is
//! [`native_strategies::exerciser`], shared with the feed exerciser.

use native_strategies::exerciser::Exerciser;
use pmb_sdk::prelude::*;

/// Engine exerciser params: none (60 §5.1, params `{}`).
#[derive(Params, Clone, Debug, Default)]
struct ExerciserParams;

/// The engine exerciser (60 §5). One instance per market (30 §4 rule 4).
#[derive(Debug, Default)]
struct EngineExerciser(Exerciser);

impl Strategy for EngineExerciser {
    type Params = ExerciserParams;
    const ID: &'static str = "engine-exerciser.rs";

    /// No feeds and no plugins (60 §5.1).
    fn requirements(_p: &ExerciserParams) -> Requirements {
        Requirements::new()
    }

    // `interests` keeps its default (all events, every tick): a ts-compat
    // port MUST NOT declare a tick interest (30 §4.1).

    fn new(_p: &ExerciserParams, _market: &MarketInfo) -> Self {
        EngineExerciser::default()
    }

    fn on_tick(&mut self, ctx: &Ctx, out: &mut Intents) -> StrategyResult {
        self.0.on_tick(ctx, out);
        Ok(())
    }

    fn on_event(&mut self, ctx: &Ctx, event: &AccountEvent, out: &mut Intents) -> StrategyResult {
        self.0.on_event(ctx, event, out);
        Ok(())
    }
}

pmb_sdk::strategy_main!(EngineExerciser);

/// Testkit tests (30 §15) of schedule v1 (60 §5.2), its pending/skip rules
/// and periodic slots (60 §5.1) and the account callback A0 (60 §5.4), on a
/// scripted synthetic market in the ts-compat profile. Intents are read from
/// the canonical parity trace (22 §3.2): `seq` is the strategy-tick index,
/// which equals the exerciser's `n` here because no feed is requested (no
/// synthetic ticks).
#[cfg(test)]
mod tests {
    use super::*;
    use pmb_sdk::json::Value;
    use pmb_sdk::testkit::{Profile, TestMarket};

    /// `btc-updown-15m-1760140800`.
    const START_MS: i64 = 1_760_140_800_000;
    /// Strategy tick `seq` happens at `T0 + 100 ms × seq`, inside the window.
    const T0_MS: i64 = START_MS + 1_000;

    const UP_BIDS: [(Price, Qty); 2] = [(price!(0.48), qty!(100)), (price!(0.47), qty!(100))];
    const UP_ASKS: [(Price, Qty); 2] = [(price!(0.52), qty!(100)), (price!(0.53), qty!(100))];
    const DOWN_BIDS: [(Price, Qty); 2] = [(price!(0.47), qty!(100)), (price!(0.46), qty!(100))];
    const DOWN_ASKS: [(Price, Qty); 2] = [(price!(0.53), qty!(100)), (price!(0.54), qty!(100))];

    fn at(seq: u64) -> TsMs {
        TsMs(T0_MS + 100 * seq as i64)
    }

    /// The scripted inputs, one strategy tick each.
    #[derive(Copy, Clone)]
    enum Input {
        UpBook,
        DownBook,
        /// A price change on a deep UP bid level (0.40, size alternating 1 and
        /// 2): a real tick that leaves both best levels unchanged.
        Filler,
    }

    /// A BTC 15m ts-compat market whose strategy tick `seq` is `inputs(seq)`,
    /// for `seq` in `0..=last`.
    fn market(capital: Usdc, last: u64, inputs: impl Fn(u64) -> Input) -> TestMarket {
        let mut m = TestMarket::btc_15m(TsMs(START_MS))
            .profile(Profile::TsCompat)
            .starting_capital(capital);
        for seq in 0..=last {
            match inputs(seq) {
                Input::UpBook => {
                    m.book(at(seq), Outcome::Up, &UP_BIDS, &UP_ASKS);
                }
                Input::DownBook => {
                    m.book(at(seq), Outcome::Down, &DOWN_BIDS, &DOWN_ASKS);
                }
                Input::Filler => {
                    let size = if seq % 2 == 0 { qty!(1) } else { qty!(2) };
                    m.price_change(at(seq), Outcome::Up, Side::Buy, price!(0.40), size);
                }
            }
        }
        m
    }

    /// Both books from the first two ticks on.
    fn full_book(seq: u64) -> Input {
        match seq {
            0 => Input::UpBook,
            1 => Input::DownBook,
            _ => Input::Filler,
        }
    }

    /// The intent records written by callbacks of `src` (`"tick"` or
    /// `"account"`), in trace order, as (`seq`, record without `t`, `seq` and
    /// `src`).
    fn intents(trace: &[Value], src: &str) -> Vec<(u64, Value)> {
        trace
            .iter()
            .filter(|r| r["t"] == "intent" && r["src"] == src)
            .map(|r| {
                let seq = r["seq"].as_u64().expect("intent record without seq");
                let mut r = r.clone();
                if let Value::Object(m) = &mut r {
                    m.remove("t");
                    m.remove("seq");
                    m.remove("src");
                }
                (seq, r)
            })
            .collect()
    }

    /// JSON equality with numbers compared by value (`10` equals `10.000000`,
    /// as the trace diff compares exact decimals, 22 §3.4).
    fn same(a: &Value, b: &Value) -> bool {
        match (a, b) {
            (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
            (Value::Array(x), Value::Array(y)) => {
                x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q))
            }
            (Value::Object(x), Value::Object(y)) => {
                x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same(v, w)))
            }
            _ => a == b,
        }
    }

    fn render(v: &[(u64, Value)]) -> String {
        v.iter().map(|(seq, r)| format!("  {seq}: {r}\n")).collect()
    }

    /// Asserts the exact intent list, in order.
    fn assert_intents(actual: &[(u64, Value)], expected: &[(u64, &str)]) {
        let expected: Vec<(u64, Value)> = expected
            .iter()
            .map(|(seq, json)| (*seq, json.parse().expect("expected record is JSON")))
            .collect();
        let equal = actual.len() == expected.len()
            && actual
                .iter()
                .zip(&expected)
                .all(|((sa, a), (se, e))| sa == se && same(a, e));
        assert!(
            equal,
            "intents differ\nactual:\n{}expected:\n{}",
            render(actual),
            render(&expected)
        );
    }

    const X1: &str = r#"{"kind":"place_limit","cid":"x1","asset":0,"side":"BUY","price":0.48,"size":10,"orderType":"GTC","postOnly":true,"expireAtMs":null}"#;
    const X2: &str = r#"{"kind":"place_limit","cid":"x2","asset":1,"side":"BUY","price":0.53,"size":5,"orderType":"FOK","postOnly":false,"expireAtMs":null}"#;
    const SPLIT: &str = r#"{"kind":"split_positions","size":10}"#;
    /// `expireAtMs` = ts of tick 90 (`T0 + 9000`) + 120000.
    const X3: &str = r#"{"kind":"place_limit","cid":"x3","asset":0,"side":"BUY","price":0.46,"size":6,"orderType":"GTD","postOnly":false,"expireAtMs":1760140930000}"#;
    const X4: &str = r#"{"kind":"place_batch","orders":[
        {"cid":"x4a","asset":0,"side":"SELL","price":0.55,"size":4,"orderType":"GTC","postOnly":false,"expireAtMs":null},
        {"cid":"x4b","asset":1,"side":"SELL","price":0.56,"size":4,"orderType":"GTC","postOnly":false,"expireAtMs":null}]}"#;
    const CANCEL_X1: &str = r#"{"kind":"cancel_order","cid":"x1"}"#;
    const X5: &str = r#"{"kind":"place_limit","cid":"x5","asset":0,"side":"BUY","price":0.54,"size":200,"orderType":"GTC","postOnly":false,"expireAtMs":null}"#;
    const X6: &str = r#"{"kind":"place_limit","cid":"x6","asset":0,"side":"BUY","price":0.43,"size":5,"orderType":"FOK","postOnly":false,"expireAtMs":null}"#;
    const X7: &str = r#"{"kind":"place_limit","cid":"x7","asset":1,"side":"BUY","price":0.53,"size":3,"orderType":"GTC","postOnly":true,"expireAtMs":null}"#;
    const CANCEL_BATCH: &str = r#"{"kind":"cancel_batch","cids":["x4a","x4b","x9-missing"]}"#;
    const CANCEL_MARKET_UP: &str = r#"{"kind":"cancel_market","asset":0}"#;

    #[test]
    fn no_params_no_feeds_no_plugins() {
        // spec: 60 §5.1 (params `{}`, no feeds, no plugins), 30 §9 rule 3
        assert_eq!(
            EngineExerciser::requirements(&ExerciserParams),
            Requirements::new()
        );
        assert_eq!(ExerciserParams.normalized_json(), "{}");
        assert!(ExerciserParams::from_cli(["size=5"]).is_err());
    }

    #[test]
    fn schedule_v1_rows_50_to_120_on_a_full_book() {
        // spec: 60 §5.2 rows 50, 60, 70, 90, 100, 120; 60 §5.1 price snapping
        let run = market(usdc!(1000), 130, full_book).run::<EngineExerciser>(&ExerciserParams);
        assert_intents(
            &intents(run.trace(), "tick"),
            &[
                (50, X1),
                (60, X2),
                (70, SPLIT),
                (90, X3),
                (100, X4),
                (120, CANCEL_X1),
            ],
        );
    }

    #[test]
    fn x2_fill_cascades_x2_exit_once() {
        // spec: 60 §5.4 A0 (first fill of x2: GTC SELL of its outcome at fill
        // price + 0.05 snapped up, size = fill size). x2 takes 5 of the 100
        // DOWN shares at 0.53; when the fill arrives depends on the latency
        // model, so only the callback source and the record are fixed.
        let run = market(usdc!(1000), 130, full_book).run::<EngineExerciser>(&ExerciserParams);
        let exits = intents(run.trace(), "account");
        assert_eq!(exits.len(), 1, "account intents:\n{}", render(&exits));
        assert!(exits[0].0 >= 60, "x2 is placed at tick 60");
        let exit = r#"{"kind":"place_limit","cid":"x2-exit","asset":1,"side":"SELL","price":0.58,"size":5,"orderType":"GTC","postOnly":false,"expireAtMs":null}"#;
        assert_intents(&exits, &[(exits[0].0, exit)]);
    }

    #[test]
    fn pending_actions_retry_in_schedule_order() {
        // spec: 60 §5.1 (a missing bid/ask keeps the action pending; retried on
        // every following tick, in schedule order). The DOWN book arrives at
        // tick 105, so x2 (row 60) and x4 (row 100) fire together there, x2
        // first.
        let inputs = |seq| match seq {
            0 => Input::UpBook,
            105 => Input::DownBook,
            _ => Input::Filler,
        };
        let run = market(usdc!(1000), 125, inputs).run::<EngineExerciser>(&ExerciserParams);
        assert_intents(
            &intents(run.trace(), "tick"),
            &[
                (50, X1),
                (70, SPLIT),
                (90, X3),
                (105, X2),
                (105, X4),
                (120, CANCEL_X1),
            ],
        );
    }

    #[test]
    fn skips_complete_silently_and_periodic_slots_cancel_after_40() {
        // spec: 60 §5.2 rows 150–500 and `600 + 100k`, 60 §5.1 (skip
        // conditions, periodic slots). With 1 USDC every BUY and the split are
        // refused for capital, so positions stay 0: merge (260) and x8 (400)
        // skip. The naked x4 sells rest in ts-compat (13 TC-C4) until the cancel
        // batch at 220, so no order is open when the slots 600 and 700 come.
        let run = market(usdc!(1), 750, full_book).run::<EngineExerciser>(&ExerciserParams);
        assert_intents(
            &intents(run.trace(), "tick"),
            &[
                (50, X1),
                (60, X2),
                (70, SPLIT),
                (90, X3),
                (100, X4),
                (120, CANCEL_X1),
                (150, X5),
                (180, X6),
                (200, X7),
                (220, CANCEL_BATCH),
                (300, CANCEL_MARKET_UP),
                (500, r#"{"kind":"cancel_all"}"#),
                (
                    600,
                    r#"{"kind":"place_limit","cid":"r600","asset":0,"side":"BUY","price":0.47,"size":5,"orderType":"GTC","postOnly":false,"expireAtMs":null}"#,
                ),
                (640, r#"{"kind":"cancel_order","cid":"r600"}"#),
                (
                    700,
                    r#"{"kind":"place_limit","cid":"r700","asset":0,"side":"BUY","price":0.47,"size":5,"orderType":"GTC","postOnly":false,"expireAtMs":null}"#,
                ),
                (740, r#"{"kind":"cancel_order","cid":"r700"}"#),
            ],
        );
        assert!(intents(run.trace(), "account").is_empty());
    }

    #[test]
    fn merge_and_x8_size_from_positions_with_full_capital() {
        // spec: 60 §5.2 rows 260 (merge size min(pos(UP), pos(DOWN), 5)) and 400
        // (x8 GTC SELL UP @ bid(UP), size min(pos(UP), 5)). With 1000 USDC the
        // split at 70 alone gives 10 UP and 10 DOWN; no order sells either
        // outcome before 260 (x4a/x4b and x2-exit rest above the book until
        // canceled or the run ends), so the merge takes 5 and leaves at least
        // 5 UP for x8. The bid read by x8 is the recorded 0.48: in ts-compat own
        // resting orders are not part of the book view (13 §5).
        let run = market(usdc!(1000), 450, full_book).run::<EngineExerciser>(&ExerciserParams);
        assert_intents(
            &intents(run.trace(), "tick"),
            &[
                (50, X1),
                (60, X2),
                (70, SPLIT),
                (90, X3),
                (100, X4),
                (120, CANCEL_X1),
                (150, X5),
                (180, X6),
                (200, X7),
                (220, CANCEL_BATCH),
                (260, r#"{"kind":"merge_positions","size":5}"#),
                (300, CANCEL_MARKET_UP),
                (
                    400,
                    r#"{"kind":"place_limit","cid":"x8","asset":0,"side":"SELL","price":0.48,"size":5,"orderType":"GTC","postOnly":false,"expireAtMs":null}"#,
                ),
            ],
        );
    }
}
